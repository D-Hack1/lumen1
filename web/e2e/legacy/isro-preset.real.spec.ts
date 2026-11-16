// Owner: Abhinav — Phase 3 exit check on REAL data (Gowri's ephemeris + catalog through Nived's worker):
// CY-3 at touchdown + 60 d window, scrubbed to 2023-09-03 18:00 UTC (after the 6° crossing, before sunset — the same
// instant as Nived's G7 store test). Clicking the ISRO preset in the ✎ popover must switch the Answer Strip to
// "Below ops elevation (6°)"; resetting the chip must switch it back. Run: `npm run e2e:real`.
import { expect, test } from '@playwright/test';
import { CY3_TOUCHDOWN, openScenario } from './helpers';

const SCRUB = Date.parse('2023-09-03T18:00:00Z');
test.use({ viewport: { width: 1920, height: 960 } });

test('CY-3 (real data) + ISRO preset → Answer Strip "Below ops elevation (6°)"; reset restores it', async ({
  page,
}) => {
  await openScenario(page, {
    site: { kind: 'site', id: 'cy3_shiv_shakti' },
    landingUtc: CY3_TOUCHDOWN,
    scrubUtc: SCRUB,
    durationDays: 60,
  });
  const strip = page.locator('.answer-strip');
  await expect(strip).toHaveAttribute('data-sun-state', 'sunsetIn', { timeout: 15_000 });
  await page.screenshot({ path: 'e2e/screens/phase-3/isro-1-before.png' });

  await page.getByRole('button', { name: 'Edit definitions' }).click();
  await page.getByRole('button', { name: 'ISRO Vikram ops (min Sun elevation 6°)' }).click();
  await page.keyboard.press('Escape');
  await expect(strip).toHaveAttribute('data-sun-state', 'belowOpsElevation', { timeout: 10_000 });
  await expect(strip).toContainText('Below ops elevation (6°)');
  await expect(page.locator('.def-bar__preset')).toHaveText(/Preset: ISRO ops/);
  await page.screenshot({ path: 'e2e/screens/phase-3/isro-2-after.png' });

  await page.locator('.def-bar__preset').getByRole('button', { name: 'Reset to default definitions' }).click();
  await expect(strip).toHaveAttribute('data-sun-state', 'sunsetIn', { timeout: 10_000 });
  await page.screenshot({ path: 'e2e/screens/phase-3/isro-3-reset.png' });
});
