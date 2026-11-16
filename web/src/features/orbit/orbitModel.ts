// Owner: Abhinav
// Orbit page — the design's sample model: curated sites, a synthetic horizon, Sun / Earth / DSN visibility over a lunar
// month, and the countdowns derived from it. These are the design preview's placeholder numbers ("sample values"); when the
// page is wired to the engine, this file is what gets replaced by real results. Ported unchanged from the approved design.

import { dataMode } from '../../engine/data/source';
import { getBaseUtc } from './windowStart';
import { realHorizon, realModelReady, realSnapshot } from './realModel';

export const MONTH_HOURS = 708.73;
export const T_MAX = 709;
/** Hours between the design's t = 0 (2027-02-08 00:00 UTC) and the new moon the Sun's longitude is counted from. */
export const SUN_PHASE_OFFSET_H = 7;
export const BASE_UTC = Date.UTC(2027, 1, 8, 0, 0, 0);

export type Tone = 'good' | 'warn' | 'bad';

export interface Site {
  id: string;
  name: string;
  short: string;
  group: string;
  lat: number;
  lon: number;
  tag?: string;
  tone?: Tone;
  seed: number;
  lift: number;
  noEarth?: boolean;
  custom?: boolean;
}

export const SITES: readonly Site[] = [
  {
    id: 'im2',
    name: 'Mons Mouton, IM-2 site',
    short: 'IM-2 Athena site',
    group: 'Artemis era · CLPS',
    lat: -84.7906,
    lon: 29.1957,
    tag: 'Good',
    tone: 'good',
    seed: 0,
    lift: 0.1,
  },
  {
    id: 'shack',
    name: 'Shackleton connecting ridge',
    short: 'Connecting ridge',
    group: 'Near-perpetual light',
    lat: -89.54,
    lon: 129.0,
    tag: 'Good',
    tone: 'good',
    seed: 0.6,
    lift: 0.9,
  },
  {
    id: 'malapert',
    name: 'Malapert Massif',
    short: 'Malapert Massif',
    group: 'Artemis region',
    lat: -85.9,
    lon: 0.0,
    tag: 'Good',
    tone: 'good',
    seed: 1.2,
    lift: 0.5,
  },
  {
    id: 'haworth',
    name: 'Haworth',
    short: 'Haworth',
    group: 'Artemis region',
    lat: -87.5,
    lon: -5.0,
    tag: 'Marginal',
    tone: 'warn',
    seed: 2.1,
    lift: -0.4,
  },
  {
    id: 'nobile1',
    name: 'Nobile Rim 1',
    short: 'Nobile Rim 1',
    group: 'Artemis region',
    lat: -85.4,
    lon: 31.4,
    tag: 'Marginal',
    tone: 'warn',
    seed: 2.8,
    lift: -0.1,
  },
  {
    id: 'degerlache',
    name: 'de Gerlache Rim 2',
    short: 'de Gerlache Rim 2',
    group: 'Artemis region',
    lat: -88.5,
    lon: -87.0,
    tag: 'Good',
    tone: 'good',
    seed: 3.4,
    lift: 0.3,
  },
  {
    id: 'a11',
    name: 'Apollo 11',
    short: 'Apollo 11',
    group: 'Equatorial, for contrast',
    lat: 0.6741,
    lon: 23.473,
    tag: 'Good',
    tone: 'good',
    seed: 4.0,
    lift: 1.5,
  },
  {
    id: 'ce6',
    name: "Chang'e-6 (far side)",
    short: "Chang'e-6",
    group: 'Far side, for contrast',
    lat: 41.6,
    lon: -153.99,
    tag: 'No DTE',
    tone: 'bad',
    seed: 4.6,
    lift: 1.5,
    noEarth: true,
  },
];

export const MASTS = [0, 1, 2, 5, 10] as const;

export const customSite = (lat: number, lon: number): Site => ({
  id: 'custom',
  name: 'Custom pin',
  short: 'Custom pin',
  group: 'Your coordinates',
  lat,
  lon,
  seed: Math.abs(Math.sin(lat * 12.9 + lon * 7.7)) * 4,
  lift: Math.max(-0.8, Math.min(0.8, (-lat - 85) * 0.1)),
  custom: true,
});

export const fmtCoords = (lat: number, lon: number): string =>
  `${Math.abs(lat).toFixed(4)}°${lat < 0 ? 'S' : 'N'}  ${Math.abs(lon).toFixed(4)}°${lon < 0 ? 'W' : 'E'}`;

