// Owner: Ebin
// Loads the current site's Tier-A/B horizon mask for the Ribbon (Nived's `engine/data/masks.ts` loader).
// Tier C sites (and anything else without a mask file) resolve to `mask: null` — the Ribbon falls back to a
// flat horizon rather than treating a 404 as an error (PLAN_FINAL §4.2: Tier C genuinely has no terrain).
import { useEffect, useState } from 'react';
import { loadMask, type Mask } from '../../engine/data/masks';

export interface SiteMaskState {
  mask: Mask | null;
  loading: boolean;
  /** True once we've tried and failed (vs. not having asked yet) — lets the UI say "no terrain" vs "loading". */
  unavailable: boolean;
}

const EMPTY: SiteMaskState = { mask: null, loading: false, unavailable: false };

export function useSiteMask(siteId: string | null): SiteMaskState {
  const [state, setState] = useState<SiteMaskState>(EMPTY);

  useEffect(() => {
    if (!siteId || siteId === 'mock') {
      setState(EMPTY);
      return;
    }
    let live = true;
    setState({ mask: null, loading: true, unavailable: false });
    loadMask(siteId).then(
      (mask) => live && setState({ mask, loading: false, unavailable: false }),
      () => live && setState({ mask: null, loading: false, unavailable: true }),
    );
    return () => {
      live = false;
    };
  }, [siteId]);

  return state;
}
