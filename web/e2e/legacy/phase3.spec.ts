// Owner: Abhinav — Frontend Phase 3 behaviour (mock data): Site Explorer, Definitions Bar + ISRO preset, InfoBadge.
// Screens → e2e/screens/phase-3/. The ISRO → Answer Strip check against REAL data is isro-preset.real.spec.ts.
import { expect, test } from '@playwright/test';
import { cy3Scenario, openScenario } from './helpers';

const SHOTS = 'e2e/screens/phase-3';
test.use({ viewport: { width: 1920, height: 960 } });

test.describe('Definitions Bar + ISRO preset', () => {
  test('default line, ✎ popover (150 ms, origin at the ✎), preset chip + reset', async ({ page }) => {
    await openScenario(page, cy3Scenario(2));
    const line = page.getByTestId('definitions-line');
    await expect(line).toHaveText(
      'Sun available = ≥50% disk above terrain @2 m·Link = Earth ≥1° above terrain + DSN ≥10°',
    );

    // Click and read the enter animation in the same task (it finishes and is cancelled after 150 ms).
    const motion = await page.evaluate(async () => {
      document.querySelector<HTMLButtonElement>('.def-bar__edit')!.click();
      await new Promise((r) => setTimeout(r, 30));
      const el = document.querySelector<HTMLElement>('.def-popover')!;
      const a = el.getAnimations()[0];
      const pencil = document.querySelector('.def-bar__edit')!.getBoundingClientRect();
      const left = parseFloat(el.style.left); // layout position (the bounding box is mid-scale here)
      const [ox] = getComputedStyle(el).transformOrigin.split(' ').map(parseFloat);
      return {
        dur: a ? Number(a.effect!.getTiming().duration) : null,
        originX: left + ox,
        pencilX: pencil.left + pencil.width / 2,
      };
    });
    const pop = page.getByRole('dialog', { name: 'Definitions' });
    await expect(pop).toBeVisible();
    expect(motion.dur).toBe(150);
    expect(Math.abs(motion.originX - motion.pencilX)).toBeLessThanOrEqual(2);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/definitions-popover.png` });

    await pop.getByRole('button', { name: 'ISRO Vikram ops (min Sun elevation 6°)' }).click();
    await expect(pop.getByRole('button', { name: /ISRO Vikram ops/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(line).toContainText('+ elevation ≥6°');
    await page.keyboard.press('Escape');
    const chip = page.locator('.def-bar__preset');
    await expect(chip).toHaveText(/Preset: ISRO ops/);
    await page.screenshot({ path: `${SHOTS}/definitions-isro-chip.png` });

    await chip.getByRole('button', { name: 'Reset to default definitions' }).click();
    await expect(chip).toHaveCount(0);
    await expect(line).not.toContainText('elevation ≥');
  });

  test('popover is interruptible: open–close–open spam ends open, no stuck state', async ({ page }) => {
    await openScenario(page, cy3Scenario(2));
    const pencil = page.getByRole('button', { name: 'Edit definitions' });
    for (let i = 0; i < 5; i++) await pencil.click({ delay: 10 });
    const pop = page.getByRole('dialog', { name: 'Definitions' });
    await expect(pop).toBeVisible();
    await page.waitForTimeout(250);
    expect(await pop.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  });

  test('slider edit commits on release and updates the line (recompute input)', async ({ page }) => {
    await openScenario(page, cy3Scenario(2));
    await page.getByRole('button', { name: 'Edit definitions' }).click();
    const slider = page.getByRole('slider', { name: 'Earth margin' });
    await slider.focus();
    await page.keyboard.press('ArrowRight'); // +0.5°
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('definitions-line')).toContainText('Link = Earth ≥2° above terrain');
    await expect(page.locator('.def-bar__preset')).toHaveText(/Custom rules/);
    await page.getByRole('dialog', { name: 'Definitions' }).getByRole('radio', { name: '10 m' }).click();
    await expect(page.getByTestId('definitions-line')).toContainText('@10 m');
  });

  // Phase 3 exit check with the MOCK data path (the mock now honours site / scrub / minSunElevationOps; this was a known gap).
  test('CY-3 (mock) + ISRO preset → Answer Strip "Below ops elevation (6°)"', async ({ page }) => {
    await openScenario(page, cy3Scenario(2));
    await page.getByRole('button', { name: 'Edit definitions' }).click();
    await page.getByRole('button', { name: 'ISRO Vikram ops (min Sun elevation 6°)' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.answer-strip')).toHaveAttribute('data-sun-state', 'belowOpsElevation', {
      timeout: 3000,
    });
  });
});

test.describe('Site Explorer', () => {
  test('cards: tier, coords, touchdown precision, CY-3 landing + target, sparklines', async ({ page }) => {
    await openScenario(page, {});
    const cy3 = page.locator('.sb-card[data-site="cy3_shiv_shakti"]');
    await expect(cy3.locator('[data-coords="landing-target"]')).toHaveText(
      /Landing\s*69\.373°S 32\.319°E\s*Target\s*69\.3676°S 32\.3481°E/,
    );
    await expect(cy3.locator('[data-date="touchdown"]')).toHaveText(/Touchdown 2023-08-23 12:33 UTC · to the minute/);
    await expect(cy3.locator('.sb-card__tier')).toHaveCount(1);
    await expect(cy3.locator('.sb-spark canvas').first()).toBeVisible();
    const im2 = page.locator('.sb-card[data-site="im2_athena"]');
    await expect(im2.locator('[data-date="touchdown"]')).toHaveText(/2025-03-06 17:28:50 UTC · to the second/);
    await expect(page.locator('.sb-card[data-site="shackleton_ridge"] [data-date="published"]')).toHaveText(
      /as published/,
    );
  });

  test('chips + agency filter + name search', async ({ page }) => {
    await openScenario(page, {});
    const cards = page.locator('.sb-card');
    await expect(cards).toHaveCount(4);
    await page.locator('.sb-chips [data-chip="published"]').click();
    await expect(cards).toHaveCount(1);
    await page.locator('.sb-chips [data-chip="all"]').click();
    await page.getByLabel('Agency').selectOption('isro');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute('data-site', 'cy3_shiv_shakti');
    await page.getByLabel('Agency').selectOption('all');
    await page.getByRole('searchbox').fill('athena');
    await expect(cards).toHaveCount(1);
  });

  test('hover pulses the map pin (CSS opacity); off-map site pulses its edge indicator', async ({ page }) => {
    await openScenario(page, {});
    await page.locator('.sb-card[data-site="shackleton_ridge"]').hover();
    const pin = page.locator('.basemap__pin.is-card-hover');
    await expect(pin).toHaveCount(1);
    const anim = await pin.evaluate((el) => el.getAnimations().map((a) => (a as CSSAnimation).animationName));
    expect(anim).toEqual(['sb-pin-pulse']);
    await page.screenshot({ path: `${SHOTS}/card-hover-pin-pulse.png` });
    await page.locator('.sb-card[data-site="cy3_shiv_shakti"]').hover();
    await expect(pin).toHaveCount(0);
    // Off-map edge indicators (guide §3.1 L5) were removed from the Basemap on main; check the pulse only if present.
    if ((await page.locator('[data-offmap]').count()) > 0) {
      await expect(page.locator('[data-offmap="cy3_shiv_shakti"].is-card-hover')).toHaveCount(1);
    } else {
      test.info().annotations.push({ type: 'note', description: 'Basemap has no off-map indicators (Nived)' });
    }
    await page.mouse.move(960, 5);
    await expect(page.locator('.is-card-hover')).toHaveCount(0);
  });

  test('click selects; Shift-click and "+ Compare" add Compare rows', async ({ page }) => {
    await openScenario(page, {});
    const cy3 = page.locator('.sb-card[data-site="cy3_shiv_shakti"]');
    await cy3.click({ position: { x: 150, y: 40 } }); // anywhere on the card (stretched target), not just the name
    await expect(cy3).toHaveClass(/is-selected/);
    await page.locator('.sb-card[data-site="im2_athena"]').click({ position: { x: 150, y: 50 }, modifiers: ['Shift'] });
    await expect(page.getByText('Added to Compare as row A.')).toBeVisible();
    await page.locator('.sb-card[data-site="shackleton_ridge"]').getByRole('button', { name: '+ Compare' }).click();
    await expect(page.getByText('Added to Compare as row B.')).toBeVisible();
    await expect(cy3).toHaveClass(/is-selected/); // compare did not change the selection
  });

  test('typed "lat, lon" offers Analyse custom point + Quick Answer', async ({ page }) => {
    await openScenario(page, {});
    const box = page.getByRole('searchbox');
    await box.fill('-84.79, 29.20');
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: /Analyse custom point/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Quick Answer/ })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/search-coordinates.png` });

    await menu.getByRole('menuitem', { name: /Quick Answer/ }).click();
    const qa = page.getByRole('dialog', { name: 'Quick Answer' });
    await expect(qa).toContainText('84.79°S 29.2°E');
    await expect(qa).toContainText('Sun now', { timeout: 3000 });
    await page.screenshot({ path: `${SHOTS}/quick-answer-peek.png` });
    await qa.getByRole('button', { name: 'Open in Cockpit' }).click();

    const custom = page.locator('.sb-card[data-category="custom"]');
    await expect(custom).toHaveCount(1);
    await expect(custom).toHaveClass(/is-selected/);
    await expect(custom).toContainText('84.79°S 29.2°E');
  });
});

