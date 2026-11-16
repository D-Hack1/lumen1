// Owner: Ebin
// Loads the landing-pad plane fit (Nived's `engine/data/pad.ts`) for the Touchdown Pad. A missing pad file
// (Tier C, custom point) resolves to `pad: null` — the widget then falls back to the catalog slope or "—".
import { useEffect, useState } from 'react';
import { loadPad, type Pad } from '../../engine/data/pad';

export function usePad(siteId: string | null): { pad: Pad | null; loading: boolean } {
  const [state, setState] = useState<{ pad: Pad | null; loading: boolean }>({ pad: null, loading: false });
  useEffect(() => {
    if (!siteId || siteId === 'mock') {
      setState({ pad: null, loading: false });
      return;
    }
    let live = true;
    setState({ pad: null, loading: true });
    loadPad(siteId).then(
      (pad) => live && setState({ pad, loading: false }),
      () => live && setState({ pad: null, loading: false }),
    );
    return () => {
      live = false;
    };
  }, [siteId]);
  return state;
}
