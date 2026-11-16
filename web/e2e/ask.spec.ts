// Owner: Ebin
// Ask LUMEN in the LIVE app: the "/" key, the header button, commands (navigate, pick a site, slip), ordinary-language
// questions (how-to, how it's calculated, why we decided), an off-topic question (must not be answered), and the key rules
// (ignored while typing, Esc closes, focus returns). Runs in mock data mode like the rest of the suite; the engine-backed
// "Why this number?" is covered by unit tests and by e2e/ask.real.spec.ts (real data).
import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, hash = 'slip') {
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errs.push(`console: ${m.text()}`));
  await page.goto(`/#${hash}`);
  await page.waitForSelector('html[data-ready="true"]');
  return errs;
}
const box = (page: Page) => page.locator('.ask');
const input = (page: Page) => page.locator('.ask__input');
async function ask(page: Page, text: string) {
  await input(page).fill(text);
  await page.waitForTimeout(150);
}
async function openBox(page: Page) {
  await page.locator('body').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('/');
  await expect(box(page)).toBeVisible();
}

test.describe('opening and closing', () => {
  test('"/" opens, Esc closes and focus goes back where it was', async ({ page }) => {
    const errs = await open(page);
    const nav = page.getByRole('link', { name: 'Compare' }).first();
    await nav.focus();
    await page.keyboard.press('/');
    await expect(box(page)).toBeVisible();
    await expect(input(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(box(page)).toHaveCount(0);
    await expect(nav).toBeFocused();
    expect(errs).toEqual([]);
  });

  test('the header "Ask" button opens it', async ({ page }) => {
    await open(page);
    await page.locator('button[title^="Ask LUMEN"]').click();
    await expect(box(page)).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Ask LUMEN' })).toBeVisible();
  });

  test('"/" is ignored while typing in a field', async ({ page }) => {
    await open(page, 'orbit');
    const field = page.locator('input[type="text"], input:not([type])').first();
    await field.click();
    await page.keyboard.type('/');
    await expect(box(page)).toHaveCount(0);
    await expect(field).toHaveValue(/\//);
  });

  test('Tab stays inside the dialog (focus is trapped)', async ({ page }) => {
    await open(page);
    await openBox(page);
    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => !!document.activeElement?.closest('.ask'));
    expect(inside).toBe(true);
  });
});

test.describe('commands', () => {
  test('"go to compare" navigates', async ({ page }) => {
    await open(page, 'orbit');
    await openBox(page);
    await ask(page, 'go to compare');
    await expect(page.locator('.ask__row').first()).toContainText('Go to Compare');
    await page.keyboard.press('Enter');
    await expect(box(page)).toHaveCount(0);
    await expect(page).toHaveURL(/#compare$/);
  });

  test('"show malapert" picks the site', async ({ page }) => {
    await open(page, 'stand-here');
    await openBox(page);
    await ask(page, 'show malapert');
    await page.keyboard.press('Enter');
    await expect(box(page)).toHaveCount(0);
    await expect(page.locator('body')).toContainText('Malapert');
  });

  test('slip commands set the slip, clamp to 0–27 and say so', async ({ page }) => {
    await open(page, 'slip');
    await openBox(page);
    await ask(page, 'slip 9 days');
    await page.keyboard.press('Enter');
    await expect(page.locator('body')).toContainText('Slip by 9 days');

    await openBox(page);
    await ask(page, 'slip 40 days');
    await expect(page.locator('.ask__row').first()).toContainText('allowed: 0 to 27 d');
    await page.keyboard.press('Enter');
    await expect(page.locator('body')).toContainText('Slip by 27 days');

    await openBox(page);
    await ask(page, 'move front 2 days');
    await page.keyboard.press('Enter');
    await expect(page.locator('body')).toContainText('Slip by 2 days');
  });

  test('a question that mentions a page is explained, not run as a command', async ({ page }) => {
    await open(page, 'orbit');
    await openBox(page);
    await ask(page, 'how do i compare two sites');
    await expect(page.locator('.ask__row--cmd')).toHaveCount(0);
    await expect(page.locator('.ask__cardtitle').first()).toContainText('How do I compare sites?');
    await expect(page).toHaveURL(/#orbit$/);
  });
});

test.describe('ordinary questions', () => {
  const cases: [string, string][] = [
    ['how is the earth elevation calculated', 'How is Earth elevation calculated?'],
    ['how are the results calculated', 'How does LUMEN work'],
    ['why did you choose to show a plus minus', 'Why does LUMEN show a ±'],
    ['what does the array height do', 'array height'],
    ['what is a dsn station', 'Deep Space Network'],
    ['are these numbers real', 'Are the numbers on the pages real?'],
  ];
  for (const [q, title] of cases) {
    test(q, async ({ page }) => {
      const errs = await open(page);
      await openBox(page);
      await ask(page, q);
      await expect(page.locator('.ask__cardtitle').first()).toContainText(title, { ignoreCase: true });
      await expect(page.locator('.ask__src').first()).toContainText(/Source:|From:/);
      expect(errs).toEqual([]);
    });
  }

  test('written answers show their source', async ({ page }) => {
    await open(page);
    await openBox(page);
    await ask(page, 'how is sunlight calculated');
    await expect(page.locator('.ask__card').first()).toContainText('Source: PLAN_FINAL');
  });

  test('an off-topic question is NOT answered, and examples are offered', async ({ page }) => {
    await open(page);
    await openBox(page);
    await ask(page, 'what is the capital of france');
    await expect(page.locator('.ask__note').first()).toContainText('don’t have an answer');
    await expect(page.locator('.ask__card')).toHaveCount(0);
    await expect(page.locator('.ask__chip').first()).toBeVisible();
  });

  test('clicking an example fills the box', async ({ page }) => {
    await open(page);
    await openBox(page);
    const chip = page.locator('.ask__chip', { hasText: 'how do I compare sites?' });
    await chip.click();
    await expect(input(page)).toHaveValue('how do I compare sites?');
    await expect(page.locator('.ask__cardtitle').first()).toContainText('How do I compare sites?');
  });
});

test.describe('"Why this number?"', () => {
  test('a "why" question about a number gives a guarded, sourced explanation (no invented ±)', async ({ page }) => {
    await open(page);
    await openBox(page);
    await ask(page, 'why is this ± so big?');
    const card = page.locator('.ask__card--why').first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText('Why this number');
    await expect(card.locator('.ask__src')).toContainText('From:');
  });
});
