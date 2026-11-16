// Owner: Nived
// Number formatting for the Perf HUD. Kept out of the component file (fast refresh) and testable on its own.

export function fmtMs(ms: number | null): string {
  if (ms == null) return '—';
  return ms < 9.95 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`;
}

/** A budget is printed exactly as the plan states it: 4 ms, 16.7 ms, 100 ms (never rounded). */
export const fmtBudget = (ms: number): string => `${Number.isInteger(ms) ? ms : ms.toFixed(1)} ms`;
