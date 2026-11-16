// Owner: Nived
// Strict parser for the shared 64-byte little-endian LUMEN binary header (data_masks.md §3.1, §4).
// Consumers must reject, never default: magic, version, header size, dimensions, offsets, lengths, reserved fields.
import { DataError } from './source';

export interface LumenHeader {
  magic: string;
  formatVersion: number;
  headerSize: number;
  heightCount: number;
  azimuthCount: number;
  binWidthDeg: number;
  rayRangeKm: number;
  distanceScaleKm: number;
  elevOffset: number; // sigma files: sigma payload offset
  distOffset: number;
  elevLength: number; // sigma files: sigma payload length
  distLength: number;
}

export const HEADER_BYTES = 64;
export const HEIGHT_COUNT = 4;
export const AZIMUTH_COUNT = 3600;
export const BIN_WIDTH_DEG = 0.1;
export const RAY_RANGE_KM = 250;
export const HEIGHTS_M = [1, 2, 5, 10] as const;
const PAYLOAD_BYTES = HEIGHT_COUNT * AZIMUTH_COUNT * 4;

function fail(label: string, why: string): never {
  throw new DataError(`${label}: ${why}`);
}

export function parseLumenHeader(label: string, buf: ArrayBuffer, magic: 'LUMENMSK' | 'LUMENSGM'): LumenHeader {
  if (buf.byteLength < HEADER_BYTES) fail(label, `file too short (${buf.byteLength} bytes)`);
  const dv = new DataView(buf);
  let m = '';
  for (let i = 0; i < 8; i++) m += String.fromCharCode(dv.getUint8(i));
  const h: LumenHeader = {
    magic: m,
    formatVersion: dv.getUint16(8, true),
    headerSize: dv.getUint16(10, true),
    heightCount: dv.getUint32(12, true),
    azimuthCount: dv.getUint32(16, true),
    binWidthDeg: dv.getFloat32(20, true),
    rayRangeKm: dv.getFloat32(24, true),
    distanceScaleKm: dv.getFloat32(28, true),
    elevOffset: dv.getUint32(32, true),
    distOffset: dv.getUint32(36, true),
    elevLength: dv.getUint32(40, true),
    distLength: dv.getUint32(44, true),
  };
  if (m !== magic) fail(label, `bad magic "${m}", expected ${magic}`);
  if (h.formatVersion !== 1) fail(label, `unsupported format version ${h.formatVersion}`);
  if (h.headerSize !== HEADER_BYTES) fail(label, `unexpected header size ${h.headerSize}`);
  if (h.heightCount !== HEIGHT_COUNT) fail(label, `unexpected height_count ${h.heightCount}`);
  if (h.azimuthCount !== AZIMUTH_COUNT) fail(label, `unexpected azimuth_count ${h.azimuthCount}`);
  if (Math.abs(h.binWidthDeg - BIN_WIDTH_DEG) > 1e-6) fail(label, `unexpected bin width ${h.binWidthDeg}`);
  if (h.rayRangeKm !== RAY_RANGE_KM) fail(label, `unexpected ray range ${h.rayRangeKm}`);
  if (h.distanceScaleKm !== 1) fail(label, `unexpected distance scale ${h.distanceScaleKm}`);
  if (dv.getUint32(48, true) !== 0 || dv.getUint32(52, true) !== 0 || dv.getBigUint64(56, true) !== 0n) {
    fail(label, 'reserved fields must be zero');
  }
  if (h.elevOffset !== HEADER_BYTES) fail(label, `unexpected payload offset ${h.elevOffset}`);
  if (h.elevLength !== PAYLOAD_BYTES) fail(label, `unexpected payload length ${h.elevLength}`);
  if (magic === 'LUMENMSK') {
    if (h.distOffset !== HEADER_BYTES + PAYLOAD_BYTES) fail(label, `unexpected distance offset ${h.distOffset}`);
    if (h.distLength !== PAYLOAD_BYTES) fail(label, `unexpected distance length ${h.distLength}`);
  } else if (h.distOffset !== 0 || h.distLength !== 0) {
    fail(label, 'sigma distance offset and length must be zero');
  }
  const end = Math.max(h.elevOffset + h.elevLength, h.distLength ? h.distOffset + h.distLength : 0);
  if (buf.byteLength < end) fail(label, `truncated: need ${end} bytes, have ${buf.byteLength}`);
  return h;
}

/** Copy a little-endian float32 array out of the buffer (NaN preserved; independent of host endianness/alignment). */
export function readFloat32LE(buf: ArrayBuffer, byteOffset: number, count: number): Float32Array {
  const out = new Float32Array(count);
  const dv = new DataView(buf, byteOffset, count * 4);
  for (let i = 0; i < count; i++) out[i] = dv.getFloat32(i * 4, true);
  return out;
}
