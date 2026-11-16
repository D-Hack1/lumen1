// Owner: Nived
// R3 three-pass SCENARIO bounds with refined, event-driven windows (Python twin: reference/bounds.py). Generic by design, as the Python: the caller supplies each
// visibility predicate (sun, earth, link, ops), its transition labels and peak elevation, and the policy that pairs a shifted-pass event with its nominal one
// (R3 defines none; `pairNearest` is the rule the engine uses). Metrics come from the refined windows, not from 2-minute samples, and every window gets
// independent [lo, nominal, hi] ranges for its start, end and duration.
import type { Bounded, EventRecord, WindowType } from '../types';
import { detectTransitions as detectLabelled } from './events';
import { annotateEvent, exactEventUncertainty, numericBounds, threePassBounds } from './uncertainty';
import type { Horizon } from './visibility';
import { longestWindowGapHours, windowDurationMs, windowPercentage, windowsFromEvents, type RawWindow } from './windows';

const H = 3_600_000;
export const WINDOW_TYPES: readonly WindowType[] = ['sun', 'earth', 'link', 'ops'];

/** A refined state change with its bisection bracket and, once annotated, its +- (the generic counterpart of EventRecord). */
export interface TransitionEvent extends Omit<EventRecord, 'type'> {
  type: string;
  bracketStartMs: number;
  bracketEndMs: number;
}

export interface WindowSpec {
  type: WindowType;
  downEvent: string;
  upEvent: string;
  visibleAt: (tMs: number, horizon: Horizon) => boolean;
  peakElevationDeg: (startMs: number, endMs: number, horizon: Horizon) => number;
}

export type EventPairer = (event: TransitionEvent, candidates: readonly TransitionEvent[]) => TransitionEvent | null;

/** The nearest event of the same type (within `windowMs` when given); null = the event vanished in that pass. */
export const pairNearest =
  (windowMs: number | null = null): EventPairer =>
  (event, candidates) => {
    let best: TransitionEvent | null = null;
    for (const c of candidates) {
      if (c.type !== event.type || (windowMs !== null && Math.abs(c.t - event.t) > windowMs)) continue;
      if (best === null || Math.abs(c.t - event.t) < Math.abs(best.t - event.t)) best = c;
    }
    return best;
  };

export interface BoundedWindow {
  nominal: RawWindow;
  /** Epoch ms; lo/hi null when an endpoint event vanished in a shifted pass. */
  start: Bounded;
  end: Bounded;
  durationH: Bounded;
}

export interface ScenarioPass {
  events: Record<string, TransitionEvent[]>;
  windows: Record<string, RawWindow[]>;
  metrics: Record<string, number | null>;
}

export interface ScenarioBounds {
  passes: { lower: ScenarioPass; nominal: ScenarioPass; upper: ScenarioPass };
  events: Record<string, TransitionEvent[]>;
  windows: Record<string, BoundedWindow[]>;
  metrics: { sunlitPct: Bounded; earthVisiblePct: Bounded; linkPct: Bounded; longestNightH: Bounded; longestCommGapH: Bounded; opsHours: Bounded };
  sunlitDurationHours: Bounded;
}

function detectTransitions(startMs: number, endMs: number, predicate: (t: number) => boolean, down: string, up: string): TransitionEvent[] {
  return detectLabelled(startMs, endMs, predicate, down, up).map((x) => ({ ...x, dtMs: null, grazing: false, grazingReason: null, dtMethod: 'fast' as const }));
}

function passMetrics(startMs: number, endMs: number, windows: Record<string, RawWindow[]>): Record<string, number | null> {
  const pct = (t: string) => (t in windows ? windowPercentage(startMs, endMs, windows[t]) : null);
  return {
    sunlitPct: pct('sun'),
    earthVisiblePct: pct('earth'),
    linkPct: pct('link'),
    longestNightH: 'sun' in windows ? longestWindowGapHours(startMs, endMs, windows.sun) : null,
    longestCommGapH: 'link' in windows ? longestWindowGapHours(startMs, endMs, windows.link) : null,
    opsHours: 'ops' in windows ? windowDurationMs(windows.ops) / H : null,
  };
}

function evaluatePass(startMs: number, endMs: number, horizon: Horizon, specs: readonly WindowSpec[]): ScenarioPass {
  const windows: Record<string, RawWindow[]> = {};
  const events: Record<string, TransitionEvent[]> = {};
  for (const spec of specs) {
    const predicate = (t: number) => spec.visibleAt(t, horizon);
    const transitions = detectTransitions(startMs, endMs, predicate, spec.downEvent, spec.upEvent);
    events[spec.type] = transitions;
    windows[spec.type] = windowsFromEvents(spec.type, startMs, endMs, predicate(startMs), transitions, {
      downEvent: spec.downEvent, upEvent: spec.upEvent, peakElevationDeg: (a, b) => spec.peakElevationDeg(a, b, horizon),
    });
  }
  return { events, windows, metrics: passMetrics(startMs, endMs, windows) };
}

