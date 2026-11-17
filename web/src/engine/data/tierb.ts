// Owner: Nived
// Loader: terrain/tierb/index.json + tiles/<id>.bin (data_tierb.md v0.1.0).
import { DataError, fetchBuffer, fetchJson } from './source';

interface Section {
  dtype: 'float32' | 'uint16';
  offset_bytes: number;
  byte_length: number;
  shape: number[];
  scale?: number;
  offset?: number;
  unavailable_sentinel?: number;
  unit?: string;
}
interface RawIndex {
  schema: 'tierb_index';
  version: '0.1.0';
  bin_deg: number;
  height_m: number;
  tiles: Array<{ id: string; file: string; n_nodes: number; sections: Record<string, Section> }>;
}

export interface TierBTile {
  id: string;
  nNodes: number;
  binDeg: number;
  latDeg: Float32Array;
  lonDeg: Float32Array;
  /** (nNodes, 720) horizon elevation, degrees. */
  maskDeg: Float32Array;
  slopeDeg: Float32Array;
  downhillAspectDeg: Float32Array;
  z0M: Float32Array;
  dMinM: Float32Array;
}

let idx: Promise<RawIndex> | null = null;
export function parseTierBIndex(index: RawIndex): RawIndex {
  if (index.schema !== 'tierb_index' || index.version !== '0.1.0' || index.bin_deg !== 0.5 || index.height_m !== 1 || !Array.isArray(index.tiles)) {
    throw new DataError('tierb: index disagrees with v0.1.0 contract');
  }
  return index;
}

export const loadTierBIndex = (): Promise<RawIndex> => (idx ??= fetchJson<RawIndex>('terrain/tierb/index.json', ['0.1.0']).then(parseTierBIndex));

const tiles = new Map<string, Promise<TierBTile>>();

export function loadTierBTile(id: string): Promise<TierBTile> {
  let p = tiles.get(id);
  if (!p) {
    p = loadTierBIndex().then(async (ix) => {
      const t = ix.tiles.find((x) => x.id === id);
      if (!t) throw new DataError(`tierb: no tile ${id}`);
      const buf = await fetchBuffer(`terrain/tierb/${t.file}`);
      const dv = new DataView(buf);
      const n = t.n_nodes;
      if (!Number.isInteger(n) || n <= 0) throw new DataError(`tierb ${id}: invalid node count`);
      const sec = (name: string): Section => {
        const s = t.sections[name];
        if (!s || !Number.isInteger(s.offset_bytes) || !Number.isInteger(s.byte_length) || s.offset_bytes < 0 || s.byte_length <= 0 || s.offset_bytes + s.byte_length > buf.byteLength) {
          throw new DataError(`tierb ${id}: section ${name} missing or out of range`);
        }
        return s;
      };
      const read = (name: string, shape: number[], map: (v: number) => number): Float32Array => {
        const s = sec(name);
        const count = shape.reduce((product, dimension) => product * dimension, 1);
        const size = { float32: 4, uint16: 2 }[s.dtype];
        if (!Array.isArray(s.shape) || s.shape.length !== shape.length || s.shape.some((dimension, i) => dimension !== shape[i])) {
          throw new DataError(`tierb ${id}: section ${name} has wrong shape`);
        }
        if (s.byte_length !== count * size) throw new DataError(`tierb ${id}: section ${name} has wrong length`);
        const out = new Float32Array(count);
        for (let i = 0; i < count; i++) {
          const o = s.offset_bytes + i * size;
          const v = s.dtype === 'float32' ? dv.getFloat32(o, true) : dv.getUint16(o, true);
          out[i] = map(v);
        }
        return out;
      };
      const m = sec('mask');
      if (m.scale !== 0.01 || m.offset !== -10 || m.unavailable_sentinel !== 65535) {
        throw new DataError(`tierb ${id}: mask quantization disagrees with v0.1.0 contract`);
      }
      const slope = sec('slope_deg');
      const aspect = sec('downhill_aspect_deg');
      if (slope.scale !== 0.01 || slope.offset !== 0 || slope.unit !== 'deg' || aspect.scale !== 0.01 || aspect.offset !== 0 || aspect.unit !== 'deg') {
        throw new DataError(`tierb ${id}: terrain angle quantization disagrees with v0.1.0 contract`);
      }
      if (sec('lat_deg').unit !== 'deg' || sec('lon_deg').unit !== 'deg' || sec('z0_m').unit !== 'm' || sec('d_min_m').unit !== 'm') {
        throw new DataError(`tierb ${id}: section units disagree with v0.1.0 contract`);
      }
      const sections = ['lat_deg', 'lon_deg', 'mask', 'slope_deg', 'downhill_aspect_deg', 'z0_m', 'd_min_m'].map(sec).sort((a, b) => a.offset_bytes - b.offset_bytes);
      let end = 0;
      for (const section of sections) {
        if (section.offset_bytes !== end) throw new DataError(`tierb ${id}: sections are not contiguous`);
        end += section.byte_length;
      }
      if (end !== buf.byteLength) throw new DataError(`tierb ${id}: payload has trailing bytes`);
      return {
        id, nNodes: n, binDeg: ix.bin_deg,
        latDeg: read('lat_deg', [n], (v) => v), lonDeg: read('lon_deg', [n], (v) => v),
        maskDeg: read('mask', [n, Math.round(360 / ix.bin_deg)], (v) => v === 65535 ? Number.NaN : v * m.scale! + m.offset!),
        slopeDeg: read('slope_deg', [n], (v) => v * 0.01),
        downhillAspectDeg: read('downhill_aspect_deg', [n], (v) => v * 0.01),
        z0M: read('z0_m', [n], (v) => v),
        dMinM: read('d_min_m', [n], (v) => v),
      };
    });
    tiles.set(id, p);
    p.catch(() => tiles.delete(id));
  }
  return p;
}

/** Nearest geographic node; equal distances retain the earlier row-major node. */
export function nearestTierBNode(tile: TierBTile, latitudeDeg: number, longitudeDeg: number): number {
  if (!Number.isFinite(latitudeDeg) || !Number.isFinite(longitudeDeg)) throw new RangeError('tierb: query coordinates must be finite');
  const latitude = latitudeDeg * Math.PI / 180;
  const longitude = longitudeDeg * Math.PI / 180;
  let nearest = 0;
  let nearestDot = -Infinity;
  for (let i = 0; i < tile.nNodes; i++) {
    const nodeLatitude = tile.latDeg[i] * Math.PI / 180;
    const dot = Math.sin(latitude) * Math.sin(nodeLatitude) + Math.cos(latitude) * Math.cos(nodeLatitude) * Math.cos(longitude - tile.lonDeg[i] * Math.PI / 180);
    if (dot > nearestDot) {
      nearestDot = dot;
      nearest = i;
    }
  }
  return nearest;
}
