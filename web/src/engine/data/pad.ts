// Owner: Nived
// Loader: terrain/pad/<id>.json (data_terrain_misc.md §1, contract 0.1.0). Convention: downhill_aspect_deg is the
// steepest-DESCENT azimuth; uphill_az_deg = (downhill + 180) mod 360 (see contract §1.4).
import { DataError, fetchJson } from './source';

export interface Pad {
  siteId: string;
  groundNormalMe: [number, number, number];
  slopeDeg: number;
  downhillAspectDeg: number;
  uphillAzDeg: number;
  z0M: number; // metres above the 1737.4 km sphere
  dMinM: number;
  nearFieldResolutionM: number;
  underResolved: boolean;
  planeFit: { k: number; windowPx: [number, number]; windowDimM: [number, number]; baselineM: number; demSource: string };
  dispersionSlopeStats: { p50: number; p95: number; max: number; pctBelowTolerance: number };
  mock: boolean;
}

interface Raw {
  version: string;
  site_id: string;
  ground_normal_me: [number, number, number];
  slope_deg: number;
  downhill_aspect_deg: number;
  uphill_az_deg: number;
  z0_m: number;
  d_min_m: number;
  near_field_resolution_m: number;
  under_resolved: boolean;
  plane_fit: { k: number; window_px: [number, number]; window_dim_m: [number, number]; baseline_m: number; dem_source: string };
  dispersion_slope_stats: { p50: number; p95: number; max: number; pct_below_tolerance: number };
  mock?: boolean;
}

function bad(id: string, why: string): never {
  throw new DataError(`pad ${id}: ${why}`);
}
const fin = (x: unknown) => typeof x === 'number' && Number.isFinite(x);

export function parsePad(id: string, j: Raw): Pad {
  if (j.version !== '0.1.0') bad(id, `unsupported contract version ${String(j.version)}`);
  if (j.site_id !== id) bad(id, `site_id "${j.site_id}" does not match filename`);
  if (!fin(j.slope_deg) || j.slope_deg < 0 || j.slope_deg >= 90) bad(id, 'slope_deg must be in [0, 90)');
  for (const k of ['downhill_aspect_deg', 'uphill_az_deg'] as const) {
    if (!fin(j[k]) || j[k] < 0 || j[k] >= 360) bad(id, `${k} must be in [0, 360)`);
  }
  const d = (((j.downhill_aspect_deg + 180) % 360) + 360) % 360;
  if (Math.abs(d - j.uphill_az_deg) > 1e-6) bad(id, 'uphill_az_deg must equal (downhill_aspect_deg + 180) mod 360');
  if (!fin(j.z0_m)) bad(id, 'z0_m must be finite');
  if (!(j.near_field_resolution_m > 0)) bad(id, 'near_field_resolution_m must be > 0');
  if (Math.abs(j.d_min_m - 3 * j.near_field_resolution_m) > 1e-9) bad(id, 'd_min_m must equal 3 * near_field_resolution_m');
  const n = j.ground_normal_me;
  if (!Array.isArray(n) || n.length !== 3 || !n.every(fin) || Math.abs(Math.hypot(n[0], n[1], n[2]) - 1) > 1e-6) {
    bad(id, 'ground_normal_me must be a finite unit vector');
  }
  const pf = j.plane_fit;
  if (pf?.k !== 3 || pf.window_px?.[0] !== 7 || pf.window_px?.[1] !== 7) bad(id, 'plane_fit must be k = 3, 7x7 px');
  return {
    siteId: id, groundNormalMe: n, slopeDeg: j.slope_deg, downhillAspectDeg: j.downhill_aspect_deg, uphillAzDeg: j.uphill_az_deg,
    z0M: j.z0_m, dMinM: j.d_min_m, nearFieldResolutionM: j.near_field_resolution_m, underResolved: j.under_resolved,
    planeFit: { k: pf.k, windowPx: pf.window_px, windowDimM: pf.window_dim_m, baselineM: pf.baseline_m, demSource: pf.dem_source },
    dispersionSlopeStats: {
      p50: j.dispersion_slope_stats.p50, p95: j.dispersion_slope_stats.p95, max: j.dispersion_slope_stats.max,
      pctBelowTolerance: j.dispersion_slope_stats.pct_below_tolerance,
    },
    mock: j.mock === true,
  };
}

const cache = new Map<string, Promise<Pad>>();

export function loadPad(siteId: string): Promise<Pad> {
  let p = cache.get(siteId);
  if (!p) {
    p = fetchJson<Raw>(`terrain/pad/${siteId}.json`).then((j) => parsePad(siteId, j));
    cache.set(siteId, p);
    p.catch(() => cache.delete(siteId));
  }
  return p;
}
