// Owner: Ebin
// Aligned Barcodes: ≤4 compare rows stacked, aligned to time since each row's own landing (PLAN_FINAL §8.6).
// Encoding follows §8.1 #8 — never colour alone: Sun-only = amber solid, Sun+Earth = teal solid,
// Earth-only = blue dots, blocked = grey hatch. One shared crosshair: the scrub/hover offset is measured from the
// first row's start and applied to every row's own time axis, so a column always means "same day since landing".
// Overlay-only redraw on `crosshairBus` and `slipBus` (Fast Lane); the static layer draws once per series.
// Live slip: while a slip slider is dragged (slipBus.dragging) each affected row previews the move by sliding its
// existing bars (barcodeShift.ts) — the engine recomputes once, on release. Rows the drag does not target (the
// per-row "selected" mode) stay put. The days that slide in from beyond the computed window show as "not computed".
import { useCompareResults } from '../../engine/hooks';
import type { Series } from '../../engine/types';
import { crosshairBus, slipBus } from '../../state/buses';
import { getScenario } from '../../state/scenarioStore';
import { createDotPattern, createHatchPattern } from '../../ui/patterns';
import { color } from '../../ui/tokens';
import { LayeredCanvas } from '../shared/LayeredCanvas';
import { shiftedColumns, UNKNOWN } from './barcodeShift';

// Module-level so the array reference is stable across renders (LayeredCanvas resubscribes when it changes).
const OVERLAY_BUSES = [crosshairBus, slipBus] as const;
const MAX_ROWS = 4;

const spanOf = (s: Series) => s.stepMs * s.sunUp.length;

/** Days this row should preview right now: 0 unless a slip drag is live and targets this row. */
function liveSlipDeltaDays(rowId: string): number {
  const bus = slipBus.get();
  if (!bus.dragging) return 0;
  const st = getScenario();
  if (bus.rowId == null) return bus.slipDays - st.slipDays; // global slip: every row
  if (bus.rowId !== rowId) return 0; // per-row slip: only that row
  return bus.slipDays - (st.compareRows.find((r) => r.id === rowId)?.slipDays ?? 0);
}

export function AlignedBarcodes() {
  const compare = useCompareResults();
  const rows = compare.rows.slice(0, MAX_ROWS);
  const refSeries = rows[0]?.result.series ?? null;

  return (
    <div className="aligned-barcodes" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', height: '100%', minHeight: 0 }}>
      {rows.map((row) => {
        const series = row.result.series;
        return (
          <div key={row.scenarioId} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <span className="num" style={{ width: 20, color: color.textMuted }}>
              {row.scenarioId}
              {row.scenarioId === compare.baselineId ? '★' : ''}
            </span>
            <div style={{ flex: 1, height: '100%', minHeight: 0 }}>
              <LayeredCanvas
                staticKey={series}
                drawStatic={(ctx, w, h, dpr) => {
                  if (!series) return;
                  const hatch = createHatchPattern(ctx, dpr) ?? color.blockedBg;
                  const dots = createDotPattern(ctx, dpr) ?? color.earthSoft;
                  const n = series.sunUp.length;
                  const cw = w / Math.max(1, n);
                  for (let i = 0; i < n; i++) {
                    const sun = series.sunUp[i] === 1;
                    const earth = series.earthUp[i] === 1;
                    ctx.fillStyle = sun && earth ? color.both : sun ? color.sun : earth ? dots : hatch;
                    ctx.fillRect(i * cw, 0, Math.max(1, cw), h);
                  }
                }}
                drawOverlay={(ctx, w, h, dpr) => {
                  if (!series || !refSeries) return;
                  const delta = liveSlipDeltaDays(row.scenarioId);
                  if (delta !== 0) {
                    // Opaque preview over the static bars: same encodings, shifted; "not computed" where nothing slid in.
                    const hatch = createHatchPattern(ctx, dpr) ?? color.blocked;
                    const dots = createDotPattern(ctx, dpr) ?? color.earth;
                    const fills = [hatch, color.sun, dots, color.both] as const;
                    const cols = Math.max(1, Math.floor(w));
                    const states = shiftedColumns(series, delta, cols);
                    ctx.fillStyle = color.surface2;
                    ctx.fillRect(0, 0, w, h);
                    for (let c = 0; c < cols; c++) {
                      if (states[c] === UNKNOWN) continue;
                      ctx.fillStyle = fills[states[c]];
                      ctx.fillRect((c / cols) * w, 0, w / cols + 0.5, h);
                    }
                    ctx.fillStyle = color.text;
                    ctx.font = '10px var(--font-mono)';
                    ctx.textBaseline = 'top';
                    ctx.textAlign = 'left';
                    ctx.fillText(`preview · slip ${delta > 0 ? '+' : ''}${delta} d`, 4, 3);
                    ctx.textBaseline = 'alphabetic';
                  }
                  const { tScrub, tHover } = crosshairBus.get();
                  const line = (t: number, alpha: number, dashed: boolean) => {
                    const x = ((t - refSeries.t0) / spanOf(refSeries)) * w;
                    if (x < 0 || x > w) return;
                    const px = Math.round(x) + 0.5;
                    ctx.globalAlpha = alpha;
                    ctx.strokeStyle = color.focus;
                    ctx.lineWidth = 1;
                    ctx.setLineDash(dashed ? [3, 3] : []);
                    ctx.beginPath();
                    ctx.moveTo(px, 0);
                    ctx.lineTo(px, h);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.globalAlpha = 1;
                  };
                  line(tScrub, 0.95, false);
                  if (tHover != null) line(tHover, 0.55, true);
                }}
                overlayBuses={OVERLAY_BUSES}
              />
            </div>
          </div>
        );
      })}
      {rows.length === 0 && <div style={{ color: color.textFaint, fontSize: 'var(--fs-sm)' }}>Add scenarios to Compare to see them here.</div>}
    </div>
  );
}
