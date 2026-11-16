// Owner: Nived
// Loader: terrain/sigma/<id>.{bin,json} (data_masks.md §4, §8). Separate from the mask; NaN pattern must match the mask.
import { AZIMUTH_COUNT, HEIGHT_COUNT, parseLumenHeader, readFloat32LE } from './lumenBinary';
import { loadMask, type Mask } from './masks';
import { DataError, dataMode, dataUrl, fetchBuffer, fetchJson } from './source';

export type SigmaSource = 'default' | 'monte_carlo' | 'calibrated';

export interface Sigma {
  siteId: string;
  source: SigmaSource;
  cloneCount: number | null;
  /** (4, 3600) height-major, degrees, >= 0; NaN where the mask is unavailable. */
  sigmaDeg: Float32Array;
  notes: string | null;
  /** Set when the DEM error was an ASSUMED constant 1-sigma (metres), not a published error raster. Null for measured-raster sigma. */
  assumedErrorM: number | null;
  /** Synthetic/mock artifact: never used for real results (same rule as masks). */
  mock: boolean;
}

interface RawSigma {
  version: string;
  site_id: string;
  source: SigmaSource;
  clone_count?: number;
  unit: string;
  notes?: string;
  mock?: boolean;
  error_model?: string;
  assumed_error_m?: number;
  shape: number[];
  height_order_m: number[];
  binary: { magic: string; format_version: number; byte_order: string; array_order: string };
}

function bad(id: string, why: string): never {
  throw new DataError(`sigma ${id}: ${why}`);
}

export function parseSigma(id: string, bin: ArrayBuffer, j: RawSigma): Sigma {
  if (j.version !== '1.0.0') bad(id, `unsupported contract version ${String(j.version)}`);
  if (j.site_id !== id) bad(id, `site_id "${j.site_id}" does not match filename`);
  if (j.unit !== 'deg') bad(id, `unit must be deg, got ${j.unit}`);
  if (JSON.stringify(j.shape) !== JSON.stringify([HEIGHT_COUNT, AZIMUTH_COUNT])) bad(id, 'shape must be [4, 3600]');
  if (j.binary?.magic !== 'LUMENSGM' || j.binary.format_version !== 1 || j.binary.byte_order !== 'little') bad(id, 'binary descriptor disagrees with contract');
  if (j.source === 'monte_carlo') {
    if (!Number.isInteger(j.clone_count) || (j.clone_count as number) < 20 || (j.clone_count as number) > 30) bad(id, 'monte_carlo needs clone_count in [20, 30]');
  } else if (j.source === 'default') {
    if (j.clone_count !== undefined) bad(id, 'clone_count is forbidden for default sigma');
  } else if (j.source === 'calibrated') {
    if (!j.notes) bad(id, 'calibrated sigma needs notes naming the method');
  } else {
    bad(id, `unknown source ${String(j.source)}`);
  }
  const h = parseLumenHeader(`sigma ${id}`, bin, 'LUMENSGM');
  const sigmaDeg = readFloat32LE(bin, h.elevOffset, HEIGHT_COUNT * AZIMUTH_COUNT);
  for (let i = 0; i < sigmaDeg.length; i++) {
    if (!Number.isNaN(sigmaDeg[i]) && sigmaDeg[i] < 0) bad(id, `negative sigma at index ${i}`);
  }
  const assumedErrorM = j.error_model === 'assumed_uniform' && typeof j.assumed_error_m === 'number' && j.assumed_error_m > 0 ? j.assumed_error_m : null;
  return { siteId: id, source: j.source, cloneCount: j.clone_count ?? null, sigmaDeg, notes: j.notes ?? null, assumedErrorM, mock: j.mock === true };
}

/** Gate 6: finite sigma wherever the mask is valid, NaN wherever it is not. */
export function checkSigmaMatchesMask(mask: Mask, sigma: Sigma): void {
  for (let i = 0; i < mask.elevDeg.length; i++) {
    if (Number.isNaN(mask.elevDeg[i]) !== Number.isNaN(sigma.sigmaDeg[i])) {
      bad(sigma.siteId, `NaN pattern differs from mask at index ${i}`);
    }
  }
}

const cache = new Map<string, Promise<Sigma>>();

/** Loads sigma and verifies it against the site's mask. */
export function loadSigma(siteId: string): Promise<Sigma> {
  let p = cache.get(siteId);
  if (!p) {
    p = Promise.all([fetchBuffer(`terrain/sigma/${siteId}.bin`), fetchJson<RawSigma>(`terrain/sigma/${siteId}.json`), loadMask(siteId)]).then(
      ([bin, j, mask]) => {
        const s = parseSigma(siteId, bin, j);
        checkSigmaMatchesMask(mask, s);
        return s;
      },
    );
    cache.set(siteId, p);
    p.catch(() => cache.delete(siteId));
  }
  return p;
}

/** How the result labels its sigma (ResultMeta.sigmaSource), from the artifact's declared source (data_masks.md §8). */
export function sigmaSourceLabel(s: Pick<Sigma, 'source' | 'cloneCount' | 'notes'> & { assumedErrorM?: number | null }): string {
  if (s.source === 'monte_carlo') {
    return s.assumedErrorM ? `Monte-Carlo, ${s.cloneCount} clones, assumed ${s.assumedErrorM} m DEM error` : `Monte-Carlo, ${s.cloneCount} clones`;
  }
  if (s.source === 'calibrated') return `calibrated: ${s.notes}`;
  return 'default';
}

const absent = new Set<string>();

/**
 * The site's production sigma, or null when there is none to use: no site id, mock data mode, a mock artifact, or a missing/invalid one (wrong header,
 * negative value, NaN pattern that disagrees with the mask). Null means the result keeps "sigma pending": no +/- is ever invented.
 */
export async function loadSigmaOrNull(siteId: string | null | undefined): Promise<Sigma | null> {
  if (!siteId || dataMode() !== 'real') return null;
  const key = `${dataUrl('')}${siteId}`;
  if (absent.has(key)) return null;
  try {
    const s = await loadSigma(siteId);
    return s.mock ? null : s;
  } catch {
    absent.add(key);
    return null;
  }
}

export function __resetSigmaAbsentForTests(): void {
  absent.clear();
}
