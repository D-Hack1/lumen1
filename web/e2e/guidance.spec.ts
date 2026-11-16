// Owner: Ebin
// Methodology page and Quick-Start in the LIVE app (mock data mode, like the rest of the suite).
import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, url = '/') {
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errs.push(`console: ${m.text()}`));
  await page.goto(url);
  await page.waitForSelector('html[data-ready="true"]');
  return errs;
}

test.describe('Methodology', () => {
  test('is in the nav and shows the scope statement, sources, definitions, uncertainty and glossary', async ({ page }) => {
    const errs = await open(page, '/#orbit');
    await page.getByRole('link', { name: 'Methodology' }).first().click();
    await expect(page).toHaveURL(/#methodology$/);
    await expect(page.getByRole('heading', { level: 1, name: /Methodology/ })).toBeVisible();
    for (const h of ['What LUMEN does and does not compute', 'How a number is produced', 'Data sources', 'Definitions and frames', 'Uncertainty', 'Glossary']) {
      await expect(page.getByRole('heading', { level: 2, name: new RegExp(h) })).toBeVisible();
    }
    // these three sections were removed from the page on request
    for (const h of ['Validation', 'Known limitations', 'AI-use disclosure']) {
      await expect(page.getByRole('heading', { level: 2, name: new RegExp(h) })).toHaveCount(0);
    }
    await expect(page.locator('#m-scope')).toContainText('does not compute');
    await expect(page.locator('#m-scope')).toContainText('link budgets');
    await expect(page.locator('#m-data a[href^="https://"]').first()).toBeVisible();
    expect(errs).toEqual([]);
  });

  test('the glossary lists the terms and the page has no horizontal scroll at 1280 px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(page, '/#methodology');
    await expect(page.locator('#m-glossary dt').first()).toBeVisible({ timeout: 20_000 });
    expect(await page.locator('#m-glossary dt').count()).toBeGreaterThan(10);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over).toBeLessThanOrEqual(1);
  });

  test('Ask LUMEN can open it: "go to methodology"', async ({ page }) => {
    await open(page, '/#orbit');
    await page.locator('body').click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('/');
    await page.locator('.ask__input').fill('go to methodology');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#methodology$/);
  });
});

test.describe('Quick-Start', () => {
  test('the header button opens four guided cards, each with a credit', async ({ page }) => {
    const errs = await open(page, '/#orbit');
    await page.getByRole('button', { name: 'Quick start' }).click();
    const dlg = page.getByRole('dialog', { name: 'Quick start' });
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('article')).toHaveCount(4);
    for (const art of await dlg.locator('article').all()) {
      await expect(art.locator('img')).toHaveAttribute('alt', /.+/);
      await expect(art.locator('.lm-qs__credit')).not.toBeEmpty();
    }
    expect(errs).toEqual([]);
  });

  test('Esc closes it and focus returns to the button', async ({ page }) => {
    await open(page, '/#orbit');
    const btn = page.getByRole('button', { name: 'Quick start' });
    await btn.focus();
    await btn.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Quick start' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Quick start' })).toHaveCount(0);
    await expect(btn).toBeFocused();
  });

  test('"What does a 9-day slip do?" opens the Slip explorer with a 9-day slip', async ({ page }) => {
    await open(page, '/#orbit');
    await page.getByRole('button', { name: 'Quick start' }).click();
    await page.locator('article[data-card="slip-9"]').getByRole('button', { name: 'Start' }).click();
    await expect(page).toHaveURL(/#slip$/);
    await expect(page.getByRole('dialog', { name: 'Quick start' })).toHaveCount(0);
    await expect(page.locator('body')).toContainText('Slip by 9 days');
  });

  test('?quickstart=1 opens it on load; it does not nag a scripted browser otherwise', async ({ page }) => {
    await open(page, '/?quickstart=1');
    await expect(page.getByRole('dialog', { name: 'Quick start' })).toBeVisible();
    const fresh = await page.context().newPage();
    await fresh.goto('/');
    await fresh.waitForSelector('html[data-ready="true"]');
    await expect(fresh.getByRole('dialog', { name: 'Quick start' })).toHaveCount(0); // automation (navigator.webdriver) is never nagged
  });

  test('Tab stays inside the dialog', async ({ page }) => {
    await open(page, '/#orbit');
    await page.getByRole('button', { name: 'Quick start' }).click();
    for (let i = 0; i < 14; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.lm-qs'))).toBe(true);
  });
});
