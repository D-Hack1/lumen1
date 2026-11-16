// Owner: Nived
// Replays Gowri's PRELIMINARY real-site Golden Set 2 (public/data/golden/golden_set2_shackleton_preliminary.json) through the TypeScript engine.
// Status: these are Python-generated parity references for the Shackleton Tier-A mask, NOT independent scientific ground truth. Terrain sigma, pad and PGDA
// reference values are not asserted by the file, so nothing here tests bounds, power or DSN. Passing means TS == Python on identical inputs, nothing more.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleTimes, detectEvents } from '../core/events';
import { bodyAt, makeSite } from '../core/geometry';
import { Horizon, availability } from '../core/visibility';
import { loadEphem } from '../data/ephem';
import type { Ephemeris } from '../data/ephem';
import { loadMask } from '../data/masks';
import type { Mask } from '../data/masks';
import { setDataMode } from '../data/source';
import { PUBLIC, stubFetch } from './helpers';

type Case = { id: string; input?: Record<string, any>; expected: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
const file = JSON.parse(readFileSync(join(PUBLIC, 'data/golden/golden_set2_shackleton_preliminary.json'), 'utf8')) as {
  cases: Case[];
  tolerances: { angle_deg: number; distance_km: number; event_time_s: number };
  provenance: { terrain_mask_sha256: string; ephem_sha256: string; site_coordinates: { latitude_deg: number; longitude_deg_east: number } };
};
const TOL = file.tolerances;
const get = (id: string): Case => file.cases.find((c) => c.id === id)!;
const { latitude_deg: LAT, longitude_deg_east: LON } = file.provenance.site_coordinates;
const HEIGHTS = [1, 2, 5, 10];

let eph: Ephemeris;
let mask: Mask;
const horizonFor = (heightM: number): Horizon => {
  const k = HEIGHTS.indexOf(heightM);
  return new Horizon({ elevationsDeg: mask.elevDeg.subarray(k * mask.azimuthCount, (k + 1) * mask.azimuthCount), binWidthDeg: mask.binWidthDeg, observerHeightM: heightM });
};
const site = (heightM: number) => makeSite(LAT, LON, heightM);

beforeAll(async () => {
  setDataMode('real');
  stubFetch();
  eph = await loadEphem();
  mask = await loadMask('shackleton_ridge');
});
afterAll(() => setDataMode(null));

describe('Golden Set 2 (Shackleton, preliminary Python references) vs the TypeScript engine', () => {
  it('has the six documented cases, and is the same mask and ephemeris the TS engine loads', () => {
    expect(file.cases.map((c) => c.id)).toEqual([
      'shackleton_ridge_visibility_2025-01-01', 'shackleton_ridge_visibility_2025-06-01', 'shackleton_ridge_visibility_2025-12-01',
      'shackleton_ridge_horizon_interpolation', 'shackleton_ridge_sun_event_consistency_30d_10m', 'shackleton_ridge_mask_numerical_invariants',
    ]);
    const sha = (rel: string) => createHash('sha256').update(readFileSync(join(PUBLIC, rel))).digest('hex');
    expect(sha('data/terrain/masks/shackleton_ridge.bin')).toBe(file.provenance.terrain_mask_sha256);
    expect(sha('data/ephem/ephem.bin')).toBe(file.provenance.ephem_sha256);
  });

  it.each(['2025-01-01', '2025-06-01', '2025-12-01'])('visibility %s: Sun and Earth az/el/distance and per-height clearance, disk fraction, visibility', (day) => {
    const c = get(`shackleton_ridge_visibility_${day}`);
    const t = Date.parse(c.input!.utc);
    expect(c.input!.observer_heights_m).toEqual(HEIGHTS);
    for (const body of ['sun', 'earth'] as const) {
      const want = c.expected[body];
      const g = bodyAt(eph, body, t, site(0)); // Python evaluates the body geometry at the surface point; only the horizon varies with height
      expect(Math.abs(g.azimuthDeg - want.azimuth_deg)).toBeLessThanOrEqual(TOL.angle_deg);
      expect(Math.abs(g.elevationDeg - want.elevation_deg)).toBeLessThanOrEqual(TOL.angle_deg);
      expect(Math.abs(g.distanceKm - want.distance_km)).toBeLessThanOrEqual(TOL.distance_km);
      for (const h of HEIGHTS) {
        const w = want.by_height_m[String(h)];
        const a = availability(body, g.elevationDeg, g.azimuthDeg, g.distanceKm, horizonFor(h), { diskThreshold: 0.5 });
        expect(Math.abs(a.clearanceDeg - w.clearance_deg), `${body} ${h} m clearance`).toBeLessThanOrEqual(TOL.angle_deg);
        expect(a.fraction, `${body} ${h} m disk fraction`).toBeCloseTo(w.disk_fraction, 6);
        expect(a.visible, `${body} ${h} m visible`).toBe(w.visible);
      }
    }
  });

  it('horizon_interpolation: periodic linear interpolation between bin centres, per height (float32 mask values)', () => {
    const c = get('shackleton_ridge_horizon_interpolation');
    for (const h of HEIGHTS) {
      c.input!.azimuth_deg.forEach((az: number, i: number) => {
        expect(Math.abs(horizonFor(h).elevationAt(az) - c.expected[String(h)][i]), `${h} m az ${az}`).toBeLessThanOrEqual(TOL.angle_deg);
      });
    }
  });

  it('sun_event_consistency_30d_10m: 21,601 samples, no Sun visible, no events (10 m height)', () => {
    const c = get('shackleton_ridge_sun_event_consistency_30d_10m');
    const start = Date.parse(c.input!.start_utc);
    const end = Date.parse(c.input!.end_utc);
    const horizon = horizonFor(c.input!.observer_height_m);
    const s = site(0); // same convention: surface-point geometry, 10 m horizon
    const visibleAt = (t: number) => {
      const g = bodyAt(eph, 'sun', t, s);
      return availability('sun', g.elevationDeg, g.azimuthDeg, g.distanceKm, horizon, { diskThreshold: 0.5 }).visible;
    };
    const times = sampleTimes(start, end);
    expect(times.length).toBe(c.expected.sample_count);
    expect(times.filter(visibleAt).length).toBe(c.expected.sample_visible_count);
    expect(detectEvents(start, end, visibleAt, { down: 'sunset', up: 'shadowExit' })).toEqual(c.expected.events);
  });

  it('mask_numerical_invariants: hash, shape, finite counts, NaN pattern, per-height min/max', () => {
    const e = get('shackleton_ridge_mask_numerical_invariants').expected;
    expect(e.sha256).toBe(file.provenance.terrain_mask_sha256);
    expect(e.shape).toEqual([4, mask.azimuthCount]);
    const n = mask.azimuthCount;
    HEIGHTS.forEach((_, k) => {
      const el = mask.elevDeg.subarray(k * n, (k + 1) * n);
      const di = mask.distKm.subarray(k * n, (k + 1) * n);
      const fe = Array.from(el).filter(Number.isFinite);
      const fd = Array.from(di).filter(Number.isFinite);
      expect(fe.length).toBe(e.finite_elevation_count_by_height[k]);
      expect(fd.length).toBe(e.finite_distance_count_by_height[k]);
      expect(Math.min(...fe)).toBeCloseTo(e.elevation_min_deg[k], 5);
      expect(Math.max(...fe)).toBeCloseTo(e.elevation_max_deg[k], 5);
      expect(Math.min(...fd)).toBeCloseTo(e.distance_min_km[k], 3);
      expect(Math.max(...fd)).toBeCloseTo(e.distance_max_km[k], 3);
    });
    const patternsEqual = Array.from(mask.elevDeg).every((v, i) => Number.isNaN(v) === Number.isNaN(mask.distKm[i]));
    expect(patternsEqual).toBe(e.nan_patterns_equal);
  });
});
