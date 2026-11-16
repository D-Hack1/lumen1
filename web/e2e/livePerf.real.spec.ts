// Owner: Ebin — measures the LIVE app (real data) on the machine it runs on, for the G8 evidence. It asserts only that it measured something;
// the budgets are judged in pipeline/lumen_pipeline/validation/report.py, not here, so a slow machine never makes this spec flaky.
//   LUMEN_G8_OUT=<file> npx playwright test -c e2e/playwright.real.config.ts livePerf
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { expect, test, type Page } from '@playwright/test';

const pct = (a: number[], p: number): number => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN;
};
const stats = (a: number[]) => ({ n: a.length, p50: +pct(a, 50).toFixed(2), p95: +pct(a, 95).toFixed(2), max: +Math.max(...a).toFixed(2) });
const out: Record<string, unknown> = {};

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1440, height: 810 } });

async function ready(page: Page, hash: string) {
  await page.goto(hash);
  await page.waitForSelector('.lm-header', { timeout: 60_000 });
  await page.waitForTimeout(1500);
}

test('site switch on Stand here: click -> new numbers on screen', async ({ page }) => {
  await ready(page, '/#stand-here');
  await page.waitForSelector('[data-testid="stand-here-details"]', { timeout: 60_000 });
  const names = ['Ridge', 'CY-3', 'IM-2', 'Blue Ghost', 'CY-3', 'IM-2', 'Ridge', 'IM-2'];
  const times: number[] = [];
  const finals: number[] = [];
  for (const name of names) {
    const ms = await page.evaluate(async (n) => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === n && b.getAttribute('aria-pressed') === 'false') as HTMLButtonElement | undefined;
      if (!btn) return -1;
      const root = document.querySelector('main') as HTMLElement;
      const before = root.innerText;
      const t0 = performance.now();
      btn.click();
      await new Promise<void>((res) => {
        const check = () => (root.innerText !== before ? res() : requestAnimationFrame(check));
        check();
      });
      // The page removes the old numbers while the engine recomputes and shows the new ones when it answers: wait for them to go, then come back.
      await new Promise<void>((res) => {
        const gone = () => (!document.querySelector('.lm-nums__value') ? res() : performance.now() - t0 > 3000 ? res() : requestAnimationFrame(gone));
        gone();
      });
      await new Promise<void>((res) => {
        const back = () => (document.querySelector('.lm-nums__value') ? res() : requestAnimationFrame(back));
        back();
      });
      const first = performance.now() - t0;
      // Staged evaluation: the numbers above are stage 1 (nominal). Also time the final stage (+/- and verdict), so both are reported.
      await new Promise<void>((res) => {
        const done = () => (document.querySelector('.lm-nums[data-stage="final"]') ? res() : requestAnimationFrame(done));
        done();
      });
      return [first, performance.now() - t0];
    }, name);
    if (ms !== -1) { times.push((ms as number[])[0]); finals.push((ms as number[])[1]); }
    await page.waitForTimeout(400);
  }
  out.siteSwitchMs = stats(times);
  out.siteSwitchFinalMs = stats(finals); // to the +/- and verdict (stage 2), reported alongside
  expect(times.length).toBeGreaterThan(3);
});

test('hover on the Power chart: pointer event -> next frame', async ({ page }) => {
  await ready(page, '/#stand-here');
  await page.waitForSelector('[data-testid="stand-here-details"]', { timeout: 60_000 });
  await page.locator('[data-testid="stand-here-details"]').getByRole('button', { name: 'Power & barcode' }).click();
  await page.waitForTimeout(800);
  const chart = page.locator('[data-testid="stand-here-details"] canvas').first();
  await chart.scrollIntoViewIfNeeded();
  const box = (await chart.boundingBox())!;
  await page.evaluate(() => {
    const w = window as unknown as { __lat: number[] };
    w.__lat = [];
    window.addEventListener('pointermove', (e) => {
      const t = e.timeStamp;
      requestAnimationFrame((now) => w.__lat.push(now - t));
    }, true);
  });
  for (let i = 0; i < 300; i++) await page.mouse.move(box.x + 6 + ((box.width - 12) * i) / 299, box.y + box.height / 2);
  await page.waitForTimeout(200);
  const lat = await page.evaluate(() => (window as unknown as { __lat: number[] }).__lat);
  out.hoverToFrameMs = stats(lat);
  expect(lat.length).toBeGreaterThan(50);
});

test('slip drag: frame time', async ({ page }) => {
  await ready(page, '/#slip');
  const slider = page.locator('#lm-slip');
  const box = (await slider.boundingBox())!;
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __go: boolean };
    w.__frames = [];
    w.__go = true;
    let last = performance.now();
    const loop = (now: number) => {
      if (!w.__go) return;
      w.__frames.push(now - last);
      last = now;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.5, y);
  await page.mouse.down();
  for (let i = 0; i < 90; i++) {
    await page.mouse.move(box.x + box.width * (0.5 + 0.4 * Math.sin((i / 89) * Math.PI)), y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __go: boolean };
    w.__go = false;
    return w.__frames.slice(2);
  });
  out.slipDragFrameMs = stats(frames);
  expect(frames.length).toBeGreaterThan(30);
});

test.afterAll(() => {
  const file = process.env.LUMEN_G8_OUT;
  if (!file) return;
  const cpus = os.cpus();
  writeFileSync(
    file,
    JSON.stringify(
      { measured: out, machine: { platform: os.platform(), release: os.release(), cpu: cpus[0]?.model, logical_cpus: cpus.length, total_mem_gb: +(os.totalmem() / 1e9).toFixed(1), node: process.version }, viewport: '1440x810', browser: 'Playwright Chromium (headless)', data: 'real' },
      null,
      2,
    ) + '\n',
  );
});
