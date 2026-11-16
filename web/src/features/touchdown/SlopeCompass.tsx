// Owner: Ebin
// Slope/aspect compass (PLAN_FINAL §5.6): downhill arrow (long, headed) and uphill arrow (= downhill + 180°,
// short, hollow head) on the static layer; Sun (amber) and Earth (blue) azimuth ticks on the rim follow the
// crosshair via the overlay (bus-driven, Fast Lane). 0° = North at top.
import type { Series } from '../../engine/types';
import { crosshairBus } from '../../state/buses';
import { color } from '../../ui/tokens';
import { LayeredCanvas } from '../shared/LayeredCanvas';

const OVERLAY_BUSES = [crosshairBus] as const;

export interface SlopeCompassProps {
  slopeDeg: number | null;
  downhillAzimuthDeg: number | null;
  /** Series to read Sun/Earth azimuth from at crosshair time. */
  series?: Series | null;
}

const pt = (cx: number, cy: number, r: number, azDeg: number): [number, number] => {
  const a = (azDeg * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
};

function arrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, azDeg: number, stroke: string, hollow: boolean) {
  const [x, y] = pt(cx, cy, r, azDeg);
  const [bx, by] = pt(cx, cy, r - 7, azDeg - 14);
  const [dx, dy] = pt(cx, cy, r - 7, azDeg + 14);
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(bx, by);
  ctx.lineTo(dx, dy);
  ctx.closePath();
  if (hollow) ctx.stroke();
  else ctx.fill();
}

export function SlopeCompass({ slopeDeg, downhillAzimuthDeg, series }: SlopeCompassProps) {
  const uphillAz = downhillAzimuthDeg != null ? (downhillAzimuthDeg + 180) % 360 : null;

  return (
    <LayeredCanvas
      className="slope-compass"
      staticKey={`${slopeDeg}:${downhillAzimuthDeg}`}
      drawStatic={(ctx, w, h) => {
        const cx = w / 2;
        const cy = h / 2;
        const r = Math.min(w, h) / 2 - 8;

        ctx.strokeStyle = color.hairlineStrong;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = color.textFaint;
        ctx.font = '9px var(--font-mono)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('N', cx, cy - r - 5);

        if (downhillAzimuthDeg != null) arrow(ctx, cx, cy, r * 0.85, downhillAzimuthDeg, color.text, false);
        if (uphillAz != null) arrow(ctx, cx, cy, r * 0.5, uphillAz, color.textMuted, true);

        ctx.fillStyle = color.text;
        ctx.font = '11px var(--font-mono)';
        ctx.fillText(slopeDeg != null ? `${slopeDeg.toFixed(1)}°` : '—', cx + (downhillAzimuthDeg != null && Math.sin((downhillAzimuthDeg * Math.PI) / 180) > 0 ? -r * 0.45 : r * 0.45), cy + r * 0.55);
      }}
      drawOverlay={(ctx, w, h) => {
        if (!series) return;
        const cx = w / 2;
        const cy = h / 2;
        const r = Math.min(w, h) / 2 - 8;
        const i = Math.max(0, Math.min(series.sunAzDeg.length - 1, Math.round((crosshairBus.get().tScrub - series.t0) / series.stepMs)));
        const tick = (az: number, up: boolean, stroke: string, shape: 'sq' | 'dot') => {
          const [x0, y0] = pt(cx, cy, r - 5, az);
          const [x1, y1] = pt(cx, cy, r + 5, az);
          ctx.globalAlpha = up ? 1 : 0.35;
          ctx.strokeStyle = stroke;
          ctx.fillStyle = stroke;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
          // Shape as well as colour: Sun = square, Earth = circle (never colour alone).
          if (shape === 'sq') ctx.fillRect(x1 - 2.5, y1 - 2.5, 5, 5);
          else {
            ctx.beginPath();
            ctx.arc(x1, y1, 3, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        };
        tick(series.sunAzDeg[i], series.sunUp[i] === 1, color.sun, 'sq');
        tick(series.earthAzDeg[i], series.earthUp[i] === 1, color.earth, 'dot');
      }}
      overlayBuses={OVERLAY_BUSES}
    />
  );
}
