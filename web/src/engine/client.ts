// Owner: Nived
// Main-thread side of the engine: owns the worker, and gives hooks a latest-wins `evaluateScenario`.
// Falls back to running in-thread when Workers are unavailable (tests, SSR), with identical results.
import * as Comlink from 'comlink';
import { buildScenarioResult, type ScenarioRequest } from './core/buildResult';
import { loadEphem } from './data/ephem';
import { loadMaskOrNull, loadMasksFor } from './data/masks';
import { loadSigmaOrNull } from './data/sigma';
import { loadDsnOrNull } from './data/dsn';
import { dataMode } from './data/source';
import { perf } from './perf';
import type { EngineApi } from './worker';
import { refineCandidate, scanStage1, stage1ForOffsets, type ScanInput } from './compare/scanEngine';
import type { ScanCandidate, ScenarioResult } from './types';

let remote: Comlink.Remote<EngineApi> | null | undefined;

function engine(): Comlink.Remote<EngineApi> | null {
  if (remote !== undefined) return remote;
  remote = null;
  if (typeof Worker !== 'undefined') {
    try {
      remote = Comlink.wrap<EngineApi>(new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }));
    } catch {
      remote = null; // e.g. worker construction blocked: run in-thread
    }
  }
  return remote;
}

export function evaluateScenario(req: ScenarioRequest): Promise<ScenarioResult> {
  return perf.timeAsync('workerJob', async () => {
    const mode = dataMode();
    const w = engine();
    if (w) return w.evaluateScenario(mode, req);
    const eph = await loadEphem();
    return buildScenarioResult(eph, { ...req, dataVersions: { ...req.dataVersions, ephem: eph.mock ? 'mock' : 'real' } }, await loadDsnOrNull(), await loadMaskOrNull(req.siteId), await loadSigmaOrNull(req.siteId));
  });
}

/** Latest-wins wrapper: results of superseded calls are discarded (resolve to null), so a slow old job can never overwrite a newer one. */
export function latestWins<A extends unknown[], R>(fn: (...a: A) => Promise<R>): (...a: A) => Promise<R | null> {
  let latest = 0;
  return async (...a: A) => {
    const mine = ++latest;
    const r = await fn(...a);
    return mine === latest ? r : null;
  };
}

/** Scan stage 1 (fast nominal ranking of every candidate). */
export async function runScanStage1(input: ScanInput): Promise<ScanCandidate[]> {
  const w = engine();
  return w ? w.scanStage1(dataMode(), input) : scanStage1(await loadEphem(), input, await loadDsnOrNull(), await loadMasksFor(input.requests));
}

/** Scan stage 2 for one candidate (exact evaluation). */
export async function runRefineCandidate(req: ScenarioRequest, candidate: ScanCandidate): Promise<ScanCandidate> {
  const w = engine();
  return w ? w.refineCandidate(dataMode(), req, candidate) : refineCandidate(await loadEphem(), req, candidate, await loadDsnOrNull(), await loadMaskOrNull(req.siteId), await loadSigmaOrNull(req.siteId));
}

/** Stage 1 for one site at the given day offsets (the calendar asks for a chunk at a time). */
export async function runStage1Offsets(req: ScenarioRequest, offsets: number[]): Promise<ScanCandidate[]> {
  const w = engine();
  return w ? w.stage1Offsets(dataMode(), req, offsets) : stage1ForOffsets(await loadEphem(), req, offsets, await loadDsnOrNull(), await loadMaskOrNull(req.siteId));
}
