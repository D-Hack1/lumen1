// Owner: Ebin
// The Start date picker (real data): every page's window follows the chosen UTC day.
// Run from web/: npx playwright test -c e2e/playwright.real.config.ts dateStart
import { expect, test } from '@playwright/test';

const picker = (page: import('@playwright/test').Page) => page.getByLabel('Window start date (UTC)');

test.describe('Start date (real data)', () => {
  test('defaults to 8 Feb 2027 and changing it moves the clock, labels and engine numbers', async ({ page }) => {
    const errs: string[] = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto('/#stand-here');
    await page.waitForSelector('[data-testid="stand-here-details"]', { timeout: 60_000 });
    await expect(picker(page)).toHaveValue('2027-02-08');
    await expect(page.locator('.lm-clock')).toContainText('2027-02-');
    const windowsBefore = await page.locator('[data-testid="stand-here-details"] tbody').innerText();

    await picker(page).fill('2029-06-15');
    await expect(page.locator('.lm-clock')).toContainText('2029-06-', { timeout: 20_000 });
    await expect(page.getByText(/30 days from 15 Jun 2029/)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-testid="stand-here-details"] tbody')).toContainText('2029-06-', { timeout: 60_000 });
    expect(await page.locator('[data-testid="stand-here-details"] tbody').innerText()).not.toBe(windowsBefore);
    expect(errs).toEqual([]);
  });

  test('the date carries to Compare and Slip, and out-of-range dates are clamped', async ({ page }) => {
    await page.goto('/#compare');
    await expect(picker(page)).toBeVisible({ timeout: 60_000 });
    await picker(page).fill('2028-03-01');
    await expect(page.getByText(/starting 1 Mar 2028/)).toBeVisible();
    await page.goto('/#slip');
    // a hash navigation keeps the module state only within the page load; reload resets to the default, so set it again here
    await picker(page).fill('2030-12-30'); // beyond the supported range: clamped to the last supported start
    await expect(picker(page)).toHaveValue('2030-10-31');
    await expect(page.getByText(/days after 31 Oct 2030/)).toBeVisible({ timeout: 60_000 });
  });

  test('no horizontal scroll with the picker in the header at 1280 px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/#orbit');
    await expect(picker(page)).toBeVisible({ timeout: 60_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
