// Owner: Nived
// The hillshade slot of the Basemap (FRONTEND_BUILD_GUIDE L1). Shiva's `basemap_hillshade` arrives as a layers.json entry with layer_id
// "hillshade" (one per extent, same projection as the data layers). It is a fixed base under the data layers, not a selectable data layer.
import type { LayerEntry, MapExtent } from '../../engine/types';

export const HILLSHADE_ID = 'hillshade';

export const hillshadeFor = (layers: readonly LayerEntry[], extent: MapExtent): LayerEntry | null => layers.find((l) => l.id === HILLSHADE_ID && l.extent === extent) ?? null;
export const selectableLayers = (layers: readonly LayerEntry[]): LayerEntry[] => layers.filter((l) => l.id !== HILLSHADE_ID);
