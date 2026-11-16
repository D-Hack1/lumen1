// Owner: Ebin
// Power & Elevation (PLAN_FINAL §8.3, E-6). Two bands sharing one time axis (days from the start of the window):
//   top    Sun clearance (amber, ± σ shaded) and Earth clearance (blue), degrees above the terrain horizon, zero line dashed —
//          above zero the body clears the skyline, below zero terrain hides it.
//   bottom panel power (W) as a filled area.
// The ±σ envelope is `series.sigmaBandDeg` (the mask uncertainty at the Sun's azimuth); it is drawn only where the result
// actually has σ (Monte-Carlo or default) — no σ, no band, and the legend says "no σ for this site".
// Fast Lane: static layer redrawn only when the series changes; the overlay (crosshair) is bus-driven; hover/click write crosshairBus.
import { crosshairBus } from '../../state/buses';
import { color } from '../../ui/tokens';
import { LayeredCanvas } from '../shared/LayeredCanvas';
import { chartPointer, fractionAtTime } from '../shared/chartPointer';
import { useScenarioResult } from '../shared/scenarioResultContext';

// Module-level so the array reference is stable across renders (LayeredCanvas resubscribes when it changes).
const OVERLAY_BUSES = [crosshairBus] as const;
const GUTTER = 38; // px reserved on the left for the axis labels
const AXIS_H = 14;
const DAY_MS = 86_400_000;

function extent(a: Float32Array, b: Float32Array | null): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const arr of b ? [a, b] : [a]) {
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  return Number.isFinite(min) ? { min, max } : { min: -1, max: 1 };
}

