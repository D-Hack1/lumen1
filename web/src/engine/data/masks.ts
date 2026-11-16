// Owner: Nived
// Loader: terrain/masks/<id>.{bin,json} (data_masks.md v1.0.0). Strict: rejects malformed headers/metadata, keeps NaN.
import { RangeExtrema } from './rangeExtrema';
import { AZIMUTH_COUNT, BIN_WIDTH_DEG, HEIGHTS_M, HEIGHT_COUNT, RAY_RANGE_KM, parseLumenHeader, readFloat32LE } from './lumenBinary';
import { DataError, dataMode, dataUrl, fetchBuffer, fetchJson } from './source';

export const MASK_CONTRACT_VERSION = '1.0.0';

export interface MaskMeta {
  version: string;
  producer: string;
  createdUtc: string;
  gitCommit: string;
  siteId: string;
  nearFieldResolutionM: number;
  dMinM: number;
  z0M: number | null;
  medianFilterStatus: 'applied' | 'unavailable';
  slopeDeg: number | null;
  downhillAspectDeg: number | null;
  uphillAzimuthDeg: number | null;
  globalMaxDeg: Array<number | null>;
  globalMinDeg: Array<number | null>;
  demSource: string;
  mock: boolean;
}

export interface Mask {
  siteId: string;
  heightsM: readonly number[];
  binWidthDeg: number;
  azimuthCount: number;
  /** (4, 3600) height-major; NaN = unavailable. Bin i is centred at (i + 0.5) * binWidthDeg. */
  elevDeg: Float32Array;
  /** (4, 3600) height-major, km; NaN where elevation is NaN. */
  distKm: Float32Array;
  meta: MaskMeta;
  /** Range min/max of elevation over an azimuth interval for height index h (conservative; wraps through 0°). */
  range(h: number, azLoDeg: number, azHiDeg: number): { min: number; max: number };
}

interface RawMask {
  version: string;
  producer: string;
  created_utc: string;
  git_commit: string;
  site_id: string;
  bin_width_deg: number;
  azimuth_count: number;
  azimuth_zero: string;
  azimuth_direction: string;
  azimuth_center: string;
  heights_m: number[];
  ray_range_km: number;
  near_field_resolution_m: number;
  d_min_m: number;
  z0_m: number | null;
  median_filter_status: 'applied' | 'unavailable';
  slope_deg: number | null;
  downhill_aspect_deg: number | null;
  uphill_azimuth_deg: number | null;
  global_max_deg: Array<number | null>;
  global_min_deg: Array<number | null>;
  range_extrema: { strategy: string; supports_circular_azimuth_ranges: boolean };
  dem_source: string;
  binary: { magic: string; format_version: number; byte_order: string; float_encoding: string; array_order: string };
  mock?: boolean;
}

function bad(id: string, why: string): never {
  throw new DataError(`mask ${id}: ${why}`);
}

/** Sidecar must agree with the binary and the fixed contract constants (§10 gates 3, 7). */
export function validateMaskSidecar(id: string, j: RawMask): void {
  if (j.version !== MASK_CONTRACT_VERSION) bad(id, `unsupported contract version ${String(j.version)}`);
  if (j.site_id !== id) bad(id, `site_id "${j.site_id}" does not match filename`);
  if (j.bin_width_deg !== BIN_WIDTH_DEG || j.azimuth_count !== AZIMUTH_COUNT) bad(id, 'dimensions disagree with contract');
  if (j.ray_range_km !== RAY_RANGE_KM) bad(id, 'ray range disagrees with contract');
  if (JSON.stringify(j.heights_m) !== JSON.stringify([...HEIGHTS_M])) bad(id, 'heights_m disagree with contract');
  if (j.azimuth_zero !== 'projected_site_frame_reference' || j.azimuth_direction !== 'toward_site_frame_e' || j.azimuth_center !== 'i_plus_0.5_times_bin_width') {
    bad(id, 'azimuth convention disagrees with contract');
  }
  const b = j.binary;
  if (!b || b.magic !== 'LUMENMSK' || b.format_version !== 1 || b.byte_order !== 'little' || b.float_encoding !== 'ieee754-binary32' || b.array_order !== 'c_contiguous_height_major') {
    bad(id, 'binary descriptor disagrees with contract');
  }
  if (!(j.near_field_resolution_m > 0) || !Number.isFinite(j.near_field_resolution_m)) bad(id, 'near_field_resolution_m must be finite and > 0');
  if (Math.abs(j.d_min_m - 3 * j.near_field_resolution_m) > 1e-9) bad(id, 'd_min_m must equal 3 * near_field_resolution_m');
  if (j.range_extrema?.strategy !== 'finite_segment_tree') bad(id, 'unsupported range_extrema strategy');
  if (j.global_max_deg?.length !== HEIGHT_COUNT || j.global_min_deg?.length !== HEIGHT_COUNT) bad(id, 'global extrema need 4 values');
}

