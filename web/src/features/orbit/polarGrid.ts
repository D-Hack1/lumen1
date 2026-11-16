// Owner: Abhinav
// Orbit feature — pixel <-> map <-> lat/lon for the square south-polar terrain grid (80°S–90°S, 0° E up, east right).
// Uses the app's own stereographic projection (engine/projection.ts) so pins, clicks and the terrain raster agree with the Basemap.
import { halfExtentKm, project, unproject } from '../../engine/projection';
import { wrapLon, type LatLon } from './ephemeris';

export interface PolarGrid {
  /** Pixels per side. */
  n: number;
  /** Map radius in km (the inscribed circle is the 80°S rim). */
  halfKm: number;
}

export const POLAR_LAT_LIMIT_DEG = -80;

export const kmPerPixel = (g: PolarGrid): number => (2 * g.halfKm) / g.n;

/** Centre of a pixel in map km (x east-ish/right, y up). */
export function pixelToMap(g: PolarGrid, px: number, py: number): { x: number; y: number } {
  const k = kmPerPixel(g);
  return { x: (px + 0.5 - g.n / 2) * k, y: (g.n / 2 - (py + 0.5)) * k };
}

/** Continuous pixel coordinates of a map point (pixel centres sit at integer values). */
export function mapToPixel(g: PolarGrid, x: number, y: number): { px: number; py: number } {
  const k = kmPerPixel(g);
  return { px: x / k + g.n / 2 - 0.5, py: g.n / 2 - y / k - 0.5 };
}

export function latLonToPixel(g: PolarGrid, lat: number, lon: number): { px: number; py: number } {
  const p = project(lat, lon);
  return mapToPixel(g, p.x, p.y);
}

export function pixelToLatLon(g: PolarGrid, px: number, py: number): LatLon {
  const m = pixelToMap(g, px, py);
  const u = unproject(m.x, m.y);
  return { lat: u.lat, lon: wrapLon(u.lon) };
}

export const inDisc = (g: PolarGrid, px: number, py: number): boolean => {
  const dx = px + 0.5 - g.n / 2;
  const dy = py + 0.5 - g.n / 2;
  return dx * dx + dy * dy < (g.n / 2) * (g.n / 2);
};

/** Is a point inside the 80°S disc (and therefore drawable on the polar raster)? */
export const insidePolarView = (lat: number): boolean => lat <= POLAR_LAT_LIMIT_DEG;

/** Position of a lat/lon on the view as fractions (0–1) of the square, or null if outside the disc. */
export function latLonToUnit(g: PolarGrid, lat: number, lon: number): { u: number; v: number } | null {
  if (!insidePolarView(lat)) return null;
  const p = project(lat, lon);
  return { u: 0.5 + p.x / (2 * g.halfKm), v: 0.5 - p.y / (2 * g.halfKm) };
}

/** Inverse of `latLonToUnit` for a click: fractions of the square -> lat/lon, or null outside the disc. */
export function unitToLatLon(g: PolarGrid, u: number, v: number): LatLon | null {
  const x = (u - 0.5) * 2 * g.halfKm;
  const y = (0.5 - v) * 2 * g.halfKm;
  if (Math.hypot(x, y) > g.halfKm) return null;
  const r = unproject(x, y);
  return { lat: r.lat, lon: wrapLon(r.lon) };
}

/** Radius of a latitude ring as a fraction of the disc radius (e.g. 85°S ≈ 0.5, 88°S ≈ 0.2). */
export const ringFraction = (g: PolarGrid, latSouthDeg: number): number => halfExtentKm(latSouthDeg) / g.halfKm;
