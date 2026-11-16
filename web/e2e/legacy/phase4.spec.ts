// Owner: Abhinav — Frontend Phase 4 behaviour (mock data, Nived's mocks): Compare view assembly, scenario rows A–D
// (add via + Add / + Compare / Shift-click card / Shift-click map pin, cap at 4 with tooltip, baseline swap,
// duplicate / remove / load into Cockpit), Compare slip on one row vs all (Fast Lane live text + commit on release),
// Scan stage-1 → stage-2 streaming with "provisional" → "bounded" badges and the verdict popover's provisional line,
// Mission Profile validation + 150 ms debounce, Profile & Battery accordion overlay, view crossfade, URL round-trip,
// and the Compare slip drag frame budget from the Perf HUD (G8: p95 ≤ 16.7 ms).
// Screens → e2e/screens/phase-4/.
import { expect, test, type Page } from '@playwright/test';
import { scenarioToken } from './helpers';

const SHOTS = 'e2e/screens/phase-4';
const DAY = 86_400_000;
const LANDING = Date.parse('2025-03-06T17:28:50Z');
test.use({ viewport: { width: 1920, height: 960 } });

type Perf = { stat(n: string): { n: number; p50: number | null; p95: number | null; max: number | null }; counter(n: string): number; reset(): void; start(): void; stop(): void };
const perfOf = <T,>(page: Page, fn: (p: Perf) => T) => page.evaluate(`(${fn.toString()})(window.__lumenPerf)`) as Promise<T>;

