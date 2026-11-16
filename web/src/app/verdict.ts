// Owner: Abhinav
// Verdict chip state (pure): tone map, engine result → chip, URL forcing for UI tests.
import type { ScenarioResult, Verdict } from '../engine/types';
import type { BadgeTone } from '../ui/Badge';

export interface ChipState {
  verdict: Verdict;
  provisional: boolean;
}

export const VERDICT_TONE: Record<Verdict, BadgeTone> = {
  GO: 'go',
  MARGINAL: 'marginal',
  'NO-GO': 'nogo',
  PENDING: 'pending',
};

const VERDICTS = Object.keys(VERDICT_TONE) as Verdict[];

/** `?verdict=GO|MARGINAL|NO-GO|PENDING` and `&provisional=1` force the chip (UI testing; mirrors `?answerState=`). */
export function forcedChipFromUrl(search = typeof location === 'undefined' ? '' : location.search): ChipState | null {
  const q = new URLSearchParams(search);
  const v = q.get('verdict')?.toUpperCase() as Verdict | undefined;
  if (!v || !VERDICTS.includes(v)) return null;
  return { verdict: v, provisional: q.get('provisional') === '1' };
}

/**
 * Chip state from the engine result. While a recompute is in flight the last settled verdict stays visible,
 * labelled provisional (never a blank or a flash to PENDING). First load with nothing settled → PENDING.
 */
export function chipFromResult(r: Pick<ScenarioResult, 'status' | 'verdict'>, lastSettled: Verdict | null): ChipState {
  if (r.status === 'loading' && lastSettled && lastSettled !== 'PENDING')
    return { verdict: lastSettled, provisional: true };
  return { verdict: r.verdict, provisional: false };
}
