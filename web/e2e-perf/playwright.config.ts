// Owner: Nived
// G8 / G13 performance run against the REAL app (real ephemeris, real engine). Dev server so the test can import engine modules
// directly (quick answer, site switch). Run from web/: `npm run e2e:perf`. CI sets LUMEN_PERF_SLACK (e.g. 3) for shared runners.
import { defineConfig, devices } from '@playwright/test';

const PORT = 5187;

export default defineConfig({
  testDir: '.',
  outputDir: '../test-results/perf',
  reporter: [['list']],
  timeout: 120_000,
  workers: 1, // timing tests must not compete with each other
  use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PORT}`, colorScheme: 'dark', viewport: { width: 1920, height: 960 } },
  webServer: {
    command: `VITE_LUMEN_DATA=real npx vite --port ${PORT} --strictPort`,
    cwd: '..',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
