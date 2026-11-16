// Owner: Nived
// Gate G8 (PLAN_FINAL 10) and G13 (R3 D-13), measured on the running app through window.__lumenPerf.
//   hover < 4 ms (pointer event -> overlay drawn)   slip frame <= 16.7 ms   site switch < 100 ms   quick answer < 150 ms
//   scan stage 1 <= 100 ms, first stage-2 row <= 300 ms   zero React commits during hover   no long tasks (> 50 ms) in the hot-path runs
// All budgets are multiplied by LUMEN_PERF_SLACK (default 1) so a loaded CI runner does not make the suite flaky; the numbers are printed.
import { expect, test, type Page } from '@playwright/test';
import { G8_BUDGETS_MS } from '../src/perf/budgets';

const SLACK = Number(process.env.LUMEN_PERF_SLACK ?? 1);
/** 60 Hz vsync is 16.667 ms and rAF timestamps are quantized to 0.1 ms, so a perfect run reads 16.7-16.8. This much jitter is not a missed frame. */
const VSYNC_JITTER_MS = 0.5;

type Perf = { stat(n: string): { n: number; p50: number | null; p95: number | null; max: number | null }; counter(n: string): number; reset(): void; start(): void; stop(): void };
const perfOf = <T>(page: Page, fn: (p: Perf) => T) => page.evaluate(`(${fn.toString()})(window.__lumenPerf)`) as Promise<T>;

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.locator('[data-slot="answer"] .answer-strip[data-sun-state]')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => !!(window as unknown as { __lumenPerf?: unknown }).__lumenPerf);
  await page.waitForTimeout(500); // let the first evaluation and fonts settle
}

test('hover: pointer -> overlay drawn p95 < 4 ms over 600 steps, no React commits, no long tasks', async ({ page }) => {
  await openApp(page);
  const box = (await page.locator('[data-slot="barcode"]').boundingBox())!;
  await perfOf(page, (p) => (p.reset(), p.start()));
  const commits0 = await perfOf(page, (p) => p.counter('reactCommits'));
  const y = box.y + box.height / 2;
  for (let i = 0; i < 600; i++) await page.mouse.move(box.x + 4 + ((box.width - 8) * i) / 599, y);
  await page.waitForTimeout(150); // the last frame
  const s = await perfOf(page, (p) => p.stat('hover'));
  const commits = (await perfOf(page, (p) => p.counter('reactCommits'))) - commits0;
  const longTasks = await perfOf(page, (p) => p.counter('longTasks'));
  await perfOf(page, (p) => p.stop());
  console.log(`hover: n=${s.n} p50=${s.p50?.toFixed(2)} p95=${s.p95?.toFixed(2)} max=${s.max?.toFixed(2)} ms | React commits during run: ${commits} | long tasks: ${longTasks}`);
  expect(s.n, 'hover samples were recorded').toBeGreaterThan(50);
  expect(s.p95!, `hover p95 ${s.p95} ms`).toBeLessThan(G8_BUDGETS_MS.hover * SLACK);
  expect(commits, 'React commits during the hover run (hot path must not re-render React)').toBe(0);
  expect(longTasks, 'long tasks (> 50 ms) during the hover run').toBe(0);
});

test('slip drag: frame time p95 <= 16.7 ms over a 60-step drag, no long tasks', async ({ page }) => {
  await openApp(page);
  const slider = page.locator('[data-slot="slip"] input[type="range"]');
  const box = (await slider.boundingBox())!;
  await perfOf(page, (p) => (p.reset(), p.start()));
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.5, y);
  await page.mouse.down();
  for (let i = 0; i < 60; i++) {
    await page.mouse.move(box.x + box.width * (0.5 + 0.35 * Math.sin((i / 59) * Math.PI)), y);
    await page.waitForTimeout(16); // a human-paced drag: about one input per frame
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  const s = await perfOf(page, (p) => p.stat('slipFrame'));
  const dragFrames = await perfOf(page, (p) => p.counter('dragFrames'));
  const dropped = await perfOf(page, (p) => p.counter('droppedFrames'));
  const longTasks = await perfOf(page, (p) => p.counter('longTasks'));
  await perfOf(page, (p) => p.stop());
  console.log(`slip: n=${s.n} p50=${s.p50?.toFixed(2)} p95=${s.p95?.toFixed(2)} max=${s.max?.toFixed(2)} ms | dropped ${dropped}/${dragFrames} | long tasks: ${longTasks}`);
  expect(dragFrames, 'drag frames were recorded').toBeGreaterThan(20);
  expect(dropped / dragFrames, `dropped frames: ${dropped} of ${dragFrames}`).toBeLessThan(0.05); // guide 5.2: dropped frames < 5 %
  expect(s.p95!, `slip frame p95 ${s.p95} ms`).toBeLessThanOrEqual(G8_BUDGETS_MS.slipFrame * SLACK + VSYNC_JITTER_MS);
  expect(longTasks).toBe(0);
});

