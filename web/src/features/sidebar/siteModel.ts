// Owner: Abhinav
// Site Explorer model (pure, unit-tested): search, "lat, lon" parsing, category/agency filters, display formatting.
// No physics here — only text matching and formatting of catalog fields (WORK_DISTRIBUTION §5.1 Don'ts).
import type { SiteCategory, SiteRecord } from '../../engine/types';

// ---------- categories (filter chips, PLAN §8.4) ----------

export type CategoryFilter = 'all' | 'artemis' | 'historical' | 'published' | 'contrast' | 'custom';
export const CATEGORY_FILTERS: CategoryFilter[] = ['all', 'artemis', 'historical', 'published', 'contrast', 'custom'];

const CATEGORY_OF: Record<Exclude<CategoryFilter, 'all'>, SiteCategory> = {
  artemis: 'artemis_candidate_region',
  historical: 'historical_landing',
  published: 'published_target',
  contrast: 'contrast_site',
  custom: 'custom',
};

/** Category glyph — same shapes as the Basemap pin legend (guide §3.1 L4) so card ↔ pin read as one system. */
export const CATEGORY_GLYPH: Record<SiteCategory, string> = {
  historical_landing: '●',
  published_target: '◆',
  artemis_candidate_region: '▢',
  contrast_site: '◇',
  custom: '+',
};

// ---------- agencies (sub-filter) ----------

export type AgencyFilter = 'all' | 'nasa_clps' | 'isro' | 'cnsa' | 'jaxa' | 'commercial';
export const AGENCY_FILTERS: AgencyFilter[] = ['all', 'nasa_clps', 'isro', 'cnsa', 'jaxa', 'commercial'];

/** Commercial landers (also flown under NASA CLPS → listed under both). Matched on the catalog `agency` string. */
const COMMERCIAL = /intuitive machines|firefly|astrobotic|ispace|draper|blue origin|spacex/i;
const CLPS_PROVIDERS = /intuitive machines|firefly|astrobotic|draper/i;

