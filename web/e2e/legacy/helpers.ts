// Owner: Abhinav — shared e2e helpers.
import type { Page } from '@playwright/test';

/** Share-URL token for a partial scenario (same format as state/urlSync.ts: `1.<base64url(JSON)>`). */
export function scenarioToken(partial: Record<string, unknown>): string {
  return `1.${Buffer.from(JSON.stringify(partial), 'utf8').toString('base64url')}`;
}

export const CY3_TOUCHDOWN = Date.parse('2023-08-23T12:33:00Z');
const DAY = 86_400_000;

/** Open the app on a given scenario and wait for fonts + first render. */
export async function openScenario(page: Page, partial: Record<string, unknown>, extra = ''): Promise<void> {
  await page.goto(`/?s=${scenarioToken(partial)}${extra}`);
  await page.waitForSelector('html[data-ready="true"]');
  await page.waitForSelector('.sb-card'); // catalog loaded
}

export const cy3Scenario = (scrubDays: number, durationDays = 14) => ({
  site: { kind: 'site', id: 'cy3_shiv_shakti' },
  landingUtc: CY3_TOUCHDOWN,
  scrubUtc: CY3_TOUCHDOWN + scrubDays * DAY,
  durationDays,
});
