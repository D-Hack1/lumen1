// Owner: Nived
// Replays Gowri's synthetic near-zone fixture (public/data/golden/golden_set2_near_zone_synthetic.json) against the TypeScript engine.
// The fixture is produced from the Python mask generator's `_apply_near_zone`, which MERGES the fitted plane into the stored mask. The TS engine never builds masks;
// it applies the same plane at query time in Horizon.effectiveAt (R3 D-9), on top of a mask that already contains it. Replaying the fixture through effectiveAt checks
// that the two implement the same rule: m_eff = max(m_dem, N+) only where N+ > 0, and a negative distant horizon is preserved exactly.
// Known difference, by design: for a NaN (unavailable) distant bin the generator writes N+ when N+ > 0, while effectiveAt returns NaN. The app rejects masks with NaN bins
// (core/terrainHorizon.ts), so it never meets that case; the NaN bins are replayed here with a very low finite sentinel to check the plane value itself.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Horizon } from '../core/visibility';
import { PUBLIC } from './helpers';

interface Bin {
  azimuth_bin: number;
  azimuth_deg: number;
  observer_height_m: number;
  distant_elevation_deg: number | null;
  distant_distance_km: number | null;
  expected_elevation_deg: number | null;
  expected_distance_km: number | null;
}
interface Case { id: string; d_min_m: number; slope_deg: number; uphill_azimuth_deg: number; selected_bins: Bin[] }
// The committed file contains bare NaN tokens (Python's json.dumps default), which are not valid JSON. Read them as null until Gowri emits null.
const raw = readFileSync(join(PUBLIC, 'data/golden/golden_set2_near_zone_synthetic.json'), 'utf8').replace(/([:[,]\s*)NaN\b/g, '$1null');
const file = JSON.parse(raw) as {
  cases: Case[];
  tolerances: { elevation_deg: number; distance_km: number };
  observer_heights_m: number[];
};
const SENTINEL = -1e9;

describe('Golden Set 2 (synthetic near-zone) vs Horizon.effectiveAt', () => {
  it('has the documented cases, heights and tolerances', () => {
    expect(file.cases.map((c) => c.id)).toEqual(['flat_retention_nan_and_negative_replacement', 'twenty_degree_cardinal_and_wraparound']);
    expect(file.observer_heights_m).toEqual([1, 2, 5, 10]);
  });

  for (const c of file.cases) {
    it(`${c.id}: effective horizon and the replaced/retained distance, every bin x height`, () => {
      let taken = 0;
      for (const b of c.selected_bins) {
        const terrain = b.distant_elevation_deg ?? SENTINEL;
        const row = new Float64Array(3600).fill(terrain); // uniform row: bin-centre lookup is exact whatever the neighbours
        const h = new Horizon({ elevationsDeg: row, binWidthDeg: 0.1, slopeDeg: c.slope_deg, uphillAzimuthDeg: c.uphill_azimuth_deg, dMinM: c.d_min_m, observerHeightM: b.observer_height_m });
        const eff = h.effectiveAt(b.azimuth_deg);
        const tag = `bin ${b.azimuth_bin} @ ${b.observer_height_m} m`;
        const planeTaken = eff > terrain; // the plane replaced the distant horizon (strictly higher)
        const gotElev = b.distant_elevation_deg == null && !planeTaken ? NaN : eff;
        const gotDist = planeTaken ? c.d_min_m / 1000 : b.distant_distance_km ?? NaN;
        if (b.expected_elevation_deg == null) expect(gotElev, `${tag} elevation`).toBeNaN();
        else expect(Math.abs(gotElev - b.expected_elevation_deg), `${tag} elevation`).toBeLessThanOrEqual(file.tolerances.elevation_deg);
        if (b.expected_distance_km == null) expect(gotDist, `${tag} distance`).toBeNaN();
        else expect(Math.abs(gotDist - b.expected_distance_km), `${tag} distance`).toBeLessThanOrEqual(file.tolerances.distance_km);
        if (planeTaken) taken++;
      }
      if (c.slope_deg === 0) expect(taken).toBe(0); // flat plane at h > 0 is always below zero: nothing is replaced, negatives preserved exactly
      else expect(taken).toBeGreaterThan(0);
    });
  }
});
