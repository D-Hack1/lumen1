// Owner: Ebin
// Pure helpers for the live slip preview on the Aligned Barcodes. While a slip slider is dragged, only the slip BUS
// changes (the engine recomputes once, on release), so each row previews the move by sliding the bars it already has:
// slipping a landing `d` days later moves the window `d` days along, i.e. the bars shift LEFT by `d` days, and the last
// `d` days of the window are not computed yet (shown as "unknown" until release). Pixel-column aggregation keeps the
// per-frame cost at ~columns, not ~samples.
import type { Series } from '../../engine/types';

export type BarState = 0 | 1 | 2 | 3; // 0 blocked · 1 Sun only · 2 Earth only · 3 Sun + Earth
export const UNKNOWN = 255;

const DAY_MS = 86_400_000;

export function barState(sunUp: number, earthUp: number): BarState {
  return sunUp && earthUp ? 3 : sunUp ? 1 : earthUp ? 2 : 0;
}

/**
 * One state per pixel column after sliding the series `shiftDays` later in landing time. Column c covers the
 * (shifted) time range [c, c+1)/columns × span. Where the shifted range falls outside the series: UNKNOWN.
 * Within a column the LAST sample wins, matching the static layer's overdraw order.
 */
export function shiftedColumns(series: Series, shiftDays: number, columns: number): Uint8Array {
  const n = series.sunUp.length;
  const span = series.stepMs * n;
  const shiftMs = shiftDays * DAY_MS;
  const out = new Uint8Array(columns).fill(UNKNOWN);
  for (let c = 0; c < columns; c++) {
    const t0 = (c / columns) * span + shiftMs;
    const t1 = ((c + 1) / columns) * span + shiftMs;
    if (t1 <= 0 || t0 >= span) continue;
    const i0 = Math.max(0, Math.floor(t0 / series.stepMs));
    const i1 = Math.min(n - 1, Math.max(i0, Math.ceil(t1 / series.stepMs) - 1));
    out[c] = barState(series.sunUp[i1], series.earthUp[i1]);
  }
  return out;
}
