// Owner: Nived
// Sigma wiring (data_masks.md §4/§8) against SYNTHETIC sigma. The synthetic arrays below exist only in this file: they are never written under public/data and the
// loader refuses any artifact marked mock, so nothing here can reach a production result. When production sigma files arrive the same code path serves them.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildScenarioResult, type ScenarioRequest } from '../core/buildResult';
import { DEFAULT_DEFINITIONS } from '../core/evaluate';
import { sigmaAtAzimuth, sigmaRowFor } from '../core/terrainHorizon';
import { loadEphem, type Ephemeris } from '../data/ephem';
import { loadMask, type Mask } from '../data/masks';
import { __resetSigmaAbsentForTests, loadSigmaOrNull, sigmaSourceLabel, type Sigma } from '../data/sigma';
import { setDataMode } from '../data/source';
import { PUBLIC, stubFetch } from './helpers';

const T0 = Date.parse('2025-03-06T17:28:50Z');
const req = (over: Partial<ScenarioRequest> = {}): ScenarioRequest => ({
  siteId: 'im2_athena', tier: 'pending', nearFieldResM: null, latDeg: -84.7906, lonDegEast: 29.1957, heightM: 2, rotation: null, touchdownMs: T0, padSlopeDeg: 0, psr: null,
  startMs: T0, durationDays: 30, tScrubMs: T0, definitions: DEFAULT_DEFINITIONS, dataVersions: { catalog: 1 },
  profile: { minSunlitPct: 0, minLinkHours: 0, maxLongestNightH: 1e9, maxPadSlopeDeg: 90 }, weights: { sunlit: 1, link: 1, night: 1, slope: 1 }, ...over,
});
/** SYNTHETIC: a constant sigma (deg) on every bin of every height, shaped like the contract's (4, 3600) array. Not production data. */
const syntheticSigma = (siteId: string, deg: number, over: Partial<Sigma> = {}): Sigma => ({
  siteId, source: 'default', cloneCount: null, sigmaDeg: new Float32Array(4 * 3600).fill(deg), notes: null, assumedErrorM: null, mock: false, ...over,
});

