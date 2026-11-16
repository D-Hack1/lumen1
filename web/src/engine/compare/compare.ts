// Owner: Nived
// Compare view results (PLAN_FINAL 8.6): each scenario row (A..D) is one evaluation; deltas are against the baseline row.
// Pure and synchronous, so it runs in the worker or in tests. A row that cannot be evaluated (e.g. outside the ephemeris)
// becomes an error row; it never takes the other rows down with it.
import type { Ephemeris } from '../data/ephem';
import { buildScenarioResult, type ScenarioRequest } from '../core/buildResult';
import type { CompareResults, CompareRow, ScenarioResult } from '../types';
import { computeDeltas, DELTA_METRICS } from './delta';

export interface CompareRowInput {
  id: string;
  request: ScenarioRequest;
}

/** Deltas against the baseline, given already-evaluated rows (used by both the pure builder and the worker-backed store). */
export function assembleCompare(evaluated: Array<{ id: string; result: ScenarioResult }>, baselineId: string | null): CompareResults {
  if (evaluated.length === 0) return { status: 'idle', rows: [], baselineId: null };
  const baseline = evaluated.some((r) => r.id === baselineId) ? baselineId : null;
  const rows: CompareRow[] = evaluated.map((r) => ({ scenarioId: r.id, result: r.result, deltaVsBaseline: {} }));
  if (baseline) {
    const deltas = computeDeltas(rows, baseline);
    for (const row of rows) {
      const d = deltas[row.scenarioId];
      if (!d) continue;
      for (const m of DELTA_METRICS) {
        const v = d[m]?.value;
        if (v != null) row.deltaVsBaseline[m] = v;
      }
    }
  }
  return { status: 'ready', rows, baselineId: baseline };
}

export function buildCompareResults(eph: Ephemeris, inputs: CompareRowInput[], baselineId: string | null): CompareResults {
  return assembleCompare(inputs.map((r) => ({ id: r.id, result: buildScenarioResult(eph, r.request) })), baselineId);
}
