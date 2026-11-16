// Owner: Nived
// Seam 1 (N-6): the pure uncertainty functions, ported from pipeline/lumen_pipeline/reference/uncertainty.py (R3 delta D-8).
// Oracles that are NOT this code:
//   (a) Gowri's own hand-worked tests (test_uncertainty.py), ported case for case;
//   (b) fixtures/uncertainty_parity.json: 66 seeded cases produced by running her REAL Python (regenerate with
//       python3 web/src/mocks/make_uncertainty_parity.py). Times there are seconds; the TS API takes epoch ms, so t_ms = t_s * 1000.
import { describe, expect, it } from 'vitest';
import {
  annotateEvent, exactEventUncertainty, exactEventUncertaintyFromMasks, fastEventUncertainty, fastUncertaintyForEvent, GRAZING_DT_SECONDS,
  limbOffsetDeg, numericBounds, shiftHorizonMask, threePassBounds, totalClearanceRateDegPerHour, type GeometryAt,
} from '../core/uncertainty';
import { detectEvents } from '../core/events';
import { Horizon } from '../core/visibility';
import type { EventRecord } from '../types';
import fixture from './fixtures/uncertainty_parity.json';

const ev = (t: number, extra: Partial<EventRecord> = {}): EventRecord => ({ type: 'sunset', t, dtMs: null, grazing: false, grazingReason: null, dtMethod: 'fast', ...extra });
const S = 1000; // seconds -> ms
const ramp = (e0: number, e1: number, a0: number, a1: number): GeometryAt => (tMs) => ({ elevationDeg: e0 + e1 * (tMs / S), azimuthDeg: a0 + a1 * (tMs / S) });

