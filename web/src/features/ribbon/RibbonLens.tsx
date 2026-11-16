// Owner: Ebin
// Horizon Lens — equal angular-scale window (~12°×6°) around the selected body, TRUE-SCALE disks (Sun 0.53°,
// Earth 1.9°, ratio ≈ 3.6:1), clipped by the terrain silhouette so the visible disk area matches the engine's
// disk fraction (guide §3.2, conflict C-1, check V-6). x is scaled by cos(el) so angular distances stay true.
// Bodies are real NASA imagery (Sun: SDO, Earth: EPIC) decoded once to ImageBitmaps (bodyImages.ts) and drawn on
// the overlay canvas, clipped by the terrain silhouette. Earth gets phase shading from the engine's Sun/Earth
// directions at t_scrub and is rotated to the site's sky (upside-down from the south pole) — lensGeometry.ts.
// Fast Lane: no React state, no CSS on these draws; redraws only via the frame bus (crosshairBus / image-ready).
// If an image is missing the Lens falls back to the flat procedural disk (phase shading still applies).
import { useRef, useState } from 'react';
import { useScenario } from '../../state/scenarioStore';
import { useCatalog, useResult } from '../../engine/hooks';
import { crosshairBus } from '../../state/buses';
import { color } from '../../ui/tokens';
import { Segmented } from '../../ui/Segmented';
import { LayeredCanvas } from '../shared/LayeredCanvas';
import { nearestHeightIndex } from '../shared/ribbonGeometry';
import { useSiteMask } from './useSiteMask';
import { bodyImageReady, ensureBodyBitmap, getBodyBitmap } from './bodyImages';
import { earthAppearance, visibleDiskFraction } from './lensGeometry';
import { COACH, coachAnchor } from '../shared/coachAnchors';
import { useVisualCopy, visualCopy } from '../shared/visualCopy';

const SUN_DEG = 0.53;
const EARTH_DEG = 1.9;
const WINDOW_H_DEG = 6;
const WINDOW_W_DEG = 12;

// Module-level so the array reference is stable across renders (LayeredCanvas resubscribes when it changes).
const OVERLAY_BUSES = [crosshairBus, bodyImageReady] as const;

const EARTH_SHADE = 'rgba(4, 7, 12, 0.86)'; // night side: near-black with a trace of earthshine

type Body = 'sun' | 'earth';

function sampleIndex(series: NonNullable<ReturnType<typeof useResult>['series']>, t: number): number {
  return Math.max(0, Math.min(series.sunElevDeg.length - 1, Math.round((t - series.t0) / series.stepMs)));
}

