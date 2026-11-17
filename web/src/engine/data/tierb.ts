// Owner: Nived
// Loader: terrain/tierb/index.json + tiles/<id>.bin (data_tierb.md v0.1.0).
import { DataError, dataMode, dataUrl, fetchBuffer, fetchJson } from './source';
import { LUNAR_RADIUS_KM } from '../core/constants';
import { groundNormalFromPad, type Vec3 } from '../core/padPower';
import { Horizon } from '../core/visibility';

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
interface RawTile {
  id: string;
  file: string;
  n_nodes: number;
  spacing_m: number;
  bbox_xy_m: [number, number, number, number];
  sections: Record<string, Section>;
}
export interface RawIndex {
  schema: 'tierb_index';
  version: '0.1.0';
  crs: string;
  bin_deg: number;
  height_m: number;
  tiles: RawTile[];
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

export interface TierBTerrain {
  tier: 'B';
  horizon: Horizon;
  observerElevationM: number;
  groundNormal: Vec3;
  snapDistanceKm: number;
  tileId: string;
  nodeIndex: number;
}

export interface TierBFallback {
  tier: 'C';
  reason: 'tier_a_precedence' | 'tierb_observer_height_unsupported' | 'tierb_unavailable' | 'tierb_not_covered' | 'tierb_invalid_node';
}

const CRS = '+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400';

let idx: Promise<RawIndex> | null = null;
export function parseTierBIndex(index: RawIndex): RawIndex {
  if (index.schema !== 'tierb_index' || index.version !== '0.1.0' || index.crs !== CRS || index.bin_deg !== 0.5 || index.height_m !== 1 || !Array.isArray(index.tiles)) {
    throw new DataError('tierb: index disagrees with v0.1.0 contract');
  }
  const ids = new Set<string>();
  for (const tile of index.tiles) {
    if (!tile || typeof tile.id !== 'string' || !tile.id || ids.has(tile.id) || typeof tile.file !== 'string' || !/^tiles\/.+\.bin$/.test(tile.file) || !Number.isInteger(tile.n_nodes) || tile.n_nodes <= 0 || (tile.spacing_m !== 2000 && tile.spacing_m !== 4000) || !Array.isArray(tile.bbox_xy_m) || tile.bbox_xy_m.length !== 4 || tile.bbox_xy_m.some((value) => !Number.isFinite(value)) || tile.bbox_xy_m[0] > tile.bbox_xy_m[2] || tile.bbox_xy_m[1] > tile.bbox_xy_m[3] || !tile.sections || typeof tile.sections !== 'object') {
      throw new DataError('tierb: index has malformed tile metadata');
    }
    ids.add(tile.id);
  }
  return index;
}

export const loadTierBIndex = (): Promise<RawIndex> => {
  if (!idx) {
    idx = fetchJson<RawIndex>('terrain/tierb/index.json', ['0.1.0']).then(parseTierBIndex);
    idx.catch(() => { idx = null; });
  }
  return idx;
};

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

function projectedXY(latitudeDeg: number, longitudeDeg: number): [number, number] {
  const colatitude = (90 + latitudeDeg) * Math.PI / 180;
  const radiusM = 2 * LUNAR_RADIUS_KM * 1000 * Math.tan(colatitude / 2);
  const longitude = longitudeDeg * Math.PI / 180;
  return [radiusM * Math.sin(longitude), radiusM * Math.cos(longitude)];
}

/** Covering tiles sorted by ID make shared-boundary selection deterministic. */
export function coveringTierBTiles(index: RawIndex, latitudeDeg: number, longitudeDeg: number): RawTile[] {
  const [x, y] = projectedXY(latitudeDeg, longitudeDeg);
  // Writer bboxes describe node centres. Expand to their nearest-node cells so
  // adjacent 20 km tiles meet at the deterministic half-spacing boundary.
  return index.tiles.filter((tile) => x >= tile.bbox_xy_m[0] - tile.spacing_m / 2 && x <= tile.bbox_xy_m[2] + tile.spacing_m / 2 && y >= tile.bbox_xy_m[1] - tile.spacing_m / 2 && y <= tile.bbox_xy_m[3] + tile.spacing_m / 2).sort((a, b) => a.id.localeCompare(b.id));
}

function validNode(tile: TierBTile, index: number): boolean {
  if (!Number.isFinite(tile.latDeg[index]) || !Number.isFinite(tile.lonDeg[index]) || !Number.isFinite(tile.slopeDeg[index]) || tile.slopeDeg[index] < 0 || tile.slopeDeg[index] >= 90 || !Number.isFinite(tile.downhillAspectDeg[index]) || tile.downhillAspectDeg[index] < 0 || tile.downhillAspectDeg[index] >= 360 || !Number.isFinite(tile.z0M[index]) || !Number.isFinite(tile.dMinM[index]) || tile.dMinM[index] <= 0) return false;
  const offset = index * 720;
  for (let bin = 0; bin < 720; bin++) if (!Number.isFinite(tile.maskDeg[offset + bin])) return false;
  return true;
}

function nearestValidTierBNode(tile: TierBTile, latitudeDeg: number, longitudeDeg: number): number | null {
  let node: number | null = null;
  let dot = -Infinity;
  const latitude = latitudeDeg * Math.PI / 180;
  const longitude = longitudeDeg * Math.PI / 180;
  for (let i = 0; i < tile.nNodes; i++) {
    if (!validNode(tile, i)) continue;
    const candidateLatitude = tile.latDeg[i] * Math.PI / 180;
    const candidateDot = Math.sin(latitude) * Math.sin(candidateLatitude) + Math.cos(latitude) * Math.cos(candidateLatitude) * Math.cos(longitude - tile.lonDeg[i] * Math.PI / 180);
    if (candidateDot > dot) {
      dot = candidateDot;
      node = i;
    }
  }
  return node;
}

const unavailable = new Set<string>();

/** Resolve custom-point terrain only; curated requests retain their Tier-A path. */
export async function resolveTierBTerrain(siteId: string | null, latitudeDeg: number, longitudeDeg: number, heightM: number): Promise<TierBTerrain | TierBFallback> {
  if (siteId) return { tier: 'C', reason: 'tier_a_precedence' };
  if (heightM !== 1) return { tier: 'C', reason: 'tierb_observer_height_unsupported' };
  if (dataMode() !== 'real') return { tier: 'C', reason: 'tierb_unavailable' };
  const key = dataUrl('terrain/tierb/index.json');
  if (unavailable.has(key)) return { tier: 'C', reason: 'tierb_unavailable' };
  let index: RawIndex;
  try {
    index = await loadTierBIndex();
  } catch {
    unavailable.add(key);
    return { tier: 'C', reason: 'tierb_unavailable' };
  }
  const entries = coveringTierBTiles(index, latitudeDeg, longitudeDeg);
  if (!entries.length) return { tier: 'C', reason: 'tierb_not_covered' };
  for (const entry of entries) {
    try {
      const tile = await loadTierBTile(entry.id);
      const node = nearestValidTierBNode(tile, latitudeDeg, longitudeDeg);
      if (node == null) continue;
      const snapDistanceKm = Math.acos(Math.min(1, Math.max(-1, Math.sin(latitudeDeg * Math.PI / 180) * Math.sin(tile.latDeg[node] * Math.PI / 180) + Math.cos(latitudeDeg * Math.PI / 180) * Math.cos(tile.latDeg[node] * Math.PI / 180) * Math.cos((longitudeDeg - tile.lonDeg[node]) * Math.PI / 180)))) * LUNAR_RADIUS_KM;
      return {
        tier: 'B',
        horizon: new Horizon({ elevationsDeg: tile.maskDeg.subarray(node * 720, (node + 1) * 720), binWidthDeg: tile.binDeg, slopeDeg: tile.slopeDeg[node], uphillAzimuthDeg: (tile.downhillAspectDeg[node] + 180) % 360, dMinM: tile.dMinM[node], observerHeightM: 1 }),
        observerElevationM: tile.z0M[node] + 1,
        groundNormal: groundNormalFromPad(tile.slopeDeg[node], tile.downhillAspectDeg[node]),
        snapDistanceKm,
        tileId: entry.id,
        nodeIndex: node,
      };
    } catch {
      return { tier: 'C', reason: 'tierb_unavailable' };
    }
  }
  return { tier: 'C', reason: 'tierb_invalid_node' };
}

export function __resetTierBForTests(): void {
  idx = null;
  tiles.clear();
  unavailable.clear();
}