/** A site can belong to several agency groups (e.g. IM-2: NASA/CLPS and commercial). */
export function agencyGroups(agency: string | null, name = ''): Set<AgencyFilter> {
  const a = `${agency ?? ''} ${name}`;
  const g = new Set<AgencyFilter>();
  if (/\bnasa\b|\bclps\b|apollo|artemis/i.test(a) || CLPS_PROVIDERS.test(a)) g.add('nasa_clps');
  if (/\bisro\b|chandrayaan/i.test(a)) g.add('isro');
  if (/\bcnsa\b|chang['’]?e|china/i.test(a)) g.add('cnsa');
  if (/\bjaxa\b|\bslim\b/i.test(a)) g.add('jaxa');
  if (COMMERCIAL.test(a)) g.add('commercial');
  return g;
}

// ---------- coordinates ----------

export interface LatLon {
  lat: number;
  lon: number;
}

/** Longitude into −180…180 (east positive). */
export function normLon(lon: number): number {
  if (lon >= -180 && lon <= 180) return lon; // in range: untouched (no float drift)
  const x = ((((lon + 180) % 360) + 360) % 360) - 180;
  const r = Math.round(x * 1e9) / 1e9;
  return r === -180 && lon > 0 ? 180 : Object.is(r, -0) ? 0 : r;
}

const NUM = String.raw`[-+−]?\d+(?:[.,]\d+)?`;
const COORD = new RegExp(String.raw`^\s*(${NUM})\s*°?\s*([NS])?\s*[,;\s]\s*(${NUM})\s*°?\s*([EW])?\s*$`, 'i');

/**
 * Parse "lat, lon" typed into the search: "-84.79, 29.20" · "84.79S 29.2E" · "-69.373; 32.319" · "84.79°S, 29.20°E".
 * Decimal commas are only accepted when a separate ";" or whitespace separates the pair. Returns null when the
 * text is not a coordinate pair or is out of range (|lat| > 90).
 */
export function parseLatLon(q: string): LatLon | null {
  const m = COORD.exec(q.replace(/−/g, '-'));
  if (!m) return null;
  const n = (s: string) => Number(s.replace(',', '.'));
  let lat = n(m[1]);
  let lon = n(m[3]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (m[2]?.toUpperCase() === 'S') lat = -Math.abs(lat);
  if (m[2]?.toUpperCase() === 'N') lat = Math.abs(lat);
  if (m[4]?.toUpperCase() === 'W') lon = -Math.abs(lon);
  if (m[4]?.toUpperCase() === 'E') lon = Math.abs(lon);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 360) return null;
  return { lat, lon: normLon(lon) };
}

/** Up to 4 decimals, trailing zeros dropped: 69.373 → "69.373", 69.367621 → "69.3676". */
export const fmtCoordNum = (x: number, maxDigits = 4): string =>
  Math.abs(x)
    .toFixed(maxDigits)
    .replace(/\.?0+$/, '');

export function fmtLat(lat: number): string {
  return `${fmtCoordNum(lat)}°${lat < 0 ? 'S' : 'N'}`;
}
export function fmtLon(lon: number): string {
  const l = normLon(lon);
  return `${fmtCoordNum(l)}°${l < 0 ? 'W' : 'E'}`;
}
export function fmtLatLon(p: LatLon): string {
  return `${fmtLat(p.lat)} ${fmtLon(p.lon)}`;
}

/** True when the catalog's target differs from the landing point (CY-3: ~350 m apart). Equal pairs show once. */
export function hasDistinctTarget(s: Pick<SiteRecord, 'landingCoords' | 'targetCoords'>): boolean {
  const a = s.landingCoords;
  const b = s.targetCoords;
  return !!a && !!b && (Math.abs(a.lat - b.lat) > 1e-5 || Math.abs(normLon(a.lon) - normLon(b.lon)) > 1e-5);
}

// ---------- dates ----------

const pad = (n: number) => String(n).padStart(2, '0');

/** Touchdown in UTC at the stated precision (D-12): "2023-08-23 12:33" (minute) or "2025-03-06 17:28:50" (second). */
export function fmtTouchdown(t: number, precision: 'minute' | 'second' | null): string {
  const d = new Date(t);
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return precision === 'second' ? `${day} ${hm}:${pad(d.getUTCSeconds())}` : `${day} ${hm}`;
}

// ---------- search + filter ----------

export interface SiteFilter {
  query: string;
  category: CategoryFilter;
  agency: AgencyFilter;
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'`]/g, '') // Chang’e → change
    .toLowerCase();

export function matchesQuery(s: SiteRecord, q: string): boolean {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length || parseLatLon(q)) return true; // a coordinate query filters nothing (it offers actions)
  const hay = fold(`${s.name} ${s.id.replace(/_/g, ' ')} ${s.agency ?? ''} ${s.category.replace(/_/g, ' ')}`);
  return words.every((w) => hay.includes(w));
}

export function matchesCategory(s: SiteRecord, c: CategoryFilter): boolean {
  return c === 'all' || s.category === CATEGORY_OF[c];
}

export function matchesAgency(s: SiteRecord, a: AgencyFilter): boolean {
  return a === 'all' || agencyGroups(s.agency, s.name).has(a);
}

export function filterSites(sites: readonly SiteRecord[], f: SiteFilter): SiteRecord[] {
  return sites.filter((s) => matchesQuery(s, f.query) && matchesCategory(s, f.category) && matchesAgency(s, f.agency));
}

/** Chip counts: how many sites each category chip would show under the current query + agency. */
export function categoryCounts(sites: readonly SiteRecord[], f: SiteFilter): Record<CategoryFilter, number> {
  const base = sites.filter((s) => matchesQuery(s, f.query) && matchesAgency(s, f.agency));
  const out = Object.fromEntries(CATEGORY_FILTERS.map((c) => [c, 0])) as Record<CategoryFilter, number>;
  for (const s of base) {
    out.all++;
    for (const c of CATEGORY_FILTERS) if (c !== 'all' && matchesCategory(s, c)) out[c]++;
  }
  return out;
}

/** A custom point as a card record (current scenario site when it is a typed/clicked point). */
export function customPointRecord(p: LatLon): SiteRecord {
  return {
    id: `custom:${p.lat.toFixed(4)},${p.lon.toFixed(4)}`,
    name: 'Custom point',
    category: 'custom',
    agency: null,
    date: null,
    asPublishedDate: null,
    lat: p.lat,
    lon: p.lon,
    landingCoords: { lat: p.lat, lon: p.lon, source: 'user' },
    targetCoords: null,
    coordNote: null,
    touchdownUtc: null,
    touchdownPrecision: null,
    lastContactUtc: null,
    tier: 'pending',
    nearFieldResM: null,
    sigmaSource: 'default',
    sigmaDefaultDeg: null,
    padSlopeDeg: null,
    psr: null,
    sparklineIndex: -1,
    sourceUrl: null,
    verificationStatus: 'user',
    provenanceNotes: null,
    rotationMatrix: null,
    mock: false,
  } as SiteRecord;
}

/** Sparkline slice for the scenario window: [startIdx, endIdx) into the daily series, or null when out of range. */
export function windowSlice(
  seriesStartUtc: number,
  length: number,
  landingUtc: number,
  durationDays: number,
): [number, number] | null {
  const DAY = 86_400_000;
  const i0 = Math.floor((landingUtc - seriesStartUtc) / DAY);
  const i1 = i0 + Math.max(1, Math.ceil(durationDays));
  if (i1 <= 0 || i0 >= length) return null;
  return [Math.max(0, i0), Math.min(length, i1)];
}
