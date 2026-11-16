// Owner: Nived
// Builds the engine Horizon from a published terrain mask (data_masks.md v1.0.0). Pure: no fetching, so it runs identically in the worker and in tests.
// Returns null (=> the caller uses a smooth-sphere estimate and says so) whenever the mask cannot be trusted for this request:
//   * mock masks (fake terrain must never leak into real answers),
//   * an observer height the mask was not built for (it holds 1/2/5/10 m only; we never interpolate or snap heights),
//   * any unavailable (NaN) bin in that height's row (the engine has no defined behaviour for a partial horizon).
import type { Mask } from '../data/masks';
import type { Sigma } from '../data/sigma';
import { Horizon } from './visibility';

export function horizonFromMask(mask: Mask | null | undefined, heightM: number): Horizon | null {
  if (!mask || mask.meta.mock) return null;
  const k = mask.heightsM.indexOf(heightM);
  if (k < 0) return null;
  const row = mask.elevDeg.subarray(k * mask.azimuthCount, (k + 1) * mask.azimuthCount);
  for (let i = 0; i < row.length; i++) if (!Number.isFinite(row[i])) return null;
  const m = mask.meta;
  // R3 D-9 near-zone plane: applies only when all three inputs exist (Horizon enforces this too).
  return new Horizon({ elevationsDeg: row, binWidthDeg: mask.binWidthDeg, slopeDeg: m.slopeDeg, uphillAzimuthDeg: m.uphillAzimuthDeg, dMinM: m.dMinM, observerHeightM: heightM });
}

/**
 * The sigma row (degrees, one value per azimuth bin) for this observer height, or null when it must not be used: no sigma, a mock artifact, a different site than
 * the mask, a height with no row, or any bin that is not finite and non-negative (the contract requires that wherever the mask is valid; we never replace NaN by 0).
 */
export function sigmaRowFor(sigma: Sigma | null | undefined, mask: Mask | null | undefined, heightM: number): Float32Array | null {
  if (!sigma || sigma.mock || !mask || mask.meta.mock || sigma.siteId !== mask.siteId) return null;
  const k = mask.heightsM.indexOf(heightM);
  if (k < 0) return null;
  const row = sigma.sigmaDeg.subarray(k * mask.azimuthCount, (k + 1) * mask.azimuthCount);
  for (let i = 0; i < row.length; i++) if (!Number.isFinite(row[i]) || row[i] < 0) return null;
  return row;
}

/** Sigma (deg) at an azimuth, interpolated between bin centres like the mask itself. */
export function sigmaAtAzimuth(row: ArrayLike<number>, binWidthDeg: number, azimuthDeg: number): number {
  const n = row.length;
  const mod = ((azimuthDeg % 360) + 360) % 360;
  const c = mod / binWidthDeg - 0.5;
  const f = Math.floor(c);
  const left = ((f % n) + n) % n;
  const t = c - f;
  return (1 - t) * row[left] + t * row[(left + 1) % n];
}
