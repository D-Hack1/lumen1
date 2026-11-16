// Owner: Abhinav
// Phase 2 Mission Bar in a real browser: jumps S/E/X/T (instant scrub, keyboard), dynamic E label from Nived's
// forced answer states, disabled jump + tooltip, verdict chip crossfade + Mission Profile popover, persona switch.
// Forced states: `?answerState=<D-14 id>` (Nived, src/mocks/forced.ts) and `?verdict=…&provisional=1` (Abhinav).
import { expect, test, type Page } from '@playwright/test';

const D14 = [
  'sunsetIn',
  'sunriseIn',
  'noSunriseBeforeEnd',
  'staysUpPastEnd',
  'earthsetIn',
  'earthriseIn',
  'linkResumesDsn',
  'grazing',
  'belowOpsElevation',
] as const;

async function open(page: Page, query = '') {
  await page.goto(`/${query}`);
  await page.waitForSelector('html[data-ready="true"]');
}
const jump = (page: Page, slot: string) => page.locator(`[data-region="mission-bar"] [data-jump="${slot}"]`);
const met = (page: Page) => page.locator('.mb-met__value');

test.use({ viewport: { width: 1920, height: 960 } });

test.describe('dynamic E label across all 9 D-14 forced states', () => {
  for (const id of D14) {
    test(id, async ({ page }) => {
      await open(page, `?answerState=${id}`);
      // the Answer Strip (Nived) and the E button read the same answer state
      const earthState = await page.locator('.answer-strip').getAttribute('data-earth-state');
      const expected = earthState === 'earthriseIn' ? 'earthrise' : 'earthset';
      await expect(jump(page, 'E')).toHaveAttribute('data-event', expected);
      await expect(jump(page, 'E')).toHaveAccessibleName(expected === 'earthrise' ? 'Next Earthrise' : 'Next Earthset');
      await page.screenshot({
        path: `e2e/screens/phase-2/state-${id}.png`,
        clip: { x: 0, y: 0, width: 1920, height: 160 },
      });
    });
  }

  test('flips between Earthset and Earthrise', async ({ page }) => {
    await open(page, '?answerState=earthsetIn');
    await expect(jump(page, 'E')).toContainText('Earthset');
    await open(page, '?answerState=earthriseIn');
    await expect(jump(page, 'E')).toContainText('Earthrise');
  });
});

