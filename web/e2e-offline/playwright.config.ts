// Owner: Nived
// Offline (airplane-mode) test config. Separate from e2e/ on purpose: the service worker exists only in a PRODUCTION build,
// so this suite builds with real data and serves it with `vite preview` (the default e2e config uses the dev server).
// Run from web/: `npm run e2e:offline`.
import { defineConfig, devices } from '@playwright/test';

const PORT = 5180;

export default defineConfig({
  testDir: '.',
  outputDir: '../test-results/offline',
  reporter: [['list']],
  timeout: 90_000,
  use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PORT}`, colorScheme: 'dark', viewport: { width: 1920, height: 960 } },
  webServer: {
    command: `VITE_LUMEN_DATA=real npm run build && npx vite preview --port ${PORT} --strictPort`,
    cwd: '..',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
