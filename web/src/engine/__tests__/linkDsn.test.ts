// Owner: Nived
// Seam 2 (N-8, DSN-aware link): the engine applies DSN visibility to the link. Real ephemeris (IM-2), hand-built DSN series with known answers.
// link(t) = Earth visible(t) AND >= 1 complex at or above the mask (PLAN_FINAL: "DSN-aware link, default ON"). Earth-only events/windows are unchanged.
// Oracles: (a) the per-sample definition recomputed here from earthUp and the DSN series; (b) a 1-second brute-force scan for the resume time.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildScenarioResult, type ScenarioRequest } from '../core/buildResult';
import { dsnLinkUp } from '../core/dsn';
import { DEFAULT_DEFINITIONS, stateAt } from '../core/evaluate';
import { makeSite } from '../core/geometry';
import { Horizon } from '../core/visibility';
import type { DsnSeries } from '../data/dsn';
import { loadEphem, type Ephemeris } from '../data/ephem';
import { setDataMode } from '../data/source';
import { PUBLIC, stubFetch } from './helpers';

const run = existsSync(join(PUBLIC, 'data/ephem/ephem.bin')) && statSync(join(PUBLIC, 'data/ephem/ephem.bin')).size > 1_000_000;
const T0 = Date.parse('2025-03-06T17:28:50Z');
const DAYS = 14;
const MASK = 10;
const base: ScenarioRequest = {
  siteId: 'im2_athena', tier: 'pending', nearFieldResM: null, latDeg: -84.7906, lonDegEast: 29.1957, heightM: 2, rotation: null, touchdownMs: T0, padSlopeDeg: null, psr: null,
  startMs: T0, durationDays: DAYS, tScrubMs: T0, definitions: { ...DEFAULT_DEFINITIONS, dsnMaskDeg: MASK }, dataVersions: { catalog: 1 },
  profile: { minSunlitPct: 0, minLinkHours: 0, maxLongestNightH: 1e9, maxPadSlopeDeg: 90 }, weights: { sunlit: 1, link: 1, night: 1, slope: 1 },
};
/** A DSN series covering the whole window: elevation(station, node) from a function. */
const dsn = (f: (k: number, i: number) => number): DsnSeries => ({ stations: ['A', 'B', 'C'], startMs: T0 - 86_400_000, cadenceMs: 600_000, count: (DAYS + 3) * 144, elevDeg: f });
const ALL_UP = dsn(() => 60);
const ALL_DOWN = dsn(() => -60);
/** Station A is above the mask for 3 h out of every 8 h; B and C never. */
const DUTY = dsn((k, i) => (k === 0 && i % 48 < 18 ? 40 : -40));

