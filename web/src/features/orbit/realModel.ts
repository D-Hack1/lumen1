// Owner: Abhinav
// The Orbit page model backed by the real engine data (ephemeris, DSN series, terrain masks) instead of the design's synthetic
// numbers. Same shape as orbitModel's `model` / `horizon`, so every page reads it unchanged. Only used when VITE_LUMEN_DATA=real
// (see orbitModel.ts); until `loadRealModel()` resolves nothing here may be called.
import { useSyncExternalStore } from 'react';
import { DEFAULT_DEFINITIONS, stateAt, type Definitions } from '../../engine/core/evaluate';
import { makeSite, type Site as EngineSite } from '../../engine/core/geometry';
import { horizonFromMask } from '../../engine/core/terrainHorizon';
import { Horizon } from '../../engine/core/visibility';
import { evaluateScenario } from '../../engine/client';
import { loadCatalog } from '../../engine/data/catalog';
import { loadDsnOrNull, type DsnSeries } from '../../engine/data/dsn';
import { loadEphem, type Ephemeris } from '../../engine/data/ephem';
import { loadMaskOrNull, type Mask } from '../../engine/data/masks';
import { dataMode } from '../../engine/data/source';
import { makeRequest } from '../../engine/requests';
import type { ScenarioResult, SiteRecord } from '../../engine/types';
import { setRealEphemeris } from './realEphem';
import { SITES, type Site, type Snapshot } from './orbitModel';
import { getBaseUtc } from './windowStart';

/** Hours-since-epoch of the design's t = 0 (2027-02-08 00:00 UTC); duplicated from orbitModel to avoid a runtime import cycle. */

/** Short labels for the site tabs (catalog ids). Unknown ids fall back to the catalog name. */
const SHORT: Record<string, string> = {
  im2_athena: 'IM-2',
  shackleton_ridge: 'Ridge',
  cy3_shiv_shakti: 'CY-3',
  blue_ghost_m1: 'Blue Ghost',
  apollo_11: 'Apollo 11',
  apollo_12: 'Apollo 12',
  apollo_14: 'Apollo 14',
  apollo_15: 'Apollo 15',
  apollo_16: 'Apollo 16',
  apollo_17: 'Apollo 17',
  slim_shioli: 'SLIM',
  change6_apollo_basin: "Chang'e-6",
  shackleton_rim_ridge: 'Rim ridge',
};
const GROUP: Record<string, string> = {
  historical_landing: 'Historical landing',
  published_target: 'Published target',
};

/** The pages' site list, read from the real catalog (landing coordinates drive computation; see sites.yaml). */
function siteFromRecord(r: SiteRecord): Site {
  return {
    id: r.id,
    name: r.name,
    short: SHORT[r.id] ?? r.name,
    group: [GROUP[r.category] ?? r.category, r.agency].filter(Boolean).join(' · '),
    lat: r.landingCoords.lat,
    lon: r.landingCoords.lon,
    seed: 0,
    lift: 0,
  };
}

const DEFS: Definitions = { ...DEFAULT_DEFINITIONS, dsnMaskDeg: 10 };

interface Loaded {
  eph: Ephemeris;
  dsn: DsnSeries | null;
  records: Map<string, SiteRecord>;
  masks: Map<string, Mask>;
}

let loaded: Loaded | null = null;
let loading: Promise<void> | null = null;

/** True while the pages show the design's sample numbers (mock data mode), false when they show the real data files. */
export const showsSampleValues = (): boolean => dataMode() !== 'real';

export const realModelReady = (): boolean => loaded !== null;

/** Is this page site id one of the real catalog's sites (the pages' site list is the catalog once real data has loaded)? */
export const isCatalogSite = (id: string): boolean => loaded?.records.has(id) ?? false;

export function loadRealModel(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      const [eph, dsn, cat] = await Promise.all([loadEphem(), loadDsnOrNull(), loadCatalog()]);
      const records = new Map(cat.sites.map((s) => [s.id, s]));
      const masks = new Map<string, Mask>();
      for (const id of records.keys()) {
        const m = await loadMaskOrNull(id);
        if (m) masks.set(id, m);
      }
      loaded = { eph, dsn, records, masks };
      setRealEphemeris(eph);
      // Replace the design's sample list in place (the pages read SITES), keeping the catalog's order.
      (SITES as Site[]).splice(0, SITES.length, ...cat.sites.map(siteFromRecord));
    })();
    loading.catch(() => (loading = null));
  }
  return loading;
}

interface Prepared {
  site: EngineSite;
  horizon: Horizon;
  /** true when the horizon is the real terrain mask, false for the smooth-sphere estimate. */
  terrain: boolean;
}

const prepared = new Map<string, Prepared>();

function prepare(site: Site, mast: number): Prepared {
  const key = `${site.id}|${site.lat}|${site.lon}|${mast}`;
  let p = prepared.get(key);
  if (!p) {
    const L = loaded as Loaded;
    const tid = L.records.has(site.id) ? site.id : undefined;
    const rec = tid ? L.records.get(tid) : undefined;
    const rotation = rec?.rotationMatrix ?? undefined;
    const terrainHorizon = tid ? horizonFromMask(L.masks.get(tid), mast) : null;
    // A terrain mask is only valid at the point it was computed for (the catalog coordinates), so evaluate there when it applies.
    const at = terrainHorizon && rec ? { lat: rec.lat, lon: rec.lon } : { lat: site.lat, lon: site.lon };
    const engineSite = makeSite(at.lat, at.lon, mast, rotation);
    p = {
      site: engineSite,
      horizon: terrainHorizon ?? new Horizon({ observerHeightM: mast }),
      terrain: terrainHorizon !== null,
    };
    prepared.set(key, p);
  }
  return p;
}

