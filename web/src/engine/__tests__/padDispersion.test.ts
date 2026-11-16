// Owner: Nived
// Seam: the pad file's dispersion_slope_stats and the dispersion grid describe the SAME touchdown scatter, so the pad badge ("p95 11.2 deg > 10 deg")
// and the histogram ("100 % under 10 deg") must never disagree. Found on the mock data (reported by Ebin): the mock pad stats were hard-coded multiples of the
// slope while the grid was generated separately. Oracle: percentiles recomputed here from the raw grid bytes (numpy-style linear interpolation), not from any loader.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDispersion, summariseDispersion } from '../data/dispersion';
import { loadPad } from '../data/pad';
import { PUBLIC, stubFetch } from './helpers';

const SITES = ['im2_athena', 'cy3_shiv_shakti', 'shackleton_ridge'];
const TOL = 10; // deg: the default hazard tolerance (Mission Profile max pad slope)

function percentile(sorted: number[], p: number): number {
  const x = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(x);
  return sorted[lo] + (x - lo) * ((sorted[Math.min(lo + 1, sorted.length - 1)] ?? sorted[lo]) - sorted[lo]);
}

describe('summariseDispersion (hand-checked on a grid with known values)', () => {
  const grid = { siteId: 'x', nodes: [11, 11] as [number, number], spacingM: 50, slopeDeg: Float32Array.from({ length: 121 }, (_, i) => i / 10) }; // 0.0, 0.1 ... 12.0
  it('p50 = 6.0, p95 = 11.4, max = 12.0; 100 of 121 nodes are strictly below 10 deg', () => {
    const s = summariseDispersion(grid, 10);
    expect(s.p50).toBeCloseTo(6.0, 5);
    expect(s.p95).toBeCloseTo(11.4, 5); // (121-1)*0.95 = 114 -> value 11.4
    expect(s.max).toBeCloseTo(12.0, 5);
    expect(s.pctBelowTolerance).toBeCloseTo((100 * 100) / 121, 5);
  });
});

describe('pad stats agree with the dispersion grid (mock data now; the same check applies to the real pipeline outputs)', () => {
  beforeAll(() => stubFetch());
  it.each(SITES)('%s: p50, p95, max and %% below tolerance match the grid', async (id) => {
    const bin = readFileSync(join(PUBLIC, `data-mock/terrain/dispersion/${id}.bin`));
    const unit = JSON.parse(readFileSync(join(PUBLIC, `data-mock/terrain/dispersion/${id}.json`), 'utf8')).unit_deg as number;
    const slopes = Array.from(bin, (v) => v * unit).sort((a, b) => a - b);
    const pad = await loadPad(id);
    const s = pad.dispersionSlopeStats;
    expect(Math.abs(s.p50 - percentile(slopes, 50))).toBeLessThanOrEqual(0.05);
    expect(Math.abs(s.p95 - percentile(slopes, 95))).toBeLessThanOrEqual(0.05);
    expect(Math.abs(s.max - slopes[slopes.length - 1])).toBeLessThanOrEqual(0.05);
    expect(Math.abs(s.pctBelowTolerance - (100 * slopes.filter((v) => v < TOL).length) / slopes.length)).toBeLessThanOrEqual(0.5);
    // and the loader-side summary says the same thing as the raw bytes
    const d = summariseDispersion(await loadDispersion(id), TOL);
    expect(Math.abs(d.p95 - percentile(slopes, 95))).toBeLessThanOrEqual(1e-4);
  });
  it.each(SITES)('%s: the badge and the histogram cannot contradict each other', async (id) => {
    const s = (await loadPad(id)).dispersionSlopeStats;
    const grid = summariseDispersion(await loadDispersion(id), TOL);
    if (s.p95 > TOL) expect(grid.pctBelowTolerance, 'badge says p95 over the tolerance, so some spots must be over it').toBeLessThan(100);
    if (grid.pctBelowTolerance === 100) expect(s.p95, 'every spot under the tolerance, so p95 must be too').toBeLessThanOrEqual(TOL);
  });
});
