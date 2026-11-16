// Owner: Nived
// Event-driven windows and scenario three-pass bounds (R3, G-10 final): core/windows.ts (`windowsFromEvents`, window metrics) and core/windowBounds.ts
// (`evaluateScenarioBounds`), the TS twin of reference/windows.py, reference/metrics.py and reference/bounds.py.
// Oracles that are NOT this code: (a) Gowri's own hand-worked tests (test_bounds.py), ported case for case; (b) fixtures/window_bounds_parity.json: 14 seeded
// scenario cases and 30 window cases produced by her REAL Python (python3 web/src/mocks/make_window_bounds_parity.py). Times there are seconds; TS takes ms.
import { describe, expect, it } from 'vitest';
import { evaluateScenarioBounds, pairNearest, type TransitionEvent, type WindowSpec } from '../core/windowBounds';
import { longestWindowGapHours, windowDurationMs, windowPercentage, windowsFromEvents } from '../core/windows';
import { Horizon } from '../core/visibility';
import type { Bounded, WindowType } from '../types';
import fixture from './fixtures/window_bounds_parity.json';

const S = 1000;
type C = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const near = (got: number | null, want: number | null, tol = 1e-6) => (want === null ? expect(got).toBeNull() : expect(Math.abs((got as number) - want)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(want))));
/** A Bounded in ms against the fixture's seconds. */
const nearBoundedMs = (got: Bounded, want: C) => {
  near(got.value === null ? null : got.value / S, want.value);
  near(got.lo === null ? null : got.lo / S, want.lo);
  near(got.hi === null ? null : got.hi / S, want.hi);
};
const nearBounded = (got: Bounded, want: C, tol = 1e-6) => {
  near(got.value, want.value, tol);
  near(got.lo, want.lo, tol);
  near(got.hi, want.hi, tol);
};

describe('Gowri hand-worked cases (test_bounds.py)', () => {
  const zeros = () => new Horizon({ elevationsDeg: new Float64Array(3600) });
  const triangle = (type: WindowType, centre = 360, peak = 1): WindowSpec => ({
    type, downEvent: `${type}_down`, upEvent: `${type}_up`,
    visibleAt: (t, h) => peak - Math.abs(t / S - centre) / 120 >= h.effectiveAt(0), peakElevationDeg: () => peak,
  });
  const gt = (a: number | null, b: number | null) => expect((a as number) < (b as number)).toBe(true);

  it('three passes use independent refined windows and metrics', () => {
    const r = evaluateScenarioBounds(0, 720 * S, zeros(), 0.5, [triangle('sun'), triangle('earth'), triangle('link'), triangle('ops')], { pairEvent: pairNearest() });
    expect(Math.abs(r.metrics.sunlitPct.value! - 100 / 3)).toBeLessThanOrEqual(3);
    for (const k of ['sunlitPct', 'linkPct', 'longestNightH', 'opsHours'] as const) {
      gt(r.metrics[k].lo, r.metrics[k].value);
      gt(r.metrics[k].value, r.metrics[k].hi);
    }
    expect(Math.abs(r.sunlitDurationHours.value! - 1 / 15)).toBeLessThanOrEqual(0.01);
    const w = r.windows.sun[0];
    gt(w.start.lo, w.start.value); gt(w.start.value, w.start.hi);
    gt(w.end.lo, w.end.value); gt(w.end.value, w.end.hi);
    gt(w.durationH.lo, w.durationH.value); gt(w.durationH.value, w.durationH.hi);
    expect(new Set(r.events.sun.map((e) => e.dtMethod))).toEqual(new Set(['exact']));
    for (const e of r.events.sun) expect(Math.abs(e.dtMs! / S - 60)).toBeLessThanOrEqual(5);
  });

  it('zero sigma collapses the bounds, and partial endpoints are fixed', () => {
    const spec: WindowSpec = { type: 'sun', downEvent: 'sun_down', upEvent: 'sun_up', visibleAt: (_t, h) => 1 >= h.effectiveAt(0), peakElevationDeg: () => 1 };
    const r = evaluateScenarioBounds(0, 720 * S, zeros(), 0, [spec], { pairEvent: pairNearest() });
    for (const v of [r.metrics.sunlitPct, r.metrics.longestNightH, r.sunlitDurationHours]) {
      expect(v.lo).toBe(v.value);
      expect(v.hi).toBe(v.value);
    }
    const w = r.windows.sun[0];
    expect(w.nominal.partialStart && w.nominal.partialEnd).toBe(true);
    expect([w.start.lo, w.start.value, w.start.hi]).toEqual([0, 0, 0]);
    expect([w.end.lo, w.end.value, w.end.hi]).toEqual([720 * S, 720 * S, 720 * S]);
  });

  it('a vanished shifted event keeps the nominal window but omits its range', () => {
    const spec: WindowSpec = { type: 'sun', downEvent: 'sun_down', upEvent: 'sun_up', visibleAt: (t, h) => 0.25 - Math.abs(t / S - 360) / 120 >= h.effectiveAt(0), peakElevationDeg: () => 0.25 };
    const r = evaluateScenarioBounds(0, 720 * S, zeros(), 0.5, [spec], { pairEvent: pairNearest() });
    expect(r.events.sun.length).toBeGreaterThan(0);
    expect(new Set(r.events.sun.map((e) => e.grazingReason))).toEqual(new Set(['vanishes']));
    const w = r.windows.sun[0];
    expect(w.start.lo).toBeNull();
    expect(w.end.hi).toBeNull();
    expect(w.durationH.lo).toBeNull();
    expect(w.durationH.hi).toBeNull();
  });

  it('rejects an empty spec list, duplicate or unknown types, and a non-positive range', () => {
    const ok = triangle('sun');
    const pair = { pairEvent: pairNearest() };
    expect(() => evaluateScenarioBounds(0, 720 * S, zeros(), 0.5, [], pair)).toThrow(RangeError);
    expect(() => evaluateScenarioBounds(0, 720 * S, zeros(), 0.5, [ok, ok], pair)).toThrow(RangeError);
    expect(() => evaluateScenarioBounds(0, 720 * S, zeros(), 0.5, [{ ...ok, type: 'moon' as WindowType }], pair)).toThrow(RangeError);
    expect(() => evaluateScenarioBounds(720 * S, 720 * S, zeros(), 0.5, [ok], pair)).toThrow(RangeError);
  });
});