/** Whether this site / array height is evaluated on a real terrain mask (otherwise the smooth-sphere estimate). */
/** Metres per pixel of the terrain behind a site's mask (the polar masks are 5-60 m; masks from the global elevation model are ~237 m); null when it has no mask. */
export const terrainResolutionM = (site: Site): number | null =>
  loaded?.masks.get(site.id)?.meta.nearFieldResolutionM ?? null;

export const usesTerrain = (site: Site, mast: number): boolean => (loaded ? prepare(site, mast).terrain : false);

export function realSnapshot(t: number, site: Site, mast: number): Snapshot {
  const L = loaded as Loaded;
  const p = prepare(site, mast);
  const s = stateAt(L.eph, p.site, p.horizon, DEFS, getBaseUtc() + t * 3_600_000, L.dsn);
  return {
    sunAz: s.sun.azimuthDeg,
    sunEl: s.sun.elevationDeg,
    frac: s.sun.diskFraction,
    earthAz: s.earth.azimuthDeg,
    earthEl: s.earth.elevationDeg,
    earthUp: s.earth.up,
    dsn: s.linkUp,
  };
}

export function realHorizon(az: number, site: Site, mast: number): number {
  return prepare(site, mast).horizon.effectiveAt(az);
}

// ---- Verdict tags (the curated-site list) ----------------------------------------------------------------------------------
// The engine's own go / no-go rule (core/verdict.ts) on the same 14-day window Compare shows, against the Mission Profile in the
// scenario store (so it follows the profile rather than a copy of it).
// No terrain uncertainty (sigma) exists yet, so geometry requirements remain unconfirmed.
import { getScenario } from '../../state/scenarioStore';
import type { Verdict } from '../../engine/types';

export interface SiteTag {
  verdict: Verdict;
  label: string;
  tone: 'good' | 'warn' | 'bad' | 'mut';
  /** First reason the engine gave, for a tooltip. */
  reason: string;
}

const TAG: Record<Verdict, { label: string; tone: SiteTag['tone'] }> = {
  GO: { label: 'Go', tone: 'good' },
  MARGINAL: { label: 'Marginal', tone: 'warn' },
  'NO-GO': { label: 'No-go', tone: 'bad' },
  PENDING: { label: 'Unconfirmed', tone: 'mut' },
};

// The tag is the ENGINE's verdict for the same 14-day window Compare shows, so it uses the σ-bounded metrics where a site has σ (a Go or No-go is only
// possible then) and says WHY a site cannot be judged where it does not: no terrain mask (smooth-Moon estimate) or a mask without σ yet.
// The engine runs in a worker, so tags arrive a moment after the list is drawn; until then the list says "Checking".
const engineTags = new Map<string, SiteTag>();
const engineTagsPending = new Set<string>();
const tagListeners = new Set<() => void>();
let tagVersion = 0;

/** Re-render when more engine tags have arrived. */
export function useEngineTagVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      tagListeners.add(cb);
      return () => tagListeners.delete(cb);
    },
    () => tagVersion,
    () => tagVersion,
  );
}

/** Pure: the list tag for an engine result. */
export function tagFromResult(r: ScenarioResult): SiteTag {
  const badge = r.meta?.tierBadge ?? '';
  const verdict = r.verdict;
  let label = TAG[verdict].label;
  if (verdict === 'PENDING') {
    if (badge.startsWith('Smooth-Moon')) label = 'No terrain data';
    else if (badge.includes('σ unavailable')) label = 'σ unavailable';
  }
  return {
    verdict,
    label,
    tone: TAG[verdict].tone,
    reason: r.verdictReasons[0]
      ? `${r.verdictReasons[0]} (judged against the Mission Profile, 14-day window)`
      : badge
        ? `${badge}.`
        : '',
  };
}

function engineTagKey(site: Site, mast: number): string {
  return `${site.id}|${site.lat}|${site.lon}|${mast}|${getBaseUtc()}|${JSON.stringify([getScenario().profile, getScenario().weights])}`;
}

function requestEngineTag(site: Site, mast: number, key: string): void {
  if (engineTagsPending.has(key)) return;
  engineTagsPending.add(key);
  const L = loaded as Loaded;
  const ref = L.records.has(site.id)
    ? ({ kind: 'site', id: site.id } as const)
    : ({ kind: 'point', lat: site.lat, lon: site.lon } as const);
  void (async () => {
    const req = makeRequest({ ...getScenario(), durationDays: 14, slipDays: 0 }, [...L.records.values()], {
      siteRef: ref,
      landingUtc: getBaseUtc(),
      heightM: mast,
      scrubUtc: getBaseUtc(),
    });
    const r = await evaluateScenario(req);
    if (r.status === 'ready') {
      engineTags.set(key, tagFromResult(r));
      tagVersion++;
      tagListeners.forEach((l) => l());
    }
  })()
    .catch(() => undefined)
    .finally(() => engineTagsPending.delete(key));
}

export function realSiteTag(site: Site, mast: number): SiteTag {
  const key = engineTagKey(site, mast);
  const have = engineTags.get(key);
  if (have) return have;
  requestEngineTag(site, mast, key);
  return {
    verdict: 'PENDING',
    label: 'Checking',
    tone: 'mut',
    reason: 'The engine is working out this site’s verdict.',
  };
}
