// Owner: Nived
// useCatalog, useResult, useCompareResults, useQuickAnswer, useLayers, jumpTo.
// Catalog and layers load the (mock or real) files through the loaders. `useResult` reads the shared result store:
// real mode evaluates the scenario with the engine in a Web Worker; mock mode returns a fake, well-shaped result.
// useCompareResults / useQuickAnswer are still mock-backed (Phase 4).
import { useEffect, useState, useSyncExternalStore } from 'react';
import { loadCatalog } from './data/catalog';
import { loadLayers } from './data/layers';
import { getCompare, subscribeCompare } from './compareStore';
import { quickAnswer } from './quickAnswer';
import { getResult, subscribeResult } from './resultStore';
import { getSiteVerdicts, subscribeSiteVerdicts, type SiteVerdicts } from './siteVerdicts';
import { useScenario } from '../state/scenarioStore';
import type {
  Verdict,
  CatalogResult,
  CompareResults,
  LayersResult,
  QuickAnswerInput,
  QuickAnswerResult,
  ScenarioResult,
} from './types';

const EMPTY_CATALOG: CatalogResult = { sites: [], sparklines: {}, loading: true, error: null };
const EMPTY_QUICK: QuickAnswerResult = {
  status: 'idle', error: null, tier: 'pending', tierBadge: '', matchedSiteId: null, snapDistanceKm: null, sunElevDeg: 0, sunAzDeg: 0, sunDiskPct: 0,
  sunUp: false, earthElevDeg: 0, earthAzDeg: 0, earthRangeKm: 0, linkUp: false, nextSunset: null, nextEarthset: null, nextShadowExit: null,
  sunlitPct: { value: null, lo: null, hi: null }, linkPct: { value: null, lo: null, hi: null }, psrDistanceKm: null, text: '',
};
const EMPTY_LAYERS: LayersResult = {
  layers: [], extents: null, sizePx: null, regions: [], loading: true, error: null,
};

/** Run an async loader once on mount; `fallback` is returned until it resolves. */
function useLoaded<T>(load: () => Promise<T>, fallback: T, onError: (e: string) => T): T {
  const [v, setV] = useState<T>(fallback);
  useEffect(() => {
    let live = true;
    load().then(
      (x) => live && setV(x),
      (e: unknown) => live && setV(onError(e instanceof Error ? e.message : String(e))),
    );
    return () => {
      live = false;
    };
    // loaders are module-level and cached; run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}

export function useCatalog(): CatalogResult {
  return useLoaded<CatalogResult>(
    () => loadCatalog().then((c) => ({ ...c, loading: false, error: null })),
    EMPTY_CATALOG,
    (error) => ({ ...EMPTY_CATALOG, loading: false, error }),
  );
}

/** The scenario's result. One shared evaluation per scenario change (see resultStore.ts); mock mode returns a fake, well-shaped result. */
export function useResult(): ScenarioResult {
  return useSyncExternalStore(subscribeResult, getResult, getResult);
}

/** Compare rows A-D evaluated once each (real mode) with deltas against the baseline; mock mode returns the fake set. */
export function useCompareResults(): CompareResults {
  return useSyncExternalStore(subscribeCompare, getCompare, getCompare);
}

/** Verdicts of every catalog site at the current landing date and window (one shared stage-1 pass). */
export function useSiteVerdicts(): SiteVerdicts {
  return useSyncExternalStore(subscribeSiteVerdicts, getSiteVerdicts, getSiteVerdicts);
}

/**
 * One site's verdict for a card or Compare row. For the selected site this is the Cockpit's exact verdict, so the card and the
 * Answer Strip can never disagree; other sites get the provisional stage-1 verdict. 'PENDING' while nothing is computed yet.
 */
export function useSiteVerdict(siteId: string): { verdict: Verdict; viabilityIndex: number | null; provisional: boolean } {
  const all = useSiteVerdicts();
  const result = useResult();
  const selected = useScenario((s) => (s.site.kind === 'site' ? s.site.id : null));
  if (selected === siteId && result.status === 'ready') return { verdict: result.verdict, viabilityIndex: result.viability?.index ?? null, provisional: false };
  return all.bySite[siteId] ?? { verdict: 'PENDING', viabilityIndex: null, provisional: true };
}

export function useQuickAnswer(input: QuickAnswerInput | null): QuickAnswerResult {
  const [res, setRes] = useState<QuickAnswerResult>(EMPTY_QUICK);
  const key = input ? `${input.lat}|${input.lon}|${input.utc}|${input.durationDays}|${input.heightM}` : '';
  useEffect(() => {
    if (!input) {
      setRes(EMPTY_QUICK);
      return;
    }
    let live = true;
    setRes((r) => ({ ...r, status: 'loading' }));
    quickAnswer(input).then(
      (x) => live && setRes(x),
      (e: unknown) => live && setRes({ ...EMPTY_QUICK, status: 'error', error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return res;
}

export function useLayers(): LayersResult {
  return useLoaded<LayersResult>(
    () => loadLayers().then((l) => ({ ...l, loading: false, error: null })),
    EMPTY_LAYERS,
    (error) => ({ ...EMPTY_LAYERS, loading: false, error }),
  );
}

export { jumpTo } from './resultStore';
