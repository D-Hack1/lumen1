// Owner: Ebin — a pin in a permanently shadowed spot must not read "Sunlit" (real data), and the site list's verdict tags come from the engine.
// Run from web/: npx playwright test -c e2e/playwright.real.config.ts polarPin
import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

async function dropPin(page: Page, lat: string, lon: string) {
  await page.goto('/#orbit');
  await page.getByLabel('Latitude').fill(lat);
  await page.getByLabel('Longitude').fill(lon);
  await page.getByRole('button', { name: 'Drop pin here' }).click();
}

test.describe('a pin inside a cold trap (real data)', () => {
  test('Orbit: Power says In shadow, the disk is 0 %, and the page does not contradict itself', async ({ page }) => {
    await dropPin(page, '-87.936', '45.3585');
    await page.getByRole('button', { name: 'South pole' }).click();
    await expect(page.getByText('Permanently shadowed')).toBeVisible({ timeout: 60_000 });
    const power = page.locator('.lm-status').filter({ hasText: 'POWER' });
    await expect(power).toContainText('In shadow');
    await expect(power).not.toContainText('Sunlit');
    await expect(page.locator('.lm-nums, .lm-metrics, aside').filter({ hasText: 'Solar disk visible' }).first()).toContainText(/Solar disk visible\s*0%/);
    await expect(page.getByText(/80 m polar map/).first()).toBeVisible();
  });

  test('Stand here warns that the smooth-Moon numbers ignore the shadowing terrain', async ({ page }) => {
    await dropPin(page, '-87.936', '45.3585');
    await page.getByRole('button', { name: 'South pole' }).click();
    await expect(page.getByText('Permanently shadowed')).toBeVisible({ timeout: 60_000 });
    await page.goto('/#stand-here');
    await expect(page.getByTestId('polar-shadow-note')).toContainText(/permanently shadowed/i, { timeout: 60_000 });
  });

  test('a lit spot on a masked site shows no such warning', async ({ page }) => {
    await page.goto('/#stand-here');
    await page.waitForSelector('[data-testid="stand-here-details"]', { timeout: 60_000 });
    await expect(page.getByTestId('polar-shadow-note')).toHaveCount(0);
  });
});

test.describe('the site list tags (real data)', () => {
  test('tags come from the engine and say why a site cannot be judged', async ({ page }) => {
    await page.goto('/#orbit');
    const tag = (name: RegExp) => page.locator('.lm-site').filter({ hasText: name }).locator('.lm-tag');
    // sites outside the polar products now have a coarse mask from NASA's global elevation model, but no σ yet
    for (const n of [/Apollo 11/, /Apollo 17/, /SLIM/, /Chang'e-6/, /Blue Ghost/]) {
      await expect(tag(n)).toHaveText('σ pending', { timeout: 60_000 });
    }
    await expect(tag(/Rim|Shackleton-de Gerlache/)).toHaveText('σ pending', { timeout: 60_000 });
    // sites with terrain AND σ are judged for real: never "Unconfirmed" any more
    for (const n of [/IM-2/, /Chandrayaan-3/, /Shackleton conne/]) {
      await expect(tag(n)).not.toHaveText(/Unconfirmed|Checking/, { timeout: 60_000 });
    }
    console.log('TAGS', JSON.stringify(await page.locator('.lm-site').evaluateAll((els) => els.map((e) => (e.querySelector('.lm-site__name')?.textContent ?? '') + ' = ' + (e.querySelector('.lm-tag')?.textContent ?? '')))));
  });
});
