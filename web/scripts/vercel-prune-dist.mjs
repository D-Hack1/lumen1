// Owner: Ebin — runs AFTER the build on Vercel (see ../../vercel.json).
// Removes files from dist/ that the live app never loads, so the deployment stays small and under host file-size limits:
//   data/terrain/layers  (65 MB of map PNGs)       data/terrain/psr  (123 MB, one file is 102 MB)       data-mock  (sample data for mock mode)
// The service worker does not precache any of them (web/pwa.config.ts globIgnores), so offline behaviour is unchanged.
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = join(process.cwd(), 'dist');
const du = (p) => (statSync(p).isDirectory() ? readdirSync(p).reduce((n, f) => n + du(join(p, f)), 0) : statSync(p).size);
const mb = (n) => (n / 1048576).toFixed(1);

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/index.html is missing: the build did not produce the app.');
  process.exit(1);
}
const before = du(DIST);
for (const rel of ['data/terrain/layers', 'data/terrain/psr', 'data-mock']) {
  const p = join(DIST, rel);
  if (existsSync(p)) {
    console.log(`prune dist/${rel}  (${mb(du(p))} MB)`);
    rmSync(p, { recursive: true, force: true });
  }
}
for (const rel of ['data/ephem/ephem.bin', 'data/catalog/sites.json', 'data/validation/report.json']) {
  if (!existsSync(join(DIST, rel))) {
    console.error(`dist/${rel} is missing: the app would not load.`);
    process.exit(1);
  }
}
console.log(`dist: ${mb(before)} MB -> ${mb(du(DIST))} MB`);
