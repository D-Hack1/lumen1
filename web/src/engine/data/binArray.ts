// Owner: Nived
// Reader for Gowri's shared binary-sidecar format (pipeline/common/binio.py): a raw little-endian array `X.bin`
// plus `X.json` {version, shape, dtype, fields, units, scale, offset, producer, created_utc, sha256, ...extras}.
// Used by ephem, dsn and sparklines. (Masks/sigma use their own 64-byte header; see lumenBinary.ts.)
import { DataError, fetchBuffer, fetchJson } from './source';

export type BinDtype = 'float32' | 'int16' | 'uint8';

export interface Sidecar {
  version: string | number;
  shape: number[];
  dtype: BinDtype;
  fields: string[];
  units: string | string[];
  scale: number | null;
  offset: number | null;
  producer: string;
  created_utc: string;
  sha256: string;
  [extra: string]: unknown;
}

export type BinArray = Float32Array | Int16Array | Uint8Array;

const BYTES: Record<BinDtype, number> = { float32: 4, int16: 2, uint8: 1 };
const REQUIRED = ['version', 'shape', 'dtype', 'fields', 'units', 'scale', 'offset', 'producer', 'created_utc', 'sha256'] as const;
const HOST_LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export function checkSidecar(label: string, j: unknown): Sidecar {
  const s = j as Partial<Sidecar> | null;
  if (!s || typeof s !== 'object') throw new DataError(`${label}: sidecar is not an object`);
  const missing = REQUIRED.filter((k) => !(k in s));
  if (missing.length) throw new DataError(`${label}: sidecar missing fields: ${missing.join(', ')}`);
  if (!(s.dtype! in BYTES)) throw new DataError(`${label}: unsupported dtype ${String(s.dtype)}`);
  if (!Array.isArray(s.shape) || s.shape.some((d) => !Number.isInteger(d) || d < 0)) throw new DataError(`${label}: bad shape`);
  return s as Sidecar;
}

export function decodeArray(label: string, buf: ArrayBuffer, s: Sidecar): BinArray {
  const count = s.shape.reduce((a, d) => a * d, 1);
  const need = count * BYTES[s.dtype];
  if (buf.byteLength !== need) {
    throw new DataError(`${label}: size ${buf.byteLength} B does not match shape [${s.shape.join(', ')}] ${s.dtype} (${need} B)`);
  }
  if (s.dtype === 'uint8') return new Uint8Array(buf);
  if (HOST_LE) return s.dtype === 'float32' ? new Float32Array(buf) : new Int16Array(buf);
  const dv = new DataView(buf);
  if (s.dtype === 'float32') {
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) out[i] = dv.getFloat32(i * 4, true);
    return out;
  }
  const out = new Int16Array(count);
  for (let i = 0; i < count; i++) out[i] = dv.getInt16(i * 2, true);
  return out;
}

/** SHA-256 check against the sidecar. Skipped (not failed) if Web Crypto is unavailable (e.g. insecure context). */
export async function verifySha256(label: string, buf: ArrayBuffer, expected: string): Promise<void> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return;
  const h = new Uint8Array(await subtle.digest('SHA-256', buf));
  const hex = Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== expected) throw new DataError(`${label}: SHA-256 mismatch (file corrupted or sidecar stale)`);
}

export interface Loaded {
  sidecar: Sidecar;
  data: BinArray;
}

/** Load `<base>.bin` + `<base>.json` (base without extension). Validates sidecar, byte length and checksum. */
export async function loadBinArray(base: string, supportedVersions: Array<string | number>): Promise<Loaded> {
  const [j, buf] = await Promise.all([fetchJson<unknown>(`${base}.json`), fetchBuffer(`${base}.bin`)]);
  const sidecar = checkSidecar(base, j);
  if (!supportedVersions.includes(sidecar.version)) {
    throw new DataError(`${base}: unsupported data version ${String(sidecar.version)} (supported: ${supportedVersions.join(', ')})`);
  }
  await verifySha256(base, buf, sidecar.sha256);
  return { sidecar, data: decodeArray(base, buf, sidecar) };
}

/** Required string extra (e.g. start_utc) parsed to epoch ms. */
export function utcExtra(label: string, s: Sidecar, key: string): number {
  const v = s[key];
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  if (Number.isNaN(t)) throw new DataError(`${label}: sidecar field "${key}" missing or not a UTC timestamp`);
  return t;
}

export function positiveExtra(label: string, s: Sidecar, key: string): number {
  const v = s[key];
  if (typeof v !== 'number' || !(v > 0)) throw new DataError(`${label}: sidecar field "${key}" missing or not positive`);
  return v;
}
