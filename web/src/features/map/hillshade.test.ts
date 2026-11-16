// Owner: Nived
// Seam: the hillshade slot (FRONTEND_BUILD_GUIDE L1: Shiva's `basemap_hillshade`, same projection/extent as the data layers). A layers.json entry
// with layer_id "hillshade" is a fixed base under the data layers; it is NOT a selectable data layer and must not make the layer controls appear.
import { describe, expect, it } from 'vitest';
import type { LayerEntry } from '../../engine/types';
import { hillshadeFor, selectableLayers } from './hillshade';

const L = (id: string, extent: '80S' | '85S'): LayerEntry => ({ id, label: id, extent, url: `/x/${id}-${extent}.png`, legendStops: [], source: '', derived: false });
const all = [L('hillshade', '80S'), L('hillshade', '85S'), L('illumination', '80S')];

describe('hillshade slot', () => {
  it('picks the hillshade of the shown extent, or null when the pipeline has not produced one', () => {
    expect(hillshadeFor(all, '85S')?.url).toBe('/x/hillshade-85S.png');
    expect(hillshadeFor([L('illumination', '80S')], '80S')).toBeNull();
    expect(hillshadeFor([], '80S')).toBeNull();
  });
  it('selectable layers exclude the hillshade, so a hillshade-only drop does not show dead layer controls', () => {
    expect(selectableLayers(all).map((l) => l.id)).toEqual(['illumination']);
    expect(selectableLayers([L('hillshade', '80S')])).toEqual([]);
  });
});