/** [low, nominal, high] of three values, or the nominal alone (no range) when any pass has none. */
function bounded(lower: number | null, nominal: number | null, upper: number | null): Bounded {
  if (lower === null || nominal === null || upper === null) return { value: nominal, lo: null, hi: null };
  const [lo, value, hi] = numericBounds({ lowerMask: lower, nominal, upperMask: upper });
  return { value, lo, hi };
}

/** [lower, nominal, upper] times of an endpoint, or null when the event vanished in a shifted pass. */
function endpointTimes(event: TransitionEvent | null, lower: readonly TransitionEvent[], upper: readonly TransitionEvent[], pair: EventPairer, fixed: number | null): [number, number, number] | null {
  if (fixed !== null) return [fixed, fixed, fixed];
  if (event === null) throw new RangeError('non-partial window endpoint must have a refined transition event');
  const lo = pair(event, lower);
  const hi = pair(event, upper);
  return lo === null || hi === null ? null : [lo.t, event.t, hi.t];
}

function boundedWindows(spec: WindowSpec, startMs: number, endMs: number, lower: ScenarioPass, nominal: ScenarioPass, upper: ScenarioPass, pair: EventPairer): BoundedWindow[] {
  const lowerEvents = lower.events[spec.type];
  const nominalEvents = nominal.events[spec.type];
  const upperEvents = upper.events[spec.type];
  const eventAt = (type: string, t: number) => nominalEvents.find((e) => e.type === type && e.t === t) ?? null;
  return nominal.windows[spec.type].map((w) => {
    const s = endpointTimes(w.partialStart ? null : eventAt(spec.upEvent, w.startMs), lowerEvents, upperEvents, pair, w.partialStart ? startMs : null);
    const e = endpointTimes(w.partialEnd ? null : eventAt(spec.downEvent, w.endMs), lowerEvents, upperEvents, pair, w.partialEnd ? endMs : null);
    const dur = (w.endMs - w.startMs) / H;
    return {
      nominal: w,
      start: s === null ? { value: w.startMs, lo: null, hi: null } : bounded(...s),
      end: e === null ? { value: w.endMs, lo: null, hi: null } : bounded(...e),
      durationH: s !== null && e !== null ? bounded((e[0] - s[0]) / H, dur, (e[2] - s[2]) / H) : { value: dur, lo: null, hi: null },
    };
  });
}

/**
 * R3's correlated -sigma, nominal and +sigma passes (Python: `evaluate_with_bounds`). `pairEvent` pairs a shifted-pass event with its nominal event; it
 * must only pair events of the same predicate and transition type, and an unmatched event is reported as vanished.
 */
export function evaluateScenarioBounds(
  startMs: number,
  endMs: number,
  horizon: Horizon,
  sigmaDeg: number | ArrayLike<number>,
  specs: readonly WindowSpec[],
  o: { pairEvent: EventPairer },
): ScenarioBounds {
  if (!(startMs < endMs)) throw new RangeError('scenario range must have positive duration');
  const types = specs.map((s) => s.type);
  if (new Set(types).size !== types.length || types.some((t) => !WINDOW_TYPES.includes(t))) throw new RangeError('spec types must be unique members of sun, earth, link, ops');
  if (specs.length === 0) throw new RangeError('at least one window specification is required');

  const p = threePassBounds(horizon, sigmaDeg, (h) => evaluatePass(startMs, endMs, h, specs));
  const { lowerMask: lower, nominal, upperMask: upper } = p;
  const m = (k: string) => bounded(lower.metrics[k], nominal.metrics[k], upper.metrics[k]);
  const events: Record<string, TransitionEvent[]> = {};
  const windows: Record<string, BoundedWindow[]> = {};
  for (const spec of specs) {
    events[spec.type] = nominal.events[spec.type].map((e) => annotateEvent(e, exactEventUncertainty(e, o.pairEvent(e, lower.events[spec.type]), o.pairEvent(e, upper.events[spec.type]))));
    windows[spec.type] = boundedWindows(spec, startMs, endMs, lower, nominal, upper, o.pairEvent);
  }
  const sunH = (pass: ScenarioPass) => ('sun' in pass.windows ? windowDurationMs(pass.windows.sun) / H : null);
  return {
    passes: { lower, nominal, upper },
    events,
    windows,
    metrics: { sunlitPct: m('sunlitPct'), earthVisiblePct: m('earthVisiblePct'), linkPct: m('linkPct'), longestNightH: m('longestNightH'), longestCommGapH: m('longestCommGapH'), opsHours: m('opsHours') },
    sunlitDurationHours: bounded(sunH(lower), sunH(nominal), sunH(upper)),
  };
}
