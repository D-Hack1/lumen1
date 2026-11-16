// Owner: Nived
// Bindings between the live pages (LumenState: site, mast, slip) and the real engine. The pages keep their sample model (orbitModel / pagesModel)
// as the fallback; everything here returns null until the engine has an answer, and always in mock data mode, so sample or mock numbers are never
// presented as real ones.
//
//   useEngineResult(site, mast, slip)  -> the ScenarioResult for that site over the page's window, or null
//   useSkyline(site, mast)             -> the horizon for the panorama (terrain mask row, or the smooth Moon), or null
//   standHereView(result, skyline, t)  -> pure: everything the Stand-here page needs, read from the result at hour `t`
//
// Live id -> engine id is kept in ONE place (ENGINE_SITE_ID, tested). A live site with no entry (Malapert, Haworth, a custom pin) is evaluated as a plain
// lat/lon point on the smooth Moon and labelled as such.
import { useEffect, useState } from 'react';
import { DEFAULT_SCENARIO, type DurationDays } from '../../state/scenarioStore';
import { evaluateScenario } from '../../engine/client';
import { horizonFromMask } from '../../engine/core/terrainHorizon';
import { Horizon } from '../../engine/core/visibility';
import { loadCatalog } from '../../engine/data/catalog';
import { loadMaskOrNull } from '../../engine/data/masks';
import { dataMode } from '../../engine/data/source';
import { makeRequest } from '../../engine/requests';
import type { ScenarioRequest } from '../../engine/core/buildResult';
import type { ScenarioResult, SiteRecord } from '../../engine/types';
import { getBaseUtc, useWindowStart } from '../orbit/windowStart';
import { isCatalogSite } from '../orbit/realModel';
import { PANO_H, PANO_W, azToX } from './pagesModel';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Live page site id -> engine catalog id. The only copy; see engineBindings.test.ts. */
export const ENGINE_SITE_ID: Readonly<Record<string, string>> = { im2: 'im2_athena', shack: 'shackleton_ridge' };
/** The design's ids map through the table; in real mode the pages' ids ARE catalog ids, so those pass straight through. */
export const engineSiteId = (liveId: string): string | null => ENGINE_SITE_ID[liveId] ?? (isCatalogSite(liveId) ? liveId : null);

/** Observer heights the terrain masks were built for (data_masks.md). Any other mast (0 m) has no mask. */
export const MASK_HEIGHTS_M: readonly number[] = [1, 2, 5, 10];

export interface LiveSite {
  id: string;
  lat: number;
  lon: number;
}

/** The engine request for a live site. Pure; `sites` is the engine catalog. */
export function requestFor(site: LiveSite, mastM: number, slipDays: number, durationDays: DurationDays, sites: SiteRecord[]): ScenarioRequest {
  const id = engineSiteId(site.id);
  const base = { ...DEFAULT_SCENARIO, durationDays, slipDays };
  return makeRequest(base, sites, {
    siteRef: id ? { kind: 'site', id } : { kind: 'point', lat: site.lat, lon: site.lon },
    landingUtc: getBaseUtc(), heightM: mastM, scrubUtc: getBaseUtc() + slipDays * DAY_MS,
  });
}

/** The engine result for the live site/mast over [window start + slip, + durationDays]; null while loading, on error, and unless the data mode is real. */
export function useEngineResult(site: LiveSite, mastM: number, slipDays = 0, durationDays: DurationDays = 30, staged = false): ScenarioResult | null {
  const [res, setRes] = useState<ScenarioResult | null>(null);
  const startUtc = useWindowStart(); // a new window start re-runs the engine
  useEffect(() => {
    setRes(null); // never keep another site's numbers on screen
    if (dataMode() !== 'real') return;
    let live = true;
    let final = false;
    void (async () => {
      const { sites } = await loadCatalog();
      const req = requestFor(site, mastM, slipDays, durationDays, sites);
      // Staged (G8): a nominal-only pass first, so the numbers appear well before the three-pass bounds finish; it is marked
      // meta.stage = 'nominal' (no verdict, no +/-) and replaced by the final result. Both run on the same worker, in order.
      const quick = staged ? evaluateScenario({ ...req, nominalOnly: true }) : null;
      const full = evaluateScenario(req);
      if (quick) {
        const q = await quick;
        if (live && !final && q.status === 'ready') setRes(q);
      }
      const r = await full;
      final = true;
      if (live) setRes(r.status === 'ready' ? r : null);
    })().catch(() => {
      if (live) setRes(null);
    });
    return () => {
      live = false;
    };
  }, [site.id, site.lat, site.lon, mastM, slipDays, durationDays, startUtc, staged]);
  return res;
}

export interface Skyline {
  /** Horizon elevation (deg) at an azimuth: the effective mask (terrain + near-zone plane), or the smooth-Moon dip. */
  elevationAt: (azDeg: number) => number;
  /** True when this is the site's real terrain mask; false = smooth Moon (no terrain data for this site/mast). */
  terrain: boolean;
}

