import { describe, expect, it } from 'vitest';
import { summariseDispersion, type Dispersion } from '../../engine/data/dispersion';
import { binSlopes } from './dispersionBins';

const grid = (vals: number[]): Dispersion => ({ siteId: 't', nodes: [11, 11], spacingM: 50, slopeDeg: Float32Array.from(vals) });

describe('histogram bins vs summariseDispersion (same grid)', () => {
  const d = grid(Array.from({ length: 121 }, (_, i) => (i % 40) * 0.25)); // 0 … 9.75°
  it('every node lands in exactly one bin', () => {
    expect(binSlopes(d.slopeDeg, 0.5).reduce((a, c) => a + c, 0)).toBe(121);
  });
  it('bars below the limit sum to the share summariseDispersion reports', () => {
    const tol = 5;
    const counts = binSlopes(d.slopeDeg, 0.5);
    const below = counts.slice(0, Math.round(tol / 0.5)).reduce((a, c) => a + c, 0);
    expect((100 * below) / 121).toBeCloseTo(summariseDispersion(d, tol).pctBelowTolerance, 6);
  });
});
