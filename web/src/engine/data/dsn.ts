// Owner: Nived
// Loader: dsn/dsn.{bin,json} (data_dsn.md). Geometric Moon-centre elevation per DSN station.
// int16 = round(elevation_deg * 2), valid [-180, 180]; decode with the sidecar scale/offset (0.5 / 0).
// The contract does not fix the axis order, so it is read from `shape` + `fields`: [time, station] or [station, time].
import { loadBinArray, positiveExtra, utcExtra } from './binArray';
import { DataError } from './source';

export interface DsnSeries {
  stations: string[];
  startMs: number;
  cadenceMs: number;
  count: number;
  /** Moon elevation in degrees at station index k, node i (NaN if out of the valid stored range). */
  elevDeg(station: number, i: number): number;
}

let cached: Promise<DsnSeries> | null = null;

export function loadDsn(): Promise<DsnSeries> {
  if (!cached) {
    cached = doLoad();
    cached.catch(() => (cached = null));
  }
  return cached;
}

async function doLoad(): Promise<DsnSeries> {
  const { sidecar: s, data } = await loadBinArray('dsn/dsn', ['1', 1]);
  if (s.dtype !== 'int16' || s.shape.length !== 2) throw new DataError(`dsn: expected int16 2-D array, got ${s.dtype} [${s.shape.join(', ')}]`);
  const stations = s.fields;
  const scale = s.scale ?? 0.5;
  const offset = s.offset ?? 0;
  const [a, b] = s.shape;
  let count: number;
  let index: (k: number, i: number) => number;
  if (b === stations.length) {
    count = a;
    index = (k, i) => i * b + k; // [time, station]
  } else if (a === stations.length) {
    count = b;
    index = (k, i) => k * b + i; // [station, time]
  } else {
    throw new DataError(`dsn: shape [${a}, ${b}] does not match ${stations.length} stations`);
  }
  const raw = data as Int16Array;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] < -180 || raw[i] > 180) throw new DataError(`dsn: stored value ${raw[i]} outside [-180, 180] at index ${i}`);
  }
  return {
    stations,
    startMs: utcExtra('dsn', s, 'start_utc'),
    cadenceMs: positiveExtra('dsn', s, 'cadence_s') * 1000,
    count,
    elevDeg: (k, i) => raw[index(k, i)] * scale + offset,
  };
}

/** The DSN series, or null if it cannot be loaded (the engine then reports the link without the DSN rule and says so). */
export async function loadDsnOrNull(): Promise<DsnSeries | null> {
  try {
    return await loadDsn();
  } catch {
    return null;
  }
}
