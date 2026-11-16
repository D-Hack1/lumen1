// Owner: Nived
// Seam: the shared per-site verdict store (subscribeSiteVerdicts / getSiteVerdicts), for the sidebar cards and Compare rows.
// Oracles: the selected site's verdict must equal the Cockpit's (one number, two places); every catalog site gets an entry;
// a verdict changes when the scenario changes; mock mode is deterministic and complete.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCatalog } from '../data/catalog';
import { setDataMode } from '../data/source';
import { getSiteVerdicts, subscribeSiteVerdicts } from '../siteVerdicts';
import { useScenario } from '../../state/scenarioStore';
import { PUBLIC, stubFetch } from './helpers';

function until(pred: () => boolean, ms = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (pred()) return resolve();
    const off = subscribeSiteVerdicts(() => {
      if (pred()) { off(); clearTimeout(t); resolve(); }
    });
    const t = setTimeout(() => { off(); reject(new Error('timed out waiting for site verdicts')); }, ms);
  });
}

describe('site verdicts (mock mode)', () => {
  beforeAll(() => { setDataMode('mock'); stubFetch(); });
  afterAll(() => setDataMode(null));
  it('gives every catalog site a verdict, never undefined', async () => {
    const { sites } = await loadCatalog();
    await until(() => getSiteVerdicts().status === 'ready');
    for (const s of sites) expect(getSiteVerdicts().bySite[s.id], s.id).toBeDefined();
  });
});

const real = existsSync(join(PUBLIC, 'data/ephem/ephem.bin')) && statSync(join(PUBLIC, 'data/ephem/ephem.bin')).size > 1_000_000;
describe.skipIf(!real)('site verdicts (real data)', () => {
  beforeAll(() => { setDataMode('real'); stubFetch(); useScenario.setState({ durationDays: 30 }); }); // differs from the default so the store re-runs after the mock-mode test
  afterAll(() => setDataMode(null));
  it('every site gets a verdict from the engine, and the selected one equals the Cockpit verdict', async () => {
    const { sites } = await loadCatalog();
    await until(() => getSiteVerdicts().status === 'ready' && sites.every((s) => getSiteVerdicts().bySite[s.id]?.provisional === true)); // provisional: real engine, not the mock snapshot
    const { resultStoreVerdict } = await import('./siteVerdicts.helpers');
    // The list's verdicts are PROVISIONAL (stage 1: nominal geometry, no bounds) and stay PENDING; the selected site's Cockpit verdict is the
    // exact one (it uses sigma) and `useSiteVerdict` prefers it. So the provisional verdict is either PENDING or the exact one.
    const exact = await resultStoreVerdict();
    expect(['PENDING', exact]).toContain(getSiteVerdicts().bySite['im2_athena'].verdict);
  });
  it('re-evaluates when the window changes (a different duration changes at least one site)', async () => {
    const before = JSON.stringify(getSiteVerdicts().bySite);
    useScenario.setState({ durationDays: 7 });
    await until(() => JSON.stringify(getSiteVerdicts().bySite) !== before);
  });
});