describe('pairNearest', () => {
  const e = (type: string, t: number): TransitionEvent => ({ type, t, bracketStartMs: t, bracketEndMs: t, dtMs: null, dtMethod: 'fast', grazing: false, grazingReason: null });
  it('picks the nearest event of the same type, null when none or when beyond the window', () => {
    const c = [e('a_down', 100), e('a_up', 130), e('a_down', 400)];
    expect(pairNearest()(e('a_down', 120), c)?.t).toBe(100);
    expect(pairNearest()(e('a_up', 120), c)?.t).toBe(130);
    expect(pairNearest()(e('b_down', 120), c)).toBeNull();
    expect(pairNearest(10)(e('a_down', 200), c)).toBeNull(); // nearest is 100 ms away, window 10 ms
    expect(pairNearest(500)(e('a_down', 200), c)?.t).toBe(100);
  });
});

const byKind = (k: string) => (fixture.cases as C[]).filter((c) => c.kind === k);
const evOf = (x: C) => ({ type: x.type as string, t: x.et * S });

describe(`parity with ${fixture.source}`, () => {
  it('has the case mix the tests rely on', () => {
    const b = byKind('bounds');
    const evs = b.flatMap((c) => Object.values(c.expected.events as Record<string, C[]>).flat());
    expect(b.length).toBe(14);
    expect(byKind('windows').length).toBe(30);
    expect(evs.some((e) => e.grazingReason === 'vanishes')).toBe(true);
    expect(b.some((c) => Object.values(c.expected.windows as Record<string, C[]>).flat().some((w) => w.partialStart || w.partialEnd))).toBe(true);
    expect(b.some((c) => Object.values(c.expected.windows as Record<string, C[]>).flat().some((w) => w.start.lo === null))).toBe(true);
    expect(b.some((c) => Array.isArray(c.sigma))).toBe(true);
    expect(b.some((c) => c.pairWindowSeconds !== null)).toBe(true);
  });

  it.each(byKind('windows').map((c, i) => [i, c] as const))('windowsFromEvents and the window metrics, case %i', (_i, c) => {
    const wins = windowsFromEvents('sun', c.start * S, c.end * S, c.initiallyVisible, c.events.map(evOf), { downEvent: 'x_down', upEvent: 'x_up', peakElevationDeg: (a, b) => Math.round((0.5 * (a / S + b / S)) / 3600 * 1e6) / 1e6 });
    expect(wins.length).toBe(c.expected.windows.length);
    wins.forEach((w, k) => {
      const want = c.expected.windows[k];
      near(w.startMs / S, want.start);
      near(w.endMs / S, want.end);
      near(w.peakElevationDeg, want.peak, 1e-9);
      expect([w.partialStart, w.partialEnd]).toEqual([want.partialStart, want.partialEnd]);
    });
    near(windowDurationMs(wins) / S, c.expected.durationSeconds);
    near(windowPercentage(c.start * S, c.end * S, wins), c.expected.percentage, 1e-9);
    near(longestWindowGapHours(c.start * S, c.end * S, wins), c.expected.longestGapHours, 1e-9);
  });

  it('rejects the same invalid window inputs she rejects', () => {
    for (const e of fixture.errors as C[]) {
      const run = () =>
        e.fn === 'percentage'
          ? windowPercentage(e.start * S, e.end * S, [])
          : windowsFromEvents('sun', e.start * S, e.end * S, e.initiallyVisible, e.events.map(evOf), { downEvent: 'x_down', upEvent: 'x_up', peakElevationDeg: () => 1 });
      expect(run, JSON.stringify(e)).toThrow(RangeError);
    }
  });

  it.each(byKind('bounds').map((c, i) => [i, c] as const))('scenario three-pass bounds, case %i (metrics, events, window endpoint ranges)', (_i, c) => {
    const horizon = new Horizon({ elevationsDeg: Float64Array.from(c.mask as number[]), binWidthDeg: c.binWidthDeg });
    const el = (p: C, et: number) => p.e0 + p.e1 * et + p.A * Math.sin(p.w * et + p.p);
    const specs: WindowSpec[] = (c.specs as C[]).map((s) => ({
      type: s.type as WindowType, downEvent: `${s.type}_down`, upEvent: `${s.type}_up`,
      visibleAt: (tMs, h) => el(s.p, tMs / S) >= h.effectiveAt(s.az.a0 + s.az.a1 * (tMs / S)),
      peakElevationDeg: (a, b) => {
        let best = -Infinity;
        for (let t = a / S; t < b / S; t += 60) best = Math.max(best, el(s.p, t));
        return Math.max(best, el(s.p, b / S));
      },
    }));
    const sigma = Array.isArray(c.sigma) ? Float64Array.from(c.sigma as number[]) : (c.sigma as number);
    const r = evaluateScenarioBounds(0, c.span * S, horizon, sigma, specs, { pairEvent: pairNearest(c.pairWindowSeconds === null ? null : c.pairWindowSeconds * S) });
    const E = c.expected as C;
    for (const [k, want] of Object.entries(E.metrics as Record<string, C>)) nearBounded((r.metrics as Record<string, Bounded>)[k], want, 1e-6);
    nearBounded(r.sunlitDurationHours, E.sunlitDurationHours, 1e-6);
    for (const [type, evs] of Object.entries(E.events as Record<string, C[]>)) {
      expect(r.events[type].length).toBe(evs.length);
      r.events[type].forEach((got, k) => {
        const want = evs[k];
        expect(got.type).toBe(want.type);
        near(got.t / S, want.et);
        near(got.bracketStartMs / S, want.bracketStart);
        near(got.bracketEndMs / S, want.bracketEnd);
        near(got.dtMs === null ? null : got.dtMs / S, want.dtSeconds);
        expect(got.dtMethod).toBe(want.dtMethod);
        expect(got.grazingReason).toBe(want.grazingReason);
      });
    }
    for (const [type, ws] of Object.entries(E.windows as Record<string, C[]>)) {
      expect(r.windows[type].length).toBe(ws.length);
      r.windows[type].forEach((got, k) => {
        const want = ws[k];
        nearBoundedMs(got.start, want.start);
        nearBoundedMs(got.end, want.end);
        nearBounded(got.durationH, want.duration, 1e-6);
        expect([got.nominal.partialStart, got.nominal.partialEnd]).toEqual([want.partialStart, want.partialEnd]);
        near(got.nominal.peakElevationDeg, want.peak, 1e-9);
      });
    }
    for (const [pass, m] of Object.entries(E.passMetrics as Record<string, Record<string, number | null>>)) {
      const got = (r.passes as Record<string, { metrics: Record<string, number | null> }>)[pass].metrics;
      for (const [k, v] of Object.entries(m)) near(got[k], v, 1e-6);
    }
  });
});