/** "-84.79", "84.79 S", "29.2°E" -> signed degrees, or null. `pos`/`neg` are the hemisphere letters for + and −. */
export function parseCoord(str: string, pos: string, neg: string): number | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*°?\s*([NSEWnsew])?\s*$/.exec(str);
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (m[2]) {
    const L = m[2].toUpperCase();
    if (L === neg) v = -Math.abs(v);
    else if (L === pos) v = Math.abs(v);
    else return null;
  }
  return v;
}

/** Real-data mode: the Sun, Earth, DSN and terrain horizon come from the engine's data files, not the design's sample model. */
const isRealActive = (): boolean => dataMode() === 'real' && realModelReady();

/** Terrain horizon (degrees) at an azimuth for a site, lowered by the array height. Synthetic unless real data is loaded. */
export function horizon(az: number, site: Site, mast: number): number {
  if (isRealActive()) return realHorizon(az, site, mast);
  const s = site.seed;
  const r = (az * Math.PI) / 180;
  const d = (az - (205 + s * 25)) / 16;
  return (
    0.9 +
    0.7 * Math.sin(r * 2 + 0.5 + s) +
    0.5 * Math.sin(r * 5 + 1.3 + s * 1.7) +
    0.25 * Math.sin(r * 11) +
    2.4 * Math.exp(-d * d) -
    mast * 0.07
  );
}

export interface Snapshot {
  sunAz: number;
  sunEl: number;
  frac: number;
  earthAz: number;
  earthEl: number;
  earthUp: boolean;
  dsn: boolean;
}

export function model(t: number, site: Site, mast: number): Snapshot {
  if (isRealActive()) return realSnapshot(t, site, mast);
  const sunAz = (((180 - (360 * (t + SUN_PHASE_OFFSET_H)) / MONTH_HOURS + site.seed * 8) % 360) + 360) % 360;
  const sunEl = 1.3 + site.lift + 0.4 * Math.sin((2 * Math.PI * t) / 2600);
  const dd = (sunEl - horizon(sunAz, site, mast)) / 0.27;
  const frac = dd >= 1 ? 1 : dd <= -1 ? 0 : (Math.acos(-dd) + dd * Math.sqrt(1 - dd * dd)) / Math.PI;
  const earthAz = (20 + site.seed * 10 + 6.5 * Math.sin((2 * Math.PI * t) / 661) + 360) % 360;
  const earthEl = 2.6 + site.lift * 0.3 + 2.2 * Math.sin((2 * Math.PI * t) / 655.7);
  const earthUp = !site.noEarth && earthEl - horizon(earthAz, site, mast) > 0.5;
  const hod = ((t % 24) + 24) % 24;
  const dsn = earthUp && !(hod >= 5 && hod < 7);
  return { sunAz, sunEl, frac, earthAz, earthEl, earthUp, dsn };
}

export interface Band {
  left: number;
  width: number;
}

/** Contiguous "on" stretches over the month as % of the timeline, for the three bands. */
export function bands(key: 'sun' | 'earth' | 'dsn', site: Site, mast: number): Band[] {
  const out: Band[] = [];
  let start = -1;
  for (let h = 0; h <= T_MAX; h++) {
    const m = model(h, site, mast);
    const on = key === 'sun' ? m.frac > 0.5 : key === 'earth' ? m.earthUp : m.dsn;
    if (on && start < 0) start = h;
    if ((!on || h === T_MAX) && start >= 0) {
      const end = on ? T_MAX : h;
      out.push({ left: (start / T_MAX) * 100, width: ((end - start) / T_MAX) * 100 });
      start = -1;
    }
  }
  return out;
}

/** Hours until `test` first holds (within a month), or null. */
export function until(t: number, site: Site, mast: number, test: (m: Snapshot) => boolean): number | null {
  for (let h = t + 1; h <= t + T_MAX; h++) if (test(model(h, site, mast))) return h - t;
  return null;
}

export function fmtHours(h: number | null): string {
  if (h === null) return '> 30 d';
  const d = Math.floor(h / 24);
  const r = h % 24;
  return d > 0 ? `${d} d ${r} h` : `${r} h`;
}

export function timeLabel(t: number): string {
  const iso = new Date(getBaseUtc() + t * 3_600_000).toISOString();
  return `${iso.slice(0, 10)}  ${iso.slice(11, 16)} UTC`;
}

export const timelineTicks = (): string[] =>
  Array.from({ length: 8 }, (_, k) => new Date(getBaseUtc() + k * 101.3 * 3_600_000).toISOString().slice(5, 10));