describe('Gowri hand-worked cases (test_uncertainty.py)', () => {
  it('total clearance rate includes the mask-azimuth motion: 3.6 - 0.36 = 3.24 deg/h', () => {
    const h = new Horizon({ elevationsDeg: Float64Array.from({ length: 3600 }, (_, i) => i), binWidthDeg: 1 });
    expect(totalClearanceRateDegPerHour(100 * S, ramp(5, 0.001, 10, 0.0001), h)).toBeCloseTo(3.24, 9);
  });
  it('uses the post-event stencil when a bin boundary lies before the event: -320.4 deg/h', () => {
    const v = new Float64Array(3600);
    v.set([0, 1, 100]);
    const h = new Horizon({ elevationsDeg: v, binWidthDeg: 1 });
    expect(totalClearanceRateDegPerHour(10 * S, ramp(0, 0.01, 1.59, 0.001), h, { bracketingInterval: [9 * S, 10 * S] })).toBeCloseTo(-320.4, 9);
  });
  it('uses the pre-event stencil when a bin boundary lies after the event: 32.4 deg/h', () => {
    const v = new Float64Array(3600);
    v.set([0, 1, 100]);
    const h = new Horizon({ elevationsDeg: v, binWidthDeg: 1 });
    expect(totalClearanceRateDegPerHour(10 * S, ramp(0, 0.01, 1.39, 0.001), h, { bracketingInterval: [9 * S, 10 * S] })).toBeCloseTo(32.4, 9);
  });
  it('fast uncertainty applies the limb offset and flags grazing', () => {
    const h = new Horizon({ elevationsDeg: new Float64Array(3600) });
    const geom: GeometryAt = (t) => ({ elevationDeg: (t / S / 3600) * 0.1, azimuthDeg: 0 });
    const r = fastEventUncertainty(0, geom, h, () => 0.2, { diskFraction: 0, angularRadiusDeg: 0.25 });
    expect(r.clearanceRateDegPerHour).toBeCloseTo(0.1, 12);
    expect(r.deltaTSeconds).toBeCloseTo(7200, 6);
    expect(r.grazingReason).toBeNull();
    expect(limbOffsetDeg(0.5, 0.25)).toBe(0);
    expect(limbOffsetDeg(1, 0.25)).toBe(-0.25);
    const g = fastEventUncertainty(0, () => ({ elevationDeg: 0, azimuthDeg: 0 }), h, () => 0.2);
    expect(g.deltaTSeconds).toBe(Infinity);
    expect(g.grazingReason).toBe('rate');
    const fromEvent = fastUncertaintyForEvent(ev(0, { bracketStartMs: -S, bracketEndMs: S }), geom, h, () => 0.2);
    expect(fromEvent.deltaTSeconds).toBeCloseTo(7200, 6);
  });
  it('three-pass shifting moves only the terrain mask, never the near-zone plane; bounds are (0.9, 1.0, 1.1)', () => {
    const h = new Horizon({ elevationsDeg: [1, 2], binWidthDeg: 180, slopeDeg: 5, uphillAzimuthDeg: 0, dMinM: 15, observerHeightM: 1 });
    const shifted = shiftHorizonMask(h, [0.1, 0.3], 1);
    expect(Array.from(shifted.elevationsDeg!)).toEqual([1.1, 2.3].map((x) => expect.closeTo(x, 12)));
    expect(shifted.slopeDeg).toBe(5);
    expect(shifted.dMinM).toBe(15);
    const b = numericBounds(threePassBounds(h, [0.1, 0.3], (cur) => cur.elevationAt(90)));
    b.forEach((x, i) => expect(x).toBeCloseTo([0.9, 1.0, 1.1][i], 12));
    expect(() => shiftHorizonMask(new Horizon(), 0.2, 1)).toThrow(/Tier-C/);
  });
  it('exact timing is half the spread of the three event times; vanishing and dt_limit are flagged; annotate copies the fields', () => {
    const nominal = ev(1000 * S);
    const exact = exactEventUncertainty(nominal, ev(800 * S), ev(1300 * S));
    expect(exact.deltaTSeconds).toBe(250);
    expect(exact.dtMethod).toBe('exact');
    const annotated = annotateEvent(nominal, exact);
    expect(annotated.dtMs).toBe(250 * S);
    expect(annotated.dtMethod).toBe('exact');
    const vanished = exactEventUncertainty(nominal, null, ev(1300 * S));
    expect(vanished.grazingReason).toBe('vanishes');
    expect(vanished.deltaTSeconds).toBeNull();
    const wide = exactEventUncertainty(nominal, ev(0), ev((2 * GRAZING_DT_SECONDS + 1000) * S));
    expect(wide.grazingReason).toBe('dt_limit');
  });
  it('annotateEvent keeps the bracket and turns a non-finite delta t into "no +/-" (null), never Infinity', () => {
    const e = ev(5 * S, { bracketStartMs: 4 * S, bracketEndMs: 6 * S });
    const a = annotateEvent(e, { deltaTSeconds: Infinity, clearanceRateDegPerHour: 0, dtMethod: 'fast', grazingReason: 'rate' });
    expect(a.dtMs).toBeNull();
    expect(a.grazing).toBe(true);
    expect(a.grazingReason).toBe('rate');
    expect([a.bracketStartMs, a.bracketEndMs]).toEqual([4 * S, 6 * S]);
  });
  it('the exact path re-solves both shifted masks: +-0.2 deg sigma moves a 100 s event by +-20 s => 20 s', () => {
    const h = new Horizon({ elevationsDeg: new Float64Array(3600) });
    const resolve = (cur: Horizon) => ev(100 * S + cur.elevationAt(0.05) * 100 * S);
    const exact = exactEventUncertaintyFromMasks(ev(100 * S), h, 0.2, resolve);
    expect(exact.deltaTSeconds).toBeCloseTo(20, 9);
    expect(exact.dtMethod).toBe('exact');
  });
});

