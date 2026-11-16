// Owner: Nived
// Seam: the pure parts of the stage-2 FLIP reorder (FRONTEND_BUILD_GUIDE: 150 ms, ON only when stage-2 rows arrive, OFF during stage 1,
// and never when the user prefers reduced motion).
import { describe, expect, it } from 'vitest';
import { FLIP_MS, flipDeltas, shouldAnimate } from './flip';

describe('flipDeltas (First-Last-Invert: how far each surviving row must be pushed back to look like it has not moved)', () => {
  it('a row that moved down by 40 px starts 40 px up (-40), one that moved up by 20 starts 20 px down (+20)', () => {
    expect(flipDeltas({ a: 0, b: 30, c: 60 }, { a: 40, b: 0, c: 60 })).toEqual({ a: -40, b: 30 });
  });
  it('ignores rows that did not move (and sub-pixel jitter), rows that are new, and rows that left', () => {
    expect(flipDeltas({ a: 0, b: 30 }, { a: 0.4, b: 30, z: 99 })).toEqual({});
    expect(flipDeltas({ a: 0, gone: 30 }, { a: 10 })).toEqual({ a: -10 });
  });
});

describe('shouldAnimate', () => {
  const k = (...x: string[]) => x;
  it('animates only when stage 2 is showing and the order of surviving rows changed', () => {
    expect(shouldAnimate(1, k('a', 'b', 'c'), k('b', 'a', 'c'))).toBe(false); // stage 1: OFF
    expect(shouldAnimate(2, k('a', 'b', 'c'), k('b', 'a', 'c'))).toBe(true);
    expect(shouldAnimate(2, k('a', 'b', 'c'), k('a', 'b', 'c'))).toBe(false); // nothing reordered
    expect(shouldAnimate(0, [], k('a'))).toBe(false);
  });
  it('rows only arriving or leaving, with the rest in the same relative order, is not a reorder', () => {
    expect(shouldAnimate(2, k('a', 'b'), k('a', 'x', 'b'))).toBe(false);
    expect(shouldAnimate(2, k('a', 'b', 'c'), k('a', 'c'))).toBe(false);
  });
  it('is 150 ms', () => {
    expect(FLIP_MS).toBe(150);
  });
});
