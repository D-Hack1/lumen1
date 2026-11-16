// Owner: Nived
// ScenarioResult built from the REAL ephemeris (IM-2, smooth horizon) - what the Answer Strip / Metric Deck show in real mode.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluateScenario, latestWins } from '../client';
import { buildScenarioResult, type ScenarioRequest } from '../core/buildResult';
import { DEFAULT_DEFINITIONS } from '../core/evaluate';
import { bodyAt, makeSite } from '../core/geometry';
import { loadEphem, type Ephemeris } from '../data/ephem';
import { setDataMode } from '../data/source';
import { IM2_REFINED, PUBLIC, stubFetch } from './helpers';

const EPHEM_BIN = join(PUBLIC, 'data/ephem/ephem.bin');
const GOLDEN = join(PUBLIC, 'data/golden/golden_set1.json');
const run = existsSync(EPHEM_BIN) && statSync(EPHEM_BIN).size > 1_000_000 && existsSync(GOLDEN);

const TOUCHDOWN = Date.parse('2025-03-06T17:28:50Z');
const base: ScenarioRequest = {
  siteId: 'im2_athena', tier: 'pending', nearFieldResM: null, latDeg: -84.7906, lonDegEast: 29.1957, heightM: 2, rotation: null,
  touchdownMs: TOUCHDOWN, padSlopeDeg: null, psr: null, startMs: TOUCHDOWN, durationDays: 30, tScrubMs: TOUCHDOWN,
  definitions: DEFAULT_DEFINITIONS, dataVersions: { catalog: 1 },
  profile: { minSunlitPct: 0, minLinkHours: 0, maxLongestNightH: 1e9, maxPadSlopeDeg: 90 }, weights: { sunlit: 1, link: 1, night: 1, slope: 1 },
};

