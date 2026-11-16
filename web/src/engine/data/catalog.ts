// Owner: Nived
// Loader: catalog/sites.json + catalog/sparklines.{json,bin}.
import { loadBinArray, utcExtra } from './binArray';
import { loadPad } from './pad';
import { DataError, fetchJson } from './source';
import type { SiteRecord, Sparkline } from '../types';

const VERSIONS = [1];

interface RawCoords {
  lat: number;
  lon: number;
  source: string;
}

const coords = (c: RawCoords) => ({ lat: c.lat, lon: c.lon, source: c.source });

/** pipeline/catalog/build_catalog.py output. Terrain details live under `terrain` and are null until the terrain run lands. */
interface RawSite {
  id: string;
  name: string;
  category: SiteRecord['category'];
  agency: string | null;
  program?: string | null;
  latitude_deg: number;
  longitude_deg_east: number;
  /** null for records that only have a target (e.g. published targets); the site lat/lon is used then. */
  landing_coords: RawCoords | null;
  target_coords: RawCoords | null;
  coord_note: string | null;
  touchdown_utc: string | null;
  touchdown_precision: 'minute' | 'second' | null;
  last_contact_utc: string | null;
  tier: SiteRecord['tier'];
  rotation_matrix?: number[][];
  terrain?: {
    status?: string;
    near_field_res_m?: number | null;
    sigma?: { source: string; default_deg: number | null } | null;
    pad?: { slope_deg: number } | null;
    psr?: { distance_km: number; bearing_deg: number; nearest_psr_area_km2: number; source: 'published' | 'derived' } | null;
  };
  source_url: string | null;
  verification_status: string;
  notes?: string | null;
}

export interface Catalog {
  sites: SiteRecord[];
  sparklines: Record<string, Sparkline>;
}

let cached: Promise<Catalog> | null = null;

export function loadCatalog(): Promise<Catalog> {
  if (!cached) {
    cached = doLoad();
    cached.catch(() => (cached = null));
  }
  return cached;
}

async function doLoad(): Promise<Catalog> {
  const raw = await fetchJson<{ mock?: boolean; sites: RawSite[] }>('catalog/sites.json', VERSIONS);
  const sites: SiteRecord[] = raw.sites.map((s, i) => {
    const t = s.terrain ?? {};
    return {
      id: s.id,
      name: s.name,
      category: s.category,
      agency: s.agency ?? s.program ?? null,
      date: s.touchdown_utc ? s.touchdown_utc.slice(0, 10) : null,
      asPublishedDate: null,
      lat: s.latitude_deg,
      lon: s.longitude_deg_east,
      landingCoords: s.landing_coords ? coords(s.landing_coords) : { lat: s.latitude_deg, lon: s.longitude_deg_east, source: 'site coordinates' },
      targetCoords: s.target_coords ? coords(s.target_coords) : null,
      coordNote: s.coord_note,
      touchdownUtc: s.touchdown_utc ? Date.parse(s.touchdown_utc) : null,
      touchdownPrecision: s.touchdown_precision,
      lastContactUtc: s.last_contact_utc ? Date.parse(s.last_contact_utc) : null,
      tier: s.tier,
      nearFieldResM: t.near_field_res_m ?? null,
      sigmaSource: t.sigma?.source ?? (s.tier === 'C' ? 'smooth-sphere estimate; terrain unavailable' : 'pending'),
      sigmaDefaultDeg: t.sigma?.default_deg ?? null,
      padSlopeDeg: t.pad?.slope_deg ?? null,
      psr: t.psr ? { distanceKm: t.psr.distance_km, bearingDeg: t.psr.bearing_deg, areaKm2: t.psr.nearest_psr_area_km2, source: t.psr.source } : null,
      sparklineIndex: i,
      sourceUrl: s.source_url,
      verificationStatus: s.verification_status,
      provenanceNotes: s.notes ?? null,
      rotationMatrix: s.rotation_matrix && s.rotation_matrix.length === 3 ? (s.rotation_matrix as SiteRecord['rotationMatrix']) : null,
      mock: raw.mock === true,
    };
  });
  // The catalog builder leaves terrain "pending", but a site with a published, validated pad file (terrain/pad/<id>.json, gate G6) has a
  // real pad slope: use it so the verdict can judge the slope requirement. No pad file (coarse-mask sites, custom points) => stays null.
  if (raw.mock !== true) {
    await Promise.all(
      sites.map(async (site) => {
        if (site.padSlopeDeg != null) return;
        const pad = await loadPad(site.id).catch(() => null);
        if (pad && !pad.mock) site.padSlopeDeg = pad.slopeDeg;
      }),
    );
  }
  return { sites, sparklines: await loadSparklines(sites).catch(() => ({})) };
}

/** catalog/sparklines.{bin,json}: uint8 percent, shape [site, series(sunlit,link), day]. */
async function loadSparklines(catalogSites: SiteRecord[]): Promise<Record<string, Sparkline>> {
  const { sidecar: s, data } = await loadBinArray('catalog/sparklines', ['1', 1]);
  if (s.dtype !== 'uint8' || s.shape.length !== 3 || s.shape[1] !== 2) {
    throw new DataError(`sparklines: expected uint8 shape [sites, 2, days], got ${s.dtype} [${s.shape.join(', ')}]`);
  }
  const ids = s.sites;
  if (!Array.isArray(ids) || ids.length !== s.shape[0]) throw new DataError('sparklines: sidecar `sites` must list one id per row');
  if (ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) {
    throw new DataError('sparklines: sidecar `sites` must contain unique string ids');
  }
  const catalogIds = new Set(catalogSites.map((site) => site.id));
  if ((ids as string[]).some((id) => !catalogIds.has(id))) throw new DataError('sparklines: sidecar references an unknown catalog site');
  const [, , days] = s.shape;
  const startUtc = utcExtra('sparklines', s, 'start_utc');
  const u8 = data as Uint8Array;
  if (u8.some((value) => value > 100)) throw new DataError('sparklines: percentages must be in [0, 100]');
  const out: Record<string, Sparkline> = {};
  (ids as string[]).forEach((id, i) => {
    const o = i * 2 * days;
    out[id] = { startUtc, sunlitPct: u8.subarray(o, o + days), linkPct: u8.subarray(o + days, o + 2 * days) };
  });
  return out;
}
