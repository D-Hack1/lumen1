// Owner: Ebin
// Lets Ebin's charts and tables read the result of the page they are mounted in, instead of the app's global scenario store.
// The live pages compute their own result (`useEngineResult(site, mast)`) and hand it down with <ScenarioResultProvider>.
// Outside a provider (the old Cockpit shell, tests) they fall back to the store result exactly as before - and ONLY then do
// they subscribe to the store, so mounting them in a page never starts a second, unrelated engine evaluation.
import { createContext, useContext, useSyncExternalStore } from 'react';
import { getResult, subscribeResult } from '../../engine/resultStore';
import type { ScenarioResult } from '../../engine/types';

export const ScenarioResultContext = createContext<ScenarioResult | null>(null);

const noopSubscribe = (): (() => void) => () => undefined;

/** The result to draw: the provider's if there is one, otherwise the global store's. */
export function useScenarioResult(): ScenarioResult {
  const given = useContext(ScenarioResultContext);
  const stored = useSyncExternalStore(given ? noopSubscribe : subscribeResult, getResult, getResult);
  return given ?? stored;
}
