// Owner: Nived
import { describe, expect, it } from 'vitest';
import { groundDistanceKm, matchSite, SITE_MATCH_KM } from '../core/quick';
import type { SiteRecord } from '../types';

const site = (id: string, lat: number, lon: number) => ({ id, landingCoords: { lat, lon, source: '' } }) as unknown as SiteRecord;

describe('ground distance on the Moon (1737.4 km sphere)', () => {
  it('1 degree of latitude = pi/180 * 1737.4 = 30.3234 km (hand-worked)', () => {
    expect(groundDistanceKm(0, 0, 1, 0)).toBeCloseTo(30.3234, 3);
  });
  it('is zero for the same point and symmetric', () => {
    expect(groundDistanceKm(-84.79, 29.19, -84.79, 29.19)).toBe(0);
    expect(groundDistanceKm(10, 20, -30, 70)).toBeCloseTo(groundDistanceKm(-30, 70, 10, 20), 9);
  });
  it('longitude shrinks with latitude: 1 degree of longitude at 85S is ~ cos(85) * 30.32 = 2.643 km', () => {
    expect(groundDistanceKm(-85, 0, -85, 1)).toBeCloseTo(30.3234 * Math.cos((85 * Math.PI) / 180), 2);
  });
});

describe('curated-site matching', () => {
  const near = site('near', -85, 30);
  const far = site('far', -85, 31);
  it(`matches within ${SITE_MATCH_KM} km and not beyond: 0.01 deg lat = 0.30 km matches, 0.05 deg = 1.52 km does not`, () => {
    expect(matchSite([near], -85.01, 30)?.id).toBe('near');
    expect(matchSite([near], -85.05, 30)).toBeNull();
  });
  it('picks the nearest when several are within range', () => {
    const a = site('a', -85, 30);
    const b = site('b', -85.02, 30); // 0.6 km from a
    expect(matchSite([a, b], -85.018, 30)?.id).toBe('b'); // 0.06 km from b, 0.55 km from a
  });
  it('no sites, no match', () => {
    expect(matchSite([], 0, 0)).toBeNull();
    expect(matchSite([far], -85, 30)).toBeNull();
  });
});
