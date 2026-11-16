// Owner: Abhinav
// Numbers behind Stand here, Compare and Slip explorer. Built on the Orbit page's sample model (orbitModel.ts), so all four
// pages agree. Windows are 14 days (336 h), as in the design.
import { horizon, model, type Site } from '../orbit/orbitModel';

export const WINDOW_HOURS = 336;
export const SLIP_DAYS = 28;

export interface WindowStats {
  /** Percent of the window the Sun is above the local horizon (>50% of the disc). */
  sun: number;
  earth: number;
  dsn: number;
  /** Longest unbroken stretch without sunlight, hours. */
  dark: number;
}

/** Statistics for the 14-day window starting `startHour` hours after the 8 Feb 2027 epoch. */
export function windowStats(site: Site, mast: number, startHour = 0): WindowStats {
  let lit = 0;
  let earth = 0;
  let dsn = 0;
  let run = 0;
  let worst = 0;
  for (let h = 0; h < WINDOW_HOURS; h++) {
    const m = model(startHour + h, site, mast);
    if (m.frac > 0.5) {
      lit++;
      run = 0;
    } else {
      run++;
      if (run > worst) worst = run;
    }
    if (m.earthUp) earth++;
    if (m.dsn) dsn++;
  }
  return {
    sun: (lit / WINDOW_HOURS) * 100,
    earth: (earth / WINDOW_HOURS) * 100,
    dsn: (dsn / WINDOW_HOURS) * 100,
    dark: worst,
  };
}

/** One window per slip day, 0 … SLIP_DAYS − 1. */
export const slipWindows = (site: Site, mast: number): WindowStats[] =>
  Array.from({ length: SLIP_DAYS }, (_, d) => windowStats(site, mast, d * 24));

/** Slip day whose window has the most sunlight (earliest wins ties), weighing DSN contact as a tie-break. */
export function bestSlip(wins: readonly WindowStats[]): number {
  let best = 0;
  for (let i = 1; i < wins.length; i++) {
    const a = wins[i];
    const b = wins[best];
    if (a.sun > b.sun + 0.05 || (Math.abs(a.sun - b.sun) <= 0.05 && a.dsn > b.dsn + 0.05)) best = i;
  }
  return best;
}

export const fmtDuration = (h: number): string => (h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${h} h`);

export const fmtPoints = (a: number, b: number): string => {
  const x = Math.round(a - b);
  return x === 0 ? 'Same as on time' : `${x > 0 ? '+' : ''}${x} points vs on time`;
};

// ---- Stand-here panorama (1000 × 300 viewBox, azimuth along x, elevation up) ----

export const PANO_W = 1000;
export const PANO_H = 300;
export const skyY = (elDeg: number): number => 262 - elDeg * 34;
export const azToX = (az: number): number => (az / 360) * PANO_W;
export const xToAz = (x: number): number => (x / PANO_W) * 360;

export function horizonPath(site: Site, mast: number): string {
  let d = `M0 ${PANO_H}`;
  for (let az = 0; az <= 360; az += 3) d += ` L${azToX(az).toFixed(1)} ${skyY(horizon(az, site, mast)).toFixed(1)}`;
  return `${d} L${PANO_W} ${PANO_H} Z`;
}

/** Dashed path the Sun or Earth traces across the sky over a month; breaks where azimuth wraps. */
export function skyTrack(key: 'sun' | 'earth', site: Site, mast: number): string {
  let p = '';
  let prev: number | null = null;
  for (let h = 0; h <= 709; h += 8) {
    const q = model(h, site, mast);
    const a = key === 'sun' ? q.sunAz : q.earthAz;
    const e = key === 'sun' ? q.sunEl : q.earthEl;
    p += `${prev === null || Math.abs(a - prev) > 180 ? ' M' : ' L'}${azToX(a).toFixed(1)} ${skyY(e).toFixed(1)}`;
    prev = a;
  }
  return p;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compassPoint = (az: number): string => POINTS[Math.round((((az % 360) + 360) % 360) / 45) % 8];
