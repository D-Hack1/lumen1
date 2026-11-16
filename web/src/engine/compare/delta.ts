// Owner: Nived
// Deltas vs the baseline row, with propagated ± (root-sum-square of the two half-widths).
import type { Bounded, CompareRow, MetricSet } from '../types';

export interface Delta {
  value: number;
  pm: number; // half-width; 0 when neither side has bounds (Tier C)
}

export type DeltaMetric = 'sunlitPct' | 'linkPct' | 'longestNightH';
export const DELTA_METRICS: readonly DeltaMetric[] = ['sunlitPct', 'linkPct', 'longestNightH'];

const half = (b: Bounded): number => (b.lo != null && b.hi != null ? (b.hi - b.lo) / 2 : 0);

export function delta(row: Bounded, base: Bounded): Delta | null {
  if (row.value == null || base.value == null) return null;
  return { value: row.value - base.value, pm: Math.hypot(half(row), half(base)) };
}

/** For every non-baseline row: its deltas against the baseline row. Baseline row maps to null. */
export function computeDeltas(rows: CompareRow[], baselineId: string | null): Record<string, Record<DeltaMetric, Delta | null> | null> {
  const base: MetricSet | null | undefined = rows.find((r) => r.scenarioId === baselineId)?.result.metrics;
  const out: Record<string, Record<DeltaMetric, Delta | null> | null> = {};
  for (const r of rows) {
    const m = r.result.metrics;
    out[r.scenarioId] =
      r.scenarioId === baselineId || !m || !base
        ? null
        : { sunlitPct: delta(m.sunlitPct, base.sunlitPct), linkPct: delta(m.linkPct, base.linkPct), longestNightH: delta(m.longestNightH, base.longestNightH) };
  }
  return out;
}

/** Is a positive delta good? (More sunlight/link is good; a longer night is bad.) */
export const higherIsBetter = (m: DeltaMetric): boolean => m !== 'longestNightH';
