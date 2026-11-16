import { describe, expect, it } from 'vitest';
import { fractionAtTime, timeAtFraction } from './chartPointer';

const series = { t0: 1000, stepMs: 60_000, sunUp: new Uint8Array(11) }; // 11 samples → bars span 11 steps, line span 10 steps

describe('timeAtFraction / fractionAtTime', () => {
  it('bars: the full width is n steps; lines: n−1 steps', () => {
    expect(timeAtFraction(series, 1, 'bars')).toBe(1000 + 11 * 60_000);
    expect(timeAtFraction(series, 1, 'line')).toBe(1000 + 10 * 60_000);
    expect(timeAtFraction(series, 0)).toBe(1000);
  });
  it('clamps outside 0…1', () => {
    expect(timeAtFraction(series, -3)).toBe(1000);
    expect(timeAtFraction(series, 7, 'line')).toBe(1000 + 10 * 60_000);
  });
  it('is the exact inverse', () => {
    for (const mode of ['bars', 'line'] as const) for (const f of [0, 0.25, 0.5, 0.99]) expect(fractionAtTime(series, timeAtFraction(series, f, mode), mode)).toBeCloseTo(f, 9);
  });
  it('a time outside the series maps outside 0…1 (so the overlay skips it)', () => {
    expect(fractionAtTime(series, 1000 - 60_000, 'line')).toBeLessThan(0);
    expect(fractionAtTime(series, 1000 + 99 * 60_000, 'line')).toBeGreaterThan(1);
  });
});
