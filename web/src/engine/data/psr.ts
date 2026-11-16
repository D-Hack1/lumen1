// Owner: Nived
// Loader: terrain/psr/psr_distance.{json,bin}. DRAFT: the raster header is unresolved (data_terrain_misc.md §4.2).
// Assumed (matches the mock): uint16 little-endian, distance km = value * unit_km, row-major, top-left origin,
// pixel centre i at x = -half + (i + 0.5) * pixel, y = +half - (j + 0.5) * pixel (polar stereographic, km).
import { DataError, dataMode, fetchBuffer, fetchJson } from './source';

export interface PsrRaster {
  sizePx: [number, number];
  halfExtentKm: number;
  pixelKm: number;
  derived: boolean;
  /** Ground distance to the nearest qualifying PSR (km) at projected (xKm, yKm); NaN outside the raster. */
  distanceKm(xKm: number, yKm: number): number;
}

interface Raw {
  version: string;
  dtype: string;
  // mock layout
  size_px?: [number, number];
  pixel_m?: number;
  half_extent_km?: number;
  unit_km?: number;
  source?: 'published' | 'derived';
  // real layout (lumen_pipeline.terrain.psr): float32 km, NaN = nodata, square centred on the pole
  width_px?: number;
  height_px?: number;
  resolution_m?: number;
  radius_m?: number;
}

let cached: Promise<PsrRaster> | null = null;

/** Real data ships per-extent rasters (80_90S 240 m, 85_90S 60 m); the 80-90S one is the smaller download. */
const REAL_BASE = 'terrain/psr/psr_distance_80_90S';

export function loadPsr(): Promise<PsrRaster> {
  if (!cached) {
    const base = dataMode() === 'real' ? REAL_BASE : 'terrain/psr/psr_distance';
    cached = Promise.all([fetchJson<Raw>(`${base}.json`), fetchBuffer(`${base}.bin`)]).then(([j, buf]) => {
      const w = j.width_px ?? j.size_px?.[0];
      const h = j.height_px ?? j.size_px?.[1];
      const pixelM = j.resolution_m ?? j.pixel_m;
      const half = j.radius_m !== undefined ? j.radius_m / 1000 : j.half_extent_km;
      if (!w || !h || !pixelM || half === undefined) throw new DataError('psr: sidecar missing size/resolution/extent');
      const bytes = j.dtype === 'float32' ? 4 : j.dtype === 'uint16' ? 2 : 0;
      if (!bytes || buf.byteLength !== w * h * bytes) throw new DataError(`psr: expected ${w}x${h} ${j.dtype}, got ${buf.byteLength} bytes`);
      const dv = new DataView(buf);
      const px = pixelM / 1000;
      const unit = j.unit_km ?? 1;
      return {
        sizePx: [w, h] as [number, number], halfExtentKm: half, pixelKm: px, derived: j.source === 'derived',
        distanceKm: (x: number, y: number) => {
          const i = Math.floor((x + half) / px);
          const k = Math.floor((half - y) / px);
          if (i < 0 || k < 0 || i >= w || k >= h) return NaN;
          const o = (k * w + i) * bytes;
          return bytes === 4 ? dv.getFloat32(o, true) : dv.getUint16(o, true) * unit;
        },
      };
    });
    cached.catch(() => (cached = null));
  }
  return cached;
}
