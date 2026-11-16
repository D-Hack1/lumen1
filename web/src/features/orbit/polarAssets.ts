// Owner: Abhinav
// Orbit feature — loads web/public/content/orbit/* once and turns it into a PolarTerrain.
// The PNGs hold data (heights, horizon angles), not pictures, so they are decoded with colour conversion off to keep every
// byte exact. Failure resolves to null — the view then shows its "terrain unavailable" state instead of throwing.
import { useEffect, useState } from 'react';
import { buildPolarTerrain, type PolarManifest, type PolarTerrain } from './polarTerrain';

export interface OrbitManifest {
  polar: PolarManifest & {
    files: { dem: string; horizon: string; illum: string };
    credit: string;
  };
  globe: { moonMap: string; earthMap: string; credit: string };
}

export function orbitBase(): string {
  const b = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return `${b.replace(/\/$/, '')}/content/orbit/`;
}

let manifestCache: Promise<OrbitManifest | null> | null = null;
export function loadOrbitManifest(): Promise<OrbitManifest | null> {
  manifestCache ??= (async () => {
    try {
      const r = await fetch(`${orbitBase()}orbit.json`);
      return r.ok ? ((await r.json()) as OrbitManifest) : null;
    } catch {
      return null;
    }
  })();
  return manifestCache;
}

async function pixels(file: string): Promise<Uint8ClampedArray> {
  const r = await fetch(`${orbitBase()}${file}`);
  if (!r.ok) throw new Error(`orbit asset ${file}: ${r.status}`);
  const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2d context unavailable');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, c.width, c.height).data;
}

let terrainCache: Promise<PolarTerrain | null> | null = null;
export function loadPolarTerrain(): Promise<PolarTerrain | null> {
  terrainCache ??= (async () => {
    try {
      const m = await loadOrbitManifest();
      if (!m) return null;
      const [dem, hor, illum] = await Promise.all([
        pixels(m.polar.files.dem),
        pixels(m.polar.files.horizon),
        pixels(m.polar.files.illum),
      ]);
      return buildPolarTerrain(dem, hor, illum, m.polar);
    } catch {
      return null;
    }
  })();
  return terrainCache;
}

export type TerrainState =
  { status: 'loading' } | { status: 'ready'; terrain: PolarTerrain } | { status: 'unavailable' };

export function usePolarTerrain(): TerrainState {
  const [state, setState] = useState<TerrainState>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    void loadPolarTerrain().then((t) => {
      if (live) setState(t ? { status: 'ready', terrain: t } : { status: 'unavailable' });
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}