describe('sigma wiring (synthetic sigma)', () => {
  let eph: Ephemeris;
  let mask: Mask;
  beforeAll(async () => {
    setDataMode('real');
    stubFetch();
    eph = await loadEphem();
    mask = await loadMask('im2_athena');
  });
  afterAll(() => setDataMode(null));

  it('without sigma nothing changes: no +/-, "sigma pending", the verdict cannot be GO', () => {
    const r = buildScenarioResult(eph, req(), null, mask, null);
    expect(r.metrics!.sunlitPct.lo).toBeNull();
    expect(r.events.every((e) => e.dtMs === null)).toBe(true);
    expect(r.meta!.tierBadge).toBe('Terrain mask · σ unavailable');
    expect(r.verdict).toBe('PENDING');
  });

  it('with sigma: metrics get lo <= value <= hi, events get a +/- time, labels name the sigma source, and the verdict is judged on the bound (GO is possible)', () => {
    const r = buildScenarioResult(eph, req(), null, mask, syntheticSigma('im2_athena', 0.5));
    const m = r.metrics!;
    for (const k of ['sunlitPct', 'linkPct', 'longestNightH', 'longestCommGapH', 'opsHours'] as const) {
      const b = m[k];
      expect(b.lo, `${k} lo`).not.toBeNull();
      expect(b.hi, `${k} hi`).not.toBeNull();
      expect(b.lo!, `${k} lo <= value`).toBeLessThanOrEqual(b.value! + 1e-9);
      expect(b.hi!, `${k} value <= hi`).toBeGreaterThanOrEqual(b.value! - 1e-9);
    }
    expect(m.sunlitPct.hi! - m.sunlitPct.lo!).toBeGreaterThan(0); // 0.5 deg of mask error moves the sunlit time
    expect(r.events.length).toBeGreaterThan(0);
    expect(r.events.some((e) => e.dtMs != null)).toBe(true);
    expect(r.meta!.sigmaSource).toBe('default');
    expect(r.meta!.tierBadge).toBe('Terrain mask · σ default');
    expect(r.verdict).not.toBe('PENDING'); // bounded values can be judged; the same request without sigma is PENDING
    expect(r.verdictReasons.join(' ')).not.toMatch(/sigma|σ\) is needed|smooth-sphere estimate/);
    // the Answer Strip carries the bounds too
    expect(r.answer!.windowSunlitPct.lo).not.toBeNull();
  });

  it('more sigma gives wider bounds, and sigma = 0 collapses them onto the nominal value', () => {
    const w = (deg: number) => {
      const b = buildScenarioResult(eph, req(), null, mask, syntheticSigma('im2_athena', deg)).metrics!.sunlitPct;
      return { v: b.value!, width: b.hi! - b.lo! };
    };
    const narrow = w(0.1);
    const wide = w(1);
    const zero = w(0);
    expect(wide.width).toBeGreaterThan(narrow.width);
    expect(zero.width).toBeCloseTo(0, 9);
    expect(narrow.v).toBeCloseTo(wide.v, 9); // the nominal value does not depend on sigma
  });

  it('staged stage 1 (nominalOnly): marked nominal, no verdict and no +/-, and the SAME nominal values as the final result (G8)', () => {
    const sigma = syntheticSigma('im2_athena', 0.5);
    const quick = buildScenarioResult(eph, { ...req(), nominalOnly: true }, null, mask, null); // the worker passes no sigma for stage 1
    const final = buildScenarioResult(eph, req(), null, mask, sigma);
    expect(quick.meta!.stage).toBe('nominal');
    expect(final.meta!.stage).toBeUndefined();
    expect(quick.verdict).toBe('PENDING');
    expect(quick.verdictReasons).toEqual(['Computing the terrain uncertainty (±) and the verdict…']);
    expect(quick.meta!.tierBadge).toContain('computing ±');
    expect(quick.metrics!.sunlitPct.lo).toBeNull();
    for (const k of ['sunlitPct', 'linkPct', 'longestNightH'] as const) expect(quick.metrics![k].value).toBe(final.metrics![k].value);
  });
  it('the series carries sigma at the Sun azimuth', () => {
    const r = buildScenarioResult(eph, req(), null, mask, syntheticSigma('im2_athena', 0.25));
    expect(r.series!.sigmaBandDeg[100]).toBeCloseTo(0.25, 5);
    const none = buildScenarioResult(eph, req(), null, mask, null);
    expect(none.series!.sigmaBandDeg[100]).toBe(0);
  });

  it('labels follow the artifact source (data_masks.md §8)', () => {
    expect(sigmaSourceLabel({ source: 'default', cloneCount: null, notes: null })).toBe('default');
    expect(sigmaSourceLabel({ source: 'monte_carlo', cloneCount: 30, notes: null })).toBe('Monte-Carlo, 30 clones');
    expect(sigmaSourceLabel({ source: 'calibrated', cloneCount: null, notes: 'vs Tier A DEM' })).toBe('calibrated: vs Tier A DEM');
    const r = buildScenarioResult(eph, req(), null, mask, syntheticSigma('im2_athena', 0.2, { source: 'monte_carlo', cloneCount: 30 }));
    expect(r.meta!.sigmaSource).toBe('Monte-Carlo, 30 clones');
  });

  it('sigma that must not be used is ignored: mock, another site, a height with no row, negative or NaN bins', () => {
    const good = syntheticSigma('im2_athena', 0.3);
    expect(sigmaRowFor(good, mask, 2)).not.toBeNull();
    expect(sigmaRowFor(syntheticSigma('im2_athena', 0.3, { mock: true }), mask, 2)).toBeNull();
    expect(sigmaRowFor(syntheticSigma('cy3_shiv_shakti', 0.3), mask, 2)).toBeNull();
    expect(sigmaRowFor(good, mask, 3)).toBeNull(); // 3 m is not one of 1/2/5/10
    const neg = syntheticSigma('im2_athena', 0.3);
    neg.sigmaDeg[1 * 3600 + 7] = -0.1; // height index 1 = 2 m
    expect(sigmaRowFor(neg, mask, 2)).toBeNull();
    const nan = syntheticSigma('im2_athena', 0.3);
    nan.sigmaDeg[1 * 3600 + 7] = NaN;
    expect(sigmaRowFor(nan, mask, 2)).toBeNull();
    expect(sigmaRowFor(null, mask, 2)).toBeNull();
    // and an unusable sigma leaves the result exactly as "sigma pending"
    const r = buildScenarioResult(eph, req(), null, mask, neg);
    expect(r.metrics!.sunlitPct.lo).toBeNull();
    expect(r.meta!.tierBadge).toBe('Terrain mask · σ unavailable');
  });

  it('sigmaAtAzimuth interpolates between bin centres and wraps through north', () => {
    const row = new Float32Array(3600);
    row[3599] = 1;
    row[0] = 3;
    expect(sigmaAtAzimuth(row, 0.1, 0.05)).toBeCloseTo(3, 6); // centre of bin 0
    expect(sigmaAtAzimuth(row, 0.1, 0)).toBeCloseTo(2, 6); // halfway between bins 3599 and 0
    expect(sigmaAtAzimuth(row, 0.1, 360)).toBeCloseTo(2, 6);
  });

  it('loadSigmaOrNull: no synthetic data leaks into production, mock mode is always null, a missing file is null', async () => {
    __resetSigmaAbsentForTests();
    const prod = join(PUBLIC, 'data/terrain/sigma/im2_athena.bin');
    const got = await loadSigmaOrNull('im2_athena');
    expect(got === null).toBe(!existsSync(prod)); // null until a production file exists; then it must be a real, non-mock artifact
    if (got) expect(got.mock).toBe(false);
    expect(await loadSigmaOrNull('no_such_site')).toBeNull();
    expect(await loadSigmaOrNull(null)).toBeNull();
    setDataMode('mock');
    try {
      expect(await loadSigmaOrNull('im2_athena')).toBeNull(); // the mock sigma under data-mock is never used
    } finally {
      setDataMode('real');
    }
  });
});
