// Owner: Nived
// ephem / dsn / pad / golden / draft loaders against the mock files and the contracts.
import { beforeAll, describe, expect, it } from 'vitest';
import { checkSidecar, decodeArray, verifySha256 } from '../data/binArray';
import { loadDispersion } from '../data/dispersion';
import { loadDsn } from '../data/dsn';
import { EPHEM, EPHEM_STRIDE, loadEphem } from '../data/ephem';
import { loadGolden } from '../data/golden';
import { loadPad, parsePad } from '../data/pad';
import { loadPsr } from '../data/psr';
import { loadTierBTile } from '../data/tierb';
import { readMock, stubFetch } from './helpers';

beforeAll(() => stubFetch());

describe('real catalog (Gowri build_catalog output)', () => {
  it('loads every real site record, including those with no landing_coords, and keeps the rotation matrix', async () => {
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { PUBLIC } = await import('./helpers');
    const { setDataMode } = await import('../data/source');
    const { loadCatalog } = await import('../data/catalog');
    if (!existsSync(join(PUBLIC, 'data/catalog/sites.json'))) return; // real data not present: nothing to check
    setDataMode('real');
    try {
      const c = await loadCatalog();
      expect(c.sites.length).toBeGreaterThanOrEqual(4);
      for (const s of c.sites) {
        expect(Number.isFinite(s.landingCoords.lat) && Number.isFinite(s.landingCoords.lon), s.id).toBe(true);
        expect(s.rotationMatrix, s.id).not.toBeNull();
      }
      const im2 = c.sites.find((s) => s.id === 'im2_athena')!;
      expect(im2.touchdownUtc).toBe(Date.parse('2025-03-06T17:28:50Z'));
      expect(Object.keys(c.sparklines).sort()).toEqual(['apollo_11', 'apollo_12', 'apollo_14', 'apollo_15', 'apollo_16', 'apollo_17', 'blue_ghost_m1', 'change6_apollo_basin', 'cy3_shiv_shakti', 'im2_athena', 'shackleton_rim_ridge', 'slim_shioli']);
      expect(c.sparklines.im2_athena!.sunlitPct).toHaveLength(1096);
      expect(c.sparklines.im2_athena!.linkPct).toHaveLength(1096);
      expect(new Date(c.sparklines.im2_athena!.startUtc).toISOString()).toBe('2023-01-01T00:00:00.000Z');
      expect(new Date(c.sparklines.im2_athena!.startUtc + 365 * 86_400_000).toISOString()).toBe('2024-01-01T00:00:00.000Z');
      expect(new Date(c.sparklines.im2_athena!.startUtc + 731 * 86_400_000).toISOString()).toBe('2025-01-01T00:00:00.000Z');
      expect(new Date(c.sparklines.im2_athena!.startUtc + 1095 * 86_400_000).toISOString()).toBe('2025-12-31T00:00:00.000Z');
    } finally {
      setDataMode(null);
    }
  });
});

describe('real terrain layers index (S-7 layers.json)', () => {
  it('discovers every available layer, each with a complete, correctly-shaped projection', async () => {
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { PUBLIC } = await import('./helpers');
    const { setDataMode } = await import('../data/source');
    const { loadLayers } = await import('../data/layers');
    if (!existsSync(join(PUBLIC, 'data/terrain/layers.json'))) return; // real data not present: nothing to check
    setDataMode('real');
    try {
      const l = await loadLayers();
      // The fix must make the loader actually discover layers, not return
      // an empty collection because required projection fields were
      // missing.
      expect(l.layers.length).toBeGreaterThan(0);
      expect(l.layers.length).toBe(8);
      expect(l.sizePx).not.toBeNull();
      expect(l.extents).not.toBeNull();
      for (const extentKey of ['80S', '85S'] as const) {
        const e = l.extents![extentKey]!;
        expect(e, extentKey).toBeDefined();
        expect(Number.isFinite(e.latLimitDeg)).toBe(true);
        expect(e.latLimitDeg).toBeLessThan(0); // south-negative convention
        expect(e.halfExtentKm).toBeGreaterThan(0);
        expect(Number.isFinite(e.metresPerPx) && e.metresPerPx > 0).toBe(true);
        expect(e.centrePx).toHaveLength(2);
        expect(e.centrePx[0]).toBeGreaterThan(0);
        expect(e.centrePx[1]).toBeGreaterThan(0);
      }
      // 85S is deeper into the pole: smaller half-extent than 80S.
      expect(l.extents!['85S']!.halfExtentKm).toBeLessThan(l.extents!['80S']!.halfExtentKm);
      for (const layer of l.layers) {
        expect(layer.url, layer.id).toMatch(/\/data\/terrain\/layers\/.+\.png$/);
        expect(layer.legendStops.length, layer.id).toBeGreaterThan(0);
      }
    } finally {
      setDataMode(null);
    }
  });
});

