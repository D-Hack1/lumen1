// Owner: Nived
// Live pages <-> engine: the id table (one copy), the request a live site becomes, and the Stand-here view read from a real result.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildScenarioResult } from '../../engine/core/buildResult';
import { horizonFromMask } from '../../engine/core/terrainHorizon';
import { loadCatalog } from '../../engine/data/catalog';
import { loadEphem, type Ephemeris } from '../../engine/data/ephem';
import { loadMask, type Mask } from '../../engine/data/masks';
import { setDataMode } from '../../engine/data/source';
import { PUBLIC, stubFetch } from '../../engine/__tests__/helpers';
import { BASE_UTC, SITES } from '../orbit/orbitModel';
import { ENGINE_SITE_ID, MASK_HEIGHTS_M, engineSiteId, requestFor, skylineFor, standHereView, verticalScale } from './engineBindings';

describe('live id -> engine id table', () => {
  it('maps im2 and shack, and only those; everything else is a plain point', () => {
    expect(ENGINE_SITE_ID).toEqual({ im2: 'im2_athena', shack: 'shackleton_ridge' });
    expect(engineSiteId('im2')).toBe('im2_athena');
    expect(engineSiteId('shack')).toBe('shackleton_ridge');
    for (const id of ['malapert', 'haworth', 'custom']) expect(engineSiteId(id)).toBeNull();
  });

  it('every mapped engine id exists in the engine catalog, and every live id in the table exists on the pages', () => {
    const catalog = JSON.parse(readFileSync(join(PUBLIC, 'data/catalog/sites.json'), 'utf8')) as { sites: Array<{ id: string }> };
    for (const [live, eng] of Object.entries(ENGINE_SITE_ID)) {
      expect(catalog.sites.map((s) => s.id), eng).toContain(eng);
      expect(SITES.map((s) => s.id), live).toContain(live);
    }
  });

  it('the live Shackleton coordinates agree with the catalog (they once differed: -89.45 vs -89.54)', () => {
    const catalog = JSON.parse(readFileSync(join(PUBLIC, 'data/catalog/sites.json'), 'utf8')) as { sites: Array<{ id: string; latitude_deg: number; longitude_deg_east: number }> };
    for (const [live, eng] of Object.entries(ENGINE_SITE_ID)) {
      const page = SITES.find((s) => s.id === live)!;
      const cat = catalog.sites.find((s) => s.id === eng)!;
      expect(page.lat, `${live} lat`).toBeCloseTo(cat.latitude_deg, 4);
      expect(page.lon, `${live} lon`).toBeCloseTo(cat.longitude_deg_east, 4);
    }
  });
});

describe('Stand here bindings (real data)', () => {
  let eph: Ephemeris;
  let shackMask: Mask;
  beforeAll(async () => {
    setDataMode('real');
    stubFetch();
    eph = await loadEphem();
    shackMask = await loadMask('shackleton_ridge');
  });
  afterAll(() => setDataMode(null));

  it('requestFor: a mapped site becomes a catalog request, an unmapped one a labelled lat/lon point', async () => {
    const { sites } = await loadCatalog();
    const shack = requestFor({ id: 'shack', lat: -89.54, lon: 129 }, 10, 0, 30, sites);
    expect(shack.siteId).toBe('shackleton_ridge');
    expect(shack.heightM).toBe(10);
    expect(shack.startMs).toBe(BASE_UTC);
    expect(shack.durationDays).toBe(30);
    const mal = requestFor({ id: 'malapert', lat: -85.9, lon: 0 }, 2, 3, 14, sites);
    expect(mal.siteId).toBeNull();
    expect(mal.tier).toBe('C');
    expect(mal.latDeg).toBe(-85.9);
    expect(mal.startMs).toBe(BASE_UTC + 3 * 86_400_000); // slip moves the window
  });

  it('skylineFor: the mask row for a supported mast is "terrain"; no mask is the smooth Moon and says so', () => {
    expect(MASK_HEIGHTS_M).toEqual([1, 2, 5, 10]);
    const terrain = skylineFor(horizonFromMask(shackMask, 10), 10);
    expect(terrain.terrain).toBe(true);
    expect(terrain.elevationAt(0)).toBeGreaterThan(10); // Shackleton's skyline is ~15-27 deg
    const smooth = skylineFor(horizonFromMask(shackMask, 0), 0); // 0 m: no mask
    expect(smooth.terrain).toBe(false);
    expect(Math.abs(smooth.elevationAt(90))).toBeLessThan(0.1);
  });

  it('standHereView on the real Shackleton result: Sun behind terrain all window, skyline and tracks on one scale, honest source', () => {
    const req = {
      siteId: 'shackleton_ridge', tier: 'pending' as const, nearFieldResM: null, latDeg: -89.54, lonDegEast: 129, heightM: 10, rotation: null, touchdownMs: null, padSlopeDeg: null, psr: null,
      startMs: BASE_UTC, durationDays: 30, tScrubMs: BASE_UTC, definitions: { sunDiskThreshold: 0.5, earthDiskThreshold: 0.5, earthMarginDeg: 1, minSunElevationOpsDeg: 0 },
      dataVersions: { catalog: 1 }, profile: { minSunlitPct: 0, minLinkHours: 0, maxLongestNightH: 1e9, maxPadSlopeDeg: 90 }, weights: { sunlit: 1, link: 1, night: 1, slope: 1 },
    };
    const r = buildScenarioResult(eph, req, null, shackMask);
    const sky = skylineFor(horizonFromMask(shackMask, 10), 10);
    const v = standHereView(r, sky, 96)!;
    expect(v.source).toBe('terrain');
    expect(Number.isFinite(v.sunEl) && Number.isFinite(v.sunAz)).toBe(true);
    expect(v.lit).toBe(r.series!.sunUp[Math.round((96 * 3_600_000) / r.series!.stepMs)] === 1);
    expect(v.horizonAtSun).toBeCloseTo(sky.elevationAt(v.sunAz), 9);
    expect(v.y(0)).toBe(262); // the page's baseline
    expect(v.y(20)).toBeGreaterThan(0); // the tall skyline stays on screen (the design's 34 px/deg would put 27 deg above the top)
    expect(v.path.startsWith('M0 300')).toBe(true);
    expect(v.path.endsWith('Z')).toBe(true);
    expect(v.sunTrack.trim().startsWith('M')).toBe(true);
    if (!v.lit) expect(v.sunChangeH === null || v.sunChangeH > 0).toBe(true);
  });

  it('verticalScale keeps the design 34 px/deg for low skylines and shrinks only for tall ones', () => {
    expect(verticalScale(3)).toBe(34);
    expect(verticalScale(27)).toBeCloseTo(240 / 29, 6);
    expect(verticalScale(1000)).toBe(6);
  });
});
