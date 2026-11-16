// Owner: Nived
// Quick Answer (PLAN_FINAL 8.5): one point, one time, one duration, one observer height -> one card.
// Built on exactly the same evaluation as the Cockpit (buildScenarioResult), so the two can never disagree.
// No terrain mask exists yet, so every answer is a smooth-sphere estimate labelled "terrain unavailable".
import type { Ephemeris } from '../data/ephem';
import { fmtDeg } from '../format';
import type { EventRecord, QuickAnswerInput, QuickAnswerResult, SiteRecord } from '../types';
import type { DsnSeries } from '../data/dsn';
import { buildScenarioResult } from './buildResult';
import { DEFAULT_DEFINITIONS, stateAt } from './evaluate';
import { makeSite } from './geometry';
import { Horizon } from './visibility';
import { LUNAR_RADIUS_KM } from './constants';

/** A curated site counts as "the same place" within this distance. */
export const SITE_MATCH_KM = 1;
const NONE = { value: null, lo: null, hi: null };

/** Great-circle distance on the 1737.4 km Moon (haversine). */
export function groundDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * LUNAR_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function matchSite(sites: SiteRecord[], lat: number, lon: number): SiteRecord | null {
  let best: SiteRecord | null = null;
  let bestKm = SITE_MATCH_KM;
  for (const s of sites) {
    const km = groundDistanceKm(lat, lon, s.landingCoords.lat, s.landingCoords.lon);
    if (km <= bestKm) {
      best = s;
      bestKm = km;
    }
  }
  return best;
}

function failed(error: string): QuickAnswerResult {
  return {
    status: 'error', error, tier: 'pending', tierBadge: '', matchedSiteId: null, snapDistanceKm: null, sunElevDeg: 0, sunAzDeg: 0, sunDiskPct: 0, sunUp: false,
    earthElevDeg: 0, earthAzDeg: 0, earthRangeKm: 0, linkUp: false, nextSunset: null, nextEarthset: null, nextShadowExit: null, sunlitPct: NONE, linkPct: NONE,
    psrDistanceKm: null, text: '',
  };
}

/** Quick Answer's definitions: the defaults, with the DSN-aware link ON (PLAN default) when the DSN series is available. */
const quickDefinitions = (dsn: DsnSeries | null) => (dsn ? { ...DEFAULT_DEFINITIONS, dsnMaskDeg: 10 } : DEFAULT_DEFINITIONS);

export function buildQuickAnswer(eph: Ephemeris, input: QuickAnswerInput, sites: SiteRecord[], dsn: DsnSeries | null = null): QuickAnswerResult {
  if (!(Math.abs(input.lat) <= 90) || !(Math.abs(input.lon) <= 360)) return failed('Latitude must be within ±90° and longitude within ±360°.');
  if (!(input.durationDays > 0)) return failed('Duration must be positive.');
  const match = matchSite(sites, input.lat, input.lon);
  const res = buildScenarioResult(eph, {
    siteId: match?.id ?? null, tier: 'C', nearFieldResM: null, latDeg: input.lat, lonDegEast: input.lon, heightM: input.heightM,
    rotation: match?.rotationMatrix ?? null, touchdownMs: null, padSlopeDeg: null, psr: match?.psr ?? null,
    startMs: input.utc, durationDays: input.durationDays, tScrubMs: input.utc, definitions: quickDefinitions(dsn),
    profile: { minSunlitPct: 0, minLinkHours: 0, maxLongestNightH: Number.MAX_VALUE, maxPadSlopeDeg: 90 },
    weights: { sunlit: 1, link: 1, night: 1, slope: 1 }, dataVersions: { catalog: 1 },
  }, dsn);
  if (res.status !== 'ready' || !res.answer || !res.series || !res.metrics) return failed(res.error ?? 'No result.');

  // Range is not part of the render series, so take it from one direct evaluation at the requested instant.
  const site = makeSite(input.lat, input.lon, input.heightM, match?.rotationMatrix ?? undefined);
  const now = stateAt(eph, site, new Horizon({ observerHeightM: input.heightM }), quickDefinitions(dsn), input.utc, dsn);
  const next = (type: EventRecord['type']) => res.events.find((e) => e.type === type && e.t > input.utc) ?? null;
  const a = res.answer;
  const m = res.metrics;
  const sunset = next('sunset');
  const iso = (e: EventRecord | null) => (e ? new Date(e.t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'none in window');
  const tierBadge = 'Smooth-Moon horizon · terrain pending';
  return {
    status: 'ready', error: null, tier: 'C', tierBadge, matchedSiteId: match?.id ?? null, snapDistanceKm: null,
    sunElevDeg: a.sun.elevDeg, sunAzDeg: now.sun.azimuthDeg, sunDiskPct: a.sun.diskPct, sunUp: a.sun.up,
    earthElevDeg: a.earth.elevDeg, earthAzDeg: now.earth.azimuthDeg, earthRangeKm: now.earth.distanceKm, linkUp: a.earth.linkUp,
    nextSunset: sunset, nextEarthset: next('earthset'), nextShadowExit: next('shadowExit'),
    sunlitPct: m.sunlitPct, linkPct: m.linkPct, psrDistanceKm: m.psrDistanceKm?.km ?? null,
    text: [
      `LUMEN quick answer — ${input.lat.toFixed(4)}, ${input.lon.toFixed(4)} · ${new Date(input.utc).toISOString().slice(0, 16).replace('T', ' ')} UTC · ${input.heightM} m · ${input.durationDays} d`,
      `${match ? `Site: ${match.name}. ` : ''}${tierBadge}.`,
      `Sun ${fmtDeg(a.sun.elevDeg)} (${a.sun.up ? 'up' : 'down'}), Earth ${fmtDeg(a.earth.elevDeg)}, link ${a.earth.linkUp ? 'yes' : 'no'}, Earth range ${Math.round(now.earth.distanceKm).toLocaleString('en-US')} km.`,
      `Next sunset ${iso(sunset)}; next earthset ${iso(next('earthset'))}; next shadow exit ${iso(next('shadowExit'))}.`,
      `Sunlit ${Math.round(m.sunlitPct.value ?? 0)}% and Earth visible ${Math.round(m.linkPct.value ?? 0)}% of the window (smooth-sphere estimate; terrain unavailable).`,
    ].join('\n'),
  };
}
