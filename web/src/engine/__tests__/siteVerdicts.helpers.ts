import { getResult, subscribeResult } from '../resultStore';
import { useScenario } from '../../state/scenarioStore';

/** The Cockpit's verdict for the selected site (im2_athena) at the current scenario. */
export function resultStoreVerdict(): Promise<string> {
  useScenario.getState().selectSite('im2_athena');
  return new Promise((resolve) => {
    const off = subscribeResult(() => {
      if (getResult().status === 'ready') { off(); resolve(getResult().verdict); }
    });
    if (getResult().status === 'ready') { off(); resolve(getResult().verdict); }
  });
}
