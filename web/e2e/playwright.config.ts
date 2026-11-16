// Owner: Abhinav
// Playwright config for web/e2e. Run from web/: `npm run e2e`.
import { defineConfig, devices } from '@playwright/test';

const PORT = 5179;

export default defineConfig({
  testDir: '.',
  // legacy/ = specs for the old cockpit shell (no longer mounted); real-data checks: playwright.real.config.ts
  testIgnore: ['**/*.real.spec.ts', '**/legacy/**'],
  outputDir: '../test-results',
  fullyParallel: true,
  reporter: [['list']],
  timeout: 60_000,
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
    env: { VITE_LUMEN_DATA: 'mock' }, // mock fixtures, whatever the shell has set
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
