// Owner: Nived
// Number/time formatting shared by the engine-owned panels. Pure; no locale surprises (tabular numerals everywhere).
import type { Bounded } from './types';

const H = 3_600_000;
const D = 24 * H;
const MINUS = '−'; // true minus sign keeps columns aligned

/** Plain number with a true minus sign (no '+'), so ranges like [−2.1–−1.7°] stay readable. */
const num = (x: number, digits: number): string => (x < 0 ? MINUS : '') + Math.abs(x).toFixed(digits);

export const signed = (x: number, digits = 1): string => (x < 0 ? MINUS : x > 0 ? '+' : '') + Math.abs(x).toFixed(digits);

/** 41 h · 3 d 4 h · 12 min — for countdowns and spans. Days only from 48 h up (PLAN D-14 examples). */
export function fmtSpan(ms: number): string {
  const a = Math.abs(ms);
  if (a >= 2 * D) {
    const d = Math.floor(a / D);
    const h = Math.round((a - d * D) / H);
    return h ? `${d} d ${h} h` : `${d} d`;
  }
  if (a >= H) return `${Math.round(a / H)} h`;
  return `${Math.max(1, Math.round(a / 60_000))} min`;
}

/** "41 h ± 5 h", or just "41 h" when there is no ± (Tier C), or "~12–30 h" for grazing events. */
export function fmtUntil(ms: number, pmMs: number | null, grazing = false): string {
  if (grazing && pmMs != null) return `~${fmtSpan(Math.max(0, ms - pmMs))}–${fmtSpan(ms + pmMs)}`;
  return pmMs == null ? fmtSpan(ms) : `${fmtSpan(ms)} ± ${fmtSpan(pmMs)}`;
}

/** 62% [55–68%] — value with its [lo–hi] range (unit on both); range omitted when it collapses (Tier C). */
export function fmtBounded(b: Bounded | null, digits = 0, unit = ''): string {
  if (!b || b.value == null) return '—';
  const v = `${num(b.value, digits)}${unit}`;
  if (b.lo == null || b.hi == null || (b.lo === b.value && b.hi === b.value)) return v;
  return `${v} [${num(b.lo, digits)}–${num(b.hi, digits)}${unit}]`;
}

/** 1.24° ± 0.18° — symmetric half-width from lo/hi. */
export function fmtPm(b: Bounded | null, digits = 2, unit = ''): { value: string; pm: string | null } {
  if (!b || b.value == null) return { value: '—', pm: null };
  const half = b.lo != null && b.hi != null ? (b.hi - b.lo) / 2 : 0;
  return { value: `${signed(b.value, digits)}${unit}`, pm: half > 0 ? `± ${half.toFixed(digits)}${unit}` : null };
}

export const fmtDeg = (x: number, digits = 2): string => `${signed(x, digits)}°`;

/** Replace {name} placeholders in a copy string. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

/** Speed of light, km/s (exact). */
export const SPEED_OF_LIGHT_KM_S = 299_792.458;
export const lightTimeSeconds = (rangeKm: number): number => rangeKm / SPEED_OF_LIGHT_KM_S;
const physical = (rangeKm: number): boolean => Number.isFinite(rangeKm) && rangeKm > 0;
/** 384,400 km; 'n/a' for a missing or non-physical range (never NaN or 0). */
export const fmtRangeKm = (rangeKm: number): string => (physical(rangeKm) ? `${Math.round(rangeKm).toLocaleString('en-US')} km` : 'n/a');
/** One-way light time, 1.28 s. */
export const fmtLightTime = (rangeKm: number): string => (physical(rangeKm) ? `${lightTimeSeconds(rangeKm).toFixed(2)} s` : 'n/a');