async function open(page: Page, partial: Record<string, unknown> = {}, extra = '') {
  await page.goto(`/?s=${scenarioToken(partial)}${extra}`);
  await page.waitForSelector('html[data-ready="true"]');
}
const row = (page: Page, id: string) => page.locator(`.sc-row[data-row="${id}"]:not([data-leaving])`);
const rowIds = (page: Page) => page.locator('.sc-row:not([data-leaving])').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.row));
/** Decode the share token in the address bar (urlSync writes it 250 ms after a change). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function urlScenario(page: Page): Promise<Record<string, any>> {
  await page.waitForTimeout(400);
  const tok = new URL(page.url()).searchParams.get('s')!;
  return JSON.parse(Buffer.from(tok.slice(tok.indexOf('.') + 1), 'base64url').toString('utf8'));
}
const fourRows = (extra: Record<string, unknown> = {}) =>
  (['A', 'B', 'C', 'D'] as const).map((id, i) => ({
    id,
    site: { kind: 'site', id: ['im2_athena', 'cy3_shiv_shakti', 'shackleton_ridge', 'im2_athena'][i] },
    landingUtc: LANDING + i * 3 * DAY,
    slipDays: 0,
    panelPreset: 'fourSide',
    yawDeg: null,
    tilt: { magnitudeDeg: i * 5, directionDeg: 90 },
    heightM: 2,
    baseline: i === 0,
    ...extra,
  }));

test.describe('Compare rows', () => {
  test('add from + Add, + Compare, Shift-click card and map pin; capped at 4 with a tooltip', async ({ page }) => {
    await open(page);
    await page.waitForSelector('.sb-card');
    // Cockpit: "+ Compare" on a card, Shift-click a card, Shift-click a map pin
    await page.locator('.sb-card').nth(0).getByRole('button', { name: '+ Compare' }).click();
    await page.locator('.sb-card').nth(1).click({ modifiers: ['Shift'] });
    const pin = page.locator('.basemap__pin[data-site]').first();
    await pin.click({ modifiers: ['Shift'], force: true });
    await page.getByRole('tab', { name: 'Compare' }).first().click();
    await expect(page.locator('.app-root[data-view="compare"]')).toBeVisible();
    await expect.poll(() => rowIds(page)).toEqual(['A', 'B', 'C']);
    // + Add adds the Cockpit scenario as D, then the button is disabled and explains why
    await page.locator('.sc-add').click();
    await expect.poll(() => rowIds(page)).toEqual(['A', 'B', 'C', 'D']);
    await expect(page.locator('.sc-add')).toBeDisabled();
    await expect(page.locator('.sc-rows__count')).toHaveText('4/4');
    await page.mouse.move(5, 500); // leave first: hovering the spot the cursor already rests on fires no pointerenter
    await page.locator('.sc-add-wrap').hover();
    await expect(page.locator('.ui-tooltip')).toContainText('Compare holds up to 4 rows');
    await expect(row(page, 'A').getByRole('button', { name: /Compare holds up to 4/ })).toBeDisabled(); // duplicate too
    await page.screenshot({ path: `${SHOTS}/rows-4-full-tooltip.png` });
    // each row shows name + tier, landing UTC, attitude, colour tag
    const a = row(page, 'A');
    await expect(a.locator('.sc-row__tag')).toHaveText('A');
    await expect(a.locator('.sc-row__tier')).toHaveText(/Tier/);
    await expect(a.locator('.sc-row__utc')).toHaveText(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    await expect(a.locator('.sc-row__att')).toHaveText(/side panels · 2 m · /);
    expect(await a.locator('.sc-row__tag').evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(
      await row(page, 'B').locator('.sc-row__tag').evaluate((e) => getComputedStyle(e).backgroundColor),
    );
  });

  test('baseline swap (exactly one ★), duplicate, remove (160 ms exit), load into Cockpit', async ({ page }) => {
    await open(page, { view: 'compare', compareRows: fourRows().slice(0, 3) });
    await expect.poll(() => rowIds(page)).toEqual(['A', 'B', 'C']);
    const stars = () => page.locator('.sc-row:not([data-leaving]) .sc-row__star[aria-pressed="true"]').count();
    expect(await stars()).toBe(1);
    await row(page, 'B').getByRole('button', { name: 'Make row B the baseline' }).click();
    expect(await stars()).toBe(1);
    await expect(row(page, 'B')).toHaveAttribute('data-baseline', 'true');
    await expect(row(page, 'A')).not.toHaveAttribute('data-baseline', 'true');
    await row(page, 'B').getByRole('button', { name: 'Row B is the baseline' }).click(); // can't un-baseline
    expect(await stars()).toBe(1);
    await page.screenshot({ path: `${SHOTS}/rows-baseline-swap.png` });
    expect((await urlScenario(page)).compareRows.map((r: { baseline: boolean }) => r.baseline)).toEqual([false, true, false]);

    // duplicate C → D (enter animation, 160 ms)
    const enter = await page.evaluate(async () => {
      (document.querySelector('.sc-row[data-row="C"] button[aria-label="Duplicate row C"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 30));
      const d = document.querySelector('.sc-row[data-row="D"]') as HTMLElement;
      const a = d?.getAnimations()[0];
      return a ? Number(a.effect!.getTiming().duration) : null;
    });
    expect(enter).toBe(160);
    await expect.poll(() => rowIds(page)).toEqual(['A', 'B', 'C', 'D']);

    // remove A: fades out over 160 ms, then the others slide up; the baseline stays B
    const exit = await page.evaluate(async () => {
      (document.querySelector('.sc-row[data-row="A"] button[aria-label="Remove row A"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 30));
      const el = document.querySelector('.sc-row[data-row="A"]') as HTMLElement | null;
      const a = el?.getAnimations()[0];
      return { leaving: el?.dataset.leaving === 'true', dur: a ? Number(a.effect!.getTiming().duration) : null };
    });
    expect(exit).toEqual({ leaving: true, dur: 160 });
    await expect(page.locator('.sc-row[data-row="A"]')).toHaveCount(0);
    await expect.poll(() => rowIds(page)).toEqual(['B', 'C', 'D']);
    await expect(row(page, 'B')).toHaveAttribute('data-baseline', 'true');

    // load C into the Cockpit
    await row(page, 'C').getByRole('button', { name: 'Load row C into the Cockpit' }).click();
    await expect(page.locator('.app-root[data-view="cockpit"]')).toBeVisible();
    const s = await urlScenario(page);
    expect(s.site).toEqual({ kind: 'site', id: 'shackleton_ridge' });
    expect(s.landingUtc).toBe(LANDING + 6 * DAY);
  });
});

test.describe('Compare slip', () => {
  test('one row vs all rows: live text during the drag, commit on release', async ({ page }) => {
    await open(page, { view: 'compare', compareRows: fourRows(), compareSelected: 'B' });
    const utc = (id: string) => row(page, id).locator('.sc-row__utc').textContent();
    const a0 = await utc('A');
    const b0 = await utc('B');
    const slider = page.locator('.cmp-slip input[type="range"]');

    // selected row only (B)
    await page.locator('.cmp-slip').getByRole('radio', { name: 'Row B' }).click();
    const box = (await slider.boundingBox())!;
    const y = box.y + box.height / 2;
    const xAt = (d: number) => box.x + 8 + ((box.width - 16) * (d + 30)) / 60;
    await page.mouse.move(xAt(0), y);
    await page.mouse.down();
    await page.mouse.move(xAt(10), y, { steps: 8 });
    await page.waitForTimeout(50);
    const live = { a: await utc('A'), b: await utc('B'), chip: await page.locator('.cmp-slip__chip').textContent() };
    expect((await urlScenario(page)).compareRows[1].slipDays ?? 0, 'not committed while dragging').toBe(0);
    await page.mouse.up();
    expect(live.a, 'row A untouched by a row-B drag').toBe(a0);
    expect(live.b, 'row B landing moves live (Fast Lane)').not.toBe(b0);
    expect(live.chip).toMatch(/slipped \+\d+ d/);
    let s = await urlScenario(page);
    const bSlip = s.compareRows[1].slipDays;
    expect(bSlip).toBeGreaterThan(5);
    expect(s.slipDays).toBe(0);
    expect(s.compareRows.filter((r: { slipDays: number }) => r.slipDays !== 0)).toHaveLength(1);
    expect(Date.parse((await utc('B'))! + 'Z') - Date.parse(b0! + 'Z')).toBe(bSlip * DAY);
    await page.screenshot({ path: `${SHOTS}/slip-row-B.png` });

    // all rows: keyboard steps commit on key up
    await page.locator('.cmp-slip').getByRole('radio', { name: 'All rows' }).click();
    await slider.focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    s = await urlScenario(page);
    expect(s.slipDays).toBe(3);
    expect(Date.parse((await utc('A'))! + 'Z') - Date.parse(a0! + 'Z')).toBe(3 * DAY);
    expect(Date.parse((await utc('B'))! + 'Z') - Date.parse(b0! + 'Z')).toBe((bSlip + 3) * DAY);
    await expect(row(page, 'A').locator('.sc-row__slip')).toHaveText('slip +3 d');
    await page.screenshot({ path: `${SHOTS}/slip-all.png` });

    // Fast Lane: no transitions on the live elements
    const hot = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.sc-rows [data-hotpath], .cmp-slip [data-hotpath]')].map((e) => getComputedStyle(e).transitionDuration),
    );
    expect(hot.length).toBeGreaterThan(4);
    expect(hot.every((d) => d.split(',').every((x) => parseFloat(x) === 0))).toBe(true);
  });

  test('HUD: compare slip drag frame p95 ≤ 16.7 ms over 60 steps, no long tasks', async ({ page }) => {
    await open(page, { view: 'compare', compareRows: fourRows(), compareSelected: 'A' });
    await page.waitForFunction(() => !!(window as unknown as { __lumenPerf?: unknown }).__lumenPerf);
    await page.waitForTimeout(500);
    const slider = page.locator('.cmp-slip input[type="range"]');
    const box = (await slider.boundingBox())!;
    const y = box.y + box.height / 2;
    await perfOf(page, (p) => (p.reset(), p.start()));
    await page.mouse.move(box.x + box.width * 0.5, y);
    await page.mouse.down();
    for (let i = 0; i < 60; i++) {
      await page.mouse.move(box.x + box.width * (0.5 + 0.35 * Math.sin((i / 59) * Math.PI)), y);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
    const s = await perfOf(page, (p) => p.stat('slipFrame'));
    const frames = await perfOf(page, (p) => p.counter('dragFrames'));
    const dropped = await perfOf(page, (p) => p.counter('droppedFrames'));
    const longTasks = await perfOf(page, (p) => p.counter('longTasks'));
    await perfOf(page, (p) => p.stop());
    console.log(`compare slip: n=${s.n} p50=${s.p50?.toFixed(2)} p95=${s.p95?.toFixed(2)} max=${s.max?.toFixed(2)} ms | dropped ${dropped}/${frames} | long tasks ${longTasks}`);
    expect(frames).toBeGreaterThan(20);
    expect(s.p95!).toBeLessThanOrEqual(16.7 + 0.5); // 0.5 ms = rAF timestamp quantisation at 60 Hz (same as g8.spec)
    expect(dropped / frames).toBeLessThan(0.05);
    expect(longTasks).toBe(0);
  });
});

test.describe('Scan streaming + verdict popover', () => {
  test('stage 1 "provisional" → stage 2 "bounded" badges; popover says provisional during stage 1', async ({ page }) => {
    await open(page, { view: 'compare', compareRows: fourRows().slice(0, 2) });
    await expect(page.locator('[data-slot="scan"] .scan[data-stage="2"]')).toBeVisible();
    // open the verdict popover, then restart the scan from the keyboard (a pointer-down would close the popover)
    await page.locator('.mb-verdict').click();
    const pop = page.getByTestId('verdict-popover');
    await expect(pop).toBeVisible();
    const seq = await page.evaluate(async () => {
      const log: string[] = [];
      const scan = document.querySelector('[data-slot="scan"] .scan') as HTMLElement;
      const snap = () => {
        const first = scan.querySelector('tbody tr') as HTMLElement | null;
        const prov = !!document.querySelector('[data-testid="verdict-scan-provisional"]');
        const badge = document.querySelector('[data-testid="verdict-popover-badge"]')?.textContent ?? '';
        const entry = `stage=${scan.dataset.stage ?? 0} row1=${first?.dataset.bounds ?? '-'} pop=${prov ? 'prov' : '-'}${badge.includes('provisional') ? '+badge' : ''}`;
        if (log[log.length - 1] !== entry) log.push(entry);
      };
      const mo = new MutationObserver(snap);
      mo.observe(document.body, { subtree: true, attributes: true, childList: true });
      const radio = [...document.querySelectorAll<HTMLElement>('[data-slot="scan"] [role="radio"]')].find((r) => r.getAttribute('aria-checked') !== 'true')!;
      radio.focus();
      radio.click(); // DOM click() fires no pointerdown, so the popover's outside-dismiss does not close it
      await new Promise((r) => setTimeout(r, 600));
      mo.disconnect();
      return log;
    });
    console.log(seq.join('\n'));
    expect(seq.some((e) => e.startsWith('stage=1 row1=nominal'))).toBe(true);
    expect(seq.some((e) => /stage=1 .*pop=prov\+badge/.test(e)), 'popover shows provisional while stage 1 only').toBe(true);
    expect(seq.at(-1)).toMatch(/^stage=2 row1=bounded pop=-/);
  });

  test('popover lists each hard requirement at the conservative bound + battery + summary line', async ({ page }) => {
    await open(page, { view: 'cockpit' });
    await page.locator('.mb-verdict').click();
    const pop = page.getByTestId('verdict-popover');
    await expect(pop).toBeVisible();
    await expect(pop.locator('.mp-req__row')).toHaveCount(5);
    for (const r of ['sunlit', 'link', 'night', 'slope', 'battery']) await expect(pop.locator(`[data-req="${r}"]`)).toHaveCount(1);
    for (const r of await pop.locator('.mp-req__row').all())
      expect(await r.getAttribute('data-status')).toMatch(/^(pass|marginal|fail|unknown)$/);
    await expect(pop.getByTestId('verdict-profile-summary')).toHaveText(/^14 d · sunlit ≥ 50% · link ≥ 100 h · night ≤ 72 h · slope ≤ 10° · /);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/verdict-popover.png` });
  });
});

test.describe('Mission Profile', () => {
  test('validation + units; valid edits commit 150 ms after the last key; summary feeds the popover', async ({ page }) => {
    await open(page, { view: 'compare', compareRows: fourRows().slice(0, 2) });
    const form = page.locator('[data-slot="missionProfile"] form');
    const units = await form.locator('.mp-field__unit').allTextContents();
    expect(units).toEqual(['d', '%', 'h', 'h', '°', 'Wh', '%', 'W']);
    const sunlit = form.getByLabel(/Min sunlit/);

    await sunlit.fill('140');
    await expect(sunlit).toHaveAttribute('aria-invalid', 'true');
    await expect(form.locator('.mp-form__error')).toHaveText('Min sunlit: must be 0–100 %');
    await page.screenshot({ path: `${SHOTS}/profile-invalid.png` });
    expect((await urlScenario(page)).profile?.minSunlitPct ?? 50, 'invalid input never reaches the store').toBe(50);

    const link = form.getByLabel(/Min link/);
    await sunlit.fill('62');
    await link.fill('400'); // > 14 d × 24 h = 336 h
    await expect(form.locator('.mp-form__error')).toHaveText(/more than the 336 h on the surface/);
    await link.fill('120');
    await expect(form.locator('.mp-form__error')).toHaveCount(0);
    const t0 = Date.now();
    await expect(form.getByTestId('profile-summary')).toHaveText(/sunlit ≥ 62% · link ≥ 120 h/);
    expect(Date.now() - t0, 'debounced commit lands promptly').toBeLessThan(1500);
    const s = await urlScenario(page);
    expect(s.profile).toMatchObject({ minSunlitPct: 62, minLinkHours: 120 });

    // debounce: a single keystroke is not committed before ~150 ms
    const timing = await page.evaluate(async () => {
      const input = document.querySelector<HTMLInputElement>('[data-slot="missionProfile"] input[aria-describedby], [data-slot="missionProfile"] .mp-field__input')!;
      const summary = () => document.querySelector('[data-testid="profile-summary"]')!.textContent!;
      const before = summary();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '13');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const t = performance.now();
      await new Promise((r) => setTimeout(r, 80));
      const at80 = summary() !== before;
      while (summary() === before && performance.now() - t < 1000) await new Promise((r) => setTimeout(r, 5));
      return { at80, ms: performance.now() - t };
    });
    expect(timing.at80, 'not committed at 80 ms').toBe(false);
    expect(timing.ms).toBeGreaterThanOrEqual(140);
    await page.screenshot({ path: `${SHOTS}/profile-form.png` });

    await page.locator('.mb-verdict').click();
    await expect(page.getByTestId('verdict-profile-summary')).toHaveText(/^13 d · sunlit ≥ 62% · link ≥ 120 h/);
  });

  test('Profile & Battery accordion: overlay (no layout change, no scroll), 180 ms rise, Esc closes', async ({ page }) => {
    await open(page, { view: 'cockpit' });
    await page.waitForSelector('[data-slot="touchdown"]');
    const boxes = () =>
      page.evaluate(() =>
        ['ribbon', 'touchdown', 'metricDeck', 'profileBattery'].map((id) => {
          const r = document.querySelector(`[data-slot="${id}"]`)!.getBoundingClientRect();
          return [id, Math.round(r.top), Math.round(r.height)];
        }),
      );
    const before = await boxes();
    await expect(page.getByTestId('battery-header')).toHaveText(/(Survives longest night ✓ with|Short of the longest night ✗ by) [\d.]+ h|waits for/);
    const dur = await page.evaluate(async () => {
      document.querySelector<HTMLButtonElement>('.pb-acc .ui-acc__head')!.click();
      await new Promise((r) => setTimeout(r, 30));
      const a = document.querySelector<HTMLElement>('.ui-acc__panel')!.getAnimations()[0];
      return a ? Number(a.effect!.getTiming().duration) : null;
    });
    expect(dur).toBe(180);
    const panel = page.locator('.ui-acc__panel');
    await expect(panel).toHaveAttribute('aria-label', 'Profile & Battery');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.mp-field')).toHaveCount(8);
    await expect(panel.getByTestId('battery-line')).toBeVisible();
    await page.waitForTimeout(250);
    expect(await boxes(), 'the overlay never moves or resizes a slot').toEqual(before);
    const scroll = await page.evaluate(() => [document.documentElement.scrollHeight <= innerHeight, document.documentElement.scrollWidth <= innerWidth]);
    expect(scroll).toEqual([true, true]);
    const pb = (await page.locator('[data-slot="profileBattery"]').boundingBox())!;
    const pp = (await panel.boundingBox())!;
    expect(pp.y + pp.height).toBeLessThanOrEqual(pb.y + 1); // rises above the header, inside the viewport
    expect(pp.y).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/profile-battery-accordion.png` });

    // compact form edits the same profile
    await panel.getByLabel(/Battery/).first().fill('3000');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    expect((await urlScenario(page)).profile.batteryWh).toBe(3000);
  });
});

test.describe('Shell', () => {
  test('view switch is a ≤ 150 ms opacity crossfade (old view fades out 120 ms, new fades in 150 ms)', async ({ page }) => {
    await open(page, { view: 'cockpit' });
    await page.waitForSelector('[data-slot="ribbon"]');
    const r = await page.evaluate(async () => {
      const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.includes('Compare'))!;
      tab.click();
      await new Promise((res) => setTimeout(res, 20));
      const mains = [...document.querySelectorAll<HTMLElement>('main.app-view')];
      const info = mains.map((m) => {
        const a = m.getAnimations().find((x) => (x as CSSAnimation).animationName?.startsWith('lumen-fade'));
        return { leaving: m.classList.contains('app-view--leaving'), name: (a as CSSAnimation | undefined)?.animationName, dur: a ? Number(a.effect!.getTiming().duration) : null, inert: m.hasAttribute('inert') };
      });
      await new Promise((res) => setTimeout(res, 300));
      return { info, after: document.querySelectorAll('main.app-view').length };
    });
    expect(r.info).toEqual([
      { leaving: true, name: 'lumen-fade-out', dur: 120, inert: true },
      { leaving: false, name: 'lumen-fade-in', dur: 150, inert: false },
    ]);
    expect(r.after).toBe(1);
  });

  test('URL round-trip: rows, baseline, per-row slip, selection, profile and centre tab', async ({ page, context }) => {
    await open(page, { view: 'compare', compareRows: fourRows().slice(0, 3) });
    await row(page, 'C').getByRole('button', { name: 'Make row C the baseline' }).click();
    await row(page, 'B').locator('.sc-row__main').click();
    await page.locator('.cmp-slip').getByRole('radio', { name: 'Row B' }).click();
    const slider = page.locator('.cmp-slip input[type="range"]');
    await slider.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
    await page.locator('.compare-tabs').getByRole('radio', { name: 'Season Strip' }).click();
    const form = page.locator('[data-slot="missionProfile"] form');
    await form.getByLabel(/Max longest night/).fill('60');
    await form.getByLabel(/Usable DoD/).fill('65');
    await page.waitForTimeout(500);
    const url = page.url();

    const p2 = await context.newPage();
    await p2.goto(url);
    await p2.waitForSelector('html[data-ready="true"]');
    await expect(p2.locator('.app-root[data-view="compare"]')).toBeVisible();
    await expect.poll(() => rowIds(p2)).toEqual(['A', 'B', 'C']);
    await expect(row(p2, 'C')).toHaveAttribute('data-baseline', 'true');
    await expect(row(p2, 'B')).toHaveAttribute('data-selected', 'true');
    await expect(row(p2, 'B').locator('.sc-row__slip')).toHaveText('slip -4 d');
    await expect(p2.locator('.cmp-slip').getByRole('radio', { name: 'Row B' })).toHaveAttribute('aria-checked', 'true');
    await expect(p2.locator('.compare-tabs').getByRole('radio', { name: 'Season Strip' })).toHaveAttribute('aria-checked', 'true');
    await expect(p2.locator('[data-slot="missionProfile"]').getByLabel(/Max longest night/)).toHaveValue('60');
    await expect(p2.locator('[data-slot="missionProfile"]').getByLabel(/Usable DoD/)).toHaveValue('65');
    await p2.screenshot({ path: `${SHOTS}/url-roundtrip.png` });
  });
});
