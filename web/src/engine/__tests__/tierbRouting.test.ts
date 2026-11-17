import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { __resetTierBForTests, coveringTierBTiles, resolveTierBTerrain } from '../data/tierb';
import { clearDataCache, setDataMode } from '../data/source';
import { PUBLIC } from './helpers';

const tierbRoot = join(PUBLIC, 'data-mock', 'terrain', 'tierb');
const CRS = '+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400';
const originalFetch = globalThis.fetch;

async function fixtureIndex(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(tierbRoot, 'index.json'), 'utf8'));
}

function serveTierB(index: unknown, serveTiles = true): void {
  globalThis.fetch = (async (url: string) => {
    if (url.endsWith('/data/terrain/tierb/index.json')) {
      return { ok: true, status: 200, json: async () => index } as Response;
    }
    if (serveTiles && url.includes('/data/terrain/tierb/tiles/')) {
      try {
        const buffer = await readFile(join(tierbRoot, 'tiles', url.slice(url.lastIndexOf('/') + 1)));
        return { ok: true, status: 200, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) } as Response;
      } catch {
        return { ok: false, status: 404 } as Response;
      }
    }
    return { ok: false, status: 404 } as Response;
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  setDataMode(null);
  clearDataCache();
  __resetTierBForTests();
});

describe('Tier-B custom-point routing', () => {
  it('falls back explicitly when the real index is empty', async () => {
    setDataMode('real');
    serveTierB({ schema: 'tierb_index', version: '0.1.0', crs: CRS, bin_deg: 0.5, height_m: 1, tiles: [] });
    await expect(resolveTierBTerrain(null, -89, 0, 1)).resolves.toEqual({ tier: 'C', reason: 'tierb_not_covered' });
  });

  it('falls back explicitly for malformed metadata and a missing tile', async () => {
    setDataMode('real');
    serveTierB({ schema: 'tierb_index', version: '0.1.0', crs: 'wrong', bin_deg: 0.5, height_m: 1, tiles: [] });
    await expect(resolveTierBTerrain(null, -89, 0, 1)).resolves.toEqual({ tier: 'C', reason: 'tierb_unavailable' });

    __resetTierBForTests();
    const index = await fixtureIndex();
    serveTierB(index, false);
    await expect(resolveTierBTerrain(null, -90, 0, 1)).resolves.toEqual({ tier: 'C', reason: 'tierb_unavailable' });
  });

  it('routes a valid contract fixture through a finite node at the fixed 1 m height', async () => {
    setDataMode('real');
    serveTierB(await fixtureIndex());
    const terrain = await resolveTierBTerrain(null, -90, 0, 1);
    expect(terrain.tier).toBe('B');
    if (terrain.tier === 'B') {
      expect(terrain.horizon.elevationsDeg).toHaveLength(720);
      expect(terrain.horizon.dMinM).toBeGreaterThan(0);
      expect(terrain.observerElevationM).not.toBe(1);
      expect(terrain.snapDistanceKm).toBeGreaterThanOrEqual(0);
    }
    await expect(resolveTierBTerrain(null, -90, 0, 2)).resolves.toEqual({ tier: 'C', reason: 'tierb_observer_height_unsupported' });
  });

  it('uses deterministic tile ordering at a shared projected boundary and preserves Tier-A precedence', async () => {
    const index = {
      schema: 'tierb_index', version: '0.1.0', crs: CRS, bin_deg: 0.5, height_m: 1,
      tiles: [
        { id: 'z', file: 'tiles/z.bin', n_nodes: 1, spacing_m: 2000, bbox_xy_m: [-1, -1, 1, 1], sections: {} },
        { id: 'a', file: 'tiles/a.bin', n_nodes: 1, spacing_m: 2000, bbox_xy_m: [-1, -1, 1, 1], sections: {} },
      ],
    } as Parameters<typeof coveringTierBTiles>[0];
    expect(coveringTierBTiles(index, -90, 0).map((tile) => tile.id)).toEqual(['a', 'z']);
    await expect(resolveTierBTerrain('im2_athena', -90, 0, 1)).resolves.toEqual({ tier: 'C', reason: 'tier_a_precedence' });
  });
});
