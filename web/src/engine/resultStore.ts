// Owner: Nived
// The ONE place scenario results are computed. Every `useResult()` consumer (Answer Strip, Metric Deck, Ribbon, charts...)
// reads the same snapshot, so a scenario change triggers a single evaluation (not one per component) and latest-wins
// applies to the scenario, not to individual callers.
//   scenario store change --(30 ms debounce)--> worker evaluate --(latest wins)--> snapshot --> subscribers
// While a new evaluation is running the previous ready result stays visible (no flash of empty panels).
import { evaluateScenario, latestWins } from './client';
import { loadCatalog } from './data/catalog';
import { dataMode } from './data/source';
import { mockScenarioResult } from '../mocks/mockResult';
import { getScenario, useScenario } from '../state/scenarioStore';
import { makeRequest, padNormalFor } from './requests';
import { perf } from './perf';
import type { EventType, ScenarioResult } from './types';

const DEBOUNCE_MS = 30;

export const LOADING: ScenarioResult = { status: 'loading', error: null, meta: null, verdict: 'PENDING', verdictReasons: [], viability: null, answer: null, events: [], windows: [], series: null, metrics: null };

export { engineDefinitions } from './requests';

let snapshot: ScenarioResult = LOADING;
const listeners = new Set<() => void>();
let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastKey = '';
let lastSiteKey = '';
let siteSwitchStart: number | null = null; // G8: a site change -> its result on screen
const evaluateLatest = latestWins(evaluateScenario);

function publish(r: ScenarioResult): void {
  if (siteSwitchStart != null && r.status === 'ready') {
    perf.record('siteSwitch', performance.now() - siteSwitchStart);
    siteSwitchStart = null;
  }
  snapshot = r;
  listeners.forEach((fn) => fn());
}

/** The request depends only on these scenario fields; anything else changing (view, persona, layers...) must not re-run the engine. */
function relevantKey(): string {
  const s = getScenario();
  return JSON.stringify([s.site, s.landingUtc, s.slipDays, s.durationDays, s.scrubUtc, s.heightM, s.definitions, s.profile, s.weights, s.panelPreset, s.yawDeg, s.tilt, dataMode()]);
}

async function run(): Promise<void> {
  const s = getScenario();
  try {
    const { sites } = await loadCatalog();
    if (dataMode() === 'mock') {
      // The mock honours the scenario too: the selected site (custom points fall back to the first site), the landing and scrub times, the ops-elevation floor.
      const site = (s.site.kind === 'site' ? sites.find((x) => x.id === (s.site as { id: string }).id) : null) ?? sites[0] ?? null;
      return publish(mockScenarioResult(site, s.landingUtc, s.durationDays, s.scrubUtc, 0, s.definitions.minSunElevationOps));
    }
    const req = makeRequest(s, sites, { siteRef: s.site, landingUtc: s.landingUtc, heightM: s.heightM, scrubUtc: s.scrubUtc, groundNormal: await padNormalFor(s.site) });
    const r = await evaluateLatest(req);
    if (r) publish(r); // null = superseded by a newer scenario: drop it
  } catch (e) {
    publish({ ...LOADING, status: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void run(), dataMode() === 'real' ? DEBOUNCE_MS : 0);
}

function start(): void {
  if (started) return;
  started = true;
  lastKey = relevantKey();
  lastSiteKey = JSON.stringify(getScenario().site);
  useScenario.subscribe(() => {
    const k = relevantKey();
    if (k !== lastKey) {
      lastKey = k;
      const siteKey = JSON.stringify(getScenario().site);
      if (siteKey !== lastSiteKey) {
        lastSiteKey = siteKey;
        siteSwitchStart = performance.now();
      }
      schedule();
    }
  });
  schedule();
}

export function getResult(): ScenarioResult {
  return snapshot;
}

export function subscribeResult(fn: () => void): () => void {
  start();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Time (epoch ms UTC) of the next event of this type after the current scrub time, or null. Abhinav sets t_scrub from it. */
export function jumpTo(eventType: EventType): number | null {
  const after = snapshot.answer?.tScrub ?? getScenario().scrubUtc;
  return snapshot.events.find((e) => e.type === eventType && e.t > after)?.t ?? null;
}
