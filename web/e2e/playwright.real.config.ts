// Owner: Abhinav
// Playwright config for checks that need REAL data (VITE_LUMEN_DATA=real). Run from web/: `npm run e2e:real`.
// Own port so it never reuses the mock-mode server of playwright.config.ts.
import { defineConfig, devices } from '@playwright/test';

const PORT = 5178;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.real.spec.ts',
  // legacy/ = specs for the old cockpit shell (Answer Strip, Definitions bar), which is no longer mounted in the live app.
  testIgnore: ['**/legacy/**'],
  outputDir: '../test-results',
  reporter: [['list']],
  timeout: 90_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    cwd: '..',
    url: `http://localhost:${PORT}`,
    env: { VITE_LUMEN_DATA: 'real' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
