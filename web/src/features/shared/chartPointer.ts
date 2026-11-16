// Owner: Ebin
// Pointer → shared crosshair for time-axis charts (Power curve, Barcode, Aligned Barcodes). Fast Lane: hover and click write
// `crosshairBus` only (no React state); every chart's overlay and the page clock react to the bus (PLAN_FINAL §8.12, plan E-5).
//   hover  → tHover (ghost line on every chart)      leave → tHover = null      click → tScrub (the shared "now")
import type { MouseEvent, PointerEvent } from 'react';
import type { Series } from '../../engine/types';
import { crosshairBus } from '../../state/buses';

/**
 * Time at a horizontal fraction (0…1) of a chart. `bars`: sample i fills [i, i+1) of the width (barcodes), so the span is n steps.
 * `line`: sample i sits at i/(n−1) of the width (curves), so the span is n−1 steps. Must match how the chart draws its crosshair.
 */
export function timeAtFraction(series: Pick<Series, 't0' | 'stepMs'> & { sunUp: ArrayLike<number> }, frac: number, mode: 'bars' | 'line' = 'bars'): number {
  const n = series.sunUp.length;
  const span = series.stepMs * (mode === 'bars' ? n : Math.max(1, n - 1));
  return series.t0 + Math.max(0, Math.min(1, frac)) * span;
}

/** Inverse of `timeAtFraction`: where on the chart a time falls (may be outside 0…1 if the time is outside the series). */
export function fractionAtTime(series: Pick<Series, 't0' | 'stepMs'> & { sunUp: ArrayLike<number> }, t: number, mode: 'bars' | 'line' = 'bars'): number {
  const n = series.sunUp.length;
  const span = series.stepMs * (mode === 'bars' ? n : Math.max(1, n - 1));
  return (t - series.t0) / span;
}

/** Spread the result onto the element that wraps the chart. `gutterPx` = a left margin (axis labels) that is not part of the time axis. */
export function chartPointer(series: Series | null, source: string, opts: { mode?: 'bars' | 'line'; gutterPx?: number } = {}) {
  const { mode = 'bars', gutterPx = 0 } = opts;
  const frac = (e: PointerEvent | MouseEvent): number => {
    const r = e.currentTarget.getBoundingClientRect();
    return (e.clientX - r.left - gutterPx) / Math.max(1, r.width - gutterPx);
  };
  return {
    onPointerMove: (e: PointerEvent) => {
      if (series) crosshairBus.set({ tHover: timeAtFraction(series, frac(e), mode), source });
    },
    onPointerLeave: () => crosshairBus.set({ tHover: null, source }),
    onClick: (e: MouseEvent) => {
      if (series) crosshairBus.set({ tScrub: timeAtFraction(series, frac(e), mode), source });
    },
  };
}
