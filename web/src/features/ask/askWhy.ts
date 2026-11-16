// Owner: Ebin
// The one call other widgets need: `askWhy('sunlitPct')` opens Ask LUMEN on the explanation for that metric.
// Wire a Metric Deck tile with `<MetricDeck onWhy={askWhy} />` (Nived's optional prop). Kept apart from AskBox.tsx so
// that file only exports a component.
import type { WhyRequest } from './why';

export const OPEN_EVENT = 'lumen:ask';

export function askWhy(target: WhyRequest): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { target } }));
}
