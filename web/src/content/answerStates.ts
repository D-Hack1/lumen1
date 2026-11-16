// Owner: Abhinav
// Index of the 9 Answer Strip states in R3 delta D-14 → the copy keys each one shows. The strings live in
// personaCopy.ts (Planner + Educator); this file only says which keys belong to which state, so a test can prove
// that every state is complete in both personas. Ids match Nived's FORCED_ANSWER_STATES (src/mocks/forced.ts).
// `grazing` is a modifier rather than a cell enum: any next event may be grazing, so it adds keys to the base text.
import type { EarthCellState, SunCellState } from '../engine/types';

export type AnswerStateId = SunCellState | EarthCellState | 'grazing';

export interface AnswerStateCopy {
  cell: 'sun' | 'earth' | 'both';
  /** Cell label key(s) shown above the value. */
  label: string[];
  /** Value template key(s), filled with {t} / {n} / {deg}. */
  text: string[];
}

export const ANSWER_STATE_COPY: Record<AnswerStateId, AnswerStateCopy> = {
  sunsetIn: { cell: 'sun', label: ['answer.label.sunsetIn'], text: ['answer.sun.sunsetIn'] },
  sunriseIn: { cell: 'sun', label: ['answer.label.sunriseIn'], text: ['answer.sun.sunriseIn', 'answer.sun.darkFor'] },
  noSunriseBeforeEnd: {
    cell: 'sun',
    label: ['answer.label.noSunriseBeforeEnd'],
    text: ['answer.sun.noSunriseBeforeEnd', 'answer.sun.darkFor'],
  },
  staysUpPastEnd: { cell: 'sun', label: ['answer.label.staysUpPastEnd'], text: ['answer.sun.staysUpPastEnd'] },
  earthsetIn: { cell: 'earth', label: ['answer.label.earthsetIn'], text: ['answer.earth.earthsetIn'] },
  earthriseIn: { cell: 'earth', label: ['answer.label.earthriseIn'], text: ['answer.earth.earthriseIn'] },
  linkResumesDsn: { cell: 'earth', label: ['answer.label.linkResumesDsn'], text: ['answer.earth.linkResumes'] },
  grazing: { cell: 'both', label: [], text: ['answer.grazing', 'answer.grazingFull'] },
  belowOpsElevation: {
    cell: 'sun',
    label: ['answer.label.belowOpsElevation'],
    text: ['answer.sun.belowOps', 'answer.sun.belowOpsNoResume'],
  },
};

/** Shared Answer Strip keys shown in every state (now cells, window cells, Tier C note). */
export const ANSWER_COMMON_KEYS = [
  'answer.sunNow',
  'answer.earthNow',
  'answer.up',
  'answer.down',
  'answer.disk',
  'answer.linkOk',
  'answer.linkDown',
  'answer.windowSunlit',
  'answer.windowLink',
  'answer.earth.noChange',
  'answer.smoothMoon',
] as const;

export const ANSWER_STATE_IDS = Object.keys(ANSWER_STATE_COPY) as AnswerStateId[];
