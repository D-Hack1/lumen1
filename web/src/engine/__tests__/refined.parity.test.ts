// Owner: Nived
// CANONICAL DEMO METRICS (Gowri, G-10 final): sunlit %, Earth-visible %, link %, longest night, longest comm gap and ops hours come from REFINED windows
// (2-minute grid + 10 s bisection, then window durations), not from 2-minute sample counts. Oracle: fixtures/refined_parity.json = her REAL Python
// (detect_events -> windows_from_events -> window metrics) on the real ephemeris and dsn.bin, six scenarios (python3 web/src/mocks/make_refined_parity.py).
// The sample-based `Evaluation.metrics` stays for Golden Set 1 until that set is re-versioned; `Evaluation.refined` is what the app shows.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_DEFINITIONS, evaluate, type Evaluation } from '../core/evaluate';
import { makeSite } from '../core/geometry';
import { Horizon } from '../core/visibility';
import { loadDsn, type DsnSeries } from '../data/dsn';
import { loadEphem, type Ephemeris } from '../data/ephem';
import { setDataMode } from '../data/source';
import fixture from './fixtures/refined_parity.json';
import { PUBLIC, stubFetch } from './helpers';

const run = existsSync(join(PUBLIC, 'data/ephem/ephem.bin')) && statSync(join(PUBLIC, 'data/ephem/ephem.bin')).size > 1_000_000 && existsSync(join(PUBLIC, 'data/dsn/dsn.bin'));
type C = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const TYPES = ['sun', 'earth', 'link', 'ops'] as const;

describe.skipIf(!run)(`refined-window metrics vs ${fixture.source}`, () => {
  let eph: Ephemeris;
  let dsn: DsnSeries;
  beforeAll(async () => {
    setDataMode('real');
    stubFetch();
    eph = await loadEphem();
    dsn = await loadDsn();
  });
  afterAll(() => setDataMode(null));

  const ev = (c: C): Evaluation =>
    evaluate({
      eph,
      site: makeSite(c.latDeg, c.lonDegEast, c.heightM),
      horizon: new Horizon({ elevationsDeg: c.mask ? Float64Array.from(c.mask) : null, binWidthDeg: c.binWidthDeg, observerHeightM: c.heightM }),
      startMs: c.startUtcMs,
      durationDays: c.durationDays,
      definitions: { ...DEFAULT_DEFINITIONS, dsnMaskDeg: c.dsnMaskDeg },
      dsn,
    });

  it.each((fixture.cases as C[]).map((c) => [c.name, c] as const))('%s: metrics, windows and event times match her Python', (_n, c) => {
    const r = ev(c).refined;
    for (const [k, want] of Object.entries(c.metrics as Record<string, number>)) {
      const got = (r.metrics as Record<string, number>)[k];
      const tol = k.endsWith('Pct') ? 1e-3 : 0.02; // 0.25 s geometry twin precision x ~100 edges
      expect(Math.abs(got - want), `${c.name} ${k}: ${got} vs ${want}`).toBeLessThanOrEqual(tol);
    }
    for (const type of TYPES) {
      const want = (c.windows as Record<string, C[]>)[type];
      const got = r.windows.filter((w) => w.type === type);
      if (type === 'link' && c.dsnMaskDeg === null) {
        expect(got.length, 'no separate link windows when the DSN rule is not applied').toBe(0);
        continue;
      }
      expect(got.length, `${c.name} ${type} window count`).toBe(want.length);
      got.forEach((w, i) => {
        expect(Math.abs(w.startMs - want[i].startMs), `${type}[${i}] start`).toBeLessThanOrEqual(1500);
        expect(Math.abs(w.endMs - want[i].endMs), `${type}[${i}] end`).toBeLessThanOrEqual(1500);
        expect(Math.abs(w.peakElevationDeg - want[i].peak), `${type}[${i}] peak`).toBeLessThanOrEqual(1e-3);
        expect([w.partialStart, w.partialEnd]).toEqual([want[i].partialStart, want[i].partialEnd]);
      });
    }
  });

  it('the refined and the sample-based percentages agree to a few hundredths of a percent (the method change moves the demo numbers only slightly)', () => {
    for (const c of fixture.cases as C[]) {
      const e = ev(c);
      expect(Math.abs(e.refined.metrics.sunlitPct - e.metrics.sunlitPct.value!), c.name).toBeLessThan(0.05);
      expect(Math.abs(e.refined.metrics.earthVisiblePct - e.metrics.earthVisiblePct.value!), c.name).toBeLessThan(0.05);
    }
  });

  it('refined windows are ordered, disjoint, half-open and inside the scenario', () => {
    for (const c of fixture.cases as C[]) {
      const e = ev(c);
      const end = c.startUtcMs + c.durationDays * 86_400_000;
      for (const type of TYPES) {
        const ws = e.refined.windows.filter((w) => w.type === type);
        ws.forEach((w, i) => {
          expect(w.endMs).toBeGreaterThan(w.startMs);
          expect(w.startMs).toBeGreaterThanOrEqual(c.startUtcMs);
          expect(w.endMs).toBeLessThanOrEqual(end);
          if (i > 0) expect(w.startMs).toBeGreaterThanOrEqual(ws[i - 1].endMs);
        });
      }
    }
  });
});
