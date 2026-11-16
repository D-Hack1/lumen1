// Owner: Nived
// N-12 done-criterion: "airplane-mode test passes". Production build, real data.
// Oracle for the numbers shown offline: Gowri's golden set 1 (IM-2 at touchdown: Sun +2.46 deg, Earth +11.19 deg).
import { expect, test, type Page } from '@playwright/test';

/** Wait until the service worker is active AND the precache holds the real data files. */
async function waitForPrecache(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const names = await caches.keys();
          const urls: string[] = [];
          for (const n of names) for (const r of await (await caches.open(n)).keys()) urls.push(new URL(r.url).pathname);
          return ['/data/ephem/ephem.bin', '/data/ephem/ephem.json', '/data/catalog/sites.json'].every((p) => urls.includes(p));
        }),
      { timeout: 60_000, message: 'precache never contained the real data files' },
    )
    .toBe(true);
}

test('the app, real data and the engine all work with no network at all', async ({ page, context }) => {
  // The rule: anything that WORKED online (HTTP 200) must also work offline. Files that 404 online (terrain masks, PSR raster,
  // sparklines: not produced yet) are optional and expected to be absent either way, so they are not counted.
  const okOnline = new Set<string>();
  let recordOnline = true;
  page.on('response', (r) => {
    if (!recordOnline || r.status() !== 200 || new URL(r.url()).origin !== new URL(page.url()).origin) return;
    // The preview server answers unknown paths with index.html and status 200 (SPA fallback). A data file or image that came back as
    // HTML did NOT work online (it does not exist), so it must not be counted.
    const isDataFile = /\.(json|bin|png|svg|webp|jpe?g|avif|gif|ico|woff2?)$/.test(new URL(r.url()).pathname);
    if (isDataFile && (r.headers()['content-type'] ?? '').includes('text/html')) return;
    okOnline.add(r.url());
  });
  const failed: string[] = [];
  page.on('requestfailed', (r) => {
    if (new URL(r.url()).origin === new URL(page.url()).origin) failed.push(r.url());
  });

  // 1. First load, online: real data arrives and the service worker installs.
  await page.goto('/');
  await expect(page.locator('[data-slot="answer"] .answer-strip[data-sun-state]')).toBeVisible({ timeout: 30_000 });
  await waitForPrecache(page);

  // 2. Airplane mode, then a hard reload: everything must come from the cache.
  recordOnline = false;
  expect(okOnline.size).toBeGreaterThan(5); // we really did observe the online load
  await context.setOffline(true);
  failed.length = 0;
  await page.reload();
  const answer = page.locator('[data-slot="answer"]');
  await expect(answer.locator('.answer-strip[data-sun-state]')).toBeVisible({ timeout: 30_000 });
  await expect(answer).toContainText('+2.46°'); // real Sun elevation at IM-2 touchdown (golden), computed offline by the worker
  await expect(page.locator('[data-slot="metricDeck"]')).toContainText('+2.46°');

  // 3. The raw data files are served from the cache too (no network behind them).
  const status = await page.evaluate(async () => (await fetch('/data/ephem/ephem.bin')).status);
  expect(status).toBe(200);

  // 4. A feature that needs the worker + ephemeris + catalog: the Scan on the Compare view.
  await page.getByRole('tab', { name: 'Compare' }).click();
  await expect(page.locator('[data-slot="scan"]')).toContainText('Stage 2', { timeout: 30_000 });
  await expect(page.locator('[data-slot="scan"] tbody tr').first()).toBeVisible();

  // 5. Everything that worked online still worked offline.
  const broke = failed.filter((u) => okOnline.has(u));
  expect(broke, `these worked online but failed offline:\n${broke.join('\n')}`).toEqual([]);
});
