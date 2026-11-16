// Owner: Nived
// Event-time uncertainty and three-pass bounds (R3 delta D-8). TypeScript twin of pipeline/lumen_pipeline/reference/uncertainty.py:
// same function names (camelCase), same branching, same constants. Times are epoch ms here (ET seconds in the Python); the
// public result keeps `deltaTSeconds` in seconds like the Python's `delta_t_seconds`.
//
//   C(t)     = el(t) - m_eff(az(t)) + limb offset                 (clearance; limb: 0% -> +r, 50% -> 0, 100% -> -r)
//   dC/dt    = d el/dt - (d m_eff/d az) * d az/dt                  (TOTAL rate; a central +-2 min difference of C, one-sided when
//                                                                  the stencil crosses a mask-bin boundary)
//   fast     : delta t = sigma(az_event) / |dC/dt|                 (grazing: |dC/dt| < 0.005 deg/h, or delta t > 12 h)
//   exact    : delta t = half the spread of the event time on the -sigma / nominal / +sigma masks (vanishing event => "vanishes")
import type { EventRecord, GrazingReason } from '../types';
import type { Horizon } from './visibility';

export const RATE_INTERVAL_SECONDS = 120;
export const GRAZING_RATE_DEG_PER_HOUR = 0.005;
export const GRAZING_DT_SECONDS = 12 * 3600;

/** elevation and azimuth (deg) of the body at an instant (epoch ms). */
export type GeometryAt = (tMs: number) => { elevationDeg: number; azimuthDeg: number };

export interface EventUncertainty {
  /** Half-width in seconds. `null` when the event vanishes in a shifted pass; `Infinity` for a zero rate (fast path). */
  deltaTSeconds: number | null;
  clearanceRateDegPerHour: number | null;
  dtMethod: 'fast' | 'exact';
  grazingReason: GrazingReason;
}

export interface ThreePassBounds<T> {
  lowerMask: T;
  nominal: T;
  upperMask: T;
}

const MS = 1000;

/** Clearance offset for a 0, 50 or 100 percent disk event (R3). */
export function limbOffsetDeg(diskFraction: number, angularRadiusDeg: number): number {
  if (!Number.isFinite(angularRadiusDeg) || angularRadiusDeg < 0) throw new RangeError('angularRadiusDeg must be finite and non-negative');
  if (diskFraction === 0) return angularRadiusDeg;
  if (diskFraction === 0.5) return 0;
  if (diskFraction === 1) return -angularRadiusDeg;
  throw new RangeError('diskFraction event must be exactly 0.0, 0.5, or 1.0');
}

/** C(t): elevation minus the effective mask, plus a selected limb offset. */
export function clearanceDeg(tMs: number, geometryAt: GeometryAt, horizon: Horizon, limbOffset = 0): number {
  const { elevationDeg, azimuthDeg } = geometryAt(tMs);
  return elevationDeg - horizon.effectiveAt(azimuthDeg) + limbOffset;
}

/** The terrain-mask bin an azimuth falls in (bin i is centred at (i + 0.5) * width), or null for a smooth horizon. */
function maskBin(azimuthDeg: number, horizon: Horizon): number | null {
  const v = horizon.elevationsDeg;
  if (v == null) return null;
  const n = v.length;
  const mod = ((azimuthDeg % 360) + 360) % 360;
  const floor = Math.floor(mod / horizon.binWidthDeg - 0.5);
  return ((floor % n) + n) % n;
}

export interface RateOptions {
  limbOffsetDeg?: number;
  /** The detector's final bisection bracket [left, right] (epoch ms); it must contain the event. */
  bracketingInterval?: [number, number] | null;
}

