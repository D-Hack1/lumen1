// Owner: Nived
// Seam: buildCompareResults(eph, rows, baselineId) -> CompareResults   (Compare view, PLAN_FINAL 8.6).
// Oracles that are NOT the code under test:
//   - IM-2 over the 30-day golden window: Earth visible 67.2083 %, sunlit 49.2963 % (Gowri's Python reference).
//   - Blue Ghost (18.56 N, 61.81 E, near side): Earth is ~63 deg from the sub-Earth point, i.e. ~27 deg up even allowing for
//     libration (+-7 deg), so Earth is above the horizon (and the 1 deg margin) for the WHOLE window: 100 %.
//   - Algebra: deltas are antisymmetric in the choice of baseline, and zero between identical rows.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCompareResults, type CompareRowInput } from '../compare/compare';
import type { ScenarioRequest } from '../core/buildResult';
import { DEFAULT_DEFINITIONS } from '../core/evaluate';
import { loadEphem, type Ephemeris } from '../data/ephem';
import { setDataMode } from '../data/source';
import { IM2_REFINED, PUBLIC, stubFetch } from './helpers';

const EPHEM_BIN = join(PUBLIC, 'data/ephem/ephem.bin');
const GOLDEN = join(PUBLIC, 'data/golden/golden_set1.json');
const run = existsSync(EPHEM_BIN) && statSync(EPHEM_BIN).size > 1_000_000 && existsSync(GOLDEN);
const T0 = Date.parse('2025-03-06T17:28:50Z');

const req = (siteId: string, lat: number, lon: number, over: Partial<ScenarioRequest> = {}): ScenarioRequest => ({
  siteId, tier: 'pending', nearFieldResM: null, latDeg: lat, lonDegEast: lon, heightM: 2, rotation: null, touchdownMs: T0, padSlopeDeg: null, psr: null,
  startMs: T0, durationDays: 30, tScrubMs: T0, definitions: DEFAULT_DEFINITIONS, dataVersions: {},
  profile: { minSunlitPct: 0, minLinkHours: 0, maxLongestNightH: 1e9, maxPadSlopeDeg: 90 }, weights: { sunlit: 1, link: 1, night: 1, slope: 1 }, ...over,
});
const A: CompareRowInput = { id: 'A', request: req('im2_athena', -84.7906, 29.1957) };
const B: CompareRowInput = { id: 'B', request: req('blue_ghost_m1', 18.56, 61.81) };

describe.skipIf(!run)('buildCompareResults (real data)', () => {
  let eph: Ephemeris;
  const golden = run ? JSON.parse(readFileSync(GOLDEN, 'utf8')).cases[0].metrics : null;
  beforeAll(async () => {
    setDataMode('real');
    stubFetch();
    eph = await loadEphem();
  });
  afterAll(() => setDataMode(null));

  it('evaluates every row on its own site, keeping order and ids', () => {
    const r = buildCompareResults(eph, [A, B], 'A');
    expect(r.status).toBe('ready');
    expect(r.rows.map((x) => x.scenarioId)).toEqual(['A', 'B']);
    expect(r.rows.map((x) => x.result.meta!.siteId)).toEqual(['im2_athena', 'blue_ghost_m1']);
    expect(r.baselineId).toBe('A');
    expect(r.rows[0].result.metrics!.sunlitPct.value!).toBeCloseTo(IM2_REFINED.sunlitPct, 3); // her Python, refined windows
  });

  it('deltas are against the baseline row; the baseline row itself has none', () => {
    const r = buildCompareResults(eph, [A, B], 'A');
    expect(r.rows[0].deltaVsBaseline).toEqual({});
    // Blue Ghost link 100 % (physical fact) minus IM-2 Earth visible 67.2083 % (golden) = 32.7917
    expect(r.rows[1].result.metrics!.linkPct.value).toBe(100);
    expect(r.rows[1].deltaVsBaseline.linkPct!).toBeCloseTo(100 - golden.earthVisiblePct.value, 3);
  });

  it('is antisymmetric in the choice of baseline, and identical rows differ by exactly zero', () => {
    const ab = buildCompareResults(eph, [A, B], 'A').rows[1].deltaVsBaseline;
    const ba = buildCompareResults(eph, [A, B], 'B').rows[0].deltaVsBaseline;
    expect(ba.linkPct!).toBeCloseTo(-ab.linkPct!, 9);
    expect(ba.sunlitPct!).toBeCloseTo(-ab.sunlitPct!, 9);
    const same = buildCompareResults(eph, [A, { id: 'B', request: A.request }], 'A').rows[1].deltaVsBaseline;
    expect(same.sunlitPct).toBe(0);
    expect(same.linkPct).toBe(0);
    expect(same.longestNightH).toBe(0);
  });

  it('one row outside the ephemeris is an error row; the other rows still compute', () => {
    const bad: CompareRowInput = { id: 'C', request: req('im2_athena', -84.79, 29.19, { startMs: Date.UTC(2040, 0, 1), tScrubMs: Date.UTC(2040, 0, 1) }) };
    const r = buildCompareResults(eph, [A, B, bad], 'A');
    expect(r.rows[2].result.status).toBe('error');
    expect(r.rows[2].deltaVsBaseline).toEqual({});
    expect(r.rows[1].result.status).toBe('ready');
    expect(r.rows[1].deltaVsBaseline.linkPct).toBeDefined();
  });

  it('no baseline (or an unknown one) gives rows without deltas', () => {
    expect(buildCompareResults(eph, [A, B], null).rows.every((x) => Object.keys(x.deltaVsBaseline).length === 0)).toBe(true);
    expect(buildCompareResults(eph, [A, B], 'Z').baselineId).toBeNull();
    expect(buildCompareResults(eph, [], 'A')).toEqual({ status: 'idle', rows: [], baselineId: null });
  });
});
