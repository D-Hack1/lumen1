// Owner: Ebin
// Shared azimuth/elevation helpers for the Ribbon Panorama and Horizon Lens — not physics (that's Gowri/Nived's
// engine), just the pixel mapping and mask sampling both views need. Azimuth convention follows the mask
// contract (`data_masks.md`): bin i is centred at (i + 0.5) * binWidthDeg, 0..360.
import type { Mask } from '../../engine/data/masks';

export const HEIGHTS_M = [1, 2, 5, 10] as const;

export function nearestHeightIndex(heightM: number): number {
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < HEIGHTS_M.length; i++) {
    const d = Math.abs(HEIGHTS_M[i] - heightM);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
}

/** Elevation at `heightIdx` for the bin nearest `azDeg` (no interpolation — bin width is 0.1°, plenty fine). */
export function maskElevAt(mask: Mask, heightIdx: number, azDeg: number): number {
  const i = Math.floor(((((azDeg % 360) + 360) % 360) / mask.binWidthDeg)) % mask.azimuthCount;
  return mask.elevDeg[heightIdx * mask.azimuthCount + i];
}

/** Finite min/max elevation across all azimuth bins at `heightIdx` (NaN bins skipped). */
export function maskElevRange(mask: Mask, heightIdx: number): { min: number; max: number } {
  const n = mask.azimuthCount;
  const off = heightIdx * n;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = mask.elevDeg[off + i];
    if (Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min)) return { min: -2, max: 10 }; // fully-NaN mask: fall back to a sane polar default
  return { min, max };
}

export interface PanoramaScale {
  w: number;
  h: number;
  elevMin: number;
  elevMax: number;
  azToX(azDeg: number): number;
  elevToY(elevDeg: number): number;
  /** "V ×N" vertical exaggeration vs. true angular scale. */
  exaggeration: number;
}

export function buildPanoramaScale(w: number, h: number, elevMin: number, elevMax: number): PanoramaScale {
  const pad = Math.max(0.5, (elevMax - elevMin) * 0.12);
  const lo = elevMin - pad;
  const hi = elevMax + pad;
  const span = Math.max(0.5, hi - lo);
  const pxPerDegV = h / span;
  const pxPerDegH = w / 360;
  return {
    w,
    h,
    elevMin: lo,
    elevMax: hi,
    azToX: (az) => ((((az % 360) + 360) % 360) / 360) * w,
    elevToY: (elev) => h - (elev - lo) * pxPerDegV,
    exaggeration: pxPerDegV / pxPerDegH,
  };
}
