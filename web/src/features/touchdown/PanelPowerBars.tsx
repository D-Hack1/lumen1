// Owner: Ebin
// Per-panel power bars vs flat-ground baseline (PLAN_FINAL §5.6). Fast Lane: widths and numbers are written to
// DOM refs from `padDragBus` + `crosshairBus`, so tilt/yaw drags and scrubbing update live without re-rendering.
// Only the preset (human rate) changes which rows exist. Model: ./padModel.ts (relative; scaled to engine power).
import { useEffect, useRef } from 'react';
import type { Series } from '../../engine/types';
import { crosshairBus, padDragBus } from '../../state/buses';
import type { PanelPreset } from '../../state/scenarioStore';
import { color } from '../../ui/tokens';
import { AU_KM } from '../../engine/core/constants';
import { ASSUMED_PANEL, generationAt, groundNormalFromPad } from '../../engine/core/padPower';

interface PanelFace {
  label: string;
  watts: number;
  baselineWatts: number;
}

export interface PanelPowerBarsProps {
  preset: PanelPreset;
  series: Series | null;
  slopeDeg: number;
  downhillAzDeg: number;
  /** Yaw 'auto' (the sweep's best) instead of the dragged yaw. */
  yawAuto?: boolean;
}

const LABELS: Record<PanelPreset, string[]> = {
  fourSide: ['+X side', '+Y side', '−X side', '−Y side'],
  singleHeading: ['Panel (north)'],
  horizontalDeck: ['Deck'],
  trackingMast: ['Tracking'],
};

export function PanelPowerBars({ preset, series, slopeDeg, downhillAzDeg, yawAuto = false }: PanelPowerBarsProps) {
  const labels = LABELS[preset];
  const fillRefs = useRef<(HTMLDivElement | null)[]>([]);
  const baseRefs = useRef<(HTMLDivElement | null)[]>([]);
  const valRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const paint = () => {
      let faces: PanelFace[] = labels.map((label) => ({ label, watts: 0, baselineWatts: 0 }));
      if (series) {
        const i = Math.max(0, Math.min(series.sunElevDeg.length - 1, Math.round((crosshairBus.get().tScrub - series.t0) / series.stepMs)));
        const d = padDragBus.get();
        // The engine's R3 power model (Gowri's power.py twin), at the scrub instant, with the live (dragged) tilt and yaw.
        const r = generationAt(
          { preset, yawDeg: yawAuto ? null : d.yawDeg, tiltMagDeg: d.tiltMagDeg, tiltDirDeg: d.tiltDirDeg, groundNormal: groundNormalFromPad(slopeDeg, downhillAzDeg), ...ASSUMED_PANEL },
          { azimuthDeg: series.sunAzDeg[i], elevationDeg: series.sunElevDeg[i], distanceKm: AU_KM, diskFraction: series.sunDiskPct[i] / 100 },
        );
        faces = labels.map((label, k) => ({ label, watts: r.faces[k].watts, baselineWatts: r.faces[k].flatWatts }));
      }
      const max = Math.max(1, ...faces.map((f) => Math.max(f.watts, f.baselineWatts)));
      faces.forEach((f, k) => {
        const fill = fillRefs.current[k];
        const base = baseRefs.current[k];
        const val = valRefs.current[k];
        if (fill) fill.style.width = `${(f.watts / max) * 100}%`;
        if (base) base.style.left = `${(f.baselineWatts / max) * 100}%`;
        if (val) val.textContent = `${f.watts.toFixed(0)} W`;
      });
    };
    paint();
    const un = [padDragBus.subscribe(paint), crosshairBus.subscribe(paint)];
    return () => un.forEach((u) => u());
  }, [preset, series, slopeDeg, downhillAzDeg, yawAuto, labels]);

  return (
    <div className="panel-power-bars num" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }} aria-label="Per-panel power versus flat-ground baseline">
      {labels.map((label, k) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <span style={{ width: 78, fontSize: 'var(--fs-xs)', color: color.textMuted }}>{label}</span>
          <div style={{ flex: 1, height: 10, background: color.surface3, position: 'relative' }}>
            <div ref={(el) => (fillRefs.current[k] = el)} style={{ position: 'absolute', inset: 0, width: 0, background: color.sun }} />
            <div ref={(el) => (baseRefs.current[k] = el)} style={{ position: 'absolute', top: -1, bottom: -1, left: 0, width: 2, background: color.text }} title="flat-ground baseline" />
          </div>
          <span ref={(el) => (valRefs.current[k] = el)} style={{ width: 48, textAlign: 'right' }} />
        </div>
      ))}
      <span style={{ fontSize: 'var(--fs-2xs)', color: color.textFaint }}>▏ marker = flat-ground baseline · W per m² of panel (assumed 1 m², η 100%)</span>
    </div>
  );
}