/** Total dC/dt in deg/h from a +-2 min mask-aware difference; one-sided when the stencil crosses a mask-bin boundary. */
export function totalClearanceRateDegPerHour(eventMs: number, geometryAt: GeometryAt, horizon: Horizon, opts: RateOptions = {}): number {
  const limb = opts.limbOffsetDeg ?? 0;
  const bracket = opts.bracketingInterval ?? null;
  if (bracket) {
    const [left, right] = bracket;
    if (left > eventMs || right < eventMs || right <= left) throw new RangeError('bracketingInterval must be ordered and contain eventMs');
  }
  const beforeMs = eventMs - RATE_INTERVAL_SECONDS * MS;
  const afterMs = eventMs + RATE_INTERVAL_SECONDS * MS;
  const eventAz = geometryAt(eventMs).azimuthDeg;
  const beforeAz = geometryAt(beforeMs).azimuthDeg;
  const afterAz = geometryAt(afterMs).azimuthDeg;
  const before = clearanceDeg(beforeMs, geometryAt, horizon, limb);
  const event = clearanceDeg(eventMs, geometryAt, horizon, limb);
  const after = clearanceDeg(afterMs, geometryAt, horizon, limb);

  const b0 = maskBin(beforeAz, horizon);
  const b1 = maskBin(eventAz, horizon);
  const b2 = maskBin(afterAz, horizon);
  let perSecond: number;
  if (b0 === b1 && b1 === b2) {
    perSecond = (after - before) / (2 * RATE_INTERVAL_SECONDS);
  } else {
    // Stay on the event's own mask-bin side of the crossed boundary: a boundary before the event needs the post-event stencil,
    // one after it needs the pre-event stencil.
    let useBefore: boolean;
    if (b0 !== b1 && b1 === b2) useBefore = false;
    else if (b0 === b1 && b1 !== b2) useBefore = true;
    else if (bracket) {
      const bracketBins = new Set([maskBin(geometryAt(bracket[0]).azimuthDeg, horizon), maskBin(geometryAt(bracket[1]).azimuthDeg, horizon)]);
      useBefore = bracketBins.has(b0) && !bracketBins.has(b2);
    } else useBefore = b0 === b1;
    perSecond = useBefore ? (event - before) / RATE_INTERVAL_SECONDS : (after - event) / RATE_INTERVAL_SECONDS;
  }
  return perSecond * 3600;
}

export interface FastOptions extends RateOptions {
  diskFraction?: number;
  angularRadiusDeg?: number;
}

/** Fast path: delta t = sigma / |total clearance rate|, with grazing detection. */
export function fastEventUncertainty(eventMs: number, geometryAt: GeometryAt, horizon: Horizon, sigmaAtAzimuthDeg: (azimuthDeg: number) => number, opts: FastOptions = {}): EventUncertainty {
  const sigma = sigmaAtAzimuthDeg(geometryAt(eventMs).azimuthDeg);
  if (!Number.isFinite(sigma) || sigma < 0) throw new RangeError('sigmaAtAzimuthDeg must return a finite non-negative value');
  const rate = totalClearanceRateDegPerHour(eventMs, geometryAt, horizon, {
    limbOffsetDeg: limbOffsetDeg(opts.diskFraction ?? 0.5, opts.angularRadiusDeg ?? 0),
    bracketingInterval: opts.bracketingInterval ?? null,
  });
  const deltaTSeconds = rate === 0 ? Infinity : (sigma / Math.abs(rate)) * 3600;
  let grazingReason: GrazingReason = Math.abs(rate) < GRAZING_RATE_DEG_PER_HOUR ? 'rate' : null;
  if (grazingReason === null && deltaTSeconds > GRAZING_DT_SECONDS) grazingReason = 'dt_limit';
  return { deltaTSeconds, clearanceRateDegPerHour: rate, dtMethod: 'fast', grazingReason };
}

/** Fast uncertainty for a detected event, using the bracket the detector retained. */
export function fastUncertaintyForEvent(event: EventRecord, geometryAt: GeometryAt, horizon: Horizon, sigmaAtAzimuthDeg: (azimuthDeg: number) => number, opts: Omit<FastOptions, 'bracketingInterval'> = {}): EventUncertainty {
  const bracket: [number, number] | null = event.bracketStartMs != null && event.bracketEndMs != null ? [event.bracketStartMs, event.bracketEndMs] : null;
  return fastEventUncertainty(event.t, geometryAt, horizon, sigmaAtAzimuthDeg, { ...opts, bracketingInterval: bracket });
}