export function RibbonLens() {
  const [body, setBody] = useState<Body>('sun');
  const result = useResult();
  const series = result.series;
  const heightM = useScenario((s) => s.heightM);
  const mask = useSiteMask(result.meta?.siteId ?? null);
  const heightIdx = nearestHeightIndex(heightM);
  const vc = useVisualCopy();
  const { sites } = useCatalog();
  const siteRef = useScenario((s) => s.site);
  // Latitude orients Earth's pole in the local sky; read inside drawOverlay via a ref (no re-render on change).
  const lat = siteRef.kind === 'point' ? siteRef.lat : (sites.find((x) => x.id === siteRef.id)?.lat ?? -90);
  const latRef = useRef(lat);
  latRef.current = lat;
  ensureBodyBitmap('sun_sdo');
  ensureBodyBitmap('earth_epic');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }} {...coachAnchor(COACH.ribbonLens)}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '2px 0' }}>
        <Segmented<Body>
          size="sm"
          ariaLabel="Lens body"
          value={body}
          onChange={setBody}
          options={[
            { value: 'sun', label: 'Sun' },
            { value: 'earth', label: 'Earth' },
          ]}
        />
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <LayeredCanvas
          className="ribbon-lens"
          staticKey={`${body}:${mask.mask?.siteId}:${heightIdx}:${vc.persona}`}
          drawOverlay={(ctx, w, h) => {
            if (!series) return;
            const { tScrub } = crosshairBus.get();
            const i = sampleIndex(series, tScrub);
            const az = body === 'sun' ? series.sunAzDeg[i] : series.earthAzDeg[i];
            const el = body === 'sun' ? series.sunElevDeg[i] : series.earthElevDeg[i];
            const diskPct = body === 'sun' ? series.sunDiskPct[i] : series.earthDiskPct[i];
            const diskDeg = body === 'sun' ? SUN_DEG : EARTH_DEG;

            const cosEl = Math.max(0.15, Math.cos((el * Math.PI) / 180));
            const pxPerDegV = h / WINDOW_H_DEG;
            const pxPerDegH = w / (WINDOW_W_DEG * cosEl);
            const xAt = (bodyAz: number) => w / 2 + ((((bodyAz - az + 540) % 360) - 180)) * pxPerDegH;
            const yAt = (bodyEl: number) => h / 2 - (bodyEl - el) * pxPerDegV;

            // Terrain silhouette within the window, used both to paint the ground and to clip the disk.
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, w, h);
            ctx.clip();

            const terrainYAtX = (xp: number) => {
              const bodyAz = az + (xp - w / 2) / pxPerDegH;
              const m = mask.mask;
              const te = m ? m.elevDeg[heightIdx * m.azimuthCount + (Math.floor((((bodyAz % 360) + 360) % 360) / m.binWidthDeg) % m.azimuthCount)] : -0.09;
              return yAt(Number.isFinite(te) ? te : -0.09);
            };
            const skyPath = new Path2D();
            const cols = 64;
            skyPath.moveTo(0, 0);
            for (let c = 0; c <= cols; c++) {
              const xp = (c / cols) * w;
              const bodyAz = az + (((xp - w / 2) / pxPerDegH));
              const terrainEl = mask.mask ? mask.mask.elevDeg[heightIdx * mask.mask.azimuthCount + (Math.floor((((bodyAz % 360) + 360) % 360) / mask.mask.binWidthDeg) % mask.mask.azimuthCount)] : -0.09;
              const ty = yAt(Number.isFinite(terrainEl) ? terrainEl : -0.09);
              skyPath.lineTo(xp, ty);
            }
            skyPath.lineTo(w, 0);
            skyPath.closePath();

            // Ground (below terrain); punch a transparent hole for the sky so the panel background shows there.
            ctx.fillStyle = color.terrain;
            ctx.fillRect(0, 0, w, h);
            ctx.save();
            ctx.clip(skyPath);
            ctx.clearRect(0, 0, w, h);
            ctx.restore();

            // Disk, clipped to the sky region only — the visible area is what makes it "disk-fraction honest".
            const r = Math.max(1, (diskDeg / 2) * pxPerDegV);
            const cx = xAt(az);
            const cy = yAt(el);
            ctx.save();
            ctx.clip(skyPath);
            if (body === 'sun') {
              const img = getBodyBitmap('sun_sdo');
              ctx.beginPath();
              ctx.arc(cx, cy, r, 0, Math.PI * 2);
              if (img) {
                ctx.save();
                ctx.clip();
                ctx.drawImage(img, cx - r, cy - r, 2 * r, 2 * r);
                ctx.restore();
              } else {
                const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
                grad.addColorStop(0, color.sun);
                grad.addColorStop(1, '#c97e12');
                ctx.fillStyle = grad;
                ctx.fill();
              }
            } else {
              const ap = earthAppearance(series.sunAzDeg[i], series.sunElevDeg[i], series.earthAzDeg[i], series.earthElevDeg[i], latRef.current);
              const img = getBodyBitmap('earth_epic');
              ctx.save();
              ctx.translate(cx, cy);
              ctx.beginPath();
              ctx.arc(0, 0, r, 0, Math.PI * 2);
              ctx.clip();
              // 1) the Earth, pole oriented to the local sky
              ctx.save();
              ctx.rotate(ap.imageRotation);
              if (img) ctx.drawImage(img, -r, -r, 2 * r, 2 * r);
              else {
                ctx.fillStyle = color.earth;
                ctx.fillRect(-r, -r, 2 * r, 2 * r);
              }
              ctx.restore();
              // 2) night side: bright limb toward the Sun, terminator x = cos(ε)·√(r²−y²) in the Sun-aligned frame
              ctx.rotate(ap.sunAngle);
              ctx.fillStyle = EARTH_SHADE;
              ctx.beginPath();
              ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, true); // left limb, top → bottom
              const cosEps = Math.cos((ap.elongationDeg * Math.PI) / 180);
              const steps = 24;
              for (let k = 0; k <= steps; k++) {
                const y = r - (2 * r * k) / steps;
                ctx.lineTo(cosEps * Math.sqrt(Math.max(0, r * r - y * y)), y);
              }
              ctx.closePath();
              ctx.fill();
              ctx.restore();
            }
            ctx.restore();

            // V-6 check: area actually visible above the terrain vs the engine's disk fraction.
            const drawnPct = visibleDiskFraction(cx, cy, r, terrainYAtX) * 100;

            // Terrain edge stroke.
            ctx.strokeStyle = color.terrainEdge;
            ctx.lineWidth = 1;
            ctx.stroke(skyPath);
            ctx.restore();

            // Readout.
            ctx.fillStyle = color.text;
            ctx.font = '11px var(--font-mono)';
            ctx.textAlign = 'left';
            const c = visualCopy();
            ctx.fillText(c.t(body === 'sun' ? 'lens.sunDisk' : 'lens.earthDisk', { pct: c.pct(diskPct), drawn: c.pct(drawnPct) }), 6, h - 8);
            ctx.fillStyle = color.textFaint;
            ctx.fillText(c.t('lens.scale'), 6, 12);
          }}
          drawStatic={() => {
            /* all drawing happens in the overlay, redrawn whenever crosshairBus changes (scrub/hover/play) */
          }}
          overlayBuses={OVERLAY_BUSES}
        />
      </div>
      <div style={{ fontSize: 'var(--fs-2xs)', color: color.textFaint, padding: '2px 4px', lineHeight: 1.2 }}>
        Sun: NASA/SDO · Earth: NASA EPIC/DSCOVR
      </div>
    </div>
  );
}
