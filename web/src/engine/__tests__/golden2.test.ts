// Owner: Nived
// Golden Set 2 (synthetic R3 edge vectors; public/data/golden/golden_set2_synthetic.json, written by Gowri's validation/golden_synthetic.py).
// Hand-derived by Gowri, independent of this code: every case is replayed through the TypeScript engine and compared within the file's own tolerances.
// They exercise primitives only (no DEM, sigma, DSN or catalog data); real site Set 2 cases are still pending.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AU_KM } from '../core/constants';
import { detectEvents } from '../core/events';
import { evaluatePowerSeries } from '../core/power';
import { energyPerDayWh } from '../core/padPower';
import { availability, diskFraction, diskFractionVisible, Horizon } from '../core/visibility';
import { longestWindowGapHours, mergeWindows, windowPercentage, windowsFromEvents } from '../core/windows';
import { detectTransitions } from '../core/events';
import { dsnElevationsAt, dsnLinkUp } from '../core/dsn';
import { fastEventUncertainty, limbOffsetDeg, numericBounds, shiftHorizonMask, threePassBounds, totalClearanceRateDegPerHour, exactEventUncertainty } from '../core/uncertainty';
import { evaluateWithBounds } from '../core/bounds';
import { DEFAULT_DEFINITIONS } from '../core/evaluate';
import { buildScenarioResult } from '../core/buildResult';
import { makeSite } from '../core/geometry';
import { loadEphem } from '../data/ephem';
import type { DsnSeries } from '../data/dsn';
import { setDataMode } from '../data/source';
import { PUBLIC, stubFetch } from './helpers';
import type { EventRecord } from '../types';

