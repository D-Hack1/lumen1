// Owner: Nived
// Exact disk-span extrema (R3, G-10 final) in core/visibility.ts, the TS twin of Horizon.extrema in pipeline/lumen_pipeline/reference/visibility.py.
// Oracles that are NOT this code: (a) Gowri's own hand-worked tests (test_visibility_extrema.py), ported case for case; (b) fixtures/extrema_parity.json,
// 272 seeded cases from her REAL Python (python3 web/src/mocks/make_extrema_parity.py): masks of 4-3600 bins with ridges, NaN bins, wrap-around spans,
// full circles, near-zone planes, the smooth Moon, and the disk fraction that depends on the extrema.
import { describe, expect, it } from 'vitest';
import { diskFraction, Horizon } from '../core/visibility';
import fixture from './fixtures/extrema_parity.json';

const dec = (x: number | string): number => (x === 'nan' ? NaN : x === 'inf' ? Infinity : x === '-inf' ? -Infinity : (x as number));
const same = (got: number, want: number, tol = 1e-9) => (Number.isNaN(want) ? expect(Number.isNaN(got)).toBe(true) : Number.isFinite(want) ? expect(Math.abs(got - want)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(want))) : expect(got).toBe(want));

describe('Gowri hand-worked cases (test_visibility_extrema.py)', () => {
  it('a one-bin spike away from the disk centre is included', () => {
    const v = new Float64Array(36);
    v[6] = 9;
    expect(new Horizon({ elevationsDeg: v, binWidthDeg: 10 }).extrema(50, 15)).toEqual([0, 9]);
  });
  it('handles wrap-around and exact bin boundaries', () => {
    const v = Float64Array.from([7, ...new Array(34).fill(0), -2]);
    expect(new Horizon({ elevationsDeg: v, binWidthDeg: 10 }).extrema(0, 5)).toEqual([-2, 7]);
    const b = new Horizon({ elevationsDeg: [1, 2, 3, 4], binWidthDeg: 90 });
    expect(b.extrema(90, 0)).toEqual([2, 2]);
    expect(b.extrema(90, 90)).toEqual([1, 3]);
  });
  it('supports the full circle and ignores NaN bins', () => {
    const h = new Horizon({ elevationsDeg: [1, NaN, -3, 4], binWidthDeg: 90 });
    expect(h.extrema(0, 180)).toEqual([-3, 4]);
    expect(h.extrema(0, 360)).toEqual([-3, 4]);
  });
  it('preserves the near-zone plane and a negative downhill terrain', () => {
    const terrain = new Float64Array(4).fill(-1);
    const h = new Horizon({ elevationsDeg: terrain, binWidthDeg: 90, slopeDeg: 10, uphillAzimuthDeg: 0, dMinM: 15, observerHeightM: 1 });
    const [min, max] = h.extrema(0, 135);
    expect(min).toBeCloseTo(-1, 12);
    expect(max).toBeCloseTo(h.effectiveAt(0), 12);
    for (let a = 0; a <= 135; a++) expect(max).toBeGreaterThanOrEqual(h.effectiveAt(a) - 1e-12);
    expect(new Horizon({ elevationsDeg: terrain, binWidthDeg: 90 }).extrema(180, 0)).toEqual([-1, -1]);
  });
});

describe('edge cases the random fixture alone could not separate', () => {
  it('an infinite bin is not "finite": it is ignored like NaN', () => {
    const h = new Horizon({ elevationsDeg: [1, Infinity, -3, -Infinity], binWidthDeg: 90 });
    expect(h.extrema(0, 360)).toEqual([-3, 1]);
  });
  it('a flat plane whose near-zone angle is NEGATIVE never lifts a lower terrain: the extrema stay the terrain (Python: -inf when not above 0)', () => {
    const h = new Horizon({ elevationsDeg: new Float64Array(4).fill(-5), binWidthDeg: 90, slopeDeg: 0, uphillAzimuthDeg: 0, dMinM: 15, observerHeightM: 1 });
    expect(h.extrema(0, 45)).toEqual([-5, -5]); // atan(-1/15) = -3.8 deg is higher than -5, but a below-zero plane is ignored
    expect(h.extrema(200, 10)).toEqual([-5, -5]);
  });
});

describe('input validation (as the Python raises ValueError)', () => {
  const h = new Horizon({ elevationsDeg: new Float64Array(36), binWidthDeg: 10 });
  it('rejects a non-finite centre, a negative or non-finite half-width, and bins that do not cover 360 degrees', () => {
    expect(() => h.extrema(NaN, 1)).toThrow(RangeError);
    expect(() => h.extrema(0, -1)).toThrow(RangeError);
    expect(() => h.extrema(0, Infinity)).toThrow(RangeError);
    expect(() => new Horizon({ elevationsDeg: new Float64Array(35), binWidthDeg: 10 }).extrema(0, 1)).toThrow(RangeError);
  });
});

type C = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const horizonOf = (c: C) =>
  new Horizon({
    elevationsDeg: c.mask ? Float64Array.from((c.mask as Array<number | string>).map(dec)) : null,
    binWidthDeg: c.binWidthDeg,
    slopeDeg: c.nz?.slope_deg ?? null,
    uphillAzimuthDeg: c.nz?.uphill_azimuth_deg ?? null,
    dMinM: c.nz?.d_min_m ?? null,
    observerHeightM: c.nz?.observer_height_m ?? 0,
  });
const byKind = (k: string) => (fixture.cases as C[]).filter((c) => c.kind === k);

describe(`parity with ${fixture.source} (${fixture.cases.length} cases)`, () => {
  it('has the case mix the tests rely on', () => {
    expect(['extrema', 'smooth', 'disk'].map((k) => byKind(k).length)).toEqual([140, 12, 120]);
    const e = byKind('extrema');
    expect(e.some((c) => c.expected.includes('nan'))).toBe(true); // all-NaN spans
    expect(e.some((c) => c.half >= 180)).toBe(true); // full circle
    expect(e.some((c) => c.centre < 0 || c.centre > 360)).toBe(true); // out-of-range centres wrap
    expect(e.some((c) => c.nz.slope_deg !== undefined)).toBe(true);
    expect(byKind('disk').some((c) => c.expected > 0 && c.expected < 1)).toBe(true); // partial disks
  });

  it.each(byKind('extrema').map((c, i) => [i, c] as const))('masked extrema, case %i', (_i, c) => {
    const [lo, hi] = horizonOf(c).extrema(c.centre, c.half);
    same(lo, dec(c.expected[0]));
    same(hi, dec(c.expected[1]));
  });

  it.each(byKind('smooth').map((c, i) => [i, c] as const))('smooth-Moon extrema, case %i', (_i, c) => {
    const [lo, hi] = horizonOf(c).extrema(c.centre, c.half);
    same(lo, dec(c.expected[0]));
    same(hi, dec(c.expected[1]));
  });

  it.each(byKind('disk').map((c, i) => [i, c] as const))('disk fraction, case %i', (_i, c) => {
    same(diskFraction(c.body, c.elevation, c.azimuth, c.distanceKm, horizonOf(c)), c.expected, 1e-9);
  });
});
