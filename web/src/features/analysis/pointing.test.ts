// Owner: Nived
// Seam: sampleAt(series, t) - what the Pointing tab shows at the scrub time (nearest sample, clamped to the series).
import { describe, expect, it } from 'vitest';
import type { Series } from '../../engine/types';
import { sampleAt } from './pointingSample';

const f = (v: number[]) => Float32Array.from(v);
const series = { t0: 1000, stepMs: 120_000, sunElevDeg: f([1, 2, 3]), sunAzDeg: f([10, 20, 30]), earthElevDeg: f([4, 5, 6]), earthAzDeg: f([40, 50, 60]), earthDiskPct: f([0, 50, 100]), earthRangeKm: f([380_000, 390_000, 400_000]), linkUp: Uint8Array.from([0, 1, 1]) } as unknown as Series;

describe('sampleAt', () => {
  it('returns the Earth range at the nearest sample', () => {
    expect(sampleAt(series, 1000).earthRangeKm).toBe(380_000);
    expect(sampleAt(series, 1000 + 120_000).earthRangeKm).toBe(390_000);
    expect(sampleAt(series, 1000 + 100_000).earthRangeKm).toBe(390_000); // 100 s rounds to the 120 s sample
  });
  it('clamps before the start and after the end', () => {
    expect(sampleAt(series, -1e9).earthRangeKm).toBe(380_000);
    expect(sampleAt(series, 1e12).earthRangeKm).toBe(400_000);
  });
});
