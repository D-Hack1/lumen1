// Owner: Nived
// Loader: ephem/ephem.{bin,json} (data_ephemeris.md; sidecar written by pipeline/ephem/ephemeris.py). Per node, 12 float32:
// sun_position_km[3], sun_velocity_km_s[3], earth_position_km[3], earth_velocity_km_s[3]; Moon-centred, MOON_ME_DE421.
// Sidecar fields used: start_utc, cadence_s (or step_seconds), frame, shape [count, 12]. Since Gowri #21 `frame` is the public name
// MOON_ME and `spice_frame` carries MOON_ME_DE421; both spellings are accepted for `frame`. Never hard-code the step: real data is 3600 s,
// the mock is longer. Interpolation lives in core/interp.ts.
import { loadBinArray, positiveExtra, utcExtra } from './binArray';
import { DataError } from './source';

export const EPHEM_STRIDE = 12;
/** Offsets inside one record. */
export const EPHEM = { sunPos: 0, sunVel: 3, earthPos: 6, earthVel: 9 } as const;

export interface Ephemeris {
  startMs: number;
  cadenceMs: number;
  count: number;
  endMs: number; // time of the last node
  /** (count, 12) row-major float32. Read values into float64 maths; never accumulate in float32. */
  data: Float32Array;
  /** Node spacing in seconds (real: 3600). Used by the Hermite velocity terms, so it must be exact. */
  stepSeconds: number;
  frame: string;
  /** The SPICE frame the nodes were generated in (MOON_ME_DE421), when the sidecar says so. */
  spiceFrame: string | null;
  mock: boolean;
}

let cached: Promise<Ephemeris> | null = null;

export function loadEphem(): Promise<Ephemeris> {
  if (!cached) {
    cached = doLoad();
    cached.catch(() => (cached = null));
  }
  return cached;
}

async function doLoad(): Promise<Ephemeris> {
  const { sidecar: s, data } = await loadBinArray('ephem/ephem', ['1', 1]);
  if (s.dtype !== 'float32' || s.shape.length !== 2 || s.shape[1] !== EPHEM_STRIDE) {
    throw new DataError(`ephem: expected float32 shape [n, ${EPHEM_STRIDE}], got ${s.dtype} [${s.shape.join(', ')}]`);
  }
  if (s.shape[0] < 2) throw new DataError('ephem: need at least 2 nodes for interpolation');
  if (s.frame !== 'MOON_ME' && s.frame !== 'MOON_ME_DE421') throw new DataError(`ephem: unexpected frame ${String(s.frame)} (expected MOON_ME)`);
  const startMs = utcExtra('ephem', s, 'start_utc');
  const stepSeconds = positiveExtra('ephem', s, typeof s.cadence_s === 'number' ? 'cadence_s' : 'step_seconds');
  const count = s.shape[0];
  const cadenceMs = stepSeconds * 1000;
  return { startMs, cadenceMs, stepSeconds, count, endMs: startMs + (count - 1) * cadenceMs, data: data as Float32Array, frame: s.frame as string, spiceFrame: typeof s.spice_frame === 'string' ? s.spice_frame : null, mock: s.mock === true };
}
