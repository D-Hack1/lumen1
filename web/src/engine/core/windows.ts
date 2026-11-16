// Owner: Nived
// Run-length encoding of visibility windows (Python twin: reference/windows.py). A true run is
// [first true sample, first false sample); a run that touches either end of the range is flagged partial.
import type { WindowRecord, WindowType } from '../types';

export interface RawWindow {
  type: WindowType;
  startMs: number;
  endMs: number;
  peakElevationDeg: number;
  partialStart: boolean;
  partialEnd: boolean;
}

export function mergeWindows(type: WindowType, times: ArrayLike<number>, visible: ArrayLike<boolean>, elevationsDeg: ArrayLike<number>): RawWindow[] {
  if (times.length !== visible.length || times.length !== elevationsDeg.length || times.length < 2) {
    throw new RangeError('times, visibility, and elevations must have matching length >= 2');
  }
  const out: RawWindow[] = [];
  let start: number | null = null;
  for (let i = 0; i < visible.length; i++) {
    if (visible[i] && start === null) start = i;
    if (start !== null && (!visible[i] || i === visible.length - 1)) {
      const stop = i;
      if (stop > start) {
        let peak = -Infinity;
        for (let k = start; k <= stop; k++) peak = Math.max(peak, elevationsDeg[k]);
        out.push({ type, startMs: times[start], endMs: times[stop], peakElevationDeg: peak, partialStart: start === 0, partialEnd: stop === visible.length - 1 });
      }
      start = null;
    }
  }
  return out;
}

export const windowHours = (w: RawWindow): number => (w.endMs - w.startMs) / 3_600_000;

/** Convert to the public `WindowRecord` (± and [lo-hi] stay null until the uncertainty passes exist). */
export function toWindowRecord(w: RawWindow): WindowRecord {
  const h = windowHours(w);
  return {
    type: w.type, start: w.startMs, end: w.endMs, startPmMs: null, endPmMs: null,
    durationH: { value: h, lo: null, hi: null }, peakElevDeg: w.peakElevationDeg,
    flags: { grazing: false, partialStart: w.partialStart, partialEnd: w.partialEnd },
  };
}

/** Total duration (ms) of disjoint refined visibility windows. */
export const windowDurationMs = (windows: readonly RawWindow[]): number => windows.reduce((a, w) => a + (w.endMs - w.startMs), 0);

/** Percentage of a scenario range covered by refined windows. */
export function windowPercentage(startMs: number, endMs: number, windows: readonly RawWindow[]): number {
  if (!(startMs < endMs)) throw new RangeError('metric range must have positive duration');
  return (100 * windowDurationMs(windows)) / (endMs - startMs);
}

/** Longest unavailable gap (hours) around ordered refined windows, including before the first and after the last. */
export function longestWindowGapHours(startMs: number, endMs: number, windows: readonly RawWindow[]): number {
  if (!(startMs < endMs)) throw new RangeError('metric range must have positive duration');
  let latest = startMs;
  let longest = 0;
  for (const w of windows) {
    longest = Math.max(longest, w.startMs - latest);
    latest = w.endMs;
  }
  return Math.max(longest, endMs - latest) / 3_600_000;
}

/**
 * Half-open visible windows from refined transition events (Python twin: `windows_from_events`). `events` must be chronological, within the range and use only
 * the down/up labels; the caller owns the predicate (sun, earth, link or ops) and supplies the matching peak elevation.
 */
export function windowsFromEvents(
  type: WindowType,
  startMs: number,
  endMs: number,
  initiallyVisible: boolean,
  events: ReadonlyArray<{ type: string; t: number }>,
  o: { downEvent: string; upEvent: string; peakElevationDeg: (startMs: number, endMs: number) => number },
): RawWindow[] {
  if (!(startMs < endMs)) throw new RangeError('window range must have positive duration');
  let visible = initiallyVisible;
  let windowStart: number | null = visible ? startMs : null;
  let windowPartialStart = initiallyVisible;
  const windows: RawWindow[] = [];
  let previous = startMs;
  const close = (end: number, partialEnd: boolean) => {
    if (windowStart === null || end <= windowStart) return;
    const peak = o.peakElevationDeg(windowStart, end);
    if (!Number.isFinite(peak)) throw new RangeError('peakElevationDeg must return a finite value');
    windows.push({ type, startMs: windowStart, endMs: end, peakElevationDeg: peak, partialStart: windowPartialStart, partialEnd });
    windowStart = null;
  };
  for (const e of events) {
    if (e.type !== o.downEvent && e.type !== o.upEvent) throw new RangeError(`unexpected ${type} event type: ${e.type}`);
    if (!(startMs <= e.t && e.t <= endMs) || e.t < previous) throw new RangeError('events must be chronological and within the window range');
    previous = e.t;
    if (e.type === o.downEvent) {
      if (!visible) throw new RangeError(`${o.downEvent} cannot follow an invisible state`);
      close(e.t, false);
      visible = false;
    } else {
      if (visible) throw new RangeError(`${o.upEvent} cannot follow a visible state`);
      windowStart = e.t;
      windowPartialStart = false;
      visible = true;
    }
  }
  if (visible) close(endMs, true);
  return windows;
}
