// Owner: Nived
// Deterministic event detection: a 2-minute grid, then bisection to ~10 s at every state change
// (Python twin: reference/events.py). The coarse 60-minute step with the R3 envelope guard (D-6) is NOT used yet:
// like the Python it needs the mask-extrema proof, so until then everything runs on the safe fine grid.
import type { EventRecord, EventType } from '../types';

export const FINE_STEP_MS = 120_000;
export const BISECTION_TOLERANCE_MS = 10_000;

/** start, start + 120 s, ... and always `end` as the last sample (epoch ms). */
export function sampleTimes(startMs: number, endMs: number): number[] {
  if (!(endMs > startMs)) throw new RangeError('event range must have positive duration');
  const count = Math.floor((endMs - startMs) / FINE_STEP_MS);
  const times: number[] = [];
  for (let i = 0; i <= count; i++) times.push(startMs + i * FINE_STEP_MS);
  if (times[times.length - 1] !== endMs) times.push(endMs);
  return times;
}

/** Bisect a bracket [left, right] that contains exactly one predicate change. Returns the midpoint AND the final (<= 10 s) bracket. */
export function refineTransitionBracket(predicate: (tMs: number) => boolean, left: number, right: number): { t: number; left: number; right: number } {
  const leftValue = predicate(left);
  if (leftValue === predicate(right)) throw new Error('bisection bracket does not contain a transition');
  while (right - left > BISECTION_TOLERANCE_MS) {
    const middle = (left + right) / 2;
    if (predicate(middle) === leftValue) left = middle;
    else right = middle;
  }
  return { t: (left + right) / 2, left, right };
}

/** Bisect to the midpoint of the final bracket (Python twin: `_refine_transition`). */
export function refineTransition(predicate: (tMs: number) => boolean, left: number, right: number): number {
  return refineTransitionBracket(predicate, left, right).t;
}

/** A refined state change with its final bisection bracket, with a free-form label (sun/earth events, DSN link, ops...). */
export interface Transition {
  type: string;
  t: number;
  bracketStartMs: number;
  bracketEndMs: number;
}

/** Transitions at every false->true (`up`) and true->false (`down`) change; `sampled` may carry already-evaluated grid values to avoid re-sampling. */
export function detectTransitions(
  startMs: number,
  endMs: number,
  predicate: (tMs: number) => boolean,
  down: string,
  up: string,
  sampled?: { times: number[]; values: boolean[] },
): Transition[] {
  const times = sampled?.times ?? sampleTimes(startMs, endMs);
  const values = sampled?.values ?? times.map(predicate);
  const out: Transition[] = [];
  for (let i = 0; i < times.length - 1; i++) {
    if (values[i] !== values[i + 1]) {
      const r = refineTransitionBracket(predicate, times[i], times[i + 1]);
      out.push({ type: values[i + 1] ? up : down, t: r.t, bracketStartMs: r.left, bracketEndMs: r.right });
    }
  }
  return out;
}

/** Events at every false->true (`up`) and true->false (`down`) change; `values` may be passed to avoid re-sampling. */
export function detectEvents(
  startMs: number,
  endMs: number,
  predicate: (tMs: number) => boolean,
  kinds: { down: EventType; up: EventType },
  sampled?: { times: number[]; values: boolean[] },
): EventRecord[] {
  return detectTransitions(startMs, endMs, predicate, kinds.down, kinds.up, sampled).map((x) => ({
    type: x.type as EventType,
    t: x.t,
    dtMs: null, // +/- is added by annotateEvent (core/uncertainty.ts) when sigma is available; null = not computed
    grazing: false,
    grazingReason: null,
    dtMethod: 'fast' as const,
    bracketStartMs: x.bracketStartMs, // kept: the one-sided clearance rate picks its side from the bracket (R3 D-8)
    bracketEndMs: x.bracketEndMs,
  }));
}