// ---------------- cross-language fixture: Gowri's real Python on 66 seeded cases ----------------
interface Geom { e0: number; e1: number; e2: number; w: number; p: number; a0: number; a1: number }
type HSpec = { mask: string; slopeDeg?: number | null; uphillAzDeg?: number | null; dMinM?: number | null; observerHeightM?: number };
const masks = fixture.masks as Record<string, number[]>;
const horizonOf = (h: HSpec) => new Horizon({ elevationsDeg: masks[h.mask], binWidthDeg: fixture.binWidthDeg, slopeDeg: h.slopeDeg ?? null, uphillAzimuthDeg: h.uphillAzDeg ?? null, dMinM: h.dMinM ?? null, observerHeightM: h.observerHeightM ?? 0 });
const geomOf = (g: Geom): GeometryAt => (tMs) => {
  const t = tMs / S;
  return { elevationDeg: g.e0 + g.e1 * t + g.e2 * Math.sin(g.w * t + g.p), azimuthDeg: g.a0 + g.a1 * t };
};
const num = (x: number | string) => (x === 'inf' ? Infinity : x === '-inf' ? -Infinity : (x as number));
// Both sides are IEEE doubles doing the same arithmetic; allow a few ulps of difference in sin/atan/tan implementations.
const close = (got: number, want: number, rel = 1e-9) => (Number.isFinite(want) ? expect(Math.abs(got - want)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(want))) : expect(got).toBe(want));

