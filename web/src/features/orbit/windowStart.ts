// The date the pages' windows start from (t = 0). Default 2027-02-08 00:00 UTC, the design's epoch; the user can pick any whole UTC day the
// published ephemeris covers (2023-01-01 … 2030-12-31) with room for the longest window (30 days + a 27-day slip). A tiny external store so the
// engine bindings, the charts and the labels all read ONE value at call time, and the app can remount its pages when it changes.
import { useSyncExternalStore } from 'react';

const DAY_MS = 86_400_000;
export const DEFAULT_START_UTC = Date.UTC(2027, 1, 8);
/** Ephemeris coverage is 2023-01-01 … 2030-12-31; leave a day of margin at the start and 60 days for the longest window at the end. */
export const MIN_START_UTC = Date.UTC(2023, 0, 2);
export const MAX_START_UTC = Date.UTC(2030, 9, 31);

let start = DEFAULT_START_UTC;
const listeners = new Set<() => void>();

/** Midnight UTC of the window start, in ms. */
export const getBaseUtc = (): number => start;

export const clampStart = (ms: number): number => Math.max(MIN_START_UTC, Math.min(MAX_START_UTC, Math.floor(ms / DAY_MS) * DAY_MS));

export function setWindowStart(ms: number): void {
  if (!Number.isFinite(ms)) return;
  const next = clampStart(ms);
  if (next === start) return;
  start = next;
  listeners.forEach((l) => l());
}

export function useWindowStart(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => start,
    () => start,
  );
}

/** 'YYYY-MM-DD' (the value an <input type="date"> uses). */
export const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** '8 Feb 2027', in UTC. */
export function longDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Parse 'YYYY-MM-DD' to midnight UTC; NaN when it is not a date. */
export const parseIsoDate = (s: string): number => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T00:00:00Z`) : NaN);
