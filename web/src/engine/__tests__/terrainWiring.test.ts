// Owner: Nived
// The engine uses a site's real terrain mask when one exists, and otherwise uses a labelled smooth-sphere estimate.
// Shackleton is the case: its published mask has the Sun visible in 0 of 21,601 samples over 2025-12-01..31, while the smooth Moon says 100% sunlit.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluateScenario } from '../client';
import { buildScenarioResult, type ScenarioRequest } from '../core/buildResult';
import { DEFAULT_DEFINITIONS } from '../core/evaluate';
import { horizonFromMask } from '../core/terrainHorizon';
import { loadEphem, type Ephemeris } from '../data/ephem';
import { loadMask, loadMaskOrNull, type Mask } from '../data/masks';
import { setDataMode } from '../data/source';
import { stubFetch } from './helpers';

const T = Date.parse('2025-12-01T00:00:00Z');
const shackleton = (over: Partial<ScenarioRequest> = {}): ScenarioRequest => ({
  siteId: 'shackleton_ridge', tier: 'pending', nearFieldResM: null, latDeg: -89.54, lonDegEast: 129, heightM: 10, rotation: null, touchdownMs: null,
  padSlopeDeg: null, psr: null, startMs: T, durationDays: 30, tScrubMs: T, definitions: DEFAULT_DEFINITIONS, dataVersions: { catalog: 1 },
  profile: { minSunlitPct: 0, minLinkHours: 0, maxLongestNightH: 1e9, maxPadSlopeDeg: 90 }, weights: { sunlit: 1, link: 1, night: 1, slope: 1 }, ...over,
});

describe('terrain mask wiring (real Shackleton mask)', () => {
  let eph: Ephemeris;
  let mask: Mask;
  beforeAll(async () => {
    setDataMode('real');
    stubFetch();
    eph = await loadEphem();
    mask = await loadMask('shackleton_ridge');
  });
  afterAll(() => setDataMode(null));

  it('without a mask the result is the labelled smooth-sphere estimate', () => {
    const r = buildScenarioResult(eph, shackleton());
    expect(r.meta!.tierBadge).toBe('Smooth-Moon horizon · terrain pending');
    expect(r.meta!.sigmaSource).toBe('smooth-sphere estimate; terrain unavailable');
    expect(r.metrics!.sunlitPct.value).toBe(100);
  });

  it('with the mask the Sun is never up: 0% sunlit, no events, honest labels, no +/-, never GO', () => {
    const r = buildScenarioResult(eph, shackleton(), null, mask);
    expect(r.status).toBe('ready');
    expect(r.metrics!.sunlitPct.value).toBe(0);
    expect(r.metrics!.sunlitPct.lo).toBeNull();
    expect(r.events.filter((e) => e.type === 'sunset' || e.type === 'shadowExit')).toEqual([]);
    expect(r.answer!.sun.up).toBe(false);
    expect(r.answer!.sun.nextEventT).toBeNull();
    expect(r.meta!.tierBadge).toBe('Terrain mask · σ unavailable');
    expect(r.meta!.sigmaSource).toBe('terrain mask, σ unavailable');
    expect(r.verdict).not.toBe('GO');
    expect(r.verdictReasons.join(' ')).not.toMatch(/smooth-Moon/);
  });

  it('a height the mask was not built for uses the smooth-sphere estimate (heights are never snapped or interpolated)', () => {
    expect(horizonFromMask(mask, 3)).toBeNull();
    const r = buildScenarioResult(eph, shackleton({ heightM: 3 }), null, mask);
    expect(r.meta!.tierBadge).toBe('Smooth-Moon horizon · terrain pending');
  });

  it('a mask with an unavailable (NaN) bin, or a mock mask, is not used', () => {
    const nan = Float32Array.from(mask.elevDeg);
    nan[10 * 0 + 5 + 3 * mask.azimuthCount] = NaN; // height index 3 = 10 m
    expect(horizonFromMask({ ...mask, elevDeg: nan }, 10)).toBeNull();
    expect(horizonFromMask({ ...mask, meta: { ...mask.meta, mock: true } }, 10)).toBeNull();
    expect(horizonFromMask(null, 10)).toBeNull();
  });

  it('loadMaskOrNull: real mask for Shackleton, null for a site without one or no id, and null in mock mode', async () => {
    expect(await loadMaskOrNull('shackleton_ridge')).not.toBeNull();
    expect(await loadMaskOrNull('no_such_site')).toBeNull();
    expect(await loadMaskOrNull(null)).toBeNull();
    setDataMode('mock');
    try {
      expect(await loadMaskOrNull('shackleton_ridge')).toBeNull();
    } finally {
      setDataMode('real');
    }
  });

  it('evaluateScenario (the Cockpit path, in-thread) picks the mask up from the site id', async () => {
    const r = await evaluateScenario(shackleton());
    expect(r.metrics!.sunlitPct.value).toBe(0);
    expect(r.meta!.tierBadge).toBe('Terrain mask · σ Monte-Carlo, 30 clones'); // preliminary Monte-Carlo sigma is published for Shackleton
    const noMask = await evaluateScenario(shackleton({ siteId: 'no_such_site' }));
    expect(noMask.metrics!.sunlitPct.value).toBe(100);
  });

  it('IM-2 (real mask, 2 m): the mask changes the numbers (in either direction: terrain can lower the horizon as well as raise it) and the labels say terrain, no sigma', async () => {
    const t0 = Date.parse('2025-03-06T17:28:50Z');
    const im2 = shackleton({ siteId: 'im2_athena', latDeg: -84.7906, lonDegEast: 29.1957, heightM: 2, startMs: t0, tScrubMs: t0, touchdownMs: t0 });
    const imMask = await loadMask('im2_athena');
    const smooth = buildScenarioResult(eph, im2);
    const terrain = buildScenarioResult(eph, im2, null, imMask);
    expect(Math.abs(terrain.metrics!.sunlitPct.value! - smooth.metrics!.sunlitPct.value!)).toBeGreaterThan(0.001);
    expect(terrain.meta!.tierBadge).toBe('Terrain mask · σ unavailable');
    expect(terrain.meta!.tierBadge).not.toBe(smooth.meta!.tierBadge);
    expect(terrain.metrics!.sunlitPct.lo).toBeNull(); // still no sigma, so no +/-
  });
});
