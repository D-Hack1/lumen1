// Owner: Nived
// Which stage-1 candidates get the exact stage-2 evaluation (R3 delta D-15):
//   (a) the top N by viability, and
//   (b) every candidate whose nominal value lies within 10% of a hard profile threshold: these are the ones whose verdict can flip.
// (b) is ordered most-flip-able first (smallest relative distance to a threshold) so the early stage-2 results are the useful ones.
import type { VerdictProfile } from '../core/verdict';
import type { ScanCandidate } from '../types';

export const NEAR_THRESHOLD = 0.1; // inclusive

export interface Stage2Options {
  topN: number;
  /** Upper bound on the candidates refined, so stage 2 cannot grow without limit. */
  maxTotal: number;
}

/** Smallest relative distance |value - limit| / |limit| over the hard thresholds the candidate has data for; null if none. */
export function closenessToThreshold(c: ScanCandidate, p: VerdictProfile, windowHours: number): number | null {
  const rel = (value: number | null, limit: number) => (value == null || !(limit > 0) ? null : Math.abs(value - limit) / limit);
  const linkHours = c.linkPct.value == null ? null : (c.linkPct.value * windowHours) / 100;
  const ds = [rel(c.sunlitPct.value, p.minSunlitPct), rel(linkHours, p.minLinkHours), rel(c.longestNightH.value, p.maxLongestNightH)].filter((d): d is number => d != null);
  return ds.length === 0 ? null : Math.min(...ds);
}

export function selectForStage2(candidates: ScanCandidate[], profile: VerdictProfile, windowHours: number, opts: Stage2Options): ScanCandidate[] {
  const ranked = [...candidates].sort((a, b) => b.viabilityIndex - a.viabilityIndex);
  const top = ranked.slice(0, opts.topN);
  const near = ranked
    .slice(opts.topN)
    .map((c) => ({ c, d: closenessToThreshold(c, profile, windowHours) }))
    .filter((x): x is { c: ScanCandidate; d: number } => x.d != null && x.d <= NEAR_THRESHOLD + 1e-9)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.c);
  return [...top, ...near].slice(0, opts.maxTotal);
}