export function parseMask(id: string, bin: ArrayBuffer, j: RawMask): Mask {
  validateMaskSidecar(id, j);
  const h = parseLumenHeader(`mask ${id}`, bin, 'LUMENMSK');
  const count = HEIGHT_COUNT * AZIMUTH_COUNT;
  const elevDeg = readFloat32LE(bin, h.elevOffset, count);
  const distKm = readFloat32LE(bin, h.distOffset, count);
  for (let i = 0; i < count; i++) {
    const e = elevDeg[i];
    const d = distKm[i];
    if (Number.isNaN(e) !== Number.isNaN(d)) bad(id, `elevation/distance NaN pattern differs at index ${i}`);
    if (!Number.isNaN(d) && !(d > 0 && d <= RAY_RANGE_KM)) bad(id, `distance ${d} outside (0, ${RAY_RANGE_KM}] at index ${i}`);
  }
  const trees = Array.from({ length: HEIGHT_COUNT }, (_, k) => new RangeExtrema(elevDeg.subarray(k * AZIMUTH_COUNT, (k + 1) * AZIMUTH_COUNT)));
  return {
    siteId: id,
    heightsM: HEIGHTS_M,
    binWidthDeg: BIN_WIDTH_DEG,
    azimuthCount: AZIMUTH_COUNT,
    elevDeg,
    distKm,
    meta: {
      version: j.version, producer: j.producer, createdUtc: j.created_utc, gitCommit: j.git_commit, siteId: j.site_id,
      nearFieldResolutionM: j.near_field_resolution_m, dMinM: j.d_min_m, z0M: j.z0_m, medianFilterStatus: j.median_filter_status,
      slopeDeg: j.slope_deg, downhillAspectDeg: j.downhill_aspect_deg, uphillAzimuthDeg: j.uphill_azimuth_deg,
      globalMaxDeg: j.global_max_deg, globalMinDeg: j.global_min_deg, demSource: j.dem_source, mock: j.mock === true,
    },
    range: (hIdx, lo, hi) => {
      if (hIdx < 0 || hIdx >= HEIGHT_COUNT) throw new RangeError(`height index ${hIdx}`);
      return trees[hIdx].queryAzimuth(lo, hi, BIN_WIDTH_DEG);
    },
  };
}

const cache = new Map<string, Promise<Mask>>();

export function loadMask(siteId: string): Promise<Mask> {
  let p = cache.get(siteId);
  if (!p) {
    p = Promise.all([fetchBuffer(`terrain/masks/${siteId}.bin`), fetchJson<RawMask>(`terrain/masks/${siteId}.json`)]).then(([bin, j]) =>
      parseMask(siteId, bin, j),
    );
    cache.set(siteId, p);
    p.catch(() => cache.delete(siteId));
  }
  return p;
}

const absent = new Set<string>();

/**
 * The site's real terrain mask, or null when there is none to use: no site id, mock data mode (mock masks are fake terrain), or a mask that is
 * missing/invalid (the engine then uses a smooth-sphere estimate and says so). A missing mask is remembered so it is not re-fetched every evaluation.
 */
export async function loadMaskOrNull(siteId: string | null | undefined): Promise<Mask | null> {
  if (!siteId || dataMode() !== 'real') return null;
  const key = `${dataUrl('')}${siteId}`;
  if (absent.has(key)) return null;
  try {
    return await loadMask(siteId);
  } catch {
    absent.add(key);
    return null;
  }
}

/** The usable masks for a batch of requests, keyed by site id (sites without one are simply absent). */
export async function loadMasksFor(requests: ReadonlyArray<{ siteId: string | null }>): Promise<Map<string, Mask>> {
  const out = new Map<string, Mask>();
  for (const id of new Set(requests.map((r) => r.siteId))) {
    const m = await loadMaskOrNull(id);
    if (m && id) out.set(id, m);
  }
  return out;
}

export function __resetMaskAbsentForTests(): void {
  absent.clear();
}