describe(`parity with ${fixture.source} (${fixture.cases.length} cases)`, () => {
  const byKind = (k: string) => fixture.cases.filter((c) => c.kind === k) as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

  it('has the case mix the tests rely on (guards against a thin fixture)', () => {
    const kinds = Object.fromEntries(['rate', 'limb', 'fast', 'shift', 'exact', 'exactVanish', 'detect'].map((k) => [k, byKind(k).length]));
    expect(kinds).toEqual({ rate: 24, limb: 6, fast: 25, shift: 8, exact: 7, exactVanish: 3, detect: 6 });
    const f = byKind('fast');
    for (const r of [null, 'rate', 'dt_limit']) expect(f.some((c) => c.expected.grazingReason === r), `grazing ${r}`).toBe(true);
  });

  it('the 12 h dt_limit boundary is pinned from both sides on BOTH paths (so a wrong threshold cannot pass)', () => {
    const fastNear = byKind('fast').filter((c) => c.boundaryHours !== undefined);
    expect(fastNear.map((c) => [c.boundaryHours, c.expected.grazingReason])).toEqual([[11, null], [11.9, null], [12.1, 'dt_limit'], [13, 'dt_limit'], [20, 'dt_limit']]);
    const exactNear = byKind('exact').filter((c) => c.times[0] === 0 && c.times[1] > 40000);
    expect(exactNear.map((c) => c.expected.grazingReason)).toEqual([null, 'dt_limit']);
  });

  it.each(byKind('rate').map((c, i) => [i, c] as const))('total clearance rate, case %i (central and one-sided stencils, with/without bracket)', (_i, c) => {
    const bracket = c.bracket ? ([c.bracket[0] * S, c.bracket[1] * S] as [number, number]) : null;
    close(totalClearanceRateDegPerHour(c.eventSeconds * S, geomOf(c.geom), horizonOf(c.horizon), { limbOffsetDeg: c.limbOffsetDeg, bracketingInterval: bracket }), c.expected);
  });

  it.each(byKind('limb').map((c, i) => [i, c] as const))('limb offset, case %i', (_i, c) => {
    expect(limbOffsetDeg(c.diskFraction, c.angularRadiusDeg)).toBe(c.expected);
  });

  it.each(byKind('fast').map((c, i) => [i, c] as const))('fast event uncertainty, case %i (delta t, rate, grazing reason)', (_i, c) => {
    const bracket = c.bracket ? ([c.bracket[0] * S, c.bracket[1] * S] as [number, number]) : null;
    const sigma = (az: number) => c.sigma.s0 + c.sigma.s1 * Math.abs(Math.sin((az * Math.PI) / 180));
    const u = fastEventUncertainty(c.eventSeconds * S, geomOf(c.geom), horizonOf(c.horizon), sigma, { diskFraction: c.diskFraction, angularRadiusDeg: c.angularRadiusDeg, bracketingInterval: bracket });
    close(u.deltaTSeconds as number, num(c.expected.deltaTSeconds));
    close(u.clearanceRateDegPerHour as number, c.expected.rateDegPerHour);
    expect(u.dtMethod).toBe(c.expected.dtMethod);
    expect(u.grazingReason).toBe(c.expected.grazingReason);
  });

  it.each(byKind('shift').map((c, i) => [i, c] as const))('shifted masks, near-zone plane untouched, three-pass bounds, case %i', (_i, c) => {
    const h = horizonOf(c.horizon);
    const up = shiftHorizonMask(h, c.sigma, 1);
    const dn = shiftHorizonMask(h, c.sigma, -1);
    c.probeAzimuths.forEach((az: number, k: number) => {
      close(up.elevationAt(az), c.expected.up[k]);
      close(dn.elevationAt(az), c.expected.down[k]);
      close(up.effectiveAt(az), c.expected.upEffective[k]);
    });
    expect(up.slopeDeg).toBe(c.expected.slope);
    const b = numericBounds(threePassBounds(h, c.sigma, (cur) => cur.effectiveAt(90)));
    b.forEach((x, k) => close(x, c.expected.bounds[k]));
  });

  it.each(byKind('exact').map((c, i) => [i, c] as const))('exact event uncertainty, case %i', (_i, c) => {
    const [lo, nom, hi] = c.times as number[];
    const u = exactEventUncertainty(ev(nom * S), ev(lo * S), ev(hi * S));
    close(u.deltaTSeconds as number, num(c.expected.deltaTSeconds));
    expect(u.dtMethod).toBe(c.expected.dtMethod);
    expect(u.grazingReason).toBe(c.expected.grazingReason);
  });

  it.each(byKind('exactVanish').map((c, i) => [i, c] as const))('exact event uncertainty when a shifted event vanishes, case %i', (_i, c) => {
    const n = ev(1000 * S);
    const u = exactEventUncertainty(n, c.which === 'upper' ? ev(900 * S) : null, c.which === 'lower' ? ev(1100 * S) : null);
    expect(u.deltaTSeconds).toBe(c.expected.deltaTSeconds);
    expect(u.dtMethod).toBe('exact');
    expect(u.grazingReason).toBe(c.expected.grazingReason);
  });

  // Seam 2: the detector must retain the final bisection bracket (her Event.bracket_start_et / bracket_end_et), because the
  // one-sided clearance rate chooses its side from it.
  it.each(byKind('detect').map((c, i) => [i, c] as const))('event detection reproduces her event time AND her refinement bracket, case %i', (_i, c) => {
    const [a, b] = c.rangeSeconds as [number, number];
    const pred = c.falling ? (tMs: number) => tMs / S < c.thresholdSeconds : (tMs: number) => tMs / S >= c.thresholdSeconds;
    const got = detectEvents(a * S, b * S, pred, { down: 'sunset', up: 'shadowExit' });
    expect(got.length).toBe(c.expected.length);
    got.forEach((e, k) => {
      const want = c.expected[k];
      expect(e.type).toBe(want.type);
      expect(Math.abs(e.t / S - want.et)).toBeLessThan(1e-6);
      expect(Math.abs(e.bracketStartMs! / S - want.bracketStart)).toBeLessThan(1e-6);
      expect(Math.abs(e.bracketEndMs! / S - want.bracketEnd)).toBeLessThan(1e-6);
    });
  });

  it('the bracket always contains the event and is no wider than the 10 s bisection tolerance', () => {
    for (const c of byKind('detect')) {
      const [a, b] = c.rangeSeconds as [number, number];
      const pred = c.falling ? (tMs: number) => tMs / S < c.thresholdSeconds : (tMs: number) => tMs / S >= c.thresholdSeconds;
      for (const e of detectEvents(a * S, b * S, pred, { down: 'sunset', up: 'shadowExit' })) {
        expect(e.bracketStartMs!).toBeLessThanOrEqual(e.t);
        expect(e.bracketEndMs!).toBeGreaterThanOrEqual(e.t);
        expect(e.bracketEndMs! - e.bracketStartMs!).toBeLessThanOrEqual(10 * S);
      }
    }
  });
});

