// Owner: Nived
// Smoke test: the mock dataset loads through the real loaders and has the shapes the contract promises.
import { stubFetch } from './helpers';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadCatalog } from '../data/catalog';
import { loadLayers } from '../data/layers';
import { dataUrl, checkVersion } from '../data/source';
import { mockScenarioResult } from '../../mocks/mockResult';

beforeAll(() => stubFetch());

describe('mock dataset', () => {
  it('switches to data-mock by default', () => {
    expect(dataUrl('catalog/sites.json')).toBe('/data-mock/catalog/sites.json');
  });

  it('loads the catalog, including sparklines and a Tier C site', async () => {
    const c = await loadCatalog();
    expect(c.sites.length).toBe(4);
    expect(c.sites.every((s) => s.mock)).toBe(true);
    expect(c.sites.find((s) => s.id === 'im2_athena')?.lat).toBeCloseTo(-84.7906, 4); // latitude_deg mapped
    expect(c.sites.find((s) => s.tier === 'C')?.sigmaSource).toMatch(/smooth/);
    const sp = c.sparklines[c.sites[0].id];
    expect(sp.sunlitPct.length).toBe(400);
    expect(sp.startUtc).toBe(Date.UTC(2025, 0, 1));
    expect(sp.linkPct.length).toBe(400);
  });

  it('loads layers and regions', async () => {
    const l = await loadLayers();
    expect(l.layers.length).toBe(10);
    expect(l.extents?.['85S']?.halfExtentKm).toBeLessThan(l.extents!['80S']!.halfExtentKm);
    expect(l.regions.length).toBe(3);
    expect(l.regions[0].svgPath).toMatch(/^M /);
    expect(l.layers.every((x) => x.legendStops.every((g) => /^#[0-9a-f]{6}$/i.test(g.color)))).toBe(true);
  });

  it('rejects an unsupported header version', () => {
    expect(() => checkVersion('x', { version: 9 }, [1])).toThrow(/unsupported/);
  });

  it('mock result is fully shaped', async () => {
    const { sites } = await loadCatalog();
    const r = mockScenarioResult(sites[0]);
    expect(r.status).toBe('ready');
    expect(r.series!.sunElevDeg.length).toBe(r.series!.sunUp.length);
    expect(r.windows.length).toBeGreaterThan(0);
    expect(r.metrics!.sunlitPct.lo!).toBeLessThanOrEqual(r.metrics!.sunlitPct.hi!);
    const c = mockScenarioResult(sites.find((s) => s.tier === 'C')!);
    expect(c.metrics!.sunlitPct.lo).toBe(c.metrics!.sunlitPct.hi); // Tier C: no terrain ±
  });
});
