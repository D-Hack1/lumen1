// Owner: Abhinav
import { useContext } from 'react';
import { LumenContext, type LumenState } from '../orbit/lumenState';

/** The shared Lumen state. Pages other than Orbit only make sense inside PagesApp, so a missing provider is a bug. */
export function useLumenContext(): LumenState {
  const ctx = useContext(LumenContext);
  if (!ctx) throw new Error('Lumen pages must be rendered inside <PagesApp>');
  return ctx;
}
