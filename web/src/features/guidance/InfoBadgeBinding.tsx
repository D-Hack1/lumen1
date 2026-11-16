// Owner: Abhinav
// Glossary-bound InfoBadge wiring (PLAN §8.10, guide §1.4 "Tooltips / InfoBadge").
//
// `installGlossaryBinding()` runs once at boot (main.tsx). It loads public/content/glossary.json (Gowri), merges it
// over the interim spec entries and installs a resolver into the kit InfoBadge — so every `<InfoBadge term="…" />`
// anywhere in the app (Ebin's charts, Nived's Answer Strip / Metric Deck, my panels) shows Formula · Impact ·
// Source & σ · "Learn more →" with no change in the caller. `term` may be a glossary id or the visible label.
//
// Teammates: import `InfoBadge` from 'src/ui' (or from here — same component). Pass `term` only.
// Unknown term → the tooltip shows the term as title with a "draft" tag (WORK_DISTRIBUTION: "Tooltip shows key name").
// "Learn more →" switches to the Methodology view and scrolls to `#<anchor>` once that section exists.
import { getScenario } from '../../state/scenarioStore';
import { InfoBadge, setInfoBadgeBinding } from '../../ui/InfoBadge';
import { buildGlossary, lookup, type Glossary } from './glossary';

export { InfoBadge };

let glossary: Glossary = buildGlossary(null);
let pendingAnchor: string | null = null;
let installed: Promise<Glossary> | null = null;

export function getGlossary(): Glossary {
  return glossary;
}

/** Methodology view (Phase 6) calls this on mount to scroll to the section a "Learn more →" asked for. */
export function consumeMethodologyAnchor(): string | null {
  const a = pendingAnchor;
  pendingAnchor = null;
  return a;
}

function learnMore(anchor: string): void {
  pendingAnchor = anchor;
  getScenario().setView('methodology');
  // If the section is already rendered (Methodology built), scroll to it after the view switch paints.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start' })),
  );
}

function contentUrl(path: string): string {
  const b = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return `${b.replace(/\/$/, '')}/content/${path}`;
}

/** Install the resolver now (interim entries) and swap in glossary.json when it arrives. Idempotent. */
export function installGlossaryBinding(fetchImpl: typeof fetch = fetch): Promise<Glossary> {
  setInfoBadgeBinding({
    resolve: (term) => {
      const e = lookup(glossary, term);
      if (!e) return null;
      return {
        label: e.label,
        formula: e.formula,
        impact: e.impact,
        source: e.source,
        sigma: e.sigma,
        anchor: e.anchor,
        pending: e.pending,
      };
    },
    learnMore,
  });
  installed ??= fetchImpl(contentUrl('glossary.json'))
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((json: unknown) => {
      glossary = buildGlossary(json);
      return glossary;
    });
  return installed;
}
