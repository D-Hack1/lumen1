// Owner: Nived
// R3 horizon interpolation, near-zone occluder and disk visibility (Python twin: reference/visibility.py).
// Same function names and the same sampling rules as the Python, so the two agree to float precision.
import { AU_KM, DEG, EARTH_RADIUS_KM, LUNAR_RADIUS_KM, SUN_ANGULAR_RADIUS_DEG_AT_1_AU } from './constants';
import type { BodyId } from './interp';

export interface HorizonInit {
  /** One height's elevation profile (bin centres at (i + 0.5) * binWidthDeg). Omit for the smooth-Moon (Tier C) horizon. */
  elevationsDeg?: ArrayLike<number> | null;
  binWidthDeg?: number;
  /** R3 D-9 near-zone occluder inputs; all three must be set for it to apply. */
  slopeDeg?: number | null;
  uphillAzimuthDeg?: number | null;
  dMinM?: number | null;
  observerHeightM?: number;
}

export class Horizon {
  readonly elevationsDeg: ArrayLike<number> | null;
  readonly binWidthDeg: number;
  readonly slopeDeg: number | null;
  readonly uphillAzimuthDeg: number | null;
  readonly dMinM: number | null;
  readonly observerHeightM: number;

  constructor(init: HorizonInit = {}) {
    this.elevationsDeg = init.elevationsDeg ?? null;
    this.binWidthDeg = init.binWidthDeg ?? 0.1;
    this.slopeDeg = init.slopeDeg ?? null;
    this.uphillAzimuthDeg = init.uphillAzimuthDeg ?? null;
    this.dMinM = init.dMinM ?? null;
    this.observerHeightM = init.observerHeightM ?? 0;
  }

  /** The same horizon with a different terrain mask. Near-zone plane parameters and observer height are kept (R3: the +/- sigma passes shift only the mask). */
  withElevations(elevationsDeg: ArrayLike<number>): Horizon {
    return new Horizon({ elevationsDeg, binWidthDeg: this.binWidthDeg, slopeDeg: this.slopeDeg, uphillAzimuthDeg: this.uphillAzimuthDeg, dMinM: this.dMinM, observerHeightM: this.observerHeightM });
  }

  /** Smooth-sphere dip when there is no mask; otherwise periodic linear interpolation between bin centres. */
  elevationAt(azimuthDeg: number): number {
    const values = this.elevationsDeg;
    if (values == null) {
      return -Math.acos(LUNAR_RADIUS_KM / (LUNAR_RADIUS_KM + this.observerHeightM / 1000)) / DEG;
    }
    const n = values.length;
    const mod = ((azimuthDeg % 360) + 360) % 360;
    const coordinate = mod / this.binWidthDeg - 0.5;
    const floor = Math.floor(coordinate);
    const left = ((floor % n) + n) % n;
    const fraction = coordinate - floor;
    const right = (left + 1) % n;
    return (1 - fraction) * values[left] + fraction * values[right];
  }

  /** Effective mask: terrain, raised by the near-zone plane when it is uphill; the terrain value itself is never clamped. */
  effectiveAt(azimuthDeg: number): number {
    const terrain = this.elevationAt(azimuthDeg);
    if (this.slopeDeg == null || this.uphillAzimuthDeg == null || this.dMinM == null) return terrain;
    const slope = this.slopeDeg * DEG;
    const near = Math.atan(Math.tan(slope) * Math.cos((azimuthDeg - this.uphillAzimuthDeg) * DEG) - this.observerHeightM / this.dMinM) / DEG;
    const nearPositive = Math.max(0, near);
    return nearPositive === 0 ? terrain : Math.max(terrain, nearPositive); // as reference/visibility.py: a flat or downhill plane never lifts a below-zero terrain horizon to 0
  }

  /** Exact half-open bin ranges [start, end) that intersect the closed azimuth span (as the Python `_span_ranges`); a range crossing bin 0 is split. */
  private spanRanges(centreAzimuthDeg: number, halfWidthDeg: number): Array<[number, number]> {
    if (!Number.isFinite(centreAzimuthDeg) || !Number.isFinite(halfWidthDeg) || halfWidthDeg < 0) throw new RangeError('azimuth centre and half-width must be finite, with non-negative half-width');
    const values = this.elevationsDeg;
    if (values == null) return [];
    const count = values.length;
    if (count === 0 || Math.abs(count * this.binWidthDeg - 360) > 1e-9) throw new RangeError('horizon bins must cover exactly one 360-degree circle');
    if (2 * halfWidthDeg >= 360) return [[0, count]];
    const first = Math.floor((centreAzimuthDeg - halfWidthDeg) / this.binWidthDeg);
    const last = Math.floor((centreAzimuthDeg + halfWidthDeg) / this.binWidthDeg);
    const spanCount = last - first + 1;
    if (spanCount >= count) return [[0, count]];
    const start = ((first % count) + count) % count;
    const end = start + spanCount;
    return end <= count ? [[start, end]] : [[start, count], [0, end - count]];
  }

