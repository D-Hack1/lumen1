// Owner: Nived
// Every data loader against the REAL files in public/data (VITE_LUMEN_DATA=real). Skipped if real data is absent.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDsn } from '../data/dsn';
import { loadEphem } from '../data/ephem';
import { loadMask } from '../data/masks';
import { loadLayers } from '../data/layers';
import { loadPad } from '../data/pad';
import { loadCatalog } from '../data/catalog';
import { loadPsr } from '../data/psr';
import { loadSigma, sigmaSourceLabel } from '../data/sigma';
import { loadDispersion } from '../data/dispersion';
import { setDataMode } from '../data/source';
import { PUBLIC, stubFetch } from './helpers';

/** Coarse-mask sites that have an assumed-error Monte-Carlo sigma published. Add a site here only after its sigma file exists. */
const COARSE_WITH_SIGMA = ['apollo_11', 'apollo_12', 'apollo_14', 'apollo_15', 'apollo_16', 'apollo_17', 'slim_shioli', 'change6_apollo_basin', 'blue_ghost_m1'] as const;

const have = existsSync(join(PUBLIC, 'data/catalog/sites.json'));
beforeAll(() => { stubFetch(); setDataMode('real'); });
afterAll(() => setDataMode(null));

describe.skipIf(!have)('real-mode loaders', () => {
  it('ephem', async () => { const e = await loadEphem(); expect(e.count).toBeGreaterThan(1000); expect(e.cadenceMs).toBe(3600_000); });
  it('dsn', async () => { expect((await loadDsn()).stations.length).toBe(3); });
  for (const id of ['cy3_shiv_shakti', 'im2_athena', 'shackleton_ridge']) {
    it(`mask ${id}`, async () => { await loadMask(id); });
  }
  it('pad im2_athena', async () => { await loadPad('im2_athena'); });
  it('catalog: sites with a pad file (polar DEMs, LROC NAC DTMs) carry its slope; Blue Ghost and SLIM (no DTM) stay null (never invented)', async () => {
    const { sites } = await loadCatalog();
    const slope = Object.fromEntries(sites.map((s) => [s.id, s.padSlopeDeg]));
    const withPad = ['im2_athena', 'cy3_shiv_shakti', 'shackleton_ridge', 'shackleton_rim_ridge', 'apollo_11', 'apollo_12', 'apollo_14', 'apollo_15', 'apollo_16', 'apollo_17', 'change6_apollo_basin'];
    for (const id of withPad) expect(slope[id]).toBe((await loadPad(id)).slopeDeg);
    for (const id of ['blue_ghost_m1', 'slim_shioli']) expect(slope[id]).toBeNull();
  });
  it.each(['apollo_11', 'apollo_12', 'apollo_14', 'apollo_15', 'apollo_16', 'apollo_17', 'change6_apollo_basin'])('pad %s comes from an LROC NAC DTM at <= 5 m/px', async (id) => {
    const p = await loadPad(id);
    expect(p.planeFit.demSource).toMatch(/^lroc_nac_dtm_/);
    expect(p.nearFieldResolutionM).toBeLessThanOrEqual(5);
    expect(p.underResolved).toBe(false);
  });
  it('layers', async () => { const l = await loadLayers(); expect(l).toBeTruthy(); });
  it('psr raster', async () => {
    const r = await loadPsr();
    expect(r.sizePx[0]).toBe(2534);
    expect(Number.isNaN(r.distanceKm(10_000, 0))).toBe(true);
    let finite = 0, zero = 0;
    for (let x = -300; x <= 300; x += 5) for (let y = -300; y <= 300; y += 5) {
      const d = r.distanceKm(x, y);
      if (Number.isFinite(d)) { finite++; if (d === 0) zero++; }
    }
    console.log(`psr: ${finite} finite samples, ${zero} inside a PSR`);
    expect(finite).toBeGreaterThan(1000);
  });
  // Preliminary Monte-Carlo sigma (30 clones) is published for the four fine-terrain sites; each must match its own mask's validity exactly.
  it.each(['im2_athena', 'cy3_shiv_shakti', 'shackleton_ridge', 'shackleton_rim_ridge'])('sigma: %s is Monte-Carlo (30 clones) and matches its mask', async (id) => {
    const [s, m] = await Promise.all([loadSigma(id), loadMask(id)]);
    expect(s.source).toBe('monte_carlo');
    expect(s.cloneCount).toBe(30);
    expect(s.mock).toBe(false);
    expect(s.sigmaDeg.length).toBe(m.elevDeg.length);
    for (let i = 0; i < s.sigmaDeg.length; i++) expect(Number.isFinite(s.sigmaDeg[i])).toBe(Number.isFinite(m.elevDeg[i])); // contract 10.6: same finite/NaN pattern
  });
  // Coarse-mask sites: sigma is Monte-Carlo with an ASSUMED constant 1 m DEM error (no error raster exists for LDEM_128); it must say so.
  it.each(COARSE_WITH_SIGMA)('sigma: %s is Monte-Carlo (30 clones) with a declared ASSUMED DEM error, and matches its mask', async (id) => {
    const [s, m] = await Promise.all([loadSigma(id), loadMask(id)]);
    expect(s.source).toBe('monte_carlo');
    expect(s.cloneCount).toBe(30);
    expect(s.mock).toBe(false);
    expect(s.assumedErrorM).toBe(1);
    expect(s.assumedErrorIsLowerBound).toBe(true);
    expect(sigmaSourceLabel(s)).toContain('assumed 1 m DEM error (lower bound)');
    for (let i = 0; i < s.sigmaDeg.length; i++) expect(Number.isFinite(s.sigmaDeg[i])).toBe(Number.isFinite(m.elevDeg[i]));
  });
  it('sigma: a measured-raster site does not claim an assumed error', async () => { expect((await loadSigma('im2_athena')).assumedErrorM).toBeNull(); });
  // 11 x 11 slope micro-grids (50 m spacing) are published only where a verified near-field DEM exists.
  it.each(['im2_athena', 'cy3_shiv_shakti', 'shackleton_rim_ridge', 'apollo_11', 'apollo_12', 'apollo_14', 'apollo_15', 'apollo_16', 'apollo_17', 'change6_apollo_basin'])('dispersion: %s is a valid 11 x 11 grid at 50 m with finite slopes', async (id) => {
    const d = await loadDispersion(id);
    expect(d.nodes).toEqual([11, 11]);
    expect(d.spacingM).toBe(50);
    expect(d.slopeDeg.length).toBe(121);
    expect([...d.slopeDeg].every((v) => Number.isFinite(v) && v >= 0 && v <= 25.5)).toBe(true);
  });
  it('dispersion: a site with no grid (Blue Ghost, Tier C) is a 404, so no slope statistics are invented for it', async () => { await expect(loadDispersion('blue_ghost_m1')).rejects.toThrow(/404/); });
});

// Sites outside the polar DEM products have a COARSE mask from NASA's global LOLA elevation model (≈237 m per pixel).
describe.skipIf(!have)('coarse masks from the global elevation model', () => {
  beforeAll(() => { stubFetch(); setDataMode('real'); });
  it.each(['apollo_11', 'apollo_12', 'apollo_14', 'apollo_15', 'apollo_16', 'apollo_17', 'slim_shioli', 'change6_apollo_basin', 'blue_ghost_m1'])('mask %s: valid, coarse, and finite', async (id) => {
    const m = await loadMask(id);
    expect(m.meta.demSource).toBe('lola_gdr_ldem_128_pds');
    expect(m.meta.nearFieldResolutionM).toBeGreaterThan(200);
    let finite = 0;
    for (let i = 0; i < m.elevDeg.length; i++) if (Number.isFinite(m.elevDeg[i])) finite++;
    expect(finite / m.elevDeg.length).toBeGreaterThan(0.99);
    const expected = (COARSE_WITH_SIGMA as readonly string[]).includes(id) ? 'has σ' : 'no σ'; // no σ is invented where none was computed
    expect(await loadSigma(id).then(() => 'has σ', () => 'no σ')).toBe(expected);
  });
});
