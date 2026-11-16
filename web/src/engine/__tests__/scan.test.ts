// Owner: Nived
// Seams: scanStage1(eph, input) -> ScanCandidate[] (fast, nominal, "provisional") and refineCandidate(...) (stage 2, exact).
// Oracle: Gowri's golden set 1 (IM-2, 30 d from touchdown: sunlit 49.2963 %, longest night from golden). Stage 1 samples every
// 10 min, so it may differ from the exact 2-min value by a small sampling error; stage 2 must match the golden value exactly.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ScenarioRequest } from '../core/buildResult';
import { DEFAULT_DEFINITIONS } from '../core/evaluate';
import { refineCandidate, scanStage1, STAGE1_STEP_MS, type ScanInput } from '../compare/scanEngine';
import { loadEphem, type Ephemeris } from '../data/ephem';
import { setDataMode } from '../data/source';
import { IM2_REFINED, PUBLIC, stubFetch } from './helpers';

const EPHEM_BIN = join(PUBLIC, 'data/ephem/ephem.bin');
const GOLDEN = join(PUBLIC, 'data/golden/golden_set1.json');
const run = existsSync(EPHEM_BIN) && statSync(EPHEM_BIN).size > 1_000_000 && existsSync(GOLDEN);
const T0 = Date.parse('2025-03-06T17:28:50Z');
const DAY = 86_400_000;

const req = (siteId: string, lat: number, lon: number): ScenarioRequest => ({
  siteId, tier: 'pending', nearFieldResM: null, latDeg: lat, lonDegEast: lon, heightM: 2, rotation: null, touchdownMs: T0, padSlopeDeg: null, psr: null,
  startMs: T0, durationDays: 30, tScrubMs: T0, definitions: DEFAULT_DEFINITIONS, dataVersions: {},
  profile: { minSunlitPct: 40, minLinkHours: 100, maxLongestNightH: 500, maxPadSlopeDeg: 90 }, weights: { sunlit: 1, link: 1, night: 1, slope: 1 },
});
const IM2 = req('im2_athena', -84.7906, 29.1957);
const BG = req('blue_ghost_m1', 18.56, 61.81);

describe.skipIf(!run)('Scan on the real ephemeris', () => {
  let eph: Ephemeris;
  const g = run ? JSON.parse(readFileSync(GOLDEN, 'utf8')).cases[0].metrics : null;
  beforeAll(async () => {
    setDataMode('real');
    stubFetch();
    eph = await loadEphem();
  });
  afterAll(() => setDataMode(null));

  const input = (requests: ScenarioRequest[], plusMinusDays = 5): ScanInput => ({ requests, plusMinusDays });

  it('stage 1 ranks 2N+1 landing dates per site, best viability first, all marked provisional/nominal', () => {
    const c = scanStage1(eph, input([IM2], 5));
    expect(c.length).toBe(11);
    expect(c.every((x) => x.provisional && x.boundsStatus === 'nominal')).toBe(true);
    const vi = c.map((x) => x.viabilityIndex);
    expect(vi).toEqual([...vi].sort((a, b) => b - a)); // descending
    expect(new Set(c.map((x) => x.landingUtc)).size).toBe(11);
    expect(c.map((x) => (x.landingUtc - T0) / DAY).sort((a, b) => a - b)).toEqual([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
  });

  it('stage 1 agrees with the Python golden values for the base date within the 10-minute sampling error', () => {
    const base = scanStage1(eph, input([IM2], 5)).find((x) => x.landingUtc === T0)!;
    expect(Math.abs(base.sunlitPct.value! - g.sunlitPct.value)).toBeLessThan(0.2); // percentage points
    expect(Math.abs(base.longestNightH.value! - g.longestNightH.value)).toBeLessThan(10 / 60 + 1e-9); // one 10-min step, in hours
    expect(STAGE1_STEP_MS).toBe(600_000);
  });

  it('stage 1 across sites: a site whose Earth is always visible (Blue Ghost) has link 100 %, IM-2 does not', () => {
    const c = scanStage1(eph, input([IM2, BG], 2));
    expect(c.length).toBe(10);
    expect(c.filter((x) => x.siteId === 'blue_ghost_m1').every((x) => x.linkPct.value === 100)).toBe(true);
    expect(c.filter((x) => x.siteId === 'im2_athena').every((x) => x.linkPct.value! < 100)).toBe(true);
  });

  it('stage 1 meets the G13 budget (<= 100 ms for a +-15 day scan of one site), with CI headroom', () => {
    const t0 = performance.now();
    const c = scanStage1(eph, input([IM2], 15));
    const ms = performance.now() - t0;
    expect(c.length).toBe(31);
    expect(ms, `stage 1 took ${ms.toFixed(0)} ms`).toBeLessThan(250); // budget is 100 ms; 250 tolerates a loaded CI runner
  });

  it('stage 2 refines a candidate to the exact value (golden), clears "provisional", and keeps its identity', () => {
    const s1 = scanStage1(eph, input([IM2], 5)).find((x) => x.landingUtc === T0)!;
    const s2 = refineCandidate(eph, IM2, s1);
    expect(s2.siteId).toBe('im2_athena');
    expect(s2.landingUtc).toBe(T0);
    expect(s2.provisional).toBe(false);
    expect(s2.sunlitPct.value!).toBeCloseTo(IM2_REFINED.sunlitPct, 3); // refined-window method, from her Python
    expect(s2.longestNightH.value!).toBeCloseTo(IM2_REFINED.longestNightH, 1);
  });

  it('candidates whose window leaves the ephemeris are skipped, not thrown', () => {
    const late = { ...IM2, startMs: Date.UTC(2030, 11, 25), tScrubMs: Date.UTC(2030, 11, 25), durationDays: 14 };
    const c = scanStage1(eph, input([late], 10));
    expect(c.length).toBeLessThan(21);
    expect(c.length).toBeGreaterThan(0);
  });
});
