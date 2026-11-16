// Owner: Ebin (live pages)
// Quick-Start data + the pure part of applying a card (PLAN_FINAL §8.9). The cards live in public/content/quickstart.json.
// `resolveCard` is pure so it can be tested: given the sites the app actually has, it says which site to select and which to pick for Compare.
export interface QuickStartAction {
  route: 'orbit' | 'stand-here' | 'compare' | 'slip' | 'methodology';
  /** Candidate site ids, best first: the real-data id, then the sample-mode id. For Compare, every one that exists is picked. */
  siteIds: string[];
  mastM?: number;
  slipDays?: number;
}
export interface QuickStartCard {
  id: string;
  title: string;
  blurb: string;
  image: string;
  alt: string;
  credit: string;
  sourceUrl: string | null;
  license: string;
  action: QuickStartAction;
  steps: string[];
}

export interface ResolvedCard {
  route: QuickStartAction['route'];
  /** The site to select (first candidate that exists), or null if none of them exists in this build. */
  siteId: string | null;
  /** Sites to pick for Compare: every candidate that exists (so the sample ids of a real build are simply skipped). */
  pickIds: string[];
  mastM: number | null;
  slipDays: number | null;
}

export function resolveCard(card: QuickStartCard, availableSiteIds: readonly string[]): ResolvedCard {
  const have = new Set(availableSiteIds);
  const present = card.action.siteIds.filter((id) => have.has(id));
  return {
    route: card.action.route,
    siteId: present[0] ?? null,
    pickIds: card.action.route === 'compare' ? present : [],
    mastM: card.action.mastM ?? null,
    slipDays: card.action.slipDays ?? null,
  };
}

const SEEN_KEY = 'lumen-quickstart-seen';

export function hasSeenQuickStart(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // storage blocked: never nag
  }
}

export function markQuickStartSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* fine: it just may show again next visit */
  }
}

/**
 * Open by itself only for a real first visit: not seen before, landing on the bare URL (no #route), and not an automated browser
 * (automation always starts as a "first visit" and an overlay would block every scripted click). `?quickstart=1` forces it open.
 */
export function shouldAutoOpen(): boolean {
  if (new URLSearchParams(window.location.search).get('quickstart') === '1') return true;
  return !hasSeenQuickStart() && window.location.hash === '' && !navigator.webdriver;
}

export const OPEN_QUICKSTART_EVENT = 'lumen:quickstart';
export const openQuickStart = (): void => {
  window.dispatchEvent(new CustomEvent(OPEN_QUICKSTART_EVENT));
};

let cache: Promise<QuickStartCard[]> | null = null;
export function loadQuickStart(): Promise<QuickStartCard[]> {
  cache ??= (async () => {
    try {
      const b = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
      const r = await fetch(`${b.replace(/\/$/, '')}/content/quickstart.json`);
      if (!r.ok) return [];
      const j = (await r.json()) as { cards?: QuickStartCard[] };
      return j.cards ?? [];
    } catch {
      return [];
    }
  })();
  return cache;
}