/** Wait two animation frames: the MET readout is written by a bus subscriber on the next frame (Fast Lane, §1.3). */
const frames = (page: Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

test('jump buttons and S/E/X/T keys commit the scrub instantly (no tween)', async ({ page }) => {
  await open(page);
  const before = (await met(page).textContent()) ?? '';
  await jump(page, 'E').click(); // the default mock has Earth events in the window (no sunset: S is disabled)
  // the readout updates on the next frame, never synchronously, so wait for it (auto-retry), don't read once
  await expect(met(page)).not.toHaveText(before);

  // instant, no tween: once it has changed, the value never moves again (a tween would keep stepping)
  const settled = await met(page).textContent();
  for (let i = 0; i < 10; i++) await frames(page);
  await page.waitForTimeout(300);
  expect(await met(page).textContent()).toBe(settled);

  await page.keyboard.press('t');
  await expect(met(page)).toHaveText('T+00:00:00');
  await page.keyboard.press('e');
  await expect(met(page)).not.toHaveText('T+00:00:00');

  // keys are ignored while typing in a field (wait past the frame a jump would need, so the check isn't vacuous)
  await page.locator('.mb-input').focus();
  const typingBefore = await met(page).textContent();
  await page.keyboard.press('s');
  await page.keyboard.press('e');
  await frames(page);
  await page.waitForTimeout(100);
  expect(await met(page).textContent()).toBe(typingBefore);
});

test('tooltip shows target time ± and key', async ({ page }) => {
  await open(page);
  await jump(page, 'E').hover();
  await expect(page.getByRole('tooltip')).toContainText(
    /Next Earth(set|rise) · \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC ± \d+ h( \(grazing\))? · key E/,
  );
  await page.mouse.move(0, 500);
  await jump(page, 'T').hover();
  await expect(page.getByRole('tooltip')).toHaveText(/Touchdown \(T0\) · 2025-03-06 17:28 UTC · key T/);
});

test('disabled jump: tooltip explains, click and key show a toast, scrub unchanged', async ({ page }) => {
  await open(page); // mock: the Sun stays up for the whole 14-day window → no sunset
  await expect(jump(page, 'S')).toHaveAttribute('aria-disabled', 'true');
  await jump(page, 'S').hover();
  await expect(page.getByRole('tooltip')).toHaveText('Next Sunset · none before window end · key S');
  const before = await met(page).textContent();
  await jump(page, 'S').click({ force: true });
  await expect(page.getByText('No such event in this window')).toBeVisible();
  await page.keyboard.press('s');
  expect(await met(page).textContent()).toBe(before);
  await page.screenshot({
    path: 'e2e/screens/phase-2/jump-disabled.png',
    clip: { x: 0, y: 0, width: 1920, height: 160 },
  });
});

test('verdict chip crossfades on change and opens the Mission Profile popover', async ({ page }) => {
  await open(page, '?verdict=GO');
  const chip = page.locator('.mb-verdict');
  await expect(chip).toHaveAttribute('data-verdict', 'GO');
  await expect(chip.locator('.mb-verdict__layer')).toHaveCount(1);

  await chip.click();
  const pop = page.getByRole('dialog', { name: 'Mission Profile' });
  await expect(pop).toBeVisible();
  await expect(pop).toContainText('Hard requirements');
  await page.screenshot({
    path: 'e2e/screens/phase-2/verdict-popover.png',
    clip: { x: 1300, y: 0, width: 620, height: 520 },
  });

  // open–close–open spam: ends open, no stuck layers
  await page.keyboard.press('Escape');
  await chip.click();
  await page.keyboard.press('Escape');
  await chip.click();
  await expect(pop).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(chip).toBeFocused(); // focus returns to the anchor
});

test('verdict chip: 120 ms opacity crossfade when the verdict changes (PENDING → settled on load)', async ({
  page,
}) => {
  // record every animation started on a chip layer, from the very first frame
  await page.addInitScript(() => {
    const seen: { d: number; props: string[] }[] = [];
    (window as unknown as { __chipAnims: typeof seen }).__chipAnims = seen;
    const orig = Element.prototype.animate;
    Element.prototype.animate = function (
      this: Element,
      kf: Keyframe[] | PropertyIndexedKeyframes | null,
      opts?: number | KeyframeAnimationOptions,
    ) {
      if (this.classList?.contains('mb-verdict__layer')) {
        const frames = (Array.isArray(kf) ? kf : []) as Keyframe[];
        seen.push({ d: typeof opts === 'number' ? opts : Number(opts?.duration), props: Object.keys(frames[0] ?? {}) });
      }
      return orig.call(this, kf, opts);
    };
  });
  await open(page);
  const chip = page.locator('.mb-verdict');
  await expect(chip).not.toHaveAttribute('data-verdict', 'PENDING');
  await expect(chip.locator('.mb-verdict__layer')).toHaveCount(1); // old layer removed after the fade
  const anims = await page.evaluate(
    () => (window as unknown as { __chipAnims: { d: number; props: string[] }[] }).__chipAnims,
  );
  expect(anims.length).toBeGreaterThanOrEqual(2); // old out + new in (StrictMode may restart the enter once in dev)
  for (const a of anims) {
    expect(a.d).toBe(120);
    expect(a.props).toEqual(['opacity']); // opacity only, never layout or transform
  }
});

test('provisional verdict and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, '?verdict=MARGINAL&provisional=1');
  const chip = page.locator('.mb-verdict');
  await expect(chip).toHaveAttribute('data-provisional', 'true');
  await expect(chip).toContainText('provisional');
  await chip.click();
  const dur = await page
    .getByRole('dialog')
    .evaluate((el) => el.getAnimations().map((a) => Number((a.effect as KeyframeEffect).getTiming().duration)));
  for (const d of dur) expect(d).toBeLessThanOrEqual(80);
});

test('persona switch changes copy everywhere (Mission Bar + Answer Strip)', async ({ page }) => {
  await open(page, '?answerState=sunriseIn');
  await expect(jump(page, 'X')).toHaveAccessibleName('Next Shadow Exit');
  const stripPlanner = await page.locator('.answer-strip').innerText();
  await page.getByRole('radio', { name: 'Educator' }).click();
  await expect(jump(page, 'X')).toHaveAccessibleName('Jump to when the Sun comes back');
  await expect(jump(page, 'X')).toContainText('Sun returns');
  await expect(page.locator('.answer-strip')).toContainText('The Sun comes back in');
  expect(await page.locator('.answer-strip').innerText()).not.toBe(stripPlanner);
  await expect(page.locator('.mb-verdict')).not.toContainText(/^GO$|^MARGINAL$|^NO-GO$/);
  await page.screenshot({
    path: 'e2e/screens/phase-2/persona-educator.png',
    clip: { x: 0, y: 0, width: 1920, height: 160 },
  });
});
