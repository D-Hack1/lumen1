// Owner: Ebin
// Provides the page's own result to Ebin's charts and tables (see scenarioResultContext.ts).
import type { ReactNode } from 'react';
import type { ScenarioResult } from '../../engine/types';
import { ScenarioResultContext } from './scenarioResultContext';

export function ScenarioResultProvider({ result, children }: { result: ScenarioResult; children: ReactNode }) {
  return <ScenarioResultContext.Provider value={result}>{children}</ScenarioResultContext.Provider>;
}
