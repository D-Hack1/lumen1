// Owner: Nived
// Site Inset geometry (guide 3.1 L6): Landing vs Target offsets for sites whose pins are < 1 px apart at basemap scale.
import { MOON_RADIUS_KM } from '../../engine/projection';
import type { SiteRecord } from '../../engine/types';

/** Landing/target offset in metres (east, north) for the Site Inset. Flat-Moon is exact enough at ~350 m. */
export function insetOffsetsM(site: Pick<SiteRecord, 'landingCoords' | 'targetCoords'>): { landing: [number, number]; target: [number, number] } | null {
  if (!site.targetCoords) return null;
  const k = (Math.PI / 180) * MOON_RADIUS_KM * 1000;
  const c = Math.cos((site.landingCoords.lat * Math.PI) / 180);
  return {
    landing: [0, 0],
    target: [(site.targetCoords.lon - site.landingCoords.lon) * k * c, (site.targetCoords.lat - site.landingCoords.lat) * k],
  };
}