describe.skipIf(!run)('buildScenarioResult (real IM-2 ephemeris)', () => {
  let eph: Ephemeris;
  const golden = run ? (JSON.parse(readFileSync(GOLDEN, 'utf8')).cases[0] as { events: Array<{ type: string; utc: string }>; metrics: Record<string, { value: number }> }) : null;
  beforeAll(async () => {
    setDataMode('real');
    stubFetch();
    eph = await loadEphem();
  });
  afterAll(() => setDataMode(null));

  it('answers "Sun now / Sunset in" from the real geometry, matching the golden sunset', () => {
    const r = buildScenarioResult(eph, base);
    expect(r.status).toBe('ready');
    expect(r.answer!.sun.up).toBe(true);
    expect(r.answer!.sun.state).toBe('sunsetIn');
    const goldenSunset = Date.parse(golden!.events.find((e) => e.type === 'sunset')!.utc);
    expect(Math.abs(r.answer!.sun.nextEventT! - goldenSunset)).toBeLessThan(60_000);
    expect(r.answer!.sun.elevDeg).toBeCloseTo(2.4646, 3); // from the golden render sample at touchdown
    expect(r.answer!.earth.state).toBe('earthsetIn');
  });

  it('never invents values it does not have: no sigma bounds, no power, verdict pending, honest labels', () => {
    const r = buildScenarioResult(eph, base);
    expect(r.verdict).toBe('PENDING');
    expect(r.verdictReasons.join(' ')).toMatch(/smooth-sphere estimates; terrain data is needed to determine pass or fail/);
    expect(r.metrics!.energyPerDayWh.value).toBeNull();
    expect(r.metrics!.sunlitPct.lo).toBeNull(); // no +/- until the uncertainty passes exist
    expect(r.meta!.sigmaSource).toBe('smooth-sphere estimate; terrain unavailable');
    expect(r.meta!.definitionsSummary).toMatch(/DSN not applied/);
    expect(r.metrics!.sunlitPct.value).toBeCloseTo(IM2_REFINED.sunlitPct, 3); // refined-window method (her Python); Golden Set 1's sample-based 49.2963 differs by 0.003
  });

  it('moves to the sunrise state after dark, with "dark for" measured from the last sunset', () => {
    const afterSunset = Date.parse('2025-03-21T00:00:00Z'); // between the 19 Mar sunset and the 3 Apr shadow exit
    const r = buildScenarioResult(eph, { ...base, tScrubMs: afterSunset });
    expect(r.answer!.sun.up).toBe(false);
    expect(r.answer!.sun.state).toBe('sunriseIn');
    expect(r.answer!.sun.darkForMs).toBeGreaterThan(30 * 3_600_000);
    expect(r.answer!.sun.nextEventT).toBeGreaterThan(afterSunset);
  });

  it('the ISRO ops-elevation definition produces the below-ops state (D-10 / D-14)', () => {
    const r = buildScenarioResult(eph, { ...base, definitions: { ...DEFAULT_DEFINITIONS, minSunElevationOpsDeg: 6 } });
    expect(r.answer!.sun.state).toBe('belowOpsElevation'); // Sun is up at 2.5 deg but below the 6 deg minimum
    expect(r.answer!.sun.opsMinElevDeg).toBe(6);
    expect(r.metrics!.sunlitPct.value).toBe(0); // never above 6 deg at 85S, so no ops-available time
  });

  it('reports a clear error when the window is outside the ephemeris', () => {
    const r = buildScenarioResult(eph, { ...base, startMs: Date.UTC(2035, 0, 1), tScrubMs: Date.UTC(2035, 0, 1) });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/outside it/);
  });

  it('series, events and windows are consistent with each other', () => {
    const r = buildScenarioResult(eph, base);
    const s = r.series!;
    expect(s.sunElevDeg.length).toBe(s.sunUp.length);
    expect(s.t0).toBe(TOUCHDOWN);
    expect(s.stepMs).toBe(120_000);
    expect(r.events.map((e) => e.t)).toEqual([...r.events.map((e) => e.t)].sort((a, b) => a - b));
    expect(r.windows.filter((w) => w.type === 'sun').length).toBeGreaterThan(0);
  });

  it('series carries the Earth range (km) for Pointing: physical, and equal to the engine geometry at each sample', () => {
    const r = buildScenarioResult(eph, base);
    const s = r.series!;
    expect(s.earthRangeKm).toBeInstanceOf(Float32Array);
    expect(s.earthRangeKm.length).toBe(s.earthElevDeg.length);
    // Independent physical bounds: Earth-Moon centre distance 356,400-406,700 km, plus/minus the Moon radius for a surface site.
    for (const km of s.earthRangeKm) {
      expect(km).toBeGreaterThan(354_000);
      expect(km).toBeLessThan(408_500);
    }
    // Wiring: sample i equals the geometry (range parity with the Python reference is covered in core.parity.test.ts).
    for (const i of [0, 100, 5000, s.earthRangeKm.length - 1]) {
      const g = bodyAt(eph, 'earth', s.t0 + i * s.stepMs, makeSite(base.latDeg, base.lonDegEast, base.heightM));
      expect(Math.abs(s.earthRangeKm[i] - g.distanceKm)).toBeLessThan(0.05); // float32 storage
    }
  });

  it('with a power config: series.powerW / flatPowerW are the panel generation (flat deck: S0*sin(el)*disk), energy per day is filled', () => {
    const power = { preset: 'horizontalDeck' as const, yawDeg: 0, tiltMagDeg: 0, tiltDirDeg: 0, groundNormal: null, panelAreaM2: 1, efficiency: 1 };
    const r = buildScenarioResult(eph, { ...base, power });
    const s = r.series!;
    expect(s.powerW.length).toBe(s.sunElevDeg.length);
    let checked = 0;
    for (let i = 0; i < s.powerW.length; i += 97) {
      const want = 1361 * Math.max(0, Math.sin((s.sunElevDeg[i] * Math.PI) / 180)) * (s.sunDiskPct[i] / 100);
      expect(Math.abs(s.powerW[i] - want), `sample ${i}`).toBeLessThanOrEqual(0.04 * want + 0.05); // the Sun's distance varies +-1.7% over the year => irradiance +-3.4%
      expect(s.flatPowerW[i]).toBeCloseTo(s.powerW[i], 3); // flat deck on flat ground: actual == baseline
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
    expect(Math.max(...s.powerW)).toBeGreaterThan(0);
    const e = r.metrics!.energyPerDayWh.value!;
    expect(e).toBeGreaterThan(0);
    expect(e).toBeLessThan(1361 * 24); // can never beat a panel facing the Sun all day
    expect(buildScenarioResult(eph, base).metrics!.energyPerDayWh.value).toBeNull(); // no config => no invented number
  });

  it('the client runs the same evaluation in-thread when there is no Worker (tests/SSR)', async () => {
    const r = await evaluateScenario(base);
    expect(r.status).toBe('ready');
    expect(r.meta!.dataVersions.ephem).toBe('real');
  });
});

