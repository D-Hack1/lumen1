// Owner: Nived
// Layer index robustness (Shivha, S-7): unavailable entries carry `projection: null`; the loader must not read their fields, must derive extents only from
// available layers with a complete projection, and must not throw when none are available.
import { describe, expect, it } from 'vitest';
import { parseLayers } from '../data/layers';

const proj = (half: number) => ({ size_px: [100, 100], centre_px: [50, 50], lat_limit_deg: -80, half_extent_km: half, metres_per_px: 10 });
const entry = (id: string, extent: '80_90S' | '85_90S', over: Record<string, unknown> = {}) => ({
  layer_id: id, name: id, extent, filename: `layers/${id}_${extent}.png`, projection: proj(extent === '80_90S' ? 304 : 152),
  legend_stops: [{ value_pct: 0, label: '0%', hex: '#000000' }], source_citation: 'x', ...over,
});
const regions = { regions: [] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (layers: any[]) => parseLayers({ layers } as any, regions);

describe('parseLayers', () => {
  it('all entries unavailable (projection: null): no throw, no layers, no extents, no size', () => {
    const r = parse(['a', 'b', 'c'].flatMap((id) => [entry(id, '80_90S', { projection: null }), entry(id, '85_90S', { projection: null })]));
    expect(r.layers).toEqual([]);
    expect(r.extents).toBeNull();
    expect(r.sizePx).toBeNull();
  });

  it('mixed: unavailable entries are dropped; extents come only from available layers', () => {
    const r = parse([entry('psr', '80_90S', { projection: null }), entry('slope', '80_90S'), entry('psr', '85_90S', { projection: null })]);
    expect(r.layers.map((l) => l.id)).toEqual(['slope']);
    expect(Object.keys(r.extents!)).toEqual(['80S']); // 85S has no available layer
    expect(r.extents!['80S']!.halfExtentKm).toBe(304);
    expect(r.sizePx).toEqual([100, 100]);
  });

  it('an incomplete or invalid projection, a missing filename, or available:false is treated as unavailable', () => {
    const r = parse([
      entry('a', '80_90S', { projection: { size_px: [100, 100] } }),
      entry('b', '80_90S', { projection: { ...proj(0) } }),
      entry('c', '80_90S', { filename: null }),
      entry('d', '80_90S', { available: false }),
      entry('ok', '80_90S'),
    ]);
    expect(r.layers.map((l) => l.id)).toEqual(['ok']);
  });

  it('accepts the real index shape: filename "layers/x.png" resolves once under terrain/layers/, legend value_pct is read', () => {
    const r = parse([entry('slope', '80_90S')]);
    expect(r.layers[0].url).toMatch(/terrain\/layers\/slope_80_90S\.png$/);
    expect(r.layers[0].url).not.toMatch(/layers\/layers\//);
    expect(r.layers[0].legendStops[0]).toEqual({ value: 0, label: '0%', color: '#000000' });
  });
});
