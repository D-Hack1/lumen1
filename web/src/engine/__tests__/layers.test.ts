// Owner: Shiva Shakthi
// Integration tests for S-7 backend layer index alignment and layer loader.
import { beforeEach, describe, expect, it } from 'vitest';
import { loadLayers, resetLayersCache } from '../data/layers';
import { clearDataCache, setDataMode } from '../data/source';
import { stubFetch } from './helpers';

describe('S-7 layer index and loader integration', () => {
  beforeEach(() => {
    resetLayersCache();
    clearDataCache();
    stubFetch();
  });

  it('loads valid available layers and derives correct projection field values and units', async () => {
    setDataMode('real');
    const res = await loadLayers();
    expect(res.layers.length).toBe(8);
    expect(res.sizePx).toEqual([2534, 2534]);

    // Check map extents
    expect(res.extents).toBeDefined();
    expect(res.extents?.['80S']).toBeDefined();
    expect(res.extents?.['85S']).toBeDefined();

    const ext80 = res.extents!['80S']!;
    expect(ext80.latLimitDeg).toBe(-80);
    expect(ext80.halfExtentKm).toBeCloseTo(304.0056, 4);
    expect(ext80.centrePx).toEqual([1267, 1267]);
    expect(ext80.metresPerPx).toBe(240);

    const ext85 = res.extents!['85S']!;
    expect(ext85.latLimitDeg).toBe(-85);
    expect(ext85.halfExtentKm).toBeCloseTo(151.7130, 4);
    expect(ext85.centrePx).toEqual([633, 633]);
    expect(ext85.metresPerPx).toBe(240);

    // Verify filenames and paths resolve correctly
    for (const layer of res.layers) {
      expect(layer.url).toMatch(/^\/data\/terrain\/layers\/[a-z_]+_8[05]_90S\.png$/);
      expect(layer.url).not.toContain('layers/layers/');
    }

    // Verify legend stops and units
    const slope80 = res.layers.find((l) => l.id === 'slope_hazard' && l.extent === '80S');
    expect(slope80).toBeDefined();
    expect(slope80!.legendStops.length).toBe(4);
    expect(slope80!.legendStops[0].value).toBe(0.0);
    expect(slope80!.legendStops[1].value).toBe(5.0);

    const illum80 = res.layers.find((l) => l.id === 'average_illumination' && l.extent === '80S');
    expect(illum80).toBeDefined();
    expect(illum80!.legendStops.length).toBe(5);
    expect(illum80!.legendStops[0].value).toBe(0.0);
    expect(illum80!.legendStops[4].value).toBe(1.0);
  });

  it('skips unavailable layers with projection: null', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (url: string) => {
        if (url.includes('terrain/layers.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              version: '0.1.0',
              layers: [
                {
                  layer_id: 'slope_hazard',
                  name: 'Slope Hazard',
                  extent: '80_90S',
                  available: true,
                  filename: 'slope_hazard_80_90S.png',
                  projection: {
                    size_px: [2534, 2534],
                    centre_px: [1267.0, 1267.0],
                    lat_limit_deg: -80,
                    half_extent_km: 304.0056,
                    metres_per_px: 240.0,
                  },
                  legend_stops: [{ value: 0, label: 'Safe', hex: '#ffffb2' }],
                  source_citation: 'PGDA products/90',
                },
                {
                  layer_id: 'average_illumination',
                  name: 'Average Illumination',
                  extent: '80_90S',
                  available: false,
                  filename: null,
                  projection: null,
                  legend_stops: [],
                  source_citation: null,
                },
              ],
            }),
          } as Response;
        }
        if (url.includes('terrain/regions.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ version: '0.1.0', regions: [] }),
          } as Response;
        }
        return originalFetch(url);
      }) as typeof fetch;

      resetLayersCache();
      clearDataCache();
      const res = await loadLayers();
      expect(res.layers.length).toBe(1);
      expect(res.layers[0].id).toBe('slope_hazard');
      expect(res.extents?.['80S']).toBeDefined();
      expect(res.extents?.['85S']).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('skips entries with missing or incomplete projection metadata or missing filename', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (url: string) => {
        if (url.includes('terrain/layers.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              version: '0.1.0',
              layers: [
                {
                  layer_id: 'incomplete_proj',
                  name: 'Incomplete Proj',
                  extent: '80_90S',
                  available: true,
                  filename: 'incomplete.png',
                  projection: {
                    // Missing size_px, centre_px, etc.
                    lat_limit_deg: -80,
                  },
                  legend_stops: [],
                },
                {
                  layer_id: 'missing_filename',
                  name: 'Missing Filename',
                  extent: '80_90S',
                  available: true,
                  filename: null,
                  projection: {
                    size_px: [2534, 2534],
                    centre_px: [1267.0, 1267.0],
                    lat_limit_deg: -80,
                    half_extent_km: 304.0,
                    metres_per_px: 240.0,
                  },
                  legend_stops: [],
                },
                {
                  layer_id: 'valid_layer',
                  name: 'Valid Layer',
                  extent: '85_90S',
                  available: true,
                  filename: 'valid.png',
                  projection: {
                    size_px: [1266, 1266],
                    centre_px: [633.0, 633.0],
                    lat_limit_deg: -85,
                    half_extent_km: 151.713,
                    metres_per_px: 240.0,
                  },
                  legend_stops: [{ value: 0, label: '0', hex: '#ffffff' }],
                },
              ],
            }),
          } as Response;
        }
        if (url.includes('terrain/regions.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ version: '0.1.0', regions: [] }),
          } as Response;
        }
        return originalFetch(url);
      }) as typeof fetch;

      resetLayersCache();
      clearDataCache();
      const res = await loadLayers();
      expect(res.layers.length).toBe(1);
      expect(res.layers[0].id).toBe('valid_layer');
      expect(res.sizePx).toEqual([1266, 1266]);
      expect(res.extents?.['80S']).toBeUndefined();
      expect(res.extents?.['85S']).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns an empty layer collection with null extents when all eight entries are unavailable', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (url: string) => {
        if (url.includes('terrain/layers.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              version: '0.1.0',
              layers: [
                { layer_id: 'l1', extent: '80_90S', available: false, filename: null, projection: null },
                { layer_id: 'l2', extent: '85_90S', available: false, filename: null, projection: null },
                { layer_id: 'l3', extent: '80_90S', available: false, filename: null, projection: null },
                { layer_id: 'l4', extent: '85_90S', available: false, filename: null, projection: null },
                { layer_id: 'l5', extent: '80_90S', available: false, filename: null, projection: null },
                { layer_id: 'l6', extent: '85_90S', available: false, filename: null, projection: null },
                { layer_id: 'l7', extent: '80_90S', available: false, filename: null, projection: null },
                { layer_id: 'l8', extent: '85_90S', available: false, filename: null, projection: null },
              ],
            }),
          } as Response;
        }
        if (url.includes('terrain/regions.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ version: '0.1.0', regions: [] }),
          } as Response;
        }
        return originalFetch(url);
      }) as typeof fetch;

      resetLayersCache();
      clearDataCache();
      const res = await loadLayers();
      expect(res.layers.length).toBe(0);
      expect(res.extents).toBeNull();
      expect(res.sizePx).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('calculates map extents only from valid available layers', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (url: string) => {
        if (url.includes('terrain/layers.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              version: '0.1.0',
              layers: [
                {
                  layer_id: 'slope_hazard_80',
                  name: 'Slope 80',
                  extent: '80_90S',
                  available: true,
                  filename: 'slope_80.png',
                  projection: {
                    size_px: [2534, 2534],
                    centre_px: [1267.0, 1267.0],
                    lat_limit_deg: -80,
                    half_extent_km: 304.0056,
                    metres_per_px: 240.0,
                  },
                  legend_stops: [],
                },
                {
                  layer_id: 'slope_hazard_85',
                  name: 'Slope 85',
                  extent: '85_90S',
                  available: false,
                  filename: 'slope_85.png',
                  projection: {
                    size_px: [1266, 1266],
                    centre_px: [633.0, 633.0],
                    lat_limit_deg: -85,
                    half_extent_km: 151.713,
                    metres_per_px: 240.0,
                  },
                  legend_stops: [],
                },
              ],
            }),
          } as Response;
        }
        if (url.includes('terrain/regions.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ version: '0.1.0', regions: [] }),
          } as Response;
        }
        return originalFetch(url);
      }) as typeof fetch;

      resetLayersCache();
      clearDataCache();
      const res = await loadLayers();
      expect(res.layers.length).toBe(1);
      expect(res.extents?.['80S']).toBeDefined();
      expect(res.extents?.['85S']).toBeUndefined();
      expect(res.extents?.['80S']?.latLimitDeg).toBe(-80);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
