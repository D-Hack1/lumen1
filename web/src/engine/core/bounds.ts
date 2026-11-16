// Owner: Nived
// Three-pass bounds and event uncertainty for one scenario (R3 delta D-8). Wraps `evaluate()` (core/evaluate.ts):
//   * evaluate on the -sigma, nominal and +sigma terrain masks (the near-zone plane is NOT shifted) -> [lo, nominal, hi] for
//     sunlit %, link % (Earth visible) and longest night;
//   * annotate every nominal event with BOTH uncertainties: exact (re-solved on the shifted masks) and fast (sigma / |total dC/dt|).
// Tier C (smooth horizon, no mask) has no terrain error to propagate: hasBounds = false, bounds are null, events stay un-annotated.
//
// Pairing rule (her Python leaves it to the caller): a shifted-pass event is "the same event" as a nominal one if it is the NEAREST event
// of the same type within `pairWindowSeconds` (default 36 h, i.e. 3x the 12 h grazing limit so a wide shift is still seen as
// dt_limit instead of "vanished"); with none in range the event vanished in that pass.
import type { Bounded, EventRecord } from '../types';
import { evaluate, type Evaluation, type EvaluateInput } from './evaluate';
import { bodyAt } from './geometry';
import { annotateEvent, exactEventUncertainty, fastUncertaintyForEvent, numericBounds, threePassBounds, type GeometryAt } from './uncertainty';

export interface BoundsOptions {
  /** Per-bin mask sigma in degrees (array matching the mask) or a scalar. */
  sigmaDeg: number | ArrayLike<number>;
  /** sigma at an azimuth, for the fast path (the same field sampled per event). */
  sigmaAtAzimuthDeg: (azimuthDeg: number) => number;
  pairWindowSeconds?: number;
}

export interface MetricBounds {
  sunlitPct: Bounded;
  earthVisiblePct: Bounded;
  /** Link % (Earth visible AND, when the DSN rule applies, a complex above the mask); equals Earth-visible % without DSN. */
  linkPct: Bounded;
  longestNightH: Bounded;
  longestCommGapH: Bounded;
  opsHours: Bounded;
}

export interface BoundedEvaluation {
  hasBounds: boolean;
  nominal: Evaluation;
  lower: Evaluation;
  upper: Evaluation;
  metrics: MetricBounds;
  /** Nominal events annotated with the EXACT delta t (re-solved on the shifted masks): used for the current scenario. */
  sunEvents: EventRecord[];
  earthEvents: EventRecord[];
  /** Nominal events annotated with the FAST delta t: used where speed matters (Scan stage 1, Quick Answer). */
  fastSunEvents: EventRecord[];
  fastEarthEvents: EventRecord[];
}

export const DEFAULT_PAIR_WINDOW_SECONDS = 36 * 3600;

function pairEvent(nominal: EventRecord, shifted: EventRecord[], windowMs: number): EventRecord | null {
  let best: EventRecord | null = null;
  for (const e of shifted) {
    if (e.type !== nominal.type || Math.abs(e.t - nominal.t) > windowMs) continue;
    if (best === null || Math.abs(e.t - nominal.t) < Math.abs(best.t - nominal.t)) best = e;
  }
  return best;
}

const bounded = (lo: number, nominal: number, hi: number): Bounded => ({ value: nominal, lo, hi });
const unbounded = (nominal: number | null): Bounded => ({ value: nominal, lo: null, hi: null });

export function evaluateWithBounds(input: EvaluateInput, opts: BoundsOptions): BoundedEvaluation {
  const horizon = input.horizon;
  if (horizon.elevationsDeg == null) {
    const nominal = evaluate(input);
    return {
      hasBounds: false, nominal, lower: nominal, upper: nominal,
      metrics: {
        sunlitPct: unbounded(nominal.refined.metrics.sunlitPct), earthVisiblePct: unbounded(nominal.refined.metrics.earthVisiblePct), linkPct: unbounded(nominal.refined.metrics.linkPct),
        longestNightH: unbounded(nominal.refined.metrics.longestNightH), longestCommGapH: unbounded(nominal.refined.metrics.longestCommGapH), opsHours: unbounded(nominal.refined.metrics.opsHours),
      },
      sunEvents: nominal.sunEvents, earthEvents: nominal.earthEvents, fastSunEvents: nominal.sunEvents, fastEarthEvents: nominal.earthEvents,
    };
  }

  const passes = threePassBounds(horizon, opts.sigmaDeg, (h) => evaluate({ ...input, horizon: h }));
  const { lowerMask: lower, nominal, upperMask: upper } = passes;
  const metric = (pick: (e: Evaluation) => number | null): Bounded => {
    const [lo, nom, hi] = numericBounds({ lowerMask: pick(lower) as number, nominal: pick(nominal) as number, upperMask: pick(upper) as number });
    return bounded(lo, nom, hi);
  };
  const windowMs = (opts.pairWindowSeconds ?? DEFAULT_PAIR_WINDOW_SECONDS) * 1000;

  const exact = (events: EventRecord[], lo: EventRecord[], hi: EventRecord[]) =>
    events.map((e) => annotateEvent(e, exactEventUncertainty(e, pairEvent(e, lo, windowMs), pairEvent(e, hi, windowMs))));

  // The fast path assumes a 50% disk event with no ops-elevation requirement (the event is a terrain-clearance crossing). Otherwise it
  // is left un-annotated rather than reporting a number that does not apply; the exact path has no such restriction.
  const d = input.definitions ?? { sunDiskThreshold: 0.5, earthDiskThreshold: 0.5, earthMarginDeg: 1, minSunElevationOpsDeg: 0 };
  const fastApplies = d.sunDiskThreshold === 0.5 && d.earthDiskThreshold === 0.5 && d.minSunElevationOpsDeg === 0;
  const geometry = (body: 'sun' | 'earth'): GeometryAt => (tMs) => {
    const g = bodyAt(input.eph, body, tMs, input.site);
    return { elevationDeg: g.elevationDeg, azimuthDeg: g.azimuthDeg };
  };
  const fast = (events: EventRecord[], body: 'sun' | 'earth') =>
    fastApplies ? events.map((e) => annotateEvent(e, fastUncertaintyForEvent(e, geometry(body), horizon, opts.sigmaAtAzimuthDeg, { diskFraction: 0.5, angularRadiusDeg: 0 }))) : events;

  return {
    hasBounds: true, nominal, lower, upper,
    // canonical method: refined-window durations (Gowri, G-10 final)
    metrics: {
      sunlitPct: metric((e) => e.refined.metrics.sunlitPct), earthVisiblePct: metric((e) => e.refined.metrics.earthVisiblePct), linkPct: metric((e) => e.refined.metrics.linkPct),
      longestNightH: metric((e) => e.refined.metrics.longestNightH), longestCommGapH: metric((e) => e.refined.metrics.longestCommGapH), opsHours: metric((e) => e.refined.metrics.opsHours),
    },
    sunEvents: exact(nominal.sunEvents, lower.sunEvents, upper.sunEvents),
    earthEvents: exact(nominal.earthEvents, lower.earthEvents, upper.earthEvents),
    fastSunEvents: fast(nominal.sunEvents, 'sun'),
    fastEarthEvents: fast(nominal.earthEvents, 'earth'),
  };
}
