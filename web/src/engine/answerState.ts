// Owner: Nived
// Pure answer-state function (R3 delta D-14). Given plain facts at scrub time it returns which Answer Strip state
// applies. The UI maps the state ids to copy keys (Planner/Educator); this file never produces display text.
//
//   Sun:   sunsetIn · sunriseIn (+ "dark for X so far") · noSunriseBeforeEnd · staysUpPastEnd · belowOpsElevation
//   Earth: earthsetIn · earthriseIn · linkResumesDsn
//   Any next event may be grazing → the UI shows a range instead of ±.
import type { AnswerState, EarthCellState, EventRecord, SunCellState } from './types';

export interface AnswerFacts {
  tScrub: number;
  sunElevDeg: number;
  sunDiskPct: number;
  sunUp: boolean;
  /** Definitions.minSunElevationOps (0/null = off). */
  opsMinElevDeg: number | null;
  /** Next sunset if the Sun is available, next shadow exit if not (null = none before window end). */
  sunNext: EventRecord | null;
  /** When the current dark spell began (null if unknown or the Sun is up). */
  darkSinceMs: number | null;
  /** When the ops-elevation requirement is next met (only used in the below-ops state). */
  opsResumeT: number | null;
  earthElevDeg: number;
  earthVisible: boolean;
  linkUp: boolean;
  dsnAware: boolean;
  /** Next earthset if Earth is visible, next earthrise if not (null = none before window end). */
  earthNext: EventRecord | null;
  /** When the DSN-aware link next resumes (used when Earth is visible but the link is down). */
  linkResumeT: number | null;
  windowSunlitPct: AnswerState['windowSunlitPct'];
  windowLinkPct: AnswerState['windowLinkPct'];
}

export function sunCellState(f: AnswerFacts): SunCellState {
  if (f.opsMinElevDeg && f.opsMinElevDeg > 0 && f.sunUp && f.sunElevDeg < f.opsMinElevDeg) return 'belowOpsElevation';
  if (f.sunUp) return f.sunNext ? 'sunsetIn' : 'staysUpPastEnd';
  return f.sunNext ? 'sunriseIn' : 'noSunriseBeforeEnd';
}

export function earthCellState(f: AnswerFacts): EarthCellState {
  if (f.earthVisible && !f.linkUp && f.dsnAware) return 'linkResumesDsn';
  return f.earthVisible ? 'earthsetIn' : 'earthriseIn';
}

export function deriveAnswerState(f: AnswerFacts): AnswerState {
  const sunState = sunCellState(f);
  const earthState = earthCellState(f);
  const sunT = sunState === 'belowOpsElevation' ? f.opsResumeT : (f.sunNext?.t ?? null);
  const earthT = earthState === 'linkResumesDsn' ? f.linkResumeT : (f.earthNext?.t ?? null);
  return {
    tScrub: f.tScrub,
    sun: {
      elevDeg: f.sunElevDeg,
      diskPct: f.sunDiskPct,
      up: f.sunUp,
      state: sunState,
      nextEventT: sunT,
      nextEventPmMs: sunState === 'belowOpsElevation' ? null : (f.sunNext?.dtMs ?? null),
      grazing: sunState !== 'belowOpsElevation' && !!f.sunNext?.grazing,
      darkForMs: !f.sunUp && f.darkSinceMs != null ? Math.max(0, f.tScrub - f.darkSinceMs) : null,
      opsMinElevDeg: f.opsMinElevDeg && f.opsMinElevDeg > 0 ? f.opsMinElevDeg : null,
    },
    earth: {
      elevDeg: f.earthElevDeg,
      visible: f.earthVisible,
      linkUp: f.linkUp,
      state: earthState,
      nextEventT: earthT,
      nextEventPmMs: earthState === 'linkResumesDsn' ? null : (f.earthNext?.dtMs ?? null),
      grazing: earthState !== 'linkResumesDsn' && !!f.earthNext?.grazing,
    },
    windowSunlitPct: f.windowSunlitPct,
    windowLinkPct: f.windowLinkPct,
  };
}
