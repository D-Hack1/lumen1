// Owner: Nived
// Two-stage scan (R3 delta D-15). Real mode: stage 1 (fast nominal ranking of every candidate) then stage 2 (exact evaluation
// of the top 10 and of every candidate within 10% of a hard threshold, streamed one at a time, ranking updated after each). Mock mode: the timing simulator in src/mocks.
// Latest-wins: cancel() stops all further updates, so a superseded scan can never overwrite a newer one.
import { runRefineCandidate, runScanStage1 } from '../client';
import { loadCatalog } from '../data/catalog';
import { dataMode } from '../data/source';
import { perf } from '../perf';
import { makeRequest } from '../requests';
import { getScenario } from '../../state/scenarioStore';
import { mockScan } from '../../mocks/mockResult';
import { simulateScan, type ScanSimHandle } from '../../mocks/scanSim';
import type { ScenarioRequest } from '../core/buildResult';
import { selectForStage2 } from './stage2';
import type { ScanCandidate, ScanParams, ScanResult } from '../types';

export interface ScanHandle {
  cancel(): void;
  done: Promise<ScanResult>;
}

/** Stage 2 always refines the top candidates, plus every one within 10% of a hard threshold (D-15), up to a cap. */
export const STAGE2_TOP = 10;
export const STAGE2_MAX_TOTAL = 30;
const byViability = (a: ScanCandidate, b: ScanCandidate) => b.viabilityIndex - a.viabilityIndex;

/** Calls onUpdate with stage 1, then with stage 2 as each top candidate is refined. Resolves with the final result. */
export function startScan(params: ScanParams, onUpdate: (r: ScanResult) => void): ScanHandle {
  let cancelled = false;
  let sim: ScanSimHandle | null = null;
  const done = (async (): Promise<ScanResult> => {
    const t0 = performance.now();
    const { sites } = await loadCatalog();
    const empty: ScanResult = { stage: 1, done: false, candidates: [], latencyMs: 0 };
    if (cancelled) return empty;
    if (dataMode() === 'mock') {
      sim = simulateScan(mockScan(params, sites), onUpdate);
      return sim.done;
    }
    const s = getScenario();
    const ids = params.siteIds ?? (s.site.kind === 'site' ? [s.site.id] : []);
    const requests: ScenarioRequest[] = ids.map((id) => ({
      ...makeRequest(s, sites, { siteRef: { kind: 'site', id }, landingUtc: params.baseLandingUtc, heightM: s.heightM, scrubUtc: params.baseLandingUtc }),
      durationDays: params.durationDays,
    }));
    const byId = new Map(requests.map((r) => [r.siteId ?? 'custom', r]));

    let list = await runScanStage1({ requests, plusMinusDays: params.plusMinusDays });
    if (cancelled) return empty;
    perf.record('scanStage1', performance.now() - t0); // G13: stage 1 <= 100 ms
    onUpdate({ stage: 1, done: false, candidates: list, latencyMs: performance.now() - t0 });

    const targets = selectForStage2(list, s.profile, params.durationDays * 24, { topN: STAGE2_TOP, maxTotal: STAGE2_MAX_TOTAL }).map((c) => ({ siteId: c.siteId, landingUtc: c.landingUtc }));
    for (let i = 0; i < targets.length; i++) {
      const cur = list.find((c) => c.siteId === targets[i].siteId && c.landingUtc === targets[i].landingUtc);
      const req = byId.get(targets[i].siteId);
      if (!cur || !req) continue;
      const refined = await runRefineCandidate(req, cur);
      if (cancelled) return empty;
      if (i === 0) perf.record('scanFirstStage2', performance.now() - t0); // G13: first refined row <= 300 ms
      list = list.map((c) => (c === cur ? refined : c)).sort(byViability);
      onUpdate({ stage: 2, done: i === targets.length - 1, candidates: list, latencyMs: performance.now() - t0 });
    }
    return { stage: 2, done: true, candidates: list, latencyMs: performance.now() - t0 };
  })();
  return {
    cancel: () => {
      cancelled = true;
      sim?.cancel();
    },
    done,
  };
}

/** Convenience wrapper that resolves with the final (stage 2) result. */
export function runScan(params: ScanParams, onUpdate?: (r: ScanResult) => void): Promise<ScanResult> {
  return startScan(params, onUpdate ?? (() => undefined)).done;
}