test.describe('InfoBadge (glossary)', () => {
  test('300 ms open delay, 0 ms between badges, Formula · Impact · Source & σ · Learn more →', async ({ page }) => {
    await openScenario(page, {});
    // Timing is measured in the page (pointerenter → tooltip in the DOM), not across Playwright round-trips.
    await page.evaluate(() => {
      const w = window as unknown as { __tt: Record<string, number> };
      w.__tt = {};
      document
        .querySelectorAll('.answer-strip .ui-info')
        .forEach((b, i) => b.addEventListener('pointerenter', () => (w.__tt[`enter${i}`] ??= performance.now())));
      new MutationObserver(() => {
        const tip = document.querySelector('[role="tooltip"]');
        if (!tip) return;
        const k = tip.textContent?.includes('Sunlit %') ? 'shown1' : 'shown0';
        w.__tt[k] ??= performance.now();
      }).observe(document.body, { childList: true, subtree: true });
    });
    const tt = () => page.evaluate(() => (window as unknown as { __tt: Record<string, number> }).__tt);
    const badges = page.locator('.answer-strip .ui-info');

    await badges.nth(0).hover();
    const tip = page.getByRole('tooltip');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('Formula');
    await expect(tip).toContainText('Impact');
    await expect(tip).toContainText('Source & σ');
    await expect(tip.getByRole('button', { name: 'Learn more →' })).toBeVisible();
    const first = await tt();
    expect(first.shown0 - first.enter0, 'open delay ≈ 300 ms').toBeGreaterThanOrEqual(295);
    expect(first.shown0 - first.enter0).toBeLessThan(450);
    await page.screenshot({ path: `${SHOTS}/infobadge-tooltip.png` });

    // warm: moving straight to the next badge opens it at once (0 ms delay → same frame or next)
    await badges.nth(1).hover();
    await expect(page.getByRole('tooltip')).toContainText('Sunlit %');
    await expect(page.getByRole('tooltip')).toHaveCount(1); // the previous tip closed immediately, no overlap
    const second = await tt();
    expect(second.shown1 - second.enter1, 'warm open ≈ 0 ms').toBeLessThan(40);

    await page.getByRole('tooltip').getByRole('button', { name: 'Learn more →' }).click();
    await expect(page.locator('.app-root')).toHaveAttribute('data-view', 'methodology');
  });

  test('Metric Deck badges (Nived) resolve through the same binding', async ({ page }) => {
    await openScenario(page, {});
    await page.locator('[data-slot="metricDeck"] .ui-info').first().click(); // click = open now, pinned
    await expect(page.getByRole('tooltip')).toContainText('angle(Sun direction, local horizontal)') // glossary text as updated in #41;
  });
});