export function PowerCurve() {
  const result = useScenarioResult();
  const series = result.series;
  const handlers = chartPointer(series, 'powerCurve', { mode: 'line', gutterPx: GUTTER });

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', cursor: 'crosshair' }} {...handlers} role="img" aria-label="Sun and Earth clearance above the terrain horizon, with the uncertainty band, and panel power over the window">
      <LayeredCanvas
        className="power-curve"
        staticKey={series}
        drawStatic={(ctx, w, h) => {
          if (!series) return;
          const n = series.powerW.length;
          if (n < 2) return;
          const plotW = w - GUTTER;
          const xAt = (i: number) => GUTTER + (i / (n - 1)) * plotW;
          const topH = Math.round((h - AXIS_H) * 0.62);
          const gap = 12;
          const botTop = topH + gap;
          const botH = h - AXIS_H - botTop;
          ctx.font = '10px var(--font-mono)';
          ctx.textBaseline = 'middle';

          // ---- clearance band
          const { min: cMin0, max: cMax0 } = extent(series.sunClearanceDeg, series.earthClearanceDeg);
          const pad = Math.max(0.5, (cMax0 - cMin0) * 0.08);
          const cMin = Math.min(cMin0 - pad, -0.5);
          const cMax = Math.max(cMax0 + pad, 0.5);
          const yC = (v: number) => 4 + (1 - (v - cMin) / (cMax - cMin)) * (topH - 8);
          // zero line
          ctx.strokeStyle = color.hairlineStrong;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(GUTTER, yC(0));
          ctx.lineTo(w, yC(0));
          ctx.stroke();
          ctx.setLineDash([]);
          // ±σ envelope around Sun clearance (only where σ is a real, positive number)
          let hasSigma = false;
          for (let i = 0; i < n; i++) if (Number.isFinite(series.sigmaBandDeg[i]) && series.sigmaBandDeg[i] > 0) hasSigma = true;
          if (hasSigma) {
            ctx.fillStyle = 'rgba(245, 165, 36, 0.20)';
            ctx.beginPath();
            for (let i = 0; i < n; i++) ctx.lineTo(xAt(i), yC(series.sunClearanceDeg[i] + (series.sigmaBandDeg[i] || 0)));
            for (let i = n - 1; i >= 0; i--) ctx.lineTo(xAt(i), yC(series.sunClearanceDeg[i] - (series.sigmaBandDeg[i] || 0)));
            ctx.closePath();
            ctx.fill();
          }
          const line = (arr: Float32Array, y: (v: number) => number, stroke: string) => {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < n; i++) {
              if (!Number.isFinite(arr[i])) {
                started = false;
                continue;
              }
              if (!started) ctx.moveTo(xAt(i), y(arr[i]));
              else ctx.lineTo(xAt(i), y(arr[i]));
              started = true;
            }
            ctx.stroke();
          };
          line(series.earthClearanceDeg, yC, color.earth);
          line(series.sunClearanceDeg, yC, color.sun);
          ctx.fillStyle = color.textFaint;
          ctx.textAlign = 'right';
          ctx.fillText(`${cMax.toFixed(0)}°`, GUTTER - 4, yC(cMax) + 5);
          ctx.fillText('0°', GUTTER - 4, yC(0));
          ctx.fillText(`${cMin.toFixed(0)}°`, GUTTER - 4, yC(cMin) - 5);
          // legend
          ctx.textAlign = 'left';
          let lx = GUTTER + 6;
          const key = (text: string, stroke: string) => {
            ctx.fillStyle = stroke;
            ctx.fillRect(lx, 7, 10, 3);
            ctx.fillStyle = color.textMuted;
            ctx.fillText(text, lx + 14, 9);
            lx += 14 + ctx.measureText(text).width + 12;
          };
          key(hasSigma ? 'Sun clearance ± σ' : 'Sun clearance (no σ for this site)', color.sun);
          key('Earth clearance', color.earth);

          // ---- power band
          let pMax = 0;
          for (let i = 0; i < n; i++) if (Number.isFinite(series.powerW[i]) && series.powerW[i] > pMax) pMax = series.powerW[i];
          pMax = Math.max(pMax, 1);
          const yP = (v: number) => botTop + (1 - v / pMax) * (botH - 2);
          ctx.fillStyle = color.sunSoft;
          ctx.beginPath();
          ctx.moveTo(xAt(0), botTop + botH);
          for (let i = 0; i < n; i++) ctx.lineTo(xAt(i), yP(Number.isFinite(series.powerW[i]) ? series.powerW[i] : 0));
          ctx.lineTo(xAt(n - 1), botTop + botH);
          ctx.closePath();
          ctx.fill();
          line(series.powerW, yP, color.both);
          ctx.fillStyle = color.textFaint;
          ctx.textAlign = 'right';
          ctx.fillText(`${Math.round(pMax)} W`, GUTTER - 4, yP(pMax) + 5);
          ctx.fillText('0', GUTTER - 4, yP(0) - 3);
          ctx.textAlign = 'left';
          ctx.fillStyle = color.textMuted;
          ctx.fillText('Panel power (W)', GUTTER + 6, botTop + 8);

          // ---- day axis
          const days = Math.round(((n - 1) * series.stepMs) / DAY_MS);
          const step = days > 20 ? 5 : days > 8 ? 2 : 1;
          ctx.fillStyle = color.textFaint;
          ctx.textAlign = 'center';
          for (let d = 0; d <= days; d += step) {
            const x = GUTTER + ((d * DAY_MS) / ((n - 1) * series.stepMs)) * plotW;
            ctx.fillText(`d${d}`, Math.min(w - 8, Math.max(GUTTER + 6, x)), h - AXIS_H / 2);
          }
        }}
        drawOverlay={(ctx, w, h) => {
          if (!series) return;
          const { tScrub, tHover } = crosshairBus.get();
          const line = (t: number, alpha: number, dashed: boolean) => {
            const f = fractionAtTime(series, t, 'line');
            if (f < 0 || f > 1) return;
            const x = Math.round(GUTTER + f * (w - GUTTER)) + 0.5;
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = color.focus;
            ctx.lineWidth = 1;
            ctx.setLineDash(dashed ? [3, 3] : []);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h - AXIS_H);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
          };
          line(tScrub, 0.9, false);
          if (tHover != null) line(tHover, 0.5, true);
        }}
        overlayBuses={OVERLAY_BUSES}
      />
    </div>
  );
}
