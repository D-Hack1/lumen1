// Owner: Nived
// Go / no-go verdict against the Mission Profile (PLAN_FINAL 5.7). Pure function.
//   GO       every hard requirement passes at the CONSERVATIVE bound (lo for a minimum, hi for a maximum)
//   MARGINAL some requirement passes only at the nominal value, or is within 10% of its limit
//   NO-GO    some requirement fails even at the nominal value
//   PENDING  nothing fails, nothing is marginal, but something cannot be judged because data or uncertainty bounds are missing.
import type { Bounded, MetricSet, Verdict } from '../types';

export interface VerdictProfile {
  minSunlitPct: number;
  minLinkHours: number;
  maxLongestNightH: number;
  maxPadSlopeDeg: number;
}

export interface VerdictWeights {
  sunlit: number;
  link: number;
  night: number;
  slope: number;
}

export interface VerdictInput {
  metrics: MetricSet;
  /** Length of the evaluated window in hours (link hours = link % of this). */
  windowHours: number;
  profile: VerdictProfile;
  weights: VerdictWeights;
  /** 'bounded': lo/hi are real uncertainty bounds. 'insufficient': geometry has no terrain or sigma-qualified bounds. */
  boundsKind: 'bounded' | 'insufficient';
  /** What the insufficient-evidence values were computed on, for the reason text only. */
  basis?: 'smooth-moon' | 'mask';
  /** Requirements supported by independent evidence even when geometry bounds are unavailable (for example, measured pad slope). */
  verifiedRequirements?: readonly RequirementId[];
}

export type RequirementId = 'sunlit' | 'link' | 'night' | 'slope';
export type RequirementStatus = 'pass' | 'marginal' | 'fail' | 'unknown';

export interface RequirementResult {
  id: RequirementId;
  status: RequirementStatus;
}

export interface VerdictComponent {
  id: RequirementId;
  /** 0..1, or null when there is no data for it. */
  score: number | null;
  weight: number;
}

export interface VerdictResult {
  verdict: Verdict;
  requirements: RequirementResult[];
  reasons: string[];
  /** 0..100 weighted average of the component scores that have data; null if none do. */
  viabilityIndex: number | null;
  components: VerdictComponent[];
}

interface Spec {
  id: RequirementId;
  label: string;
  unit: string;
  kind: 'min' | 'max';
  limit: number;
  value: Bounded | null;
}

const scale = (b: Bounded | null, k: number): Bounded | null =>
  b == null ? null : { value: b.value == null ? null : b.value * k, lo: b.lo == null ? null : b.lo * k, hi: b.hi == null ? null : b.hi * k };

const WEIGHT_KEY: Record<RequirementId, keyof VerdictWeights> = { sunlit: 'sunlit', link: 'link', night: 'night', slope: 'slope' };

/** Minimum-type: value / limit capped at 1. Maximum-type: limit / value capped at 1 (a value of 0 scores 1). */
function componentScore(s: Spec): number | null {
  const v = s.value?.value ?? null;
  if (v == null) return null;
  if (s.kind === 'min') return s.limit <= 0 ? 1 : Math.min(1, Math.max(0, v / s.limit));
  return v <= 0 ? 1 : Math.min(1, s.limit / v);
}

export function evaluateVerdict(input: VerdictInput): VerdictResult {
  const { metrics: m, profile: p } = input;
  const specs: Spec[] = [
    { id: 'sunlit', label: 'Sunlit time', unit: '%', kind: 'min', limit: p.minSunlitPct, value: m.sunlitPct },
    { id: 'link', label: 'Link time', unit: ' h', kind: 'min', limit: p.minLinkHours, value: scale(m.linkPct, input.windowHours / 100) },
    { id: 'night', label: 'Longest night', unit: ' h', kind: 'max', limit: p.maxLongestNightH, value: m.longestNightH },
    { id: 'slope', label: 'Pad slope', unit: '°', kind: 'max', limit: p.maxPadSlopeDeg, value: m.padSlopeDeg },
  ];
  const reasons: string[] = [];
  const insufficient: string[] = [];
  const verified = new Set(input.verifiedRequirements);
  const requirements: RequirementResult[] = specs.map((s) => {
    const v = s.value?.value ?? null;
    const word = s.kind === 'min' ? 'below the minimum' : 'above the maximum';
    if (v == null) {
      reasons.push(`${s.label}: no data yet.`);
      return { id: s.id, status: 'unknown' };
    }
    const meets = (x: number) => (s.kind === 'min' ? x >= s.limit : x <= s.limit);
    if (input.boundsKind === 'insufficient' && !verified.has(s.id)) {
      insufficient.push(s.label);
      return { id: s.id, status: 'unknown' };
    }
    if (!meets(v)) {
      reasons.push(`${s.label} ${v.toFixed(1)}${s.unit} is ${word} (${s.limit}${s.unit}).`);
      return { id: s.id, status: 'fail' };
    }
    // Conservative bound: the worse end of the range (lo for a minimum, hi for a maximum). No bound => the nominal value.
    const conservative = (s.kind === 'min' ? s.value?.lo : s.value?.hi) ?? v;
    const nearLimit = Math.abs(v - s.limit) <= 0.1 * Math.abs(s.limit) + 1e-9; // within 10% of the limit (inclusive)
    if (!meets(conservative)) {
      reasons.push(`${s.label} passes only at the nominal value (conservative bound ${conservative.toFixed(1)}${s.unit}).`);
      return { id: s.id, status: 'marginal' };
    }
    if (nearLimit) {
      reasons.push(`${s.label} ${v.toFixed(1)}${s.unit} is within 10% of its limit (${s.limit}${s.unit}).`);
      return { id: s.id, status: 'marginal' };
    }
    return { id: s.id, status: 'pass' };
  });
  if (insufficient.length > 0) {
    const names = insufficient.map((n, i) => (i === 0 ? n : n.charAt(0).toLowerCase() + n.slice(1)));
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    const firstUnknown = reasons.findIndex((r) => r.endsWith('no data yet.'));
    const tail = input.basis === 'mask'
      ? (names.length === 1 ? 'is a nominal terrain-mask result; terrain uncertainty (σ) is needed to determine pass or fail.' : 'are nominal terrain-mask results; terrain uncertainty (σ) is needed to determine pass or fail.')
      : (names.length === 1 ? 'is a smooth-sphere estimate; terrain data is needed to determine pass or fail.' : 'are smooth-sphere estimates; terrain data is needed to determine pass or fail.');
    const line = `${list} ${tail}`;
    if (firstUnknown === -1) reasons.push(line);
    else reasons.splice(firstUnknown, 0, line);
  }
  const has = (st: RequirementStatus) => requirements.some((r) => r.status === st);
  const components: VerdictComponent[] = specs.map((s) => ({ id: s.id, score: componentScore(s), weight: input.weights[WEIGHT_KEY[s.id]] }));
  const scored = components.filter((c) => c.score != null);
  const wSum = scored.reduce((a, c) => a + c.weight, 0);
  const viabilityIndex = scored.length === 0 || wSum <= 0 ? null : (100 * scored.reduce((a, c) => a + c.weight * (c.score as number), 0)) / wSum;
  const verdict: Verdict = has('fail') ? 'NO-GO' : has('marginal') ? 'MARGINAL' : has('unknown') ? 'PENDING' : 'GO';
  return { verdict, requirements, reasons, viabilityIndex, components };
}