describe.skipIf(!run)('verdict wired into the real result (oracle: golden set 1, computed by the Python reference)', () => {
  let eph: Ephemeris;
  beforeAll(async () => {
    setDataMode('real');
    stubFetch();
    eph = await loadEphem();
  });
  afterAll(() => setDataMode(null));
  const weights = { sunlit: 1, link: 1, night: 1, slope: 1 };
  // golden (Python): sunlit 49.296%, Earth visible 67.208% of 720 h = 483.9 h, over the 30-day window.
  const req = (profile: ScenarioRequest['profile']): ScenarioRequest => ({ ...base, profile, weights });

  it('PENDING when the nominal smooth-sphere result misses the profile: terrain is needed to determine the result', () => {
    const r = buildScenarioResult(eph, req({ minSunlitPct: 60, minLinkHours: 100, maxLongestNightH: 500, maxPadSlopeDeg: 10 }));
    expect(r.verdict).toBe('PENDING');
    expect(r.verdictReasons.join(' ')).toMatch(/smooth-sphere estimate/);
  });
  it('PENDING when nominal smooth-sphere link hours miss the profile', () => {
    const r = buildScenarioResult(eph, req({ minSunlitPct: 10, minLinkHours: 500, maxLongestNightH: 500, maxPadSlopeDeg: 10 }));
    expect(r.verdict).toBe('PENDING');
    expect(r.verdictReasons.join(' ')).toMatch(/smooth-sphere estimate/);
  });
  it('PENDING when nominal smooth-sphere values pass: terrain is needed to determine the result', () => {
    const r = buildScenarioResult(eph, req({ minSunlitPct: 40, minLinkHours: 100, maxLongestNightH: 500, maxPadSlopeDeg: 10 }));
    expect(r.verdict).toBe('PENDING');
    expect(r.verdictReasons.join(' ')).toMatch(/smooth-sphere estimate/);
  });
  it('exposes the Viability Index components, scored from the same metrics', () => {
    const r = buildScenarioResult(eph, req({ minSunlitPct: 60, minLinkHours: 100, maxLongestNightH: 500, maxPadSlopeDeg: 10 }));
    const sunlit = r.viability!.components.find((c) => c.id === 'sunlit')!;
    expect(sunlit.score).toBeCloseTo(49.2963 / 60, 3); // value / limit, hand-worked from the golden 49.2963 %
    expect(r.viability!.components.find((c) => c.id === 'slope')!.score).toBeNull(); // no pad data for this site
  });
});

describe('latestWins', () => {
  it('discards results of superseded calls', async () => {
    const slow = latestWins(async (ms: number, v: string) => (await new Promise((r) => setTimeout(r, ms)), v));
    const a = slow(30, 'old');
    const b = slow(5, 'new');
    expect(await b).toBe('new');
    expect(await a).toBeNull();
  });
});
