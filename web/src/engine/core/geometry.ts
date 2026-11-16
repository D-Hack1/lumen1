// Owner: Nived
// Site frames and topocentric geometry (Python twins: common/frames.py and reference/interp.py `Ephemeris.body_at`).
//   up = radial; reference axis = +X_ME for |lat| >= 60 deg else +Z_ME (singularity-free at the pole);
//   rotation rows = (east, north_reference, up)  =>  local = M * vec_MOON_ME;
//   azimuth = atan2(east, north_reference) in [0, 360), measured from the projected reference axis.
import { DEG, LUNAR_RADIUS_KM, POLAR_REFERENCE_LATITUDE_DEG } from './constants';
import { hermitePositions, type BodyId, type Vec3 } from './interp';
import type { Ephemeris } from '../data/ephem';

export type Mat3 = [Vec3, Vec3, Vec3];

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
function unit(a: Vec3): Vec3 {
  const n = norm(a);
  if (n === 0) throw new Error('cannot normalize a zero-length vector');
  return [a[0] / n, a[1] / n, a[2] / n];
}

export function siteUp(latDeg: number, lonDegEast: number): Vec3 {
  const la = latDeg * DEG;
  const lo = lonDegEast * DEG;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

export const referenceAxis = (latDeg: number): Vec3 => (Math.abs(latDeg) >= POLAR_REFERENCE_LATITUDE_DEG ? [1, 0, 0] : [0, 0, 1]);

export function siteRotationMatrix(latDeg: number, lonDegEast: number): Mat3 {
  const up = siteUp(latDeg, lonDegEast);
  const east = unit(cross(referenceAxis(latDeg), up));
  const northRef = unit(cross(up, east));
  return [east, northRef, up];
}

/** Site centre on the 1737.4 km reference sphere at observer height `heightM`. */
export function sitePositionKm(latDeg: number, lonDegEast: number, heightM = 0): Vec3 {
  const r = LUNAR_RADIUS_KM + heightM / 1000;
  const u = siteUp(latDeg, lonDegEast);
  return [r * u[0], r * u[1], r * u[2]];
}

export function directionToAzEl(v: Vec3): { azimuthDeg: number; elevationDeg: number } {
  const [east, north, up] = unit(v);
  const az = (Math.atan2(east, north) / DEG + 360) % 360;
  return { azimuthDeg: az, elevationDeg: Math.asin(up) / DEG };
}

export interface Site {
  latDeg: number;
  lonDegEast: number;
  heightM: number;
  /** Precomputed once per site; reuse across samples. */
  position: Vec3;
  rotation: Mat3;
}

export function makeSite(latDeg: number, lonDegEast: number, heightM = 0, rotation?: Mat3): Site {
  return { latDeg, lonDegEast, heightM, position: sitePositionKm(latDeg, lonDegEast, heightM), rotation: rotation ?? siteRotationMatrix(latDeg, lonDegEast) };
}

export interface BodyGeometry {
  distanceKm: number;
  azimuthDeg: number;
  elevationDeg: number;
}

/** Topocentric direction = (Moon-centred body vector) - (site vector); LT+S is already in the ephemeris. */
export function bodyGeometry(position: Vec3, site: Site): BodyGeometry {
  const topo: Vec3 = [position[0] - site.position[0], position[1] - site.position[1], position[2] - site.position[2]];
  const distanceKm = norm(topo);
  const dir: Vec3 = [topo[0] / distanceKm, topo[1] / distanceKm, topo[2] / distanceKm];
  const local: Vec3 = [dot(site.rotation[0], dir), dot(site.rotation[1], dir), dot(site.rotation[2], dir)];
  return { distanceKm, ...directionToAzEl(local) };
}

/**
 * Per-site memo of body geometry by epoch. The geometry depends only on (ephemeris, site, time), never on the horizon, so the nominal,
 * -sigma and +sigma passes and every event refinement of one request share it instead of recomputing the Hermite interpolation and the
 * frame rotation. Keyed weakly on the Site object (one per request), so it is dropped with the request; capped so it cannot grow unbounded.
 * The cached values are exactly what the uncached call returns (same function, same inputs).
 */
const GEOMETRY_CACHE_MAX = 250_000;
const geometryCache = new WeakMap<Site, { eph: Ephemeris; byT: Map<number, BodyGeometry[]> }>();
const BODY_INDEX: Record<BodyId, number> = { sun: 0, earth: 1 };

export function bodyAt(eph: Ephemeris, body: BodyId, tMs: number, site: Site): BodyGeometry {
  let c = geometryCache.get(site);
  if (!c || c.eph !== eph) {
    c = { eph, byT: new Map() };
    geometryCache.set(site, c);
  }
  let g = c.byT.get(tMs);
  if (!g) {
    const p = hermitePositions(eph, tMs);
    g = [bodyGeometry(p.sun, site), bodyGeometry(p.earth, site)];
    if (c.byT.size < GEOMETRY_CACHE_MAX) c.byT.set(tMs, g);
  }
  return g[BODY_INDEX[body]];
}
