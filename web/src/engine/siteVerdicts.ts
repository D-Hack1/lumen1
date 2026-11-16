// Owner: Nived
// Shared per-site verdicts for the sidebar site cards and Compare rows: ONE Scan stage-1 pass over every catalog site at the
// current landing date and window (10-minute series + prefix sums, a few ms per site), re-run when the scenario changes.
//   scenario store (landing, slip, duration, height, definitions, profile, weights) --(30 ms debounce)--> stage 1 for all sites
//   --(latest wins)--> { siteId -> verdict, viability } --> subscribers
// Verdicts here are provisional (stage 1, nominal geometry; PENDING until a terrain mask exists, see verdict.ts). The selected
// site's Cockpit verdict is the exact one: `useSiteVerdict` prefers it for that site.
import { latestWins, runScanStage1 } from './client';
import { loadCatalog } from './data/catalog';
import { dataMode } from './data/source';
import { makeRequest } from './requests';
import { mockScenarioResult } from '../mocks/mockResult';
import { getScenario, useScenario } from '../state/scenarioStore';
import type { Verdict } from './types';

export interface SiteVerdict {
  verdict: Verdict;
  viabilityIndex: number | null;
  provisional: boolean;
}
export interface SiteVerdicts {
  status: 'idle' | 'loading' | 'ready' | 'error';
  bySite: Record<string, SiteVerdict>;
}

const DEBOUNCE_MS = 30;
const IDLE: SiteVerdicts = { status: 'idle', bySite: {} };
let snapshot: SiteVerdicts = IDLE;
const listeners = new Set<() => void>();
let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastKey = '';
const scanLatest = latestWins(runScanStage1);

function publish(v: SiteVerdicts): void {
  snapshot = v;
  listeners.forEach((fn) => fn());
}

/** Only these change a site's verdict (not the selected site, view, layers, scrub...). */
function relevantKey(): string {
  const s = getScenario();
  return JSON.stringify([s.landingUtc, s.slipDays, s.durationDays, s.heightM, s.definitions, s.profile, s.weights, dataMode()]);
}

async function run(): Promise<void> {
  const s = getScenario();
  try {
    const { sites } = await loadCatalog();
    if (dataMode() === 'mock') {
      const bySite: Record<string, SiteVerdict> = {};
      sites.forEach((site, i) => {
        const r = mockScenarioResult(site, s.landingUtc, s.durationDays, s.landingUtc, i * 0.8, s.definitions.minSunElevationOps);
        bySite[site.id] = { verdict: r.verdict, viabilityIndex: r.viability?.index ?? null, provisional: false };
      });
      return publish({ status: 'ready', bySite });
    }
    if (snapshot.status !== 'ready') publish({ status: 'loading', bySite: snapshot.bySite });
    const requests = sites.map((site) => makeRequest(s, sites, { siteRef: { kind: 'site', id: site.id }, landingUtc: s.landingUtc, heightM: s.heightM, scrubUtc: s.landingUtc }));
    const cands = await scanLatest({ requests, plusMinusDays: 0 });
    if (!cands) return; // superseded by a newer scenario
    const bySite: Record<string, SiteVerdict> = {};
    for (const c of cands) bySite[c.siteId] = { verdict: c.verdict, viabilityIndex: c.viabilityIndex, provisional: c.provisional };
    // A site whose window leaves the ephemeris produces no candidate: say PENDING rather than leave it blank.
    for (const site of sites) bySite[site.id] ??= { verdict: 'PENDING', viabilityIndex: null, provisional: true };
    publish({ status: 'ready', bySite });
  } catch {
    publish({ status: 'error', bySite: {} });
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
  useScenario.subscribe(() => {
    const k = relevantKey();
    if (k !== lastKey) {
      lastKey = k;
      schedule();
    }
  });
  schedule();
}

export const getSiteVerdicts = (): SiteVerdicts => snapshot;

export function subscribeSiteVerdicts(fn: () => void): () => void {
  start();
  listeners.add(fn);
  return () => listeners.delete(fn);
}