/** The horizon with its terrain mask shifted by direction * sigma. Near-zone geometry is preserved (R3: the plane is not shifted). */
export function shiftHorizonMask(horizon: Horizon, sigmaDeg: number | ArrayLike<number>, direction: 1 | -1): Horizon {
  const mask = horizon.elevationsDeg;
  if (mask == null) throw new Error('Tier-C smooth horizons have no terrain mask to shift');
  if (direction !== 1 && direction !== -1) throw new RangeError('direction must be -1 or 1');
  const isScalar = typeof sigmaDeg === 'number';
  if (!isScalar && (sigmaDeg as ArrayLike<number>).length !== mask.length) throw new RangeError('sigmaDeg must be scalar or match the horizon mask shape');
  const sigmaAt = (i: number): number => (isScalar ? (sigmaDeg as number) : (sigmaDeg as ArrayLike<number>)[i]);
  const out = new Float64Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    const s = sigmaAt(i);
    if (!Number.isFinite(s) || s < 0) throw new RangeError('sigmaDeg must be finite and non-negative');
    out[i] = mask[i] + direction * s;
  }
  return horizon.withElevations(out);
}

/** Evaluate any metric/window result on the -sigma, nominal and +sigma masks (R3 three-pass bounds). */
export function threePassBounds<T>(horizon: Horizon, sigmaDeg: number | ArrayLike<number>, evaluate: (h: Horizon) => T): ThreePassBounds<T> {
  return { lowerMask: evaluate(shiftHorizonMask(horizon, sigmaDeg, -1)), nominal: evaluate(horizon), upperMask: evaluate(shiftHorizonMask(horizon, sigmaDeg, 1)) };
}

/** [low, nominal, high] of a scalar three-pass result. */
export function numericBounds(p: ThreePassBounds<number>): [number, number, number] {
  return [Math.min(p.lowerMask, p.nominal, p.upperMask), p.nominal, Math.max(p.lowerMask, p.nominal, p.upperMask)];
}

/** Exact path: half the spread of the three event times. A shifted pass in which the event disappears => "vanishes". */
/** Anything with a time (epoch ms): an EventRecord or a generic transition event. */
export interface Timed {
  t: number;
}
/** The uncertainty fields an event carries. */
type Annotatable = Pick<EventRecord, 'dtMs' | 'dtMethod' | 'grazing' | 'grazingReason'>;

export function exactEventUncertainty(nominal: Timed, lowerMaskEvent: Timed | null, upperMaskEvent: Timed | null): EventUncertainty {
  if (lowerMaskEvent == null || upperMaskEvent == null) return { deltaTSeconds: null, clearanceRateDegPerHour: null, dtMethod: 'exact', grazingReason: 'vanishes' };
  const times = [lowerMaskEvent.t, nominal.t, upperMaskEvent.t];
  const deltaTSeconds = (Math.max(...times) - Math.min(...times)) / 2 / MS;
  return { deltaTSeconds, clearanceRateDegPerHour: null, dtMethod: 'exact', grazingReason: deltaTSeconds > GRAZING_DT_SECONDS ? 'dt_limit' : null };
}

/** Re-solve an event on the shifted masks (`resolveEvent` must use the same rules as the nominal solve; null = it vanished). */
export function exactEventUncertaintyFromMasks(nominal: EventRecord, horizon: Horizon, sigmaDeg: number | ArrayLike<number>, resolveEvent: (h: Horizon) => EventRecord | null): EventUncertainty {
  return exactEventUncertainty(nominal, resolveEvent(shiftHorizonMask(horizon, sigmaDeg, -1)), resolveEvent(shiftHorizonMask(horizon, sigmaDeg, 1)));
}

/** The event record with its uncertainty fields filled in (contract: dt_method, grazing_reason). A non-finite delta t has no +/-. */
export function annotateEvent<E extends Annotatable>(event: E, u: EventUncertainty): E {
  return {
    ...event,
    dtMs: u.deltaTSeconds != null && Number.isFinite(u.deltaTSeconds) ? u.deltaTSeconds * MS : null,
    dtMethod: u.dtMethod,
    grazing: u.grazingReason != null,
    grazingReason: u.grazingReason,
  };
}
