// Owner: Abhinav
// Orbit feature — Sun / Earth geometry in the selenographic frame, from "hours since the last new moon".
//
// Frame (right-handed): +x = sub-Earth point (lat 0, lon 0), +y = 90°E, +z = lunar north.
// Mock mode: a smooth analytic stand-in (mean synodic month, fixed sub-solar latitude, sinusoidal libration).
// Real mode (VITE_LUMEN_DATA=real, once realModel.ts has loaded public/data/ephem): the Sun and Earth directions are the
// ephemeris's own (Hermite-interpolated, MOON_ME frame, which is this file's frame), so the globe, the polar view and the side
// panels all use one Sun. Callers pass hours since REFERENCE_NEW_MOON_UTC for everything and never re-derive anything.
import { hermitePositions, inEphemerisRange } from '../../engine/core/interp';
import { dataMode } from '../../engine/data/source';
import { getRealEphemeris } from './realEphem';

export type Vec3 = readonly [number, number, number];

export const SYNODIC_HOURS = 708.73;
/** Mean sub-solar latitude used for lighting (degrees). The true value swings ±1.54°; −1° is about right for February. */
export const DEFAULT_SUBSOLAR_LAT_DEG = -1.0;
/** New moon of 2027-02-07 16:56 UTC — the epoch `hoursSinceNewMoon` is counted from in demos and tests. */
export const REFERENCE_NEW_MOON_UTC = Date.UTC(2027, 1, 7, 16, 56, 0);

const RAD = Math.PI / 180;

/** Unit vectors toward the Sun and Earth from the real ephemeris, or null (mock mode, not loaded, or outside its span). */
let lastHours = NaN;
let lastDirs: { sun: Vec3; earth: Vec3 } | null = null;
function realDirs(hours: number): { sun: Vec3; earth: Vec3 } | null {
  if (dataMode() !== 'real') return null;
  const eph = getRealEphemeris();
  if (!eph) return null;
  if (hours === lastHours) return lastDirs;
  const tMs = REFERENCE_NEW_MOON_UTC + hours * 3_600_000;
  let dirs: { sun: Vec3; earth: Vec3 } | null = null;
  if (inEphemerisRange(eph, tMs)) {
    const p = hermitePositions(eph, tMs);
    const unit = (v: readonly number[]): Vec3 => {
      const r = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / r, v[1] / r, v[2] / r];
    };
    dirs = { sun: unit(p.sun), earth: unit(p.earth) };
  }
  lastHours = hours;
  lastDirs = dirs;
  return dirs;
}

export function hoursSinceNewMoon(date: Date | number): number {
  const ms = typeof date === 'number' ? date : date.getTime();
  return (ms - REFERENCE_NEW_MOON_UTC) / 3_600_000;
}

/** Wrap an angle in degrees to [-180, 180). */
export const wrapLon = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Sub-solar point. At new moon the Sun is over the far side (lon 180°); at full moon over the sub-Earth point (lon 0°). */
export function subsolarPoint(hours: number, latDeg?: number): LatLon {
  const real = latDeg === undefined ? realDirs(hours) : null;
  if (real) return vecToLatLon(real.sun);
  if (latDeg === undefined) latDeg = DEFAULT_SUBSOLAR_LAT_DEG;
  return { lat: latDeg, lon: wrapLon(180 - (360 * hours) / SYNODIC_HOURS) };
}

/** Optical libration of Earth as seen from the Moon (degrees). Amplitude and periods are the mean values. */
export function earthLibration(hours: number): LatLon {
  const real = realDirs(hours);
  if (real) return vecToLatLon(real.earth);
  return { lon: 6.5 * Math.sin((2 * Math.PI * hours) / 661), lat: 6.5 * Math.sin((2 * Math.PI * hours) / 655.7) };
}

export function latLonToVec(latDeg: number, lonDeg: number): Vec3 {
  const la = latDeg * RAD;
  const lo = lonDeg * RAD;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

export function vecToLatLon(v: Vec3): LatLon {
  const r = Math.hypot(v[0], v[1], v[2]) || 1;
  return { lat: Math.asin(Math.max(-1, Math.min(1, v[2] / r))) / RAD, lon: Math.atan2(v[1], v[0]) / RAD };
}

export const sunVector = (hours: number, subsolarLatDeg?: number): Vec3 => {
  const real = subsolarLatDeg === undefined ? realDirs(hours) : null;
  if (real) return real.sun;
  const p = subsolarPoint(hours, subsolarLatDeg);
  return latLonToVec(p.lat, p.lon);
};

export const earthVector = (hours: number): Vec3 => {
  const real = realDirs(hours);
  if (real) return real.earth;
  const l = earthLibration(hours);
  return latLonToVec(l.lat, l.lon);
};

/** Longitude (degrees E) of the Earth's surface that faces the Moon — Earth spins 15°/h eastward, so this runs west. */
export const earthSubLunarLonDeg = (hours: number): number => wrapLon(25 - 15 * hours);

export type PhaseName =
  | 'New moon'
  | 'Waxing crescent'
  | 'First quarter'
  | 'Waxing gibbous'
  | 'Full moon'
  | 'Waning gibbous'
  | 'Last quarter'
  | 'Waning crescent';

export interface Phase {
  /** Lit fraction of the near side as seen from Earth, 0–1. */
  illuminated: number;
  /** Position in the month, 0 (new) → 0.5 (full) → 1 (new). */
  cycle: number;
  name: PhaseName;
}

export function phaseAt(hours: number, subsolarLatDeg?: number): Phase {
  const real = subsolarLatDeg === undefined ? realDirs(hours) : null;
  const s = real ? real.sun : sunVector(hours, subsolarLatDeg);
  // angle between Earth and Sun as seen from the Moon (the sub-Earth axis x in the analytic model)
  const illuminated = real ? (1 + (s[0] * real.earth[0] + s[1] * real.earth[1] + s[2] * real.earth[2])) / 2 : (1 + s[0]) / 2;
  // real: the Sun's longitude gives the phase (180° new, 90°E first quarter, 0° full, 90°W last quarter)
  const cycle = real ? ((((180 - vecToLatLon(s).lon) / 360) % 1) + 1) % 1 : (((hours / SYNODIC_HOURS) % 1) + 1) % 1;
  const waxing = cycle < 0.5;
  let name: PhaseName;
  if (illuminated < 0.03) name = 'New moon';
  else if (illuminated > 0.97) name = 'Full moon';
  else if (illuminated < 0.45) name = waxing ? 'Waxing crescent' : 'Waning crescent';
  else if (illuminated < 0.55) name = waxing ? 'First quarter' : 'Last quarter';
  else name = waxing ? 'Waxing gibbous' : 'Waning gibbous';
  return { illuminated, cycle, name };
}

/** Direction the Sun is in on the polar map, degrees clockwise from "up" (0° E up, east to the right). */
export const polarSunAzimuthDeg = (hours: number): number => ((subsolarPoint(hours).lon % 360) + 360) % 360;