  /** Finite-only min and max over the bin ranges; [NaN, NaN] when every bin in them is unavailable. */
  private rawExtrema(ranges: ReadonlyArray<[number, number]>): [number, number] {
    const values = this.elevationsDeg as ArrayLike<number>;
    let min = Infinity;
    let max = -Infinity;
    for (const [start, end] of ranges) {
      for (let i = start; i < end; i++) {
        const v = values[i];
        if (Number.isFinite(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    }
    return min === Infinity ? [NaN, NaN] : [min, max];
  }

  /** Maximum of the near-zone plane over the span, maximised continuously (cosine of the offset from the uphill azimuth); -Infinity when it never rises above 0. */
  private nearZoneMax(centreAzimuthDeg: number, halfWidthDeg: number): number {
    if (this.slopeDeg == null || this.uphillAzimuthDeg == null || this.dMinM == null) return -Infinity;
    if (!Number.isFinite(centreAzimuthDeg) || !Number.isFinite(halfWidthDeg) || halfWidthDeg < 0) throw new RangeError('azimuth centre and half-width must be finite, with non-negative half-width');
    const uphillOffset = ((((this.uphillAzimuthDeg - centreAzimuthDeg + 180) % 360) + 360) % 360) - 180;
    let maximumCosine: number;
    if (halfWidthDeg >= 180 || Math.abs(uphillOffset) <= halfWidthDeg) maximumCosine = 1;
    else {
      const slopeAzimuth = this.uphillAzimuthDeg * DEG;
      maximumCosine = Math.max(Math.cos((centreAzimuthDeg - halfWidthDeg) * DEG - slopeAzimuth), Math.cos((centreAzimuthDeg + halfWidthDeg) * DEG - slopeAzimuth));
    }
    const nearMax = Math.atan(Math.tan(this.slopeDeg * DEG) * maximumCosine - this.observerHeightM / this.dMinM) / DEG;
    return nearMax > 0 ? nearMax : -Infinity;
  }

  /**
   * Conservative effective-mask extrema across a circular span (as the Python `extrema`): the terrain min/max are exact over the bins the span
   * touches (finite bins only), the near-zone upper bound is maximised continuously, and the raw terrain minimum stays a conservative lower bound.
   */
  extrema(centreAzimuthDeg: number, halfWidthDeg: number): [number, number] {
    if (this.elevationsDeg == null) {
      const terrain = this.elevationAt(centreAzimuthDeg);
      return [terrain, Math.max(terrain, this.nearZoneMax(centreAzimuthDeg, halfWidthDeg))];
    }
    const ranges = this.spanRanges(centreAzimuthDeg, halfWidthDeg);
    const [min, max] = this.rawExtrema(ranges);
    if (this.slopeDeg == null || this.uphillAzimuthDeg == null || this.dMinM == null) return [min, max];
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [NaN, NaN];
    return [min, Math.max(max, this.nearZoneMax(centreAzimuthDeg, halfWidthDeg))];
  }
}

export function angularRadiusDeg(body: BodyId, distanceKm: number): number {
  if (body === 'sun') return (SUN_ANGULAR_RADIUS_DEG_AT_1_AU * AU_KM) / distanceKm;
  return Math.asin(EARTH_RADIUS_KM / distanceKm) / DEG;
}

/** Visible fraction (0..1) of the body's disk above the effective mask: span short-circuit, then 24 (Sun) / 32 (Earth) chords. */
export function diskFraction(body: BodyId, elevationDeg: number, azimuthDeg: number, distanceKm: number, horizon: Horizon): number {
  const radius = angularRadiusDeg(body, distanceKm);
  const cosine = Math.max(Math.cos(Math.min(Math.abs(elevationDeg), 89.9) * DEG), Math.cos(89.9 * DEG));
  const halfWidth = radius >= 90 - elevationDeg ? 180 : Math.asin(Math.sin(radius * DEG) / cosine) / DEG;
  const [minimum, maximum] = horizon.extrema(azimuthDeg, halfWidth);
  if (elevationDeg - 1.05 * radius > maximum) return 1;
  if (elevationDeg + 1.05 * radius < minimum) return 0;
  const chords = body === 'sun' ? 24 : 32;
  const r = radius * DEG;
  let visibleArea = 0;
  for (let i = 0; i < chords; i++) {
    const x = r * ((2 * (i + 0.5)) / chords - 1);
    const halfChord = Math.sqrt(Math.max(0, r * r - x * x));
    const azimuthOffset = Math.asin(Math.sin(x) / cosine) / DEG;
    const mask = horizon.effectiveAt(azimuthDeg + azimuthOffset);
    const visibleLower = Math.max(-halfChord, (mask - elevationDeg) * DEG);
    visibleArea += Math.max(0, halfChord - visibleLower);
  }
  const f = (visibleArea * ((2 * r) / chords)) / (Math.PI * r * r);
  return Math.min(1, Math.max(0, f));
}

export interface Availability {
  fraction: number;
  clearanceDeg: number;
  visible: boolean;
}

/**
 * R3 state predicate for a disk-fraction threshold (Python twin: reference/bounds.py `disk_fraction_visible`): a 0 threshold means "any part of the disk",
 * so a fully hidden disk (fraction 0) is NOT visible; every other threshold is "at least that fraction". The app's sliders start at 10%, so 0 is only reachable by the
 * 0 / 50 / 100% event specs, but the rule lives here so every caller agrees.
 */
export function diskFractionVisible(fraction: number, threshold: number): boolean {
  return threshold === 0 ? fraction > 0 : fraction >= threshold;
}

export interface AvailabilityOptions {
  diskThreshold: number;
  marginDeg?: number;
  minSunElevationOpsDeg?: number;
}

/** "Available" per the Definitions: disk >= threshold AND clearance >= margin (AND, for the Sun, elevation >= ops minimum). */
export function availability(
  body: BodyId,
  elevationDeg: number,
  azimuthDeg: number,
  distanceKm: number,
  horizon: Horizon,
  opts: AvailabilityOptions,
): Availability {
  const fraction = diskFraction(body, elevationDeg, azimuthDeg, distanceKm, horizon);
  const clearanceDeg = elevationDeg - horizon.effectiveAt(azimuthDeg);
  let visible = diskFractionVisible(fraction, opts.diskThreshold) && clearanceDeg >= (opts.marginDeg ?? 0);
  if (body === 'sun') visible = visible && elevationDeg >= (opts.minSunElevationOpsDeg ?? 0);
  return { fraction, clearanceDeg, visible };
}
