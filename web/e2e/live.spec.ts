// Owner: Abhinav
// Smoke tests for the LIVE app: the four Lumen pages (#orbit, #stand-here, #compare, #slip) behind one shell.
// Per route: loads, nothing throws, one <h1>, the nav marks the page, no horizontal scroll at the five test viewports.
// Behaviour: nav + hash routing, theme toggle persists, the Slip explorer's shared slip, site choice carries between pages.
// (The old cockpit shell's specs live in e2e/legacy/ and are not run.) Screens → e2e/screens/live/.
import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'e2e/screens/live';
const ROUTES = [
  { hash: 'orbit', nav: 'Orbit' },
  { hash: 'stand-here', nav: 'Stand here' },
  { hash: 'compare', nav: 'Compare' },
  { hash: 'slip', nav: 'Slip explorer' },
] as const;
const VIEWPORTS = [
  { name: 'V1', width: 1920, height: 960 },
  { name: 'V2', width: 1536, height: 754 },
  { name: 'V3', width: 1440, height: 810 },
  { name: 'V4', width: 1280, height: 720 },
  { name: 'V4b', width: 1280, height: 640 },
] as const;

/** Collects uncaught errors and console errors for the whole test. */
function watchErrors(page: Page): string[] {
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(`console: ${m.text()}`);
  });
  return errs;
}

async function open(page: Page, hash: string) {
  await page.goto(`/#${hash}`);
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.locator('h1')).toHaveCount(1);
  await page.waitForTimeout(150); // fonts + first layout settle
}

const navLink = (page: Page, name: string) => page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name });

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const r of ROUTES) {
      test(`${r.hash}: loads cleanly, nav marks it, no horizontal scroll`, async ({ page }) => {
        const errs = watchErrors(page);
        await open(page, r.hash);
        await expect(navLink(page, r.nav)).toHaveAttribute('aria-current', 'page');
        const overX = await page.evaluate(() => {
          const de = document.documentElement;
          return Math.max(de.scrollWidth, document.body.scrollWidth) - window.innerWidth;
        });
        await page.screenshot({ path: `${SHOTS}/${vp.name}-${r.hash}.png` });
        expect(overX, 'horizontal overflow (px)').toBeLessThanOrEqual(1);
        expect(errs, 'console / page errors').toEqual([]);
      });
    }
  });
}

test.describe('behaviour (V1)', () => {
  test.use({ viewport: { width: 1920, height: 960 } });

  test('nav links route by hash and the title follows the page', async ({ page }) => {
    await open(page, 'orbit');
    for (const [label, hash] of [
      ['Stand here', 'stand-here'],
      ['Compare', 'compare'],
      ['Slip explorer', 'slip'],
      ['Orbit', 'orbit'],
    ] as const) {
      await navLink(page, label).click();
      await expect(page).toHaveURL(new RegExp(`#${hash}$`));
      await expect(page).toHaveTitle(`${label} · Lumen`);
      await expect(navLink(page, label)).toHaveAttribute('aria-current', 'page');
    }
  });

  test('an unknown hash falls back to Orbit', async ({ page }) => {
    await page.goto('/#nope');
    await page.waitForSelector('html[data-ready="true"]');
    await expect(page).toHaveTitle('Orbit · Lumen');
  });

  test('theme toggle switches and persists across a reload', async ({ page }) => {
    await open(page, 'orbit');
    await expect(page.locator('.lm-shell')).toHaveClass(/lm-theme-dark/);
    await page.getByRole('button', { name: 'Light mode' }).click();
    await expect(page.locator('.lm-shell')).toHaveClass(/lm-theme-light/);
    await page.screenshot({ path: `${SHOTS}/theme-light.png` });
    await page.reload();
    await page.waitForSelector('html[data-ready="true"]');
    await expect(page.locator('.lm-shell')).toHaveClass(/lm-theme-light/);
    await page.getByRole('button', { name: 'Dark mode' }).click();
    await expect(page.locator('.lm-shell')).toHaveClass(/lm-theme-dark/);
  });

  test('Slip explorer: slider and chart bars move the same slip value', async ({ page }) => {
    await open(page, 'slip');
    const label = page.locator('.lm-slipl');
    await expect(label).toContainText('6 days'); // default
    const slider = page.locator('#lm-slip');
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(label).toContainText('8 days');
    await slider.fill('0');
    await expect(label).toContainText('0 days');
    const bars = page.getByRole('region', { name: 'Slip chart' }).locator('[aria-pressed]');
    expect(await bars.count()).toBeGreaterThan(10);
    await bars.nth(9).click();
    await expect(label).toContainText('9 days');
    await expect(bars.nth(9)).toHaveAttribute('aria-pressed', 'true');
  });

  test('slip persists when you leave the Slip page and come back', async ({ page }) => {
    await open(page, 'slip');
    await page.locator('#lm-slip').fill('12');
    await navLink(page, 'Compare').click();
    await navLink(page, 'Slip explorer').click();
    await expect(page.locator('.lm-slipl')).toContainText('12 days');
  });

  test('the site chosen on the Slip page stays selected on Stand here', async ({ page }) => {
    await open(page, 'slip');
    const pick = page.locator('button[aria-pressed]').filter({ hasText: /Ridge|Malapert|Haworth/ }).first();
    const name = (await pick.textContent())!.trim();
    await pick.click();
    await expect(pick).toHaveAttribute('aria-pressed', 'true');
    await navLink(page, 'Stand here').click();
    await expect(page.locator('[aria-pressed="true"]').filter({ hasText: name }).first()).toBeVisible();
  });
});
