// Owner: Abhinav — Site Explorer model: "lat, lon" parsing, longitude range, agency groups, filters, formatting.
import { describe, expect, it } from 'vitest';
import type { SiteRecord } from '../../engine/types';
import {
  agencyGroups,
  categoryCounts,
  customPointRecord,
  filterSites,
  fmtLatLon,
  fmtTouchdown,
  hasDistinctTarget,
  normLon,
  parseLatLon,
  windowSlice,
} from './siteModel';

const site = (
  id: string,
  name: string,
  category: SiteRecord['category'],
  agency: string | null,
  lat = -85,
  lon = 0,
): SiteRecord => ({
  ...customPointRecord({ lat, lon }),
  id,
  name,
  category,
  agency,
});

const SITES = [
  site('cy3_shiv_shakti', 'Chandrayaan-3 Statio Shiv Shakti', 'historical_landing', 'ISRO', -69.373, 32.319),
  site('im2_athena', 'IM-2 Athena (Mons Mouton)', 'historical_landing', 'NASA / Intuitive Machines', -84.7906, 29.1957),
  site('blue_ghost_m1', 'Blue Ghost Mission 1 (Mare Crisium)', 'historical_landing', 'Firefly Aerospace', 18.56, 61.81),
  site('shackleton_ridge', 'Shackleton connecting ridge', 'published_target', 'NASA'),
  site('chang_e4', 'Chang’e-4 Statio Tianhe', 'contrast_site', 'CNSA'),
  site('slim', 'SLIM', 'historical_landing', 'JAXA'),
  site('artemis_1', 'Peak near Shackleton', 'artemis_candidate_region', 'NASA'),
];

describe('parseLatLon', () => {
  it('accepts signed decimals, hemispheres, degree signs and separators', () => {
    expect(parseLatLon('-84.79, 29.20')).toEqual({ lat: -84.79, lon: 29.2 });
    expect(parseLatLon('84.79S 29.2E')).toEqual({ lat: -84.79, lon: 29.2 });
    expect(parseLatLon('84.79°S, 29.20°E')).toEqual({ lat: -84.79, lon: 29.2 });
    expect(parseLatLon('−69.373; 32.319')).toEqual({ lat: -69.373, lon: 32.319 });
    expect(parseLatLon('-69,373; 32,319')).toEqual({ lat: -69.373, lon: 32.319 });
    expect(parseLatLon('0.674 23.473W')).toEqual({ lat: 0.674, lon: -23.473 });
  });
  it('normalises longitude into −180…180', () => {
    expect(parseLatLon('-89.45, 222.69')).toEqual({ lat: -89.45, lon: -137.31 });
    expect(normLon(180)).toBe(180);
    expect(normLon(-180)).toBe(-180);
    expect(normLon(360)).toBe(0);
    expect(normLon(-190)).toBe(170);
  });
  it('rejects names and out-of-range values', () => {
    expect(parseLatLon('Apollo 11')).toBeNull();
    expect(parseLatLon('shackleton')).toBeNull();
    expect(parseLatLon('-95, 10')).toBeNull();
    expect(parseLatLon('12')).toBeNull();
  });
});

describe('formatting', () => {
  it('shows up to 4 decimals with hemisphere letters (D-12 CY-3 landing vs target)', () => {
    expect(fmtLatLon({ lat: -69.373, lon: 32.319 })).toBe('69.373°S 32.319°E');
    expect(fmtLatLon({ lat: -69.367621, lon: 32.348126 })).toBe('69.3676°S 32.3481°E');
    expect(fmtLatLon({ lat: -89.45, lon: 222.69 })).toBe('89.45°S 137.31°W');
  });
  it('shows Landing + Target only when they differ (CY-3), once when equal', () => {
    const cy3 = {
      landingCoords: { lat: -69.373, lon: 32.319, source: '' },
      targetCoords: { lat: -69.367621, lon: 32.348126, source: '' },
    };
    expect(hasDistinctTarget(cy3)).toBe(true);
    expect(hasDistinctTarget({ ...cy3, targetCoords: { ...cy3.landingCoords } })).toBe(false);
    expect(hasDistinctTarget({ ...cy3, targetCoords: null })).toBe(false);
  });
  it('formats touchdown UTC at the stated precision', () => {
    expect(fmtTouchdown(Date.parse('2023-08-23T12:33:00Z'), 'minute')).toBe('2023-08-23 12:33');
    expect(fmtTouchdown(Date.parse('2025-03-06T17:28:50Z'), 'second')).toBe('2025-03-06 17:28:50');
  });
});

describe('agency groups', () => {
  it('maps catalog agency strings to the sub-filter groups (commercial CLPS landers are in both)', () => {
    expect([...agencyGroups('NASA / Intuitive Machines')].sort()).toEqual(['commercial', 'nasa_clps']);
    expect([...agencyGroups('Firefly Aerospace')].sort()).toEqual(['commercial', 'nasa_clps']);
    expect([...agencyGroups('ISRO')]).toEqual(['isro']);
    expect([...agencyGroups('CNSA')]).toEqual(['cnsa']);
    expect([...agencyGroups('JAXA')]).toEqual(['jaxa']);
    expect([...agencyGroups(null)]).toEqual([]);
  });
});

describe('filterSites + counts', () => {
  const f = (
    query = '',
    category: Parameters<typeof filterSites>[1]['category'] = 'all',
    agency: Parameters<typeof filterSites>[1]['agency'] = 'all',
  ) => filterSites(SITES, { query, category, agency }).map((s) => s.id);

  it('searches name words, ignoring accents and order', () => {
    expect(f('shiv chandrayaan')).toEqual(['cy3_shiv_shakti']);
    expect(f('change')).toEqual(['chang_e4']); // ’ and accents fold away
    expect(f('mons')).toEqual(['im2_athena']);
  });
  it('a coordinate query filters nothing (it offers actions instead)', () => {
    expect(f('-84.79, 29.2')).toHaveLength(SITES.length);
  });
  it('category and agency filters combine', () => {
    expect(f('', 'historical')).toEqual(['cy3_shiv_shakti', 'im2_athena', 'blue_ghost_m1', 'slim']);
    expect(f('', 'historical', 'commercial')).toEqual(['im2_athena', 'blue_ghost_m1']);
    expect(f('', 'published')).toEqual(['shackleton_ridge']);
    expect(f('', 'contrast')).toEqual(['chang_e4']);
    expect(f('', 'artemis', 'nasa_clps')).toEqual(['artemis_1']);
    expect(f('', 'custom')).toEqual([]);
  });
  it('chip counts follow query + agency, not the selected category', () => {
    const c = categoryCounts(SITES, { query: '', category: 'published', agency: 'nasa_clps' });
    expect(c).toEqual({ all: 4, artemis: 1, historical: 2, published: 1, contrast: 0, custom: 0 });
  });
});

describe('windowSlice (sparkline window)', () => {
  const D = 86_400_000;
  const start = Date.UTC(2025, 0, 1);
  it('slices the scenario window out of the daily series', () => {
    expect(windowSlice(start, 400, Date.UTC(2025, 2, 6, 17), 14)).toEqual([64, 78]);
  });
  it('clips at the ends and returns null when outside', () => {
    expect(windowSlice(start, 400, start - 5 * D, 14)).toEqual([0, 9]);
    expect(windowSlice(start, 400, start + 395 * D, 14)).toEqual([395, 400]);
    expect(windowSlice(start, 400, start + 500 * D, 14)).toBeNull();
  });
});
