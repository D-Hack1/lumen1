// Owner: Ebin
// Dispersion slope histogram (Tier 1, PLAN_FINAL §4 P7 / §9): the slope at each of the 11×11 candidate touchdown spots
// (50 m apart) around the aim point, binned in 0.5° steps. Bars past the mission's pad-slope limit are red with a
// hatch edge and a dashed limit line, so "how much of the landing ellipse is acceptable" reads without colour.
// Static only (data changes at human rate); labels follow persona (shared/visualCopy.ts).
import { color } from '../../ui/tokens';
import { LayeredCanvas } from '../shared/LayeredCanvas';
import { useVisualCopy, visualCopy } from '../shared/visualCopy';
import { summariseDispersion, type Dispersion } from '../../engine/data/dispersion';
import { binSlopes } from './dispersionBins';

export interface DispersionHistogramProps {
  /** The loaded 11×11 grid (engine/data/dispersion.ts) — the single source for bins AND the quoted percentages. */
  dispersion: Dispersion;
  /** Bin width in degrees (the mock sidecar says 0.5). */
  binWidthDeg?: number;
  /** Mission Profile limit; bars at or above it are flagged. */
  toleranceDeg?: number;
}

export function DispersionHistogram({ dispersion, binWidthDeg = 0.5, toleranceDeg }: DispersionHistogramProps) {
  const slopesDeg = dispersion.slopeDeg;
  const persona = useVisualCopy().persona; // part of the redraw key: a persona switch relabels the chart
  return (
    <LayeredCanvas
      className="dispersion-histogram"
      staticKey={`${persona}:${dispersion.siteId}:${slopesDeg.length}:${binWidthDeg}:${toleranceDeg}:${slopesDeg.length ? slopesDeg[0] + slopesDeg[slopesDeg.length - 1] : 0}`}
      drawStatic={(ctx, w, h) => {
        const n = slopesDeg.length;
        if (n === 0) return;
        const counts = binSlopes(slopesDeg, binWidthDeg);
        const axisH = 12;
        const capH = 12; // caption row above the bars, so the label never sits on them
        const plotTop = capH;
        const plotH = h - axisH;
        // Axis runs past the limit (×1.25) so the limit line is visible even when every spot is gentle.
        const nb = Math.max(counts.length, toleranceDeg != null ? Math.ceil((toleranceDeg * 1.25) / binWidthDeg) : 0);
        while (counts.length < nb) counts.push(0);
        const peak = Math.max(1, ...counts);
        const bw = w / nb;
        const tolBin = toleranceDeg != null ? toleranceDeg / binWidthDeg : Infinity;

        for (let i = 0; i < nb; i++) {
          const bh = (counts[i] / peak) * (plotH - plotTop - 2);
          const over = i >= tolBin;
          ctx.fillStyle = over ? color.nogo : color.both;
          ctx.fillRect(i * bw + 0.5, plotH - bh, Math.max(1, bw - 1), bh);
          if (over && bh > 2) {
            // hatch so the "over limit" state never relies on colour alone
            ctx.strokeStyle = color.bg;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let y = plotH - bh; y < plotH; y += 3) {
              ctx.moveTo(i * bw + 0.5, y + 3);
              ctx.lineTo(i * bw + 0.5 + Math.max(1, bw - 1), y);
            }
            ctx.stroke();
          }
        }

        const c = visualCopy();
        ctx.font = '9px var(--font-mono)';
        ctx.textBaseline = 'alphabetic';
        if (toleranceDeg != null) {
          const x = Math.min(w - 1, (toleranceDeg / binWidthDeg) * bw);
          ctx.strokeStyle = color.text;
          ctx.setLineDash([3, 2]);
          ctx.beginPath();
          ctx.moveTo(x, plotTop);
          ctx.lineTo(x, plotH);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = color.text;
          ctx.textAlign = 'left';
          ctx.fillText(c.t('disp.within', { pct: c.pct(summariseDispersion(dispersion, toleranceDeg).pctBelowTolerance), tol: toleranceDeg }), 0, 9);
        }
        ctx.fillStyle = color.textFaint;
        ctx.textAlign = 'left';
        ctx.fillText('0°', 0, h - 2);
        ctx.textAlign = 'right';
        ctx.fillText(`${(nb * binWidthDeg).toFixed(1)}°`, w, h - 2);
        ctx.textAlign = 'center';
        ctx.fillText(c.t('disp.axis'), w / 2, h - 2);
      }}
    />
  );
}
