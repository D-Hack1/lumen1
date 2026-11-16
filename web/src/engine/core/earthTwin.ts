// Owner: Nived
// Earth Twin (Educator, Tier 1): where the Sun would be for an Earth location at the same latitude, using a standard
// terrestrial solar-position approximation. EDUCATIONAL, not ephemeris-grade: declination is a sine fit and the equation
// of time and refraction are ignored (the UI labels it "educational approximation"). Pure; no data needed.
import { DEG } from './constants';

const OBLIQUITY_DEG = 23.44;

/** Solar declination (deg) for a UTC instant. Sine fit with the March equinox near day 80. */
export function declinationDeg(tMs: number): number {
  const d = new Date(tMs);
  const dayOfYear = Math.floor((tMs - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86_400_000);
  return OBLIQUITY_DEG * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81));
}

export interface EarthTwinPoint {
  hour: number; // local solar hour 0..24
  elevationDeg: number;
  azimuthDeg: number; // compass, from north through east
}

/** Sun elevation/azimuth over one local solar day at `latDeg` (south negative), `steps` samples from 0h to 24h. */
export function earthTwinDay(latDeg: number, tMs: number, steps = 96): EarthTwinPoint[] {
  const phi = latDeg * DEG;
  const delta = declinationDeg(tMs) * DEG;
  const out: EarthTwinPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const hour = (24 * i) / steps;
    const H = (hour - 12) * 15 * DEG;
    const sinEl = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(H);
    const el = Math.asin(Math.min(1, Math.max(-1, sinEl)));
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(delta) * Math.cos(phi)) / DEG + 180;
    out.push({ hour, elevationDeg: el / DEG, azimuthDeg: (az + 360) % 360 });
  }
  return out;
}

/** Hours of daylight: 24 in polar day, 0 in polar night. */
export function dayLengthHours(latDeg: number, tMs: number): number {
  const x = -Math.tan(latDeg * DEG) * Math.tan(declinationDeg(tMs) * DEG);
  if (x <= -1) return 24;
  if (x >= 1) return 0;
  return (2 * Math.acos(x)) / DEG / 15;
}

/** Is there a twilight (Sun between 0 and -6 deg) at some point in the day? On the Moon: never. */
export function hasTwilight(latDeg: number, tMs: number): boolean {
  return earthTwinDay(latDeg, tMs, 288).some((p) => p.elevationDeg < 0 && p.elevationDeg > -6);
}
