// Owner: Nived
// Forced-state fixtures: deterministic engine states for UI work and the zero-scroll check (guide §5.1).
//   - FORCED_ANSWER_STATES: one AnswerState for each of the 9 D-14 Answer Strip states.
//   - WORST_CASE_*: the longest strings the engine-owned panels can show, so layout is tested at real budgets.
// Select one in the browser with `?answerState=<id>`; `?fixture=worst-case` uses the worst-case bundle.
import { deriveAnswerState, type AnswerFacts } from '../engine/answerState';
import type { AnswerState, EventRecord, MetricSet, ScanCandidate, Verdict } from '../engine/types';

const H = 3_600_000;
const D = 24 * H;
const T0 = Date.UTC(2025, 2, 6, 17, 28, 50);
const T = T0 + 2 * D;

const ev = (type: EventRecord['type'], dtH: number, afterH: number, grazing = false): EventRecord => ({
  type, t: T + afterH * H, dtMs: dtH * H, grazing, grazingReason: grazing ? 'rate' : null, dtMethod: 'fast',
});

const base: AnswerFacts = {
  tScrub: T, sunElevDeg: 1.24, sunDiskPct: 100, sunUp: true, opsMinElevDeg: null, sunNext: ev('sunset', 5, 41), darkSinceMs: null, opsResumeT: null,
  earthElevDeg: 5.2, earthVisible: true, linkUp: true, dsnAware: true, earthNext: ev('earthset', 6, 76), linkResumeT: null,
  windowSunlitPct: { value: 62, lo: 55, hi: 68 }, windowLinkPct: { value: 48, lo: 41, hi: 55 },
};
const dark: Partial<AnswerFacts> = { sunUp: false, sunElevDeg: -0.42, sunDiskPct: 0, darkSinceMs: T - 31 * H };

export const FORCED_ANSWER_STATES: Record<string, AnswerState> = {
  sunsetIn: deriveAnswerState(base),
  sunriseIn: deriveAnswerState({ ...base, ...dark, sunNext: ev('shadowExit', 2, 18) }),
  noSunriseBeforeEnd: deriveAnswerState({ ...base, ...dark, sunNext: null }),
  staysUpPastEnd: deriveAnswerState({ ...base, sunNext: null }),
  earthsetIn: deriveAnswerState({ ...base, earthNext: ev('earthset', 6, 76) }),
  earthriseIn: deriveAnswerState({ ...base, earthVisible: false, linkUp: false, earthElevDeg: -2.1, earthNext: ev('earthrise', 6, 122) }),
  linkResumesDsn: deriveAnswerState({ ...base, linkUp: false, linkResumeT: T + 2 * H }),
  grazing: deriveAnswerState({ ...base, sunNext: ev('sunset', 9, 21, true), earthNext: ev('earthset', 9, 40, true) }),
  belowOpsElevation: deriveAnswerState({ ...base, sunElevDeg: 4.8, opsMinElevDeg: 6, opsResumeT: T + 30 * H }),
};

/** `?answerState=grazing` (null when absent or unknown). Safe outside a browser. */
export function forcedAnswerFromUrl(): AnswerState | null {
  if (typeof location === 'undefined') return null;
  const id = new URLSearchParams(location.search).get('answerState');
  return id ? (FORCED_ANSWER_STATES[id] ?? null) : null;
}

// ---- worst case (guide §5.1): Educator copy, +60 d, grazing ranges, 30 Scan rows, 4 Compare rows ----

export const WORST_CASE_ANSWER: AnswerState = deriveAnswerState({
  ...base, ...dark, tScrub: T, sunNext: null,
  earthVisible: false, linkUp: false, earthElevDeg: -2.1, earthNext: ev('earthrise', 9, 40, true),
  windowSunlitPct: { value: 12, lo: 8, hi: 17 }, windowLinkPct: { value: 41, lo: 35, hi: 48 },
});

const b = (value: number, lo: number, hi: number) => ({ value, lo, hi });

export const WORST_CASE_METRICS: MetricSet = {
  sunElevationDeg: b(1.24, 1.06, 1.42), sunClearanceDeg: b(0.4, 0.3, 0.5), sunDiskPct: b(100, 96, 100),
  earthElevationDeg: b(-0.8, -0.9, -0.7), dteMarginDeg: b(-1.9, -2.1, -1.7),
  sunlitPct: b(62, 55, 68), linkPct: b(48, 41, 55), longestNightH: b(96, 80, 120), longestCommGapH: b(131, 118, 140),
  opsHours: b(210, 188, 231), energyPerDayWh: b(260, 220, 300), sunElevationAtTouchdownDeg: b(8.75, 8.5, 9),
  padSlopeDeg: b(9, 8, 10), psrDistanceKm: { km: 2.4, bearingDeg: 212, areaKm2: 0.6, source: 'derived' },
};

const LONG = 'Shackleton–de Gerlache connecting ridge · Artemis III candidate region “Nobile Rim 2” (as published 2024-10-28)';
export const WORST_CASE_SCAN: ScanCandidate[] = Array.from({ length: 30 }, (_, i) => {
  const verdict: Verdict = (['GO', 'MARGINAL', 'NO-GO'] as const)[i % 3];
  return {
    siteId: i % 2 ? LONG : 'Peak near Shackleton (Artemis III candidate)', landingUtc: T0 + (i - 15) * D, viabilityIndex: 90 - i,
    verdict, provisional: i >= 10, boundsStatus: i >= 10 ? 'nominal' : 'bounded',
    sunlitPct: b(60 - i, 55 - i, 66 - i), linkPct: b(80 - i, 74 - i, 85 - i), longestNightH: b(30 + i, 26 + i, 41 + i),
  };
});
