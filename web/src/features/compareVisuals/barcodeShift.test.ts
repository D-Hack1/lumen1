import { describe, expect, it } from 'vitest';
import type { Series } from '../../engine/types';
import { shiftedColumns, UNKNOWN } from './barcodeShift';

const DAY = 86_400_000;
// 10 samples, one per day: Sun up on days 0–4, Earth up on days 3–7.
const series = {
  t0: 0,
  stepMs: DAY,
  sunUp: Uint8Array.from([1, 1, 1, 1, 1, 0, 0, 0, 0, 0]),
  earthUp: Uint8Array.from([0, 0, 0, 1, 1, 1, 1, 1, 0, 0]),
} as unknown as Series;

describe('shiftedColumns', () => {
  it('no shift reproduces the series (one column per sample)', () => {
    expect(Array.from(shiftedColumns(series, 0, 10))).toEqual([1, 1, 1, 3, 3, 2, 2, 2, 0, 0]);
  });
  it('slipping later by 2 days moves the bars left and leaves the last 2 days unknown', () => {
    const c = Array.from(shiftedColumns(series, 2, 10));
    expect(c.slice(0, 8)).toEqual([1, 3, 3, 2, 2, 2, 0, 0]);
    expect(c.slice(8)).toEqual([UNKNOWN, UNKNOWN]);
  });
  it('slipping earlier leaves the first days unknown', () => {
    const c = Array.from(shiftedColumns(series, -3, 10));
    expect(c.slice(0, 3)).toEqual([UNKNOWN, UNKNOWN, UNKNOWN]);
    expect(c[3]).toBe(1);
  });
  it('a shift larger than the window is all unknown', () => {
    expect(Array.from(shiftedColumns(series, 30, 10)).every((v) => v === UNKNOWN)).toBe(true);
  });
});
