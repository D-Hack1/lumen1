// Owner: Abhinav
// Orbit page — the circular south-pole view: LOLA terrain with live light / Earth view / month map, 85°S and 88°S rings, the
// Sun marker on the rim, click-to-pin, the pin, and a pointer-rate hover tooltip (written straight to the DOM, not React state).
import { useEffect, useMemo, useRef } from 'react';
import { SUN_PHASE_OFFSET_H } from './orbitModel';
import { tooltipCopy } from './polarCopy';
import { latLonToPixel } from './polarGrid';
import { renderPolarFrame, samplePolar, type PolarLayer, type PolarTerrain } from './polarTerrain';
import { polarSunAzimuthDeg } from './ephemeris';

export interface PolarStats {
  litPct: number | null;
  inView: boolean;
  monthPct: number;
  alwaysDark: boolean;
  sunElDeg: number;
  horizonDeg: number;
  lit: boolean;
  heightKm: number;
}

export interface PolarStageProps {
  terrain: PolarTerrain;
  t: number;
  layer: PolarLayer;
  showAlwaysDark: boolean;
  pin: { lat: number; lon: number };
  onPick: (lat: number, lon: number) => void;
  onStats: (s: PolarStats) => void;
}

const MAP_RADIUS_KM = 304;
const MOON_R_KM = 1737.4;

export function PolarStage({ terrain, t, layer, showAlwaysDark, pin, onPick, onStats }: PolarStageProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<ImageData | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const tipA = useRef<HTMLDivElement>(null);
  const tipB = useRef<HTMLDivElement>(null);
  const tipC = useRef<HTMLDivElement>(null);
  const n = terrain.n;
  const hours = t + SUN_PHASE_OFFSET_H;

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    image.current ??= ctx.createImageData(n, n);
    const { sunlitPct } = renderPolarFrame(
      terrain,
      { layer, hoursSinceNewMoon: hours, earthHours: hours, showAlwaysDark },
      image.current.data,
    );
    ctx.putImageData(image.current, 0, 0);

    let stats: PolarStats = {
      litPct: layer === 'live' ? sunlitPct : null,
      inView: false,
      monthPct: 0,
      alwaysDark: false,
      sunElDeg: 0,
      horizonDeg: 0,
      lit: false,
      heightKm: 0,
    };
    if (pin.lat <= -80) {
      const p = latLonToPixel(terrain.grid, pin.lat, pin.lon);
      const s = samplePolar(terrain, Math.round(p.px), Math.round(p.py), { hoursSinceNewMoon: hours, earthHours: hours });
      if (s) {
        stats = {
          ...stats,
          inView: true,
          monthPct: s.monthLitPct,
          alwaysDark: s.alwaysDark,
          sunElDeg: s.sunElevationDeg,
          horizonDeg: s.sunHorizonDeg,
          lit: s.sunElevationDeg > s.sunHorizonDeg,
          heightKm: s.heightM / 1000,
        };
      }
    }
    onStats(stats);
  }, [terrain, layer, hours, t, showAlwaysDark, pin.lat, pin.lon, n, onStats]);

  const hide = () => {
    if (tip.current) tip.current.style.display = 'none';
  };
  const onMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = tip.current;
    if (!el) return;
    const rc = e.currentTarget.getBoundingClientRect();
    const gx = Math.floor(((e.clientX - rc.left) / rc.width) * n);
    const gy = Math.floor(((e.clientY - rc.top) / rc.height) * n);
    const s = samplePolar(terrain, gx, gy, { hoursSinceNewMoon: hours, earthHours: hours });
    if (!s) {
      hide();
      return;
    }
    const copy = tooltipCopy(s, layer, showAlwaysDark);
    if (tipA.current) tipA.current.textContent = copy.title;
    if (tipB.current) tipB.current.textContent = copy.body;
    if (tipC.current) tipC.current.textContent = copy.coords;
    let tx = e.clientX - rc.left + 16;
    let ty = e.clientY - rc.top + 16;
    if (tx > rc.width - 250) tx = e.clientX - rc.left - 256;
    if (ty > rc.height - 120) ty = e.clientY - rc.top - 110;
    el.style.left = `${Math.max(0, tx)}px`;
    el.style.top = `${Math.max(0, ty)}px`;
    el.style.display = 'block';
  };
  const onClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rc = e.currentTarget.getBoundingClientRect();
    const dx = ((e.clientX - rc.left) / rc.width) * 2 - 1;
    const dy = ((e.clientY - rc.top) / rc.height) * 2 - 1;
    const rr = Math.hypot(dx, dy);
    if (rr > 1) return;
    onPick(
      -90 + (2 * Math.atan((rr * MAP_RADIUS_KM) / (2 * MOON_R_KM)) * 180) / Math.PI,
      (Math.atan2(dx, -dy) * 180) / Math.PI,
    );
  };

  const sunAz = (polarSunAzimuthDeg(hours) * Math.PI) / 180;
  const pinPos = useMemo(() => {
    const r = Math.min(1, Math.max(0, (Math.tan(((pin.lat + 90) * Math.PI) / 360) * 2 * MOON_R_KM) / MAP_RADIUS_KM));
    const lr = (pin.lon * Math.PI) / 180;
    return { x: 50 + 50 * r * Math.sin(lr), y: 50 - 50 * r * Math.cos(lr), visible: pin.lat <= -80 };
  }, [pin.lat, pin.lon]);

  return (
    <>
      <div className="lm-polewrap" style={{ zIndex: 2 }}>
        <button
          type="button"
          className="lm-pole"
          onClick={onClick}
          onMouseMove={onMove}
          onMouseLeave={hide}
          aria-label="NASA LOLA terrain of the lunar south pole, 80°S to 90°S, with live light and shadow. Click to drop a pin, or use the coordinate form."
        >
          <canvas ref={canvas} width={n} height={n} aria-hidden="true" className="lm-pole__canvas" />
          <span
            aria-hidden="true"
            className="lm-pole__ring"
            style={{ left: '25%', top: '25%', width: '50%', height: '50%' }}
          />
          <span
            aria-hidden="true"
            className="lm-pole__ring"
            style={{ left: '40%', top: '40%', width: '20%', height: '20%' }}
          />
          <span aria-hidden="true" className="lm-pole__vignette" />
        </button>
        <span
          aria-hidden="true"
          className="lm-pole__sun"
          style={{
            left: `${(50 + 51 * Math.sin(sunAz)).toFixed(2)}%`,
            top: `${(50 - 51 * Math.cos(sunAz)).toFixed(2)}%`,
          }}
        />
        <div ref={tip} className="lm-tip" role="status">
          <div ref={tipA} className="lm-tip__a" />
          <div ref={tipB} className="lm-tip__b" />
          <div ref={tipC} className="lm-tip__c" />
        </div>
      </div>
      <div className="lm-polewrap" style={{ zIndex: 6, pointerEvents: 'none' }}>
        {pinPos.visible && (
          <div
            aria-hidden="true"
            className="lm-pin"
            style={{ left: `${pinPos.x.toFixed(2)}%`, top: `${pinPos.y.toFixed(2)}%` }}
          >
            <svg width="22" height="30" viewBox="0 0 18 26">
              <path
                d="M9 25C9 25 1 15 1 9a8 8 0 0 1 16 0c0 6-8 16-8 16z"
                fill="#F2B04A"
                stroke="#0E0D0B"
                strokeWidth="1.5"
              />
              <circle cx="9" cy="9" r="3" fill="#0E0D0B" />
            </svg>
          </div>
        )}
      </div>
    </>
  );
}