describe.skipIf(!run)('DSN-aware link in the engine (real IM-2 ephemeris)', () => {
  let eph: Ephemeris;
  beforeAll(async () => {
    setDataMode('real');
    stubFetch();
    eph = await loadEphem();
  });
  afterAll(() => setDataMode(null));

  it('with every complex up the DSN changes nothing: link == Earth visible, same percentage', () => {
    const plain = buildScenarioResult(eph, { ...base, definitions: DEFAULT_DEFINITIONS });
    const r = buildScenarioResult(eph, base, ALL_UP);
    expect(Array.from(r.series!.linkUp)).toEqual(Array.from(plain.series!.linkUp));
    expect(r.metrics!.linkPct.value).toBe(plain.metrics!.linkPct.value);
  });

  it('with no complex up there is no link even though Earth is visible: linkUp all 0, link 0 %, comm gap = the whole window', () => {
    const r = buildScenarioResult(eph, base, ALL_DOWN);
    expect(Math.max(...r.series!.earthUp)).toBe(1); // Earth IS visible at times
    expect(Math.max(...r.series!.linkUp)).toBe(0);
    expect(r.metrics!.linkPct.value).toBe(0);
    expect(r.metrics!.longestCommGapH.value).toBeCloseTo(DAYS * 24, 6);
    expect(r.windows.filter((w) => w.type === 'link').length).toBe(0);
  });

  it('per sample: linkUp = earthUp AND the DSN rule (a duty-cycled complex)', () => {
    const r = buildScenarioResult(eph, base, DUTY);
    const s = r.series!;
    let both = 0;
    let earthOnly = 0;
    for (let i = 0; i < s.linkUp.length; i++) {
      const want = s.earthUp[i] === 1 && dsnLinkUp(DUTY, s.t0 + i * s.stepMs, MASK);
      expect(s.linkUp[i] === 1, `sample ${i}`).toBe(want);
      if (want) both++;
      else if (s.earthUp[i]) earthOnly++;
    }
    expect(both).toBeGreaterThan(100); // the test must see the link both up and Earth-up-but-link-down
    expect(earthOnly).toBeGreaterThan(100);
    expect(r.metrics!.linkPct.value!).toBeLessThan(buildScenarioResult(eph, { ...base, definitions: DEFAULT_DEFINITIONS }).metrics!.linkPct.value!);
  });

  it('link windows exist (type "link"), lie inside Earth windows, and match the linkUp series', () => {
    const r = buildScenarioResult(eph, base, DUTY);
    const link = r.windows.filter((w) => w.type === 'link');
    const earth = r.windows.filter((w) => w.type === 'earth');
    expect(link.length).toBeGreaterThan(5);
    for (const w of link) {
      expect(earth.some((e) => e.start <= w.start + 1 && e.end >= w.end - 1), `link window ${new Date(w.start).toISOString()}`).toBe(true);
      const i = Math.ceil((w.start - r.series!.t0) / r.series!.stepMs); // the window starts at a refined instant between samples: the next sample is inside it
      expect(r.series!.linkUp[i]).toBe(1);
    }
  });

  it('"link resumes (DSN)": Earth visible but the link down => state linkResumesDsn, resume time = the first instant the link is up (1 s brute force)', () => {
    // find a scrub time with Earth visible and the DSN down
    const probe = buildScenarioResult(eph, base, DUTY).series!;
    const i = Array.from(probe.earthUp).findIndex((e, k) => e === 1 && probe.linkUp[k] === 0 && k > 400);
    const scrub = probe.t0 + i * probe.stepMs;
    const r = buildScenarioResult(eph, { ...base, tScrubMs: scrub }, DUTY);
    expect(r.answer!.earth.visible).toBe(true);
    expect(r.answer!.earth.linkUp).toBe(false);
    expect(r.answer!.earth.state).toBe('linkResumesDsn');
    // oracle: scan forward second by second with the same definition
    const site = makeSite(base.latDeg, base.lonDegEast, base.heightM);
    const horizon = new Horizon({ observerHeightM: base.heightM });
    let truth = -1;
    for (let t = scrub; t < scrub + 3 * 86_400_000; t += 1000) {
      if (stateAt(eph, site, horizon, DEFAULT_DEFINITIONS, t).earth.up && dsnLinkUp(DUTY, t, MASK)) {
        truth = t;
        break;
      }
    }
    expect(truth).toBeGreaterThan(0);
    expect(Math.abs(r.answer!.earth.nextEventT! - truth)).toBeLessThanOrEqual(10_000); // the engine's 10 s bisection tolerance
  });

  it('DSN off (no mask) or no data: link == Earth visible and the definitions text says "DSN not applied"', () => {
    const plain = buildScenarioResult(eph, { ...base, definitions: DEFAULT_DEFINITIONS }, DUTY);
    expect(Math.max(...plain.series!.linkUp.map((v, i) => v - plain.series!.earthUp[i]))).toBe(0);
    expect(Math.min(...plain.series!.linkUp.map((v, i) => v - plain.series!.earthUp[i]))).toBe(0);
    expect(plain.meta!.definitionsSummary).toContain('DSN not applied');
    const noData = buildScenarioResult(eph, base, null); // mask asked for, but dsn.bin could not be loaded
    expect(Array.from(noData.series!.linkUp)).toEqual(Array.from(plain.series!.linkUp));
    expect(noData.meta!.definitionsSummary).toContain('DSN not applied');
    const applied = buildScenarioResult(eph, base, DUTY);
    expect(applied.meta!.definitionsSummary).toContain(`DSN ≥${MASK}°`);
    expect(applied.meta!.definitionsSummary).not.toContain('DSN not applied');
  });
});
