// Owner: Nived
// Seams: buildCalendar(eph, { request, days }) -> CalendarCell[] (stage 1 only, per D-15) and startCalendar(...) with progress.
// Oracles: Gowri's golden set 1 (IM-2 30 d from touchdown: sunlit 49.2963 %); a hand-counted cell count at the ephemeris end;
// consistency with the Scan for the same dates; plain arithmetic for progress.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCalendar, startCalendar, CALENDAR_CHUNK_DAYS, type CalendarProgress } from '../compare/calendar';
import { refineCandidate, scanStage1 } from '../compare/scanEngine';
import type { ScenarioRequest } from '../core/buildResult';
import { DEFAULT_DEFINITIONS } from '../core/evaluate';
import { loadEphem, type Ephemeris } from '../data/ephem';
import { setDataMode } from '../data/source';
import { IM2_REFINED, PUBLIC, stubFetch } from './helpers';

const EPHEM_BIN = join(PUBLIC, 'data/ephem/ephem.bin');
const GOLDEN = join(PUBLIC, 'data/golden/golden_set1.json');
const run = existsSync(EPHEM_BIN) && statSync(EPHEM_BIN).size > 1_000_000 && existsSync(GOLDEN);
const T0 = Date.parse('2025-03-06T17:28:50Z');
const DAY = 86_400_000;

const req = (over: Partial<ScenarioRequest> = {}): ScenarioRequest => ({
  siteId: 'im2_athena', tier: 'pending', nearFieldResM: null, latDeg: -84.7906, lonDegEast: 29.1957, heightM: 2, rotation: null, touchdownMs: T0, padSlopeDeg: null,
  psr: null, startMs: T0, durationDays: 30, tScrubMs: T0, definitions: DEFAULT_DEFINITIONS, dataVersions: {},
  profile: { minSunlitPct: 0, minLinkHours: 0, maxLongestNightH: 1e9, maxPadSlopeDeg: 90 }, weights: { sunlit: 1, link: 1, night: 1, slope: 1 }, ...over,
});

describe.skipIf(!run)('12-month calendar (real data, stage 1)', () => {
  let eph: Ephemeris;
  const golden = run ? JSON.parse(readFileSync(GOLDEN, 'utf8')).cases[0].metrics : null;
  beforeAll(async () => {
    setDataMode('real');
    stubFetch();
    eph = await loadEphem();
  });
  afterAll(() => setDataMode(null));

  it('one cell per consecutive landing date from the start, in date order, all provisional', () => {
    const cells = buildCalendar(eph, { request: req(), days: 6 });
    expect(cells.map((c) => c.landingUtc)).toEqual([0, 1, 2, 3, 4, 5].map((d) => T0 + d * DAY));
    expect(cells.every((c) => c.provisional && c.boundsStatus === 'nominal')).toBe(true);
  });

  it('the touchdown-date cell matches the Python golden sunlit value within the 10-minute sampling error', () => {
    const first = buildCalendar(eph, { request: req(), days: 3 })[0];
    expect(Math.abs(first.sunlitPct.value! - golden.sunlitPct.value)).toBeLessThan(0.2); // percentage points
  });

  it('agrees with the Scan for the same dates (one stage-1 implementation, not two)', () => {
    const cal = buildCalendar(eph, { request: req({ durationDays: 14 }), days: 4 });
    const scan = scanStage1(eph, { requests: [req({ durationDays: 14 })], plusMinusDays: 3 });
    for (const c of cal) {
      const s = scan.find((x) => x.landingUtc === c.landingUtc)!;
      expect(c.sunlitPct.value).toBe(s.sunlitPct.value);
      expect(c.verdict).toBe(s.verdict);
    }
  });

  it('skips dates whose window would run past the ephemeris, counted by hand: Dec 1 2030 + 14 d window => 17 cells', () => {
    // ephemeris ends 2030-12-31 23:00. Start Dec 1 00:00 + d days + 14 days must be < that => d = 0..16 => 17 cells (d = 17 ends Jan 1).
    const cells = buildCalendar(eph, { request: req({ startMs: Date.UTC(2030, 11, 1), tScrubMs: Date.UTC(2030, 11, 1), durationDays: 14 }), days: 60 });
    expect(cells.length).toBe(17);
    expect(cells[16].landingUtc).toBe(Date.UTC(2030, 11, 17));
  });

  it('the verdict per cell remains PENDING until terrain evidence qualifies the geometry)', () => {
    const loose = buildCalendar(eph, { request: req(), days: 3 });
    expect(loose.every((c) => c.verdict === 'PENDING')).toBe(true);
    const strict = buildCalendar(eph, { request: req({ profile: { minSunlitPct: 99.9, minLinkHours: 0, maxLongestNightH: 1e9, maxPadSlopeDeg: 90 } }), days: 3 });
    expect(strict.every((c) => c.verdict === 'PENDING')).toBe(true);
  });

  it('a full year for one site computes in the background-friendly budget (<= 2 s, CI slack via LUMEN_PERF_SLACK)', () => {
    const slack = Number(process.env.LUMEN_PERF_SLACK ?? 1);
    const t0 = performance.now();
    const cells = buildCalendar(eph, { request: req({ durationDays: 14 }), days: 365 });
    const ms = performance.now() - t0;
    expect(cells.length).toBe(365);
    expect(ms, `365 cells took ${ms.toFixed(0)} ms`).toBeLessThan(2000 * slack);
  });

  it('clicking a cell runs stage 2 for it: the refined cell equals the golden value exactly and is no longer provisional', () => {
    const cell = buildCalendar(eph, { request: req(), days: 2 })[0];
    const refined = refineCandidate(eph, req(), cell);
    expect(refined.provisional).toBe(false);
    expect(refined.sunlitPct.value!).toBeCloseTo(IM2_REFINED.sunlitPct, 3);
  });
});

describe.skipIf(!run)('startCalendar: progress and cancel', () => {
  beforeAll(async () => {
    setDataMode('real');
    stubFetch();
    await loadEphem();
  });
  afterAll(() => setDataMode(null));
  const params = { siteIds: ['im2_athena'], baseLandingUtc: T0, days: 3 * CALENDAR_CHUNK_DAYS, durationDays: 14 as const };

  it('reports monotonic progress in chunks, ending at 1 with every cell present', async () => {
    const seen: CalendarProgress[] = [];
    const final = await startCalendar(params, (p) => seen.push(p)).done;
    expect(seen.length).toBeGreaterThanOrEqual(3); // at least one update per chunk
    const f = seen.map((p) => p.fraction);
    expect(f).toEqual([...f].sort((a, b) => a - b));
    expect(f[0]).toBeGreaterThan(0);
    expect(f[f.length - 1]).toBe(1);
    expect(final.done).toBe(true);
    expect(final.cells.length).toBe(3 * CALENDAR_CHUNK_DAYS);
    const counts = seen.map((p) => p.cells.length);
    expect(counts).toEqual([...counts].sort((a, b) => a - b)); // cells only accumulate
  });

  it('cancel() stops further progress (a superseded calendar never overwrites a newer one)', async () => {
    const seen: CalendarProgress[] = [];
    const h = startCalendar(params, (p) => {
      seen.push(p);
      h.cancel();
    });
    await h.done.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 200));
    expect(seen.length).toBe(1); // exactly the first chunk, nothing after the cancel
    expect(seen[0].done).toBe(false);
  });
});