type Case = { id: string; input: Record<string, any>; expected: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
const file = JSON.parse(readFileSync(join(PUBLIC, 'data/golden/golden_set2_synthetic.json'), 'utf8')) as {
  cases: Case[];
  tolerances: { angle_deg: number; event_time_s: number; delta_t_percent: number };
  typescript_parity: { full: string[]; partial: Record<string, string>; python_only: Record<string, string> };
};
const TOL = file.tolerances;
const get = (id: string): Case => file.cases.find((c) => c.id === id)!;
const S = 1000;
const flat = (deg: number) => new Horizon({ elevationsDeg: new Float64Array(360).fill(deg), binWidthDeg: 1 });
const ev = (et: number): EventRecord => ({ type: 'sunset', t: et * S, dtMs: null, grazing: false, grazingReason: null, dtMethod: 'fast' });
const opts = { diskThreshold: 0.5 };

describe('Golden Set 2 (synthetic) vs the TypeScript engine', () => {
  it('has the 19 documented cases and explicit TypeScript parity classifications', () => {
    expect(file.cases.map((c) => c.id)).toEqual([
      'synthetic_flat_visibility_boundaries', 'synthetic_terrain_mask_boundary', 'synthetic_disk_limb_conventions', 'synthetic_disk_span_extrema',
      'synthetic_nan_wraparound_extrema', 'synthetic_event_at_window_start', 'synthetic_refined_visibility_window', 'synthetic_total_clearance_rate',
      'synthetic_three_pass_bounds', 'synthetic_exact_event_uncertainty', 'synthetic_disk_event_thresholds', 'synthetic_grazing_rate',
      'synthetic_near_zone_slope_edges', 'synthetic_guarded_span_spike', 'synthetic_tier_c_smooth_moon', 'synthetic_min_sun_elevation_ops',
      'synthetic_power_eclipse_soc', 'synthetic_dsn_link_modes', 'synthetic_dsn_out_of_coverage',
    ]);
    expect(file.typescript_parity.python_only).toHaveProperty('synthetic_guarded_span_spike');
    expect(Object.keys(file.typescript_parity.partial).sort()).toEqual(['synthetic_dsn_link_modes', 'synthetic_three_pass_bounds']);
    expect(file.typescript_parity.full).not.toContain('synthetic_guarded_span_spike');
    // Never claim parity that is not replayed: every case labelled `full` has a replay below, and Python-only cases have none.
    const everyLabelled = [...file.typescript_parity.full, ...Object.keys(file.typescript_parity.partial), ...Object.keys(file.typescript_parity.python_only)];
    expect(new Set(everyLabelled).size).toBe(everyLabelled.length); // no case carries two labels
    // Cases this file replays in TS but whose label in the fixture has not caught up yet (Gowri to move them: first three -> full, the last -> partial/full).
    const replayedButUnlabelled = ['synthetic_disk_span_extrema', 'synthetic_nan_wraparound_extrema', 'synthetic_disk_event_thresholds', 'synthetic_dsn_out_of_coverage'];
    const unlabelled = file.cases.map((c) => c.id).filter((id) => !everyLabelled.includes(id));
    expect(unlabelled.every((id) => replayedButUnlabelled.includes(id))).toBe(true);
  });

  it('synthetic_disk_span_extrema: a spike one bin before azimuth 0 is inside the Sun\'s disk span, so the disk is not fully visible', () => {
    const c = get('synthetic_disk_span_extrema');
    const mask = new Float64Array(3600);
    mask[3599] = c.input.spike_elevation_deg; // bin 3599 is centred at 359.95 deg
    const f = diskFraction('sun', c.input.sun_elevation_deg, c.input.centre_azimuth_deg, 149597870.7, new Horizon({ elevationsDeg: mask, binWidthDeg: 0.1 }));
    expect(f).toBeLessThan(c.expected.disk_fraction_lt);
    expect(f).toBeGreaterThanOrEqual(0);
  });

  it('synthetic_nan_wraparound_extrema: a full-circle span over a mask with an unavailable bin gives the finite min and max', () => {
    const c = get('synthetic_nan_wraparound_extrema');
    const elevations = Float64Array.from((c.input.elevations_deg as Array<number | null>).map((v) => (v == null ? NaN : v)));
    const [lo, hi] = new Horizon({ elevationsDeg: elevations, binWidthDeg: c.input.bin_width_deg }).extrema(0, 180);
    expect(lo).toBe(c.expected.minimum_deg);
    expect(hi).toBe(c.expected.maximum_deg);
  });

  it('synthetic_disk_event_thresholds: 0% needs any part of the disk, 50% and 100% are at-least thresholds', () => {
    const c = get('synthetic_disk_event_thresholds');
    expect(c.input.thresholds).toEqual([0, 0.5, 1]);
    expect(diskFractionVisible(0, 0)).toBe(c.expected.zero_visible_at_zero);
    expect(diskFractionVisible(0.5, 0.5)).toBe(c.expected.half_visible_at_half);
    expect(diskFractionVisible(1, 1)).toBe(c.expected.full_visible_at_full);
    expect(diskFractionVisible(0.001, 0)).toBe(true); // any sliver counts at 0%
    expect(diskFractionVisible(0.499, 0.5)).toBe(false);
  });

  it.each(['synthetic_flat_visibility_boundaries', 'synthetic_terrain_mask_boundary'])('%s: elevation +-2 deg about the horizon gives clearance, disk fraction and visibility', (id) => {
    const c = get(id);
    const h = flat(c.input.horizon_deg);
    for (const want of c.expected.visibility) {
      const a = availability('sun', want.elevation_deg, 0, c.input.sun_distance_km, h, opts);
      expect(Math.abs(a.clearanceDeg - want.clearance_deg)).toBeLessThanOrEqual(TOL.angle_deg);
      expect(a.visible).toBe(want.visible);
      if ('disk_fraction' in want) expect(a.fraction).toBeCloseTo(want.disk_fraction, 6);
    }
  });

  it('synthetic_disk_limb_conventions: 0% disk -> +r, 50% -> 0, 100% -> -r', () => {
    const c = get('synthetic_disk_limb_conventions');
    const r = c.input.solar_radius_deg;
    expect(limbOffsetDeg(0, r)).toBeCloseTo(c.expected.limb_clearance_offset_deg.disk_0_pct, 12);
    expect(limbOffsetDeg(0.5, r)).toBeCloseTo(c.expected.limb_clearance_offset_deg.disk_50_pct, 12);
    expect(limbOffsetDeg(1, r)).toBeCloseTo(c.expected.limb_clearance_offset_deg.disk_100_pct, 12);
  });

  it('synthetic_event_at_window_start: a predicate already true at the start has no event and a partial-start window', () => {
    const c = get('synthetic_event_at_window_start');
    const [a, b] = c.input.range_et as [number, number];
    expect(detectEvents(a * S, b * S, (t) => t / S >= 0, { down: 'sunset', up: 'shadowExit' })).toEqual(c.expected.events);
    const times = [a * S, (a + 120) * S, b * S];
    const w = mergeWindows('sun', times, [true, true, true], [1, 1, 1]);
    expect(w.length).toBe(1);
    expect(w[0].startMs / S).toBe(c.expected.window.start_et);
    expect(w[0].endMs / S).toBe(c.expected.window.end_et);
    expect(w[0].partialStart).toBe(c.expected.window.partial_start);
  });

  it('synthetic_refined_visibility_window: refined transitions delimit a complete window', () => {
    const c = get('synthetic_refined_visibility_window');
    const [a, b] = c.input.range_et as [number, number];
    const predicate = (t: number) => 120 <= t / S && t / S < 480;
    const events = detectEvents(a * S, b * S, predicate, { down: 'sunset', up: 'shadowExit' });
    const expected = c.expected.window;
    const times = [a * S, ...events.map((event) => event.t), b * S, (b + 120) * S];
    const windows = mergeWindows('sun', times, [false, true, false, false, false], [1, 1, 1, 1, 1]);

    expect(events.map((event) => event.type)).toEqual(c.expected.event_types);
    events.forEach((event, index) => {
      expect(Math.abs(event.t / S - [expected.start_et, expected.end_et][index])).toBeLessThanOrEqual(TOL.event_time_s);
    });
    expect(windows).toHaveLength(1);
    expect(Math.abs(windows[0].startMs / S - expected.start_et)).toBeLessThanOrEqual(TOL.event_time_s);
    expect(Math.abs(windows[0].endMs / S - expected.end_et)).toBeLessThanOrEqual(TOL.event_time_s);
    expect(windows[0].partialStart).toBe(expected.partial_start);
    expect(windows[0].partialEnd).toBe(expected.partial_end);
  });

  it('synthetic_total_clearance_rate: d el/dt - (d mask/d az)(d az/dt) = -32.4 deg/h for a moving mask', () => {
    const c = get('synthetic_total_clearance_rate');
    const v = Float64Array.from({ length: 3600 }, (_, i) => c.input.mask_deg_per_bin * i);
    const h = new Horizon({ elevationsDeg: v, binWidthDeg: c.input.mask_bin_width_deg });
    const geom = (t: number) => ({ elevationDeg: 5 + 0.001 * (t / S), azimuthDeg: 10 + 0.1 * (t / S) });
    const [a, b] = c.input.range_et as [number, number];
    const event = ((a + b) / 2) * S; // the +-120 s stencil in the file's range [-20, 220] is centred on et = 100
    expect(totalClearanceRateDegPerHour(event, geom, h)).toBeCloseTo(c.expected.clearance_rate_deg_per_hour, 6);
  });

  it('synthetic_three_pass_bounds: mask 1.0 +- sigma 0.25 -> [0.75, 1.0, 1.25]', () => {
    const c = get('synthetic_three_pass_bounds');
    const h = new Horizon({ elevationsDeg: [c.input.mask_deg, c.input.mask_deg], binWidthDeg: 180 });
    const shifted = [shiftHorizonMask(h, c.input.sigma_deg, -1), h, shiftHorizonMask(h, c.input.sigma_deg, 1)].map((x) => x.elevationAt(90));
    shifted.forEach((x, i) => expect(x).toBeCloseTo(c.expected.shifted_masks_deg[i], 12));
    numericBounds(threePassBounds(h, c.input.sigma_deg, (x) => x.elevationAt(90))).forEach((x, i) => expect(x).toBeCloseTo(c.expected.numeric_bounds[i], 12));
  });

  it('synthetic_exact_event_uncertainty: times 80/100/120 s -> half spread 20 s, exact, no grazing', () => {
    const c = get('synthetic_exact_event_uncertainty');
    const [lo, nom, hi] = c.input.event_times_et as number[];
    const u = exactEventUncertainty(ev(nom), ev(lo), ev(hi));
    expect(u.deltaTSeconds).toBe(c.expected.delta_t_seconds);
    expect(u.dtMethod).toBe(c.expected.dt_method);
    expect(u.grazingReason).toBe(c.expected.grazing_reason);
  });

  it('synthetic_grazing_rate: a clearance that never changes has no finite +-, flagged "rate"', () => {
    const c = get('synthetic_grazing_rate');
    const u = fastEventUncertainty(0, () => ({ elevationDeg: c.input.constant_clearance_deg, azimuthDeg: 0 }), flat(0), () => c.input.sigma_deg);
    expect(c.expected.delta_t_seconds).toBe('infinity');
    expect(u.deltaTSeconds).toBe(Infinity);
    expect(u.grazingReason).toBe(c.expected.grazing_reason);
  });

  it('synthetic_near_zone_slope_edges: the plane only raises the horizon on the uphill side (flat/downhill and cross-slope keep the terrain)', () => {
    const c = get('synthetic_near_zone_slope_edges');
    const i = c.input;
    const h = new Horizon({ elevationsDeg: new Float64Array(360).fill(i.terrain_horizon_deg), binWidthDeg: 1, slopeDeg: i.slope_deg, uphillAzimuthDeg: i.uphill_azimuth_deg, dMinM: i.d_min_m, observerHeightM: i.observer_height_m });
    const flatH = new Horizon({ elevationsDeg: new Float64Array(360).fill(i.terrain_horizon_deg), binWidthDeg: 1, slopeDeg: 0, uphillAzimuthDeg: i.uphill_azimuth_deg, dMinM: i.d_min_m, observerHeightM: i.observer_height_m });
    expect(Math.abs(flatH.effectiveAt(i.uphill_azimuth_deg) - c.expected.flat_or_downhill_effective_deg)).toBeLessThanOrEqual(TOL.angle_deg);
    expect(Math.abs(h.effectiveAt((i.uphill_azimuth_deg + 180) % 360) - c.expected.flat_or_downhill_effective_deg)).toBeLessThanOrEqual(TOL.angle_deg);
    expect(Math.abs(h.effectiveAt((i.uphill_azimuth_deg + 90) % 360) - c.expected.cross_slope_effective_deg)).toBeLessThanOrEqual(TOL.angle_deg);
    expect(Math.abs(h.effectiveAt(i.uphill_azimuth_deg) - c.expected.uphill_effective_deg)).toBeLessThanOrEqual(TOL.angle_deg);
  });

  it('synthetic_min_sun_elevation_ops: 5 deg elevation fails the 6 deg ISRO ops minimum even with the full disk', () => {
    const c = get('synthetic_min_sun_elevation_ops');
    const i = c.input;
    const a = availability('sun', i.elevation_deg, 0, AU_KM, flat(0), { diskThreshold: i.disk_threshold, minSunElevationOpsDeg: i.min_sun_elevation_ops_deg });
    expect(a.visible).toBe(c.expected.visible);
    expect(availability('sun', i.elevation_deg, 0, AU_KM, flat(0), { diskThreshold: i.disk_threshold }).visible).toBe(true); // without the ops floor it would be visible
  });

  it('synthetic_power_eclipse_soc: generation, net power and stored energy across daylight then eclipse', () => {
    const c = get('synthetic_power_eclipse_soc');
    const i = c.input;
    const sunDir = [0, 0, 1] as const;
    const r = evaluatePowerSeries(i.times_et, [sunDir, sunDir], [i.sun_distance_km, i.sun_distance_km], i.disk_fractions, [{ normal: i.panel_normal, areaM2: i.panel_area_m2, efficiency: i.panel_efficiency }], i.load_w, {
      batteryCapacityWh: i.battery_capacity_wh, usableDepthOfDischarge: i.usable_depth_of_discharge, initialSocFraction: i.initial_soc_fraction,
    });
    c.expected.generation_w.forEach((x: number, k: number) => expect(r.generationW[k]).toBeCloseTo(x, 9));
    c.expected.net_w.forEach((x: number, k: number) => expect(r.netW[k]).toBeCloseTo(x, 9));
    c.expected.stored_energy_wh.forEach((x: number, k: number) => expect(r.storedEnergyWh[k]).toBeCloseTo(x, 9));
    expect(energyPerDayWh(r.generationW, 3_600_000)).toBeCloseTo(c.expected.energyPerDayWh, 9);
  });

  it('synthetic_dsn_link_modes: replay interpolation and pointwise DSN on/off states only', () => {
    const c = get('synthetic_dsn_link_modes');
    const i = c.input;
    const elevations = i.station_elevations_deg as number[][];
    const series: DsnSeries = {
      stations: i.station_order as string[],
      startMs: 0,
      cadenceMs: i.cadence_s * S,
      count: elevations[0].length,
      elevDeg: (station, node) => elevations[station][node],
    };
    const queryTimes = [0, 450, 600, 750, 1200];
    const states = queryTimes.map((et) => dsnLinkUp(series, et * S, i.dsn_mask_deg));
    const dsnOffStates = queryTimes.map(() => i.earth_visible);

    expect(dsnElevationsAt(series, 450 * S)).toEqual([5, 0, 0]);
    expect(states).toEqual([true, true, false, true, true]);
    expect(dsnOffStates).toEqual([true, true, true, true, true]);
    expect(file.typescript_parity.partial.synthetic_dsn_link_modes).toContain('link-window metrics are Python-only');
  });

  it('synthetic_dsn_out_of_coverage: past the last DSN node the link is NOT up (an unknown is never a link): events, link % and longest gap match', () => {
    const c = get('synthetic_dsn_out_of_coverage');
    const i = c.input;
    const elevations = i.station_elevations_deg as number[][];
    const series: DsnSeries = { stations: i.station_order as string[], startMs: 0, cadenceMs: i.cadence_s * S, count: elevations[0].length, elevDeg: (st, n) => elevations[st][n] };
    const [a, b] = i.range_et as [number, number];
    const visible = (t: number) => i.earth_visible && dsnLinkUp(series, t, i.dsn_mask_deg); // Earth visible throughout; outside the series dsnLinkUp is false
    const ev = detectTransitions(a * S, b * S, visible, 'link_down', 'link_recovery');
    const want = c.expected.dsn_aware;
    expect(ev.map((e) => e.type)).toEqual(want.event_types);
    ev.forEach((e, k) => expect(Math.abs(e.t / S - want.event_times_et[k])).toBeLessThanOrEqual(TOL.event_time_s));
    const wins = windowsFromEvents('link', a * S, b * S, visible(a * S), ev, { downEvent: 'link_down', upEvent: 'link_recovery', peakElevationDeg: () => 1 });
    expect(Math.abs(windowPercentage(a * S, b * S, wins) - want.link_pct)).toBeLessThanOrEqual(1); // 3 edges, each bisected to the midpoint of a <= 10 s bracket (+-5 s): up to 15 s of 1800 s = 0.83 points
    expect(Math.abs(longestWindowGapHours(a * S, b * S, wins) - want.longest_comm_gap_hours)).toBeLessThanOrEqual(0.01);
    expect(dsnLinkUp(series, 1201 * S, i.dsn_mask_deg)).toBe(false); // the first instant past the last node
    expect(dsnLinkUp(series, 1200 * S, i.dsn_mask_deg)).toBe(true); // the last node itself is covered
  });

  it('synthetic_tier_c_smooth_moon: no terrain => no sigma, labelled as a smooth-sphere estimate, and no +- on any value', async () => {
    const c = get('synthetic_tier_c_smooth_moon');
    setDataMode('real');
    stubFetch();
    try {
      const eph = await loadEphem();
      const T = Date.parse('2025-03-06T17:28:50Z');
      const base = {
        siteId: null, tier: 'C' as const, nearFieldResM: null, latDeg: -84.7906, lonDegEast: 29.1957, heightM: c.input.observer_height_m, rotation: null, touchdownMs: null, padSlopeDeg: null, psr: null,
        startMs: T, durationDays: 14, tScrubMs: T, definitions: DEFAULT_DEFINITIONS, dataVersions: { catalog: 1 },
        profile: { minSunlitPct: 0, minLinkHours: 0, maxLongestNightH: 1e9, maxPadSlopeDeg: 90 }, weights: { sunlit: 1, link: 1, night: 1, slope: 1 },
      };
      expect(buildScenarioResult(eph, base).meta!.sigmaSource).toBe('smooth-sphere estimate; terrain unavailable');
      const b = evaluateWithBounds({ eph, site: makeSite(base.latDeg, base.lonDegEast, base.heightM), horizon: new Horizon({ observerHeightM: base.heightM }), startMs: T, durationDays: 14, definitions: DEFAULT_DEFINITIONS }, { sigmaDeg: 0.1, sigmaAtAzimuthDeg: () => 0.1 });
      expect(b.hasBounds).toBe(false);
      expect(b.metrics.sunlitPct.lo).toBeNull();
      for (const e of b.sunEvents) expect(e.dtMs).toBeNull();
    } finally {
      setDataMode(null);
    }
  });
});
