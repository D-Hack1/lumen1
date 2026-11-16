// Owner: Ebin
// Loads the DSN station-elevation series (Nived's `engine/data/dsn.ts`). A failed/missing file resolves to
// `dsn: null, unavailable: true` so the lanes show a quiet "no DSN data" note instead of an error.
import { useEffect, useState } from 'react';
import { loadDsn, type DsnSeries } from '../../engine/data/dsn';

export interface DsnState {
  dsn: DsnSeries | null;
  unavailable: boolean;
}

const INITIAL: DsnState = { dsn: null, unavailable: false };

export function useDsn(): DsnState {
  const [state, setState] = useState<DsnState>(INITIAL);
  useEffect(() => {
    let live = true;
    loadDsn().then(
      (dsn) => live && setState({ dsn, unavailable: false }),
      () => live && setState({ dsn: null, unavailable: true }),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}
