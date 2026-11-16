// Owner: Nived
// N-12 done-criterion: "airplane-mode test passes". Production build, real data.
// Oracle for the numbers shown offline: the same page's numbers computed online moments before (the live pages, not the unmounted cockpit).
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

  // 1. First load, online, on the live Stand here page: real data arrives, the engine answers and the service worker installs.
  const nums = page.locator('.lm-nums__value');
  await page.goto('/#stand-here');
  await expect(page.locator('[data-testid="stand-here-details"] tbody tr').first()).toBeVisible({ timeout: 60_000 });
  await expect(nums.first()).toBeVisible({ timeout: 60_000 });
  const onlineNumbers = await nums.allInnerTexts();
  await waitForPrecache(page);

  // 2. Airplane mode, then a hard reload: everything must come from the cache, and the worker must compute the SAME numbers.
  recordOnline = false;
  expect(okOnline.size).toBeGreaterThan(5); // we really did observe the online load
  await context.setOffline(true);
  failed.length = 0;
  await page.reload();
  await expect(page.locator('[data-testid="stand-here-details"] tbody tr').first()).toBeVisible({ timeout: 60_000 });
  await expect(nums.first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => nums.allInnerTexts(), { timeout: 30_000 }).toEqual(onlineNumbers);

  // 3. The raw data files are served from the cache too (no network behind them).
  const status = await page.evaluate(async () => (await fetch('/data/ephem/ephem.bin')).status);
  expect(status).toBe(200);

  // 4. A feature that needs the worker + ephemeris + catalog + masks for every site: the Orbit page's verdict tags.
  await page.goto('/#orbit');
  const tags = page.locator('.lm-site .lm-tag');
  await expect(tags.first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await tags.allInnerTexts()).filter((t) => /Checking/.test(t)).length, { timeout: 60_000 }).toBe(0);

  // 5. Everything that worked online still worked offline.
  const broke = failed.filter((u) => okOnline.has(u));
  expect(broke, `these worked online but failed offline:\n${broke.join('\n')}`).toEqual([]);
});