test('scan: stage 1 <= 100 ms and first stage-2 row <= 300 ms (G13)', async ({ page }) => {
  await openApp(page);
  await perfOf(page, (p) => p.reset());
  await page.getByRole('tab', { name: 'Compare' }).click();
  await expect(page.locator('[data-slot="scan"]')).toContainText('Stage 2', { timeout: 30_000 });
  const s1 = await perfOf(page, (p) => p.stat('scanStage1'));
  const s2 = await perfOf(page, (p) => p.stat('scanFirstStage2'));
  console.log(`scan: stage 1 ${s1.p50?.toFixed(0)} ms | first stage 2 ${s2.p50?.toFixed(0)} ms`);
  expect(s1.n).toBeGreaterThan(0);
  expect(s1.p95!, `stage 1 ${s1.p95} ms`).toBeLessThanOrEqual(G8_BUDGETS_MS.scanStage1 * SLACK);
  expect(s2.p95!, `first stage 2 ${s2.p95} ms`).toBeLessThanOrEqual(G8_BUDGETS_MS.scanFirstStage2 * SLACK);
});

test('quick answer < 150 ms (cached ephemeris and catalog)', async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => {
    const { quickAnswer } = await import('/src/engine/quickAnswer.ts');
    const T = Date.parse('2025-03-06T17:28:50Z');
    for (let i = 0; i < 12; i++) await quickAnswer({ lat: -84.7906 + i * 0.37, lon: 29.1957 + i, utc: T + i * 86_400_000, durationDays: 14, heightM: 2 });
  });
  const s = await perfOf(page, (p) => p.stat('quickAnswer'));
  console.log(`quick answer: n=${s.n} p50=${s.p50?.toFixed(1)} p95=${s.p95?.toFixed(1)} max=${s.max?.toFixed(1)} ms`);
  expect(s.n).toBe(12);
  expect(s.p95!, `quick answer p95 ${s.p95} ms`).toBeLessThan(G8_BUDGETS_MS.quickAnswer * SLACK);
});

test('site switch < 100 ms (selection -> its result is ready)', async ({ page }) => {
  await openApp(page);
  await perfOf(page, (p) => p.reset());
  const ids = ['cy3_shiv_shakti', 'shackleton_ridge', 'blue_ghost_m1', 'im2_athena', 'cy3_shiv_shakti', 'blue_ghost_m1'];
  for (let i = 0; i < ids.length; i++) {
    await page.evaluate(async (id) => {
      const { useScenario } = await import('/src/state/scenarioStore.ts');
      useScenario.getState().selectSite(id);
    }, ids[i]);
    await page.waitForFunction((n) => (window as unknown as { __lumenPerf: Perf }).__lumenPerf.stat('siteSwitch').n >= n, i + 1, { timeout: 10_000 });
  }
  const s = await perfOf(page, (p) => p.stat('siteSwitch'));
  console.log(`site switch: n=${s.n} p50=${s.p50?.toFixed(1)} p95=${s.p95?.toFixed(1)} max=${s.max?.toFixed(1)} ms`);
  expect(s.n).toBeGreaterThanOrEqual(ids.length);
  expect(s.p95!, `site switch p95 ${s.p95} ms`).toBeLessThan(G8_BUDGETS_MS.siteSwitch * SLACK);
});
