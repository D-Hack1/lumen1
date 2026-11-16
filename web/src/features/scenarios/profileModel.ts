// Owner: Abhinav
// Mission Profile model (pure, unit-tested): field specs + validation, battery endurance check, the per-requirement
// pass/fail list at the CONSERVATIVE bound (PLAN §5.7), and the one-line summary for the verdict popover.
// Requirement statuses come from the engine's own `evaluateVerdict` (Nived) so this list can never disagree with the
// verdict rule; this file only adds display values (nominal, conservative bound, limit).
import { evaluateVerdict, type RequirementStatus } from '../../engine/core/verdict';
import type { Bounded, MetricSet, ScenarioResult } from '../../engine/types';
import type { ProfileThresholds, Weights } from '../../state/scenarioStore';

export type ProfileKey = keyof ProfileThresholds;

export interface FieldSpec {
  key: ProfileKey;
  unit: string;
  min: number;
  max: number;
  step: number;
  /** Integer-only field. */
  int?: boolean;
  /** Hard requirement operator shown next to the value (≥ minimum, ≤ maximum); '' = a mission parameter. */
  op: '≥' | '≤' | '';
}

/** Order = form order. Ranges are generous sanity limits, not mission advice. */
export const PROFILE_FIELDS: readonly FieldSpec[] = [
  { key: 'surfaceDurationDays', unit: 'd', min: 1, max: 60, step: 1, int: true, op: '' },
  { key: 'minSunlitPct', unit: '%', min: 0, max: 100, step: 1, op: '≥' },
  { key: 'minLinkHours', unit: 'h', min: 0, max: 1440, step: 1, op: '≥' },
  { key: 'maxLongestNightH', unit: 'h', min: 0, max: 720, step: 1, op: '≤' },
  { key: 'maxPadSlopeDeg', unit: '°', min: 0, max: 45, step: 0.5, op: '≤' },
  { key: 'batteryWh', unit: 'Wh', min: 0, max: 100_000, step: 10, op: '' },
  { key: 'usableDodPct', unit: '%', min: 1, max: 100, step: 1, op: '' },
  { key: 'loadW', unit: 'W', min: 0.1, max: 10_000, step: 1, op: '' },
];
export const FIELD = Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, f])) as Record<ProfileKey, FieldSpec>;

/** Copy key of a validation error (rendered via useCopy, with {min}/{max}/{unit}/{h} placeholders). */
export type FieldError = 'profile.err.number' | 'profile.err.range' | 'profile.err.int' | 'profile.err.linkExceeds';

