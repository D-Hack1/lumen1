// Owner: Ebin
// Stand here "Details" with REAL data (VITE_LUMEN_DATA=real): the Windows Table, Pointing & Link and Power & Barcode are drawn from
// the same engine result as the page's numbers, and the charts and table drive the page clock.
// Run from web/: npx playwright test -c e2e/playwright.real.config.ts standHereDetails
import { expect, test } from '@playwright/test';

test.describe('Stand here → Details (real data)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#stand-here');
    await page.waitForSelector('[data-testid="stand-here-details"]', { timeout: 60_000 });
    await page.locator('[data-testid="stand-here-details"]').scrollIntoViewIfNeeded();
  });
  const det = (page: import('@playwright/test').Page) => page.locator('[data-testid="stand-here-details"]');
  const clock = (page: import('@playwright/test').Page) => page.locator('#lm-t');

  test('Windows Table lists real windows with types, UTC times and an export', async ({ page }) => {
    const rows = det(page).locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    expect(await rows.count()).toBeGreaterThan(5);
    await expect(det(page)).toContainText('Start (UTC)');
    await expect(det(page).getByRole('button', { name: 'Export CSV' })).toBeVisible();
    await expect(det(page).locator('tbody')).toContainText(/20\d\d-\d\d-\d\d \d\d:\d\d:\d\d/);
  });

  test('clicking a window jumps the page clock to its start', async ({ page }) => {
    const before = Number(await clock(page).inputValue());
    await det(page).locator('tbody tr').nth(4).click();
    await expect.poll(async () => Number(await clock(page).inputValue())).not.toBe(before);
  });

  test('filter chips narrow the table', async ({ page }) => {
    const all = await det(page).locator('tbody tr').count();
    await det(page).getByRole('button', { name: /sun\s*\d+/i }).first().click();
    const sunOnly = await det(page).locator('tbody tr').count();
    expect(sunOnly).toBeGreaterThan(0);
    expect(sunOnly).toBeLessThan(all);
  });

  test('Pointing & link shows Earth range, light time and the DSN lanes', async ({ page }) => {
    await det(page).getByRole('button', { name: 'Pointing & link' }).click();
    const body = det(page).locator('.lm-det__body');
    await expect(body).toContainText(/EARTH RANGE/i);
    await expect(body).toContainText(/\d{3},\d{3} km/); // e.g. 391,780 km
    await expect(body).toContainText(/LIGHT TIME/i);
    await expect(body.locator('[aria-label*="DSN"]')).toBeVisible();
  });

  test('Power & barcode: clicking either chart moves the page clock', async ({ page }) => {
    await det(page).getByRole('button', { name: 'Power & barcode' }).click();
    const chart = det(page).locator('.lm-det__chart');
    await expect(chart.locator('canvas').first()).toBeVisible();
    const c = (await chart.boundingBox())!;
    // Click by position INSIDE the element (Playwright scrolls and measures at click time), not by page coordinates.
    await chart.click({ position: { x: c.width * 0.3, y: c.height / 2 } });
    await expect.poll(async () => Number(await clock(page).inputValue()), { message: 'clock after clicking the power chart at 30%' }).toBeGreaterThan(150);
    expect(Number(await clock(page).inputValue())).toBeLessThan(260);
    const bar = det(page).locator('.lm-det__bar');
    const bb = (await bar.boundingBox())!;
    await bar.click({ position: { x: bb.width * 0.6, y: 20 } });
    await expect.poll(async () => Number(await clock(page).inputValue()), { message: 'clock after clicking the barcode at 60%' }).toBeGreaterThan(400);
    expect(Number(await clock(page).inputValue())).toBeLessThan(460);
  });

  test('no console errors while switching all three views', async ({ page }) => {
    const errs: string[] = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    for (const name of ['Pointing & link', 'Power & barcode', 'Windows']) {
      await det(page).getByRole('button', { name }).click();
      await page.waitForTimeout(400);
    }
    expect(errs).toEqual([]);
  });
});