describe('ephem', () => {
  it('loads, reads cadence from the sidecar and matches the physics roughly', async () => {
    const e = await loadEphem();
    expect(e.count * EPHEM_STRIDE).toBe(e.data.length);
    expect(e.cadenceMs).toBe(6 * 3600 * 1000); // mock; real data is 3600 s - never assumed
    expect(e.startMs).toBe(Date.UTC(2023, 0, 1));
    expect(e.endMs).toBe(e.startMs + (e.count - 1) * e.cadenceMs);
    const r = e.count > 100 ? 100 : 0;
    const sunD = Math.hypot(e.data[r * 12 + EPHEM.sunPos], e.data[r * 12 + EPHEM.sunPos + 1], e.data[r * 12 + EPHEM.sunPos + 2]);
    const earthD = Math.hypot(e.data[r * 12 + EPHEM.earthPos], e.data[r * 12 + EPHEM.earthPos + 1], e.data[r * 12 + EPHEM.earthPos + 2]);
    expect(sunD / 1.496e8).toBeCloseTo(1, 3);
    expect(earthD).toBeGreaterThan(350_000);
    expect(earthD).toBeLessThan(410_000);
  });
});

describe('dsn', () => {
  it('decodes int16 half-degrees and stays inside [-90, 90]', async () => {
    const d = await loadDsn();
    expect(d.stations).toEqual(['DSS-14', 'DSS-43', 'DSS-63']);
    expect(d.cadenceMs).toBe(1800 * 1000);
    let mn = Infinity, mx = -Infinity;
    for (let k = 0; k < 3; k++) for (let i = 0; i < d.count; i += 97) { const v = d.elevDeg(k, i); mn = Math.min(mn, v); mx = Math.max(mx, v); }
    expect(mn).toBeGreaterThanOrEqual(-90);
    expect(mx).toBeLessThanOrEqual(90);
    expect((mx - mn) * 2).toBeGreaterThan(100); // spans a real range, decoded at 0.5 deg
    expect(Number.isInteger(d.elevDeg(0, 5) * 2)).toBe(true);
  });
});

describe('binary sidecar format', () => {
  const good = { version: '1', shape: [2], dtype: 'float32', fields: ['a'], units: 'x', scale: null, offset: null, producer: 'p', created_utc: 'z', sha256: '0' };
  it('rejects missing fields, unknown dtype, wrong byte length and a bad checksum', async () => {
    const { sha256: _omit, ...noSha } = good;
    expect(() => checkSidecar('t', noSha)).toThrow(/missing fields: sha256/);
    expect(() => checkSidecar('t', { ...good, dtype: 'float64' })).toThrow(/dtype/);
    expect(() => decodeArray('t', new ArrayBuffer(7), checkSidecar('t', good))).toThrow(/does not match shape/);
    const buf = new Float32Array([1, 2]).buffer;
    expect(Array.from(decodeArray('t', buf, checkSidecar('t', good)))).toEqual([1, 2]);
    await expect(verifySha256('t', buf, '0'.repeat(64))).rejects.toThrow(/SHA-256 mismatch/);
  });
});

describe('pad', () => {
  it('loads a pad and enforces the aspect and d_min relations', async () => {
    const p = await loadPad('im2_athena');
    expect(p.underResolved).toBe(false);
    expect(p.uphillAzDeg).toBeCloseTo((p.downhillAspectDeg + 180) % 360, 6);
    expect(p.dMinM).toBe(3 * p.nearFieldResolutionM);
    expect(Math.hypot(...p.groundNormalMe)).toBeCloseTo(1, 6);
    const j = (await readMock('terrain/pad/im2_athena.json')).json() as never;
    expect(() => parsePad('im2_athena', { ...(j as object), uphill_az_deg: 12 } as never)).toThrow(/uphill_az_deg/);
    expect(() => parsePad('im2_athena', { ...(j as object), slope_deg: 95 } as never)).toThrow(/slope_deg/);
    expect(() => parsePad('im2_athena', { ...(j as object), version: '9' } as never)).toThrow(/version/);
    expect(() => parsePad('other', j)).toThrow(/site_id/);
  });
});

describe('golden (skips while empty)', () => {
  it('reports an empty set so parity tests can skip', async () => {
    const g = await loadGolden(1);
    expect(g.empty).toBe(true);
    expect(g.tolerances.elevation_deg).toBeGreaterThan(0);
  });
});

describe('draft loaders (formats not yet frozen)', () => {
  it('dispersion 11x11', async () => {
    const d = await loadDispersion('im2_athena');
    expect(d.slopeDeg.length).toBe(121);
    expect(Math.max(...d.slopeDeg)).toBeLessThan(25.6);
  });
  it('psr raster', async () => {
    const r = await loadPsr();
    expect(Number.isNaN(r.distanceKm(10_000, 0))).toBe(true);
    expect(r.distanceKm(-20, 15)).toBe(0); // inside a mock PSR
    expect(r.distanceKm(250, 250)).toBeGreaterThan(0);
  });
  it('tier-B tile', async () => {
    const t = await loadTierBTile('s90_000');
    expect(t.nNodes).toBe(64);
    expect(t.maskDeg.length).toBe(64 * 720);
    expect(t.latDeg[0]).toBeLessThan(-89);
    await expect(loadTierBTile('nope')).rejects.toThrow(/no tile/);
  });
});
