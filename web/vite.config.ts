// Owner: Abhinav
// Vite build configuration (+ Vitest unit-test settings).
// PWA: Nived's pwa.config.ts supplies the offline-caching options (wired in below; disabled under Vitest).
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { pwaOptions, type LumenDataMode } from './pwa.config';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const dataMode: LumenDataMode = env.VITE_LUMEN_DATA === 'mock' ? 'mock' : 'real';
  return {
    // Deploy path. "/" locally; GitHub Pages serves a project site under "/<repo>/", so the deploy workflow sets VITE_BASE.
    // (Routing is by URL hash, so no server rewrite rules are needed anywhere.)
    base: env.VITE_BASE || '/',
    plugins: [react(), ...(process.env.VITEST ? [] : [VitePWA(pwaOptions(dataMode))])],
    // Unit tests run on the mock fixtures unless a test switches to real mode itself (setDataMode).
    define: process.env.VITEST ? { 'import.meta.env.VITE_LUMEN_DATA': JSON.stringify('mock') } : {},
    server: { port: 5173 },
    test: {
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      environment: 'node',
    },
  };
});
