// Owner: Nived
// Shared Compare results: one evaluation per row per change, delivered to every consumer (Scan, Delta Table, compare visuals).
//   scenario store (compareRows, definitions, profile, weights, duration, slip) --(30 ms debounce)--> one worker job per row
//   --(latest wins for the whole batch)--> deltas vs the baseline --> snapshot --> subscribers
// Mock mode returns the fake compare set. No rows => idle.
import { assembleCompare } from './compare/compare';
import { evaluateScenario, latestWins } from './client';
import { loadCatalog } from './data/catalog';
import { dataMode } from './data/source';
import { makeRequest, padNormalFor } from './requests';
import { mockCompare } from '../mocks/mockResult';
import { getScenario, rowLandingUtc, useScenario } from '../state/scenarioStore';
import type { CompareResults } from './types';

const DEBOUNCE_MS = 30;
const IDLE: CompareResults = { status: 'idle', rows: [], baselineId: null };

let snapshot: CompareResults = IDLE;
const listeners = new Set<() => void>();
let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastKey = '';
const evaluateBatch = latestWins(async (reqs: Array<{ id: string; req: Parameters<typeof evaluateScenario>[0] }>) =>
  Promise.all(reqs.map(async ({ id, req }) => ({ id, result: await evaluateScenario(req) }))),
);

function publish(c: CompareResults): void {
  snapshot = c;
  listeners.forEach((fn) => fn());
}

/** Only these affect the compare results; anything else changing (view, persona, layers, the main site) must not re-run them. */
function relevantKey(): string {
  const s = getScenario();
  return JSON.stringify([s.compareRows, s.slipDays, s.durationDays, s.definitions, s.profile, s.weights, dataMode()]);
}

async function run(): Promise<void> {
  const s = getScenario();
  try {
    if (s.compareRows.length === 0) return publish(IDLE);
    const { sites } = await loadCatalog();
    if (dataMode() === 'mock') return publish(mockCompare(sites, s.compareRows, s.slipDays));
    const reqs = await Promise.all(s.compareRows.map(async (r) => ({
      id: r.id,
      req: makeRequest(s, sites, { siteRef: r.site, landingUtc: rowLandingUtc(r, 0), heightM: r.heightM, scrubUtc: rowLandingUtc(r, s.slipDays), panel: { preset: r.panelPreset, yawDeg: r.yawDeg, tilt: r.tilt }, groundNormal: await padNormalFor(r.site) }),
    })));
    const evaluated = await evaluateBatch(reqs);
    if (evaluated) publish(assembleCompare(evaluated, s.compareRows.find((r) => r.baseline)?.id ?? null));
  } catch {
    publish({ status: 'error', rows: [], baselineId: null });
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

export const getCompare = (): CompareResults => snapshot;

export function subscribeCompare(fn: () => void): () => void {
  start();
  listeners.add(fn);
  return () => listeners.delete(fn);
}
