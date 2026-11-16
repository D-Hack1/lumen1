// Owner: Nived
// Loader: terrain/dispersion/<id>.{json,bin}. DRAFT: the binary layout is unresolved in data_terrain_misc.md §2.3.
// Assumed here (matches the mock): 11x11 uint8 slope grid, 0.1 deg units, row-major [row j][col i], 50 m spacing.
import { DataError, fetchBuffer, fetchJson } from './source';

export interface Dispersion {
  siteId: string;
  nodes: [number, number];
  spacingM: number;
  /** slope in degrees per node, row-major [j][i], j increasing north (DRAFT). */
  slopeDeg: Float32Array;
}

interface Raw {
  version: string;
  site_id: string;
  nodes: [number, number];
  spacing_m: number;
  dtype: string;
  unit_deg: number;
}

const cache = new Map<string, Promise<Dispersion>>();

export function loadDispersion(siteId: string): Promise<Dispersion> {
  let p = cache.get(siteId);
  if (!p) {
    p = Promise.all([fetchJson<Raw>(`terrain/dispersion/${siteId}.json`), fetchBuffer(`terrain/dispersion/${siteId}.bin`)]).then(([j, buf]) => {
      if (j.site_id !== siteId) throw new DataError(`dispersion ${siteId}: site_id mismatch`);
      if (j.nodes?.[0] !== 11 || j.nodes?.[1] !== 11 || j.spacing_m !== 50) throw new DataError(`dispersion ${siteId}: must be 11x11 at 50 m`);
      if (j.dtype !== 'uint8' || buf.byteLength !== 121) throw new DataError(`dispersion ${siteId}: expected 121 uint8 values, got ${buf.byteLength} bytes`);
      const u8 = new Uint8Array(buf);
      return { siteId, nodes: j.nodes, spacingM: j.spacing_m, slopeDeg: Float32Array.from(u8, (v) => v * j.unit_deg) };
    });
    cache.set(siteId, p);
    p.catch(() => cache.delete(siteId));
  }
  return p;
}

export interface DispersionSummary {
  p50: number;
  p95: number;
  max: number;
  /** Percent of nodes with slope strictly below the tolerance. */
  pctBelowTolerance: number;
}

/** Percentiles (linear interpolation, as numpy's default) and the share under the hazard tolerance, from the grid itself. */
export function summariseDispersion(d: Dispersion, toleranceDeg: number): DispersionSummary {
  const v = Array.from(d.slopeDeg).sort((a, b) => a - b);
  const pct = (p: number) => {
    const x = ((v.length - 1) * p) / 100;
    const lo = Math.floor(x);
    return v[lo] + (x - lo) * ((v[Math.min(lo + 1, v.length - 1)] ?? v[lo]) - v[lo]);
  };
  return { p50: pct(50), p95: pct(95), max: v[v.length - 1], pctBelowTolerance: (100 * v.filter((x) => x < toleranceDeg).length) / v.length };
}
