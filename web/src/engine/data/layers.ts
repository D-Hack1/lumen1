
// Owner: Nived
// Loaders: terrain/layers.json (+ PNGs in terrain/layers/) and terrain/regions.json (data_terrain_misc.md §5, §6).
// Projection parameters are DRAFT (contract 5.4: not frozen); the loader reads whatever each layer entry declares.
import { dataUrl, fetchJson } from './source';
import type { LayerExtent, LayersResult, MapExtent } from '../types';

const VERSIONS = ['0.1.0'];
const EXTENT: Record<'80_90S' | '85_90S', MapExtent> = {
  '80_90S': '80S',
  '85_90S': '85S',
};

interface RawProjection {
  size_px?: [number, number];
  centre_px?: [number, number];
  lat_limit_deg?: number;
  half_extent_km?: number;
  metres_per_px?: number;
}

interface RawLayer {
  layer_id: string;
  name: string;
  extent: '80_90S' | '85_90S';
  filename: string | null;
  /** null (or missing/incomplete) = this layer is unavailable: it is not offered, and contributes no map extent. */
  projection: RawProjection | null;
  legend_stops: Array<{
    value?: number;
    value_pct?: number;
    /** Class-based legends (slope hazard): the class covers [lo, hi); its stop value is `lo`. */
    range_deg?: [number, number];
    label: string;
    /** null = a class with no swatch (e.g. "not a PSR"). */
    hex: string | null;
  }>;
  source_citation: string;
  derived?: boolean;
  available?: boolean;
  status?: string;
}

interface RawLayers {
  layers: RawLayer[];
}

interface RawRegions {
  regions: Array<{
    region_id: string;
    name: string;
    centroid_lat_deg: number;
    centroid_lon_deg: number;
    svg_path: string;
  }>;
}

const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const isPair = (v: unknown): v is [number, number] =>
  Array.isArray(v) &&
  v.length === 2 &&
  isNum(v[0]) &&
  isNum(v[1]);

/**
 * A layer is usable only if it declares a complete, valid projection
 * and a raster file. Never reads fields of a null projection.
 */
function usableProjection(e: RawLayer): Required<RawProjection> | null {
  if (
    e.available === false ||
    typeof e.filename !== 'string' ||
    e.filename === ''
  ) {
    return null;
  }

  const p = e.projection;

  if (!p || typeof p !== 'object') return null;

  if (
    !isPair(p.size_px) ||
    !isPair(p.centre_px) ||
    !isNum(p.lat_limit_deg) ||
    !isNum(p.half_extent_km) ||
    !isNum(p.metres_per_px)
  ) {
    return null;
  }

  if (
    !(p.half_extent_km > 0) ||
    !(p.metres_per_px > 0) ||
    !(p.size_px[0] > 0) ||
    !(p.size_px[1] > 0)
  ) {
    return null;
  }

  // Rebuilt from the validated values so the result is fully typed (the guards above narrow the fields, but not the object).
  return {
    size_px: p.size_px,
    centre_px: p.centre_px,
    lat_limit_deg: p.lat_limit_deg,
    half_extent_km: p.half_extent_km,
    metres_per_px: p.metres_per_px,
  };
}

/**
 * Pure: raw layers/regions JSON -> the result.
 * Unavailable layers are dropped; with none available, `layers` is empty
 * and `extents`/`sizePx` are null (no throw).
 */
export function parseLayers(
  l: RawLayers,
  r: RawRegions,
): Omit<LayersResult, 'loading' | 'error'> {
  const extents: Partial<Record<MapExtent, LayerExtent>> = {};
  let sizePx: [number, number] | null = null;
  const layers: LayersResult['layers'] = [];

  for (const e of l.layers ?? []) {
    const p = usableProjection(e);

    if (!p || typeof e.filename !== 'string') continue;

    const file = e.filename
      .replace(/^\/+/, '')
      .replace(/^layers\//, '');

    // The contract names files both as "x.png" (mock)
    // and "layers/x.png" (real index).
    extents[EXTENT[e.extent]] ??= {
      latLimitDeg: p.lat_limit_deg,
      halfExtentKm: p.half_extent_km,
      centrePx: p.centre_px,
      metresPerPx: p.metres_per_px,
    };

    sizePx ??= p.size_px;

    layers.push({
      id: e.layer_id,
      label: e.name,
      extent: EXTENT[e.extent],
      url: dataUrl(`terrain/layers/${file}`),
      legendStops: (e.legend_stops ?? []).map((g) => ({
        value: g.value ?? (g.value_pct != null ? g.value_pct / 100 : undefined) ?? g.range_deg?.[0] ?? 0, // value_pct 0..100 -> a 0..1 fraction, like the mock legends
        label: g.label,
        color: g.hex ?? 'transparent',
      })),
      source: e.source_citation,
      derived: e.derived === true,
    });
  }

  return {
    sizePx,
    extents:
      Object.keys(extents).length > 0
        ? (extents as LayersResult['extents'])
        : null,
    layers,
    regions: (r.regions ?? []).map((g) => ({
      id: g.region_id,
      name: g.name,
      centroid: {
        lat: g.centroid_lat_deg,
        lon: g.centroid_lon_deg,
      },
      svgPath: g.svg_path,
    })),
  };
}

let cached: Promise<Omit<LayersResult, 'loading' | 'error'>> | null = null;

export function resetLayersCache(): void {
  cached = null;
}

export function loadLayers(): Promise<
  Omit<LayersResult, 'loading' | 'error'>
> {
  if (!cached) {
    cached = Promise.all([
      fetchJson<RawLayers>('terrain/layers.json', VERSIONS),
      fetchJson<RawRegions>('terrain/regions.json', VERSIONS),
    ]).then(([l, r]) => parseLayers(l, r));

    cached.catch(() => {
      cached = null;
    });
  }

  return cached;
}
