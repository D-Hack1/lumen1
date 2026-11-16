// Owner: Nived
// Which south-pole map shows a latitude. Contract (data_terrain_misc.md 5.2): 85S = 85-90 S, 80S = 80-90 S (inclusive edges).
import type { MapExtent } from '../../engine/types';

/** Southern-latitude limit of each extent, in degrees. */
export const EXTENT_LIMIT_DEG: Record<MapExtent, number> = { '80S': 80, '85S': 85 };

/** The tightest map that contains `latDeg`, or null if neither does (e.g. Chandrayaan-3 at 69 S, any northern site). */
export function smallestExtentContaining(latDeg: number): MapExtent | null {
  if (latDeg <= -EXTENT_LIMIT_DEG['85S']) return '85S';
  if (latDeg <= -EXTENT_LIMIT_DEG['80S']) return '80S';
  return null;
}

export const extentContains = (extent: MapExtent, latDeg: number): boolean => latDeg <= -EXTENT_LIMIT_DEG[extent];
