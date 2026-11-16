// Owner: Nived
// Loader: terrain/tierb/index.json + tiles/<id>.bin. DRAFT: header layout, projection and index schema are unresolved
// (data_tierb.md §10). Assumed here (matches the mock): index lists tiles with byte `sections`; nodes carry
// lat/lon, a 720-bin uint8 mask (deg = u8 * scale + offset), slope, downhill aspect and z0. Snap-to-node is N-11.
import { DataError, fetchBuffer, fetchJson } from './source';

interface Section {
  dtype: 'float32' | 'uint8' | 'uint16' | 'int16';
  offset_bytes: number;
  byte_length: number;
  scale?: number;
  offset?: number;
  unit?: number;
}
interface RawIndex {
  node_spacing_m: number;
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
}

let idx: Promise<RawIndex> | null = null;
export const loadTierBIndex = (): Promise<RawIndex> => (idx ??= fetchJson<RawIndex>('terrain/tierb/index.json'));

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
      const sec = (name: string): Section => {
        const s = t.sections[name];
        if (!s || s.offset_bytes + s.byte_length > buf.byteLength) throw new DataError(`tierb ${id}: section ${name} missing or out of range`);
        return s;
      };
      const read = (name: string, count: number, map: (v: number) => number): Float32Array => {
        const s = sec(name);
        const size = { float32: 4, uint8: 1, uint16: 2, int16: 2 }[s.dtype];
        if (s.byte_length !== count * size) throw new DataError(`tierb ${id}: section ${name} has wrong length`);
        const out = new Float32Array(count);
        for (let i = 0; i < count; i++) {
          const o = s.offset_bytes + i * size;
          const v = s.dtype === 'float32' ? dv.getFloat32(o, true) : s.dtype === 'uint8' ? dv.getUint8(o) : s.dtype === 'uint16' ? dv.getUint16(o, true) : dv.getInt16(o, true);
          out[i] = map(v);
        }
        return out;
      };
      const m = sec('mask');
      return {
        id, nNodes: n, binDeg: ix.bin_deg,
        latDeg: read('lat_deg', n, (v) => v), lonDeg: read('lon_deg', n, (v) => v),
        maskDeg: read('mask', n * Math.round(360 / ix.bin_deg), (v) => v * (m.scale ?? 1) + (m.offset ?? 0)),
        slopeDeg: read('slope_deg', n, (v) => v * (sec('slope_deg').unit ?? 1)),
        downhillAspectDeg: read('downhill_aspect_deg', n, (v) => v * (sec('downhill_aspect_deg').unit ?? 1)),
        z0M: read('z0_m', n, (v) => v * (sec('z0_m').unit ?? 1)),
      };
    });
    tiles.set(id, p);
    p.catch(() => tiles.delete(id));
  }
  return p;
}