export function skylineFor(maskHorizon: Horizon | null, mastM: number): Skyline {
  if (maskHorizon) return { elevationAt: (az) => maskHorizon.effectiveAt(az), terrain: true };
  const smooth = new Horizon({ observerHeightM: mastM });
  return { elevationAt: (az) => smooth.elevationAt(az), terrain: false };
}

/** The panorama's horizon: the site's mask row for this mast when there is one, otherwise the smooth Moon. Null unless the data mode is real. */
export function useSkyline(site: LiveSite, mastM: number): Skyline | null {
  const [sky, setSky] = useState<Skyline | null>(null);
  useEffect(() => {
    setSky(null);
    if (dataMode() !== 'real') return;
    let live = true;
    void (async () => {
      const mask = await loadMaskOrNull(engineSiteId(site.id));
      const hz = MASK_HEIGHTS_M.includes(mastM) ? horizonFromMask(mask, mastM) : null;
      if (live) setSky(skylineFor(hz, mastM));
    })().catch(() => {
      if (live) setSky(null);
    });
    return () => {
      live = false;
    };
  }, [site.id, mastM]);
  return sky;
}

// ---- Stand here: the numbers the page draws, read from one result ----

export interface StandHereView {
  sunAz: number;
  sunEl: number;
  earthAz: number;
  earthEl: number;
  lit: boolean;
  earthUp: boolean;
  /** Skyline height at the Sun's azimuth. */
  horizonAtSun: number;
  /** Hours until the Sun's state flips (sets if lit, rises if not), or null if it does not within the result. Same for Earth. */
  sunChangeH: number | null;
  earthChangeH: number | null;
  /** SVG: the skyline polygon and the dashed Sun / Earth tracks over the whole window, all on the SAME vertical scale as `y`. */
  path: string;
  sunTrack: string;
  earthTrack: string;
  y: (elDeg: number) => number;
  /** Where the numbers come from, for the on-screen label. */
  source: 'terrain' | 'smooth';
}

const Y_BASE = 262; // the page's baseline (skyY(0))

/** Vertical scale: the design's 34 px/deg, shrunk only as far as needed to keep the tallest skyline / Sun on screen. */
export function verticalScale(maxElDeg: number): number {
  return Math.max(6, Math.min(34, 240 / Math.max(7, maxElDeg + 2)));
}

function track(az: Float32Array, el: Float32Array, step: number, y: (e: number) => number): string {
  let p = '';
  let prev: number | null = null;
  for (let i = 0; i < az.length; i += step) {
    const a = az[i];
    p += `${prev === null || Math.abs(a - prev) > 180 ? ' M' : ' L'}${azToX(a).toFixed(1)} ${y(el[i]).toFixed(1)}`;
    prev = a;
  }
  return p;
}

export function standHereView(r: ScenarioResult, sky: Skyline | null, tHours: number): StandHereView | null {
  const s = r.series;
  if (!s || r.status !== 'ready') return null;
  const tMs = getBaseUtc() + tHours * HOUR_MS;
  const i = Math.max(0, Math.min(s.sunUp.length - 1, Math.round((tMs - s.t0) / s.stepMs)));
  const hz = sky ?? skylineFor(null, 0);

  const profile: number[] = [];
  for (let az = 0; az <= 360; az += 3) profile.push(hz.elevationAt(az));
  let maxEl = Math.max(...profile);
  for (let k = 0; k < s.sunElevDeg.length; k += 30) maxEl = Math.max(maxEl, s.sunElevDeg[k]);
  const k = verticalScale(maxEl);
  const y = (e: number) => Y_BASE - e * k;

  let path = `M0 ${PANO_H}`;
  profile.forEach((e, n) => {
    path += ` L${azToX(n * 3).toFixed(1)} ${y(e).toFixed(1)}`;
  });
  path += ` L${PANO_W} ${PANO_H} Z`;

  const lit = s.sunUp[i] === 1;
  const earthUp = s.earthUp[i] === 1;
  const next = (types: string[]) => {
    const e = r.events.find((x) => x.t > tMs && types.includes(x.type));
    return e ? Math.max(0, Math.round((e.t - tMs) / HOUR_MS)) : null;
  };
  const stepsPerTrack = Math.max(1, Math.round((8 * HOUR_MS) / s.stepMs)); // one point per 8 h, as the sample tracks
  return {
    sunAz: s.sunAzDeg[i], sunEl: s.sunElevDeg[i], earthAz: s.earthAzDeg[i], earthEl: s.earthElevDeg[i], lit, earthUp,
    horizonAtSun: hz.elevationAt(s.sunAzDeg[i]),
    sunChangeH: next(lit ? ['sunset'] : ['shadowExit']),
    earthChangeH: next(earthUp ? ['earthset'] : ['earthrise']),
    path, sunTrack: track(s.sunAzDeg, s.sunElevDeg, stepsPerTrack, y), earthTrack: track(s.earthAzDeg, s.earthElevDeg, stepsPerTrack, y), y,
    source: hz.terrain ? 'terrain' : 'smooth',
  };
}
