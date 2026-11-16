// Owner: Ebin
// Loads the 11×11 landing-dispersion slope grid (Nived's `engine/data/dispersion.ts`) for the Touchdown Pad histogram.
// A missing file (Tier C / custom point) resolves to null and the histogram is simply not shown.
import { useEffect, useState } from 'react';
import { loadDispersion, type Dispersion } from '../../engine/data/dispersion';

export function useDispersion(siteId: string | null): Dispersion | null {
  const [d, setD] = useState<Dispersion | null>(null);
  useEffect(() => {
    if (!siteId || siteId === 'mock') {
      setD(null);
      return;
    }
    let live = true;
    setD(null);
    loadDispersion(siteId).then(
      (x) => live && setD(x),
      () => live && setD(null),
    );
    return () => {
      live = false;
    };
  }, [siteId]);
  return d;
}
