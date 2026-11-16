// Owner: Ebin — runs BEFORE the build on Vercel (see ../../vercel.json).
// The published data files are Git LFS objects. If Vercel's "Git Large File Storage (LFS)" setting is off, the checkout contains tiny pointer files
// instead and the app would deploy "successfully" but fail at runtime. Stop the build here with a clear message instead.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DATA = join(process.cwd(), 'public', 'data');
const MUST_BE_REAL = ['ephem/ephem.bin', 'dsn/dsn.bin', 'terrain/masks/im2_athena.bin', 'terrain/masks/cy3_shiv_shakti.bin', 'catalog/sites.json'];

let bad = 0;
for (const rel of MUST_BE_REAL) {
  const file = join(DATA, rel);
  if (!existsSync(file)) {
    console.error(`MISSING  public/data/${rel}`);
    bad++;
    continue;
  }
  const head = readFileSync(file, { encoding: 'latin1', flag: 'r' }).slice(0, 64);
  if (head.startsWith('version https://git-lfs.github.com/spec/v1') || statSync(file).size < 200) {
    console.error(`Git LFS POINTER (not the real file)  public/data/${rel}`);
    bad++;
  }
}
if (bad) {
  console.error('\nThe data files were not checked out. In Vercel: Project Settings -> Git -> enable "Git Large File Storage (LFS)", then redeploy.');
  process.exit(1);
}
console.log(`Data files are real (checked ${MUST_BE_REAL.length}).`);
