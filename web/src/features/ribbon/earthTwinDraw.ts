// Owner: Ebin
// Draws the Earth Twin: where the Sun would travel across the sky in ONE terrestrial day at the site's latitude on
// the scenario's date (Nived's `engine/core/earthTwin.ts`, an educational approximation). It is drawn on the
// Panorama's own azimuth/elevation scale as a dashed line, clipped to the chart — on Earth the Sun climbs far above
// the Moon's low skyline, so the part above the chart is cut off and said so. The contrast is the lesson: the same
// Sun crosses an Earth sky in a day, but takes ~29 days (and skims the horizon) at the lunar pole.
import { earthTwinDay } from '../../engine/core/earthTwin';
import type { PanoramaScale } from '../shared/ribbonGeometry';
import { color } from '../../ui/tokens';

export function drawEarthTwin(ctx: CanvasRenderingContext2D, scale: PanoramaScale, latDeg: number, tMs: number, label: string): void {
  const pts = earthTwinDay(latDeg, tMs, 144);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, scale.w, scale.h);
  ctx.clip();
  ctx.strokeStyle = color.textMuted;
  ctx.lineWidth = 1.25;
  ctx.setLineDash([5, 4]);

  let open = false;
  let prevAz = 0;
  let above = false;
  ctx.beginPath();
  for (const p of pts) {
    const x = scale.azToX(p.azimuthDeg);
    const y = scale.elevToY(p.elevationDeg);
    // Break the path at the 0/360 azimuth seam so it does not streak across the whole chart.
    if (!open || Math.abs(p.azimuthDeg - prevAz) > 180) {
      ctx.moveTo(x, y);
      open = true;
    } else ctx.lineTo(x, y);
    prevAz = p.azimuthDeg;
    if (p.elevationDeg > scale.elevMax) above = true;
  }
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = color.textMuted;
  ctx.font = '10px var(--font-mono)';
  ctx.textAlign = 'right';
  ctx.fillText(above ? `${label} ↑ (cut off above)` : label, scale.w - 6, 12);
  ctx.restore();
}
