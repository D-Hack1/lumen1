// Owner: Ebin
// One pin on the 80 m south-polar map (the Orbit page's terrain), read the same way the polar stage reads it. A pin with no engine terrain mask
// (a dropped pin, or a catalogue site without a mask) is otherwise evaluated on the smooth Moon, which cannot see the terrain that shadows it. Inside the
// polar view the map CAN see it, so the Orbit page uses it for lit / shadow, horizon and Sun / Earth visibility, and says so.
// The map is coarse (about 0.8 km per pixel, 24 azimuths): good for "is this spot in a crater's shadow", not a substitute for a Tier-A mask.
import { useEffect, useState } from 'react';
import { loadPolarTerrain } from './polarAssets';
import { SUN_PHASE_OFFSET_H, T_MAX } from './orbitModel';
import { latLonToPixel, POLAR_LAT_LIMIT_DEG } from './polarGrid';
import { samplePolar, type PolarSample, type PolarTerrain } from './polarTerrain';

export const insidePolarMap = (lat: number): boolean => lat <= POLAR_LAT_LIMIT_DEG;

/** The map's reading at a pin for page hour `t`; null outside the 80°S disc. */
export function polarPinAt(terrain: PolarTerrain, lat: number, lon: number, t: number): PolarSample | null {
  if (!insidePolarMap(lat)) return null;
  const p = latLonToPixel(terrain.grid, lat, lon);
  const hours = t + SUN_PHASE_OFFSET_H;
  return samplePolar(terrain, Math.round(p.px), Math.round(p.py), { hoursSinceNewMoon: hours, earthHours: hours });
}

/** Hours from `t` until `test` first holds on the map's reading (within the page's month); null if it never does. */
export function polarUntil(
  terrain: PolarTerrain,
  lat: number,
  lon: number,
  t: number,
  test: (s: PolarSample) => boolean,
): number | null {
  for (let h = t + 1; h <= t + T_MAX; h++) {
    const s = polarPinAt(terrain, lat, lon, h);
    if (s && test(s)) return h - t;
  }
  return null;
}

/** The sentence shown where an estimate ignores terrain that the polar map says shadows the spot; null when the map has nothing to add. */
export function polarShadowNote(terrain: PolarTerrain, lat: number, lon: number): string | null {
  const s = polarPinAt(terrain, lat, lon, 0);
  if (!s) return null;
  if (s.alwaysDark)
    return 'NASA’s 80 m polar map shows this spot is permanently shadowed (a cold trap). These numbers assume a smooth Moon, so they overstate the sunlight here.';
  if (s.monthLitPct < 20)
    return `NASA’s 80 m polar map shows this spot is lit only about ${Math.round(s.monthLitPct)}% of a month. These numbers assume a smooth Moon, so they overstate the sunlight here.`;
  return null;
}

/** `polarShadowNote` for a site, loading the map on demand; null until it is loaded, and for sites that already have a terrain mask. */
export function usePolarShadowNote(lat: number, lon: number, hasTerrainMask: boolean): string | null {
  const [terrain, setTerrain] = useState<PolarTerrain | null>(null);
  const wanted = !hasTerrainMask && insidePolarMap(lat);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void loadPolarTerrain().then((t) => live && setTerrain(t));
    return () => {
      live = false;
    };
  }, [wanted]);
  return wanted && terrain ? polarShadowNote(terrain, lat, lon) : null;
}