/** Parse one raw input. Returns the number, or an error key. Empty / non-numeric / out of range / non-integer → error. */
export function parseField(key: ProfileKey, raw: string): { value: number } | { error: FieldError } {
  const spec = FIELD[key];
  const s = raw.trim().replace(',', '.');
  if (s === '' || !/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return { error: 'profile.err.number' };
  const v = Number(s);
  if (!Number.isFinite(v)) return { error: 'profile.err.number' };
  if (v < spec.min || v > spec.max) return { error: 'profile.err.range' };
  if (spec.int && !Number.isInteger(v)) return { error: 'profile.err.int' };
  return { value: v };
}

/** Cross-field rules on a candidate profile. Returns errors per field (empty = valid). */
export function crossFieldErrors(p: ProfileThresholds): Partial<Record<ProfileKey, FieldError>> {
  const out: Partial<Record<ProfileKey, FieldError>> = {};
  if (p.minLinkHours > p.surfaceDurationDays * 24) out.minLinkHours = 'profile.err.linkExceeds';
  return out;
}

// ---------- battery (PLAN §5.6: endurance = battery Wh × usable DoD ÷ load W vs longest night) ----------

export interface BatteryCheck {
  enduranceH: number;
  /** Longest night used for the check: the conservative (upper) bound when known, else nominal. null = no data. */
  nightH: number | null;
  nightBound: 'conservative' | 'nominal' | null;
  /** enduranceH − nightH; null without night data. */
  marginH: number | null;
  status: 'pass' | 'fail' | 'unknown';
}

export const enduranceHours = (p: Pick<ProfileThresholds, 'batteryWh' | 'usableDodPct' | 'loadW'>): number =>
  p.loadW > 0 ? (p.batteryWh * (p.usableDodPct / 100)) / p.loadW : 0;

export function batteryCheck(p: ProfileThresholds, longestNightH: Bounded | null | undefined): BatteryCheck {
  const enduranceH = enduranceHours(p);
  const hi = longestNightH?.hi ?? null;
  const nom = longestNightH?.value ?? null;
  const nightH = hi ?? nom;
  if (nightH == null) return { enduranceH, nightH: null, nightBound: null, marginH: null, status: 'unknown' };
  const marginH = enduranceH - nightH;
  return { enduranceH, nightH, nightBound: hi != null ? 'conservative' : 'nominal', marginH, status: marginH >= 0 ? 'pass' : 'fail' };
}

// ---------- hard requirements at the conservative bound ----------

export type RequirementKey = 'sunlit' | 'link' | 'night' | 'slope';

export interface RequirementRow {
  id: RequirementKey;
  /** Profile field holding the limit. */
  field: ProfileKey;
  op: '≥' | '≤';
  limit: number;
  unit: string;
  nominal: number | null;
  /** Worse end of the range (lo for a minimum, hi for a maximum); nominal when there is no bound. */
  conservative: number | null;
  status: RequirementStatus;
}

const REQ: { id: RequirementKey; field: ProfileKey; kind: 'min' | 'max'; unit: string }[] = [
  { id: 'sunlit', field: 'minSunlitPct', kind: 'min', unit: '%' },
  { id: 'link', field: 'minLinkHours', kind: 'min', unit: 'h' },
  { id: 'night', field: 'maxLongestNightH', kind: 'max', unit: 'h' },
  { id: 'slope', field: 'maxPadSlopeDeg', kind: 'max', unit: '°' },
];

/** A result without terrain and sigma-qualified bounds cannot confirm a geometry requirement. */
export function boundsKindOf(r: Pick<ScenarioResult, 'meta'>): 'bounded' | 'insufficient' {
  const src = r.meta?.sigmaSource?.toLowerCase() ?? '';
  return r.meta?.tier === 'C' || src.includes('smooth') || src.includes('pending') ? 'insufficient' : 'bounded';
}

export function requirementRows(
  metrics: MetricSet | null,
  profile: ProfileThresholds,
  weights: Weights,
  windowHours: number,
  boundsKind: 'bounded' | 'insufficient',
  /** The engine's own per-requirement statuses (`result.verdictRequirements`). Absent on mock results: recomputed then. */
  engineStatuses?: ReadonlyArray<{ id: RequirementKey; status: RequirementStatus }>,
): RequirementRow[] {
  const linkH = (b: Bounded | null): Bounded | null =>
    b == null
      ? null
      : {
          value: b.value == null ? null : (b.value * windowHours) / 100,
          lo: b.lo == null ? null : (b.lo * windowHours) / 100,
          hi: b.hi == null ? null : (b.hi * windowHours) / 100,
        };
  const values: Record<RequirementKey, Bounded | null> = {
    sunlit: metrics?.sunlitPct ?? null,
    link: linkH(metrics?.linkPct ?? null),
    night: metrics?.longestNightH ?? null,
    slope: metrics?.padSlopeDeg ?? null,
  };
  const statuses = engineStatuses?.length
    ? engineStatuses
    : metrics
    ? evaluateVerdict({ metrics, windowHours, profile, weights, boundsKind }).requirements
    : REQ.map((r) => ({ id: r.id, status: 'unknown' as RequirementStatus }));
  return REQ.map((r) => {
    const b = values[r.id];
    const nominal = b?.value ?? null;
    const conservative = nominal == null ? null : ((r.kind === 'min' ? b?.lo : b?.hi) ?? nominal);
    return {
      id: r.id,
      field: r.field,
      op: r.kind === 'min' ? '≥' : '≤',
      limit: profile[r.field],
      unit: r.unit,
      nominal,
      conservative,
      status: statuses.find((s) => s.id === r.id)?.status ?? 'unknown',
    };
  });
}

// ---------- formatting ----------

/** Compact number: integers stay integers, others 1 decimal; thousands get a thin space (2 000). */
export function fmtNum(v: number, digits?: number): string {
  const d = digits ?? (Number.isInteger(v) ? 0 : 1);
  const s = v.toFixed(d);
  const [i, f] = s.split('.');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return f ? `${grouped}.${f}` : grouped;
}

/** "14 d · sunlit ≥ 50% · link ≥ 100 h · night ≤ 72 h · slope ≤ 10° · 2 000 Wh × 80% ÷ 60 W = 26.7 h". Copy-free
 *  symbols only (labels come from `t`). */
export function profileSummary(p: ProfileThresholds, t: (k: string) => string): string {
  return [
    `${fmtNum(p.surfaceDurationDays)} d`,
    `${t('profile.short.sunlit')} ≥ ${fmtNum(p.minSunlitPct)}%`,
    `${t('profile.short.link')} ≥ ${fmtNum(p.minLinkHours)} h`,
    `${t('profile.short.night')} ≤ ${fmtNum(p.maxLongestNightH)} h`,
    `${t('profile.short.slope')} ≤ ${fmtNum(p.maxPadSlopeDeg)}°`,
    `${fmtNum(p.batteryWh)} Wh × ${fmtNum(p.usableDodPct)}% ÷ ${fmtNum(p.loadW)} W = ${fmtNum(enduranceHours(p), 1)} h`,
  ].join(' · ');
}
