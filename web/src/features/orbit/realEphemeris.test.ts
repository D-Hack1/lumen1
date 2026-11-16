// Owner: Abhinav
// The Orbit globe / polar geometry against the REAL ephemeris (VITE_LUMEN_DATA=real). Skipped if real data is absent.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PUBLIC, stubFetch } from '../../engine/__tests__/helpers';
import { setDataMode } from '../../engine/data/source';
import { earthLibration, hoursSinceNewMoon, phaseAt, subsolarPoint, sunVector } from './ephemeris';
import { loadRealModel } from './realModel';
import { SITES, model } from './orbitModel';
import { setRealEphemeris } from './realEphem';

const have = existsSync(join(PUBLIC, 'data/catalog/sites.json'));
const h = (iso: string) => hoursSinceNewMoon(Date.parse(iso));

describe.skipIf(!have)('real ephemeris geometry', () => {
  beforeAll(async () => {
    stubFetch();
    setDataMode('real');
    await loadRealModel();
  });
  afterAll(() => {
    setDataMode(null);
    setRealEphemeris(null);
  });

  it('gives the real new moon (2027-02-06, annular-eclipse day) and full moon (2027-02-20)', () => {
    expect(phaseAt(h('2027-02-06T16:00:00Z')).illuminated).toBeLessThan(0.001);
    expect(phaseAt(h('2027-02-20T23:00:00Z')).illuminated).toBeGreaterThan(0.99);
    expect(phaseAt(h('2027-02-12T00:00:00Z')).name).toBe('Waxing crescent');
    expect(phaseAt(h('2027-02-14T08:00:00Z')).name).toMatch(/quarter/);
    expect(phaseAt(h('2027-02-25T00:00:00Z')).name).toMatch(/Waning/);
  });

  it('unit Sun vector from the ephemeris, not the analytic stand-in', () => {
    const hrs = h('2027-02-12T00:00:00Z');
    expect(Math.hypot(...sunVector(hrs))).toBeCloseTo(1, 9);
    // An explicit latitude forces the analytic path; the real Sun is not where the analytic one puts it
    // (the analytic reference epoch, 2027-02-07 16:56, is about a day after the real new moon).
    expect(subsolarPoint(hrs).lon).not.toBe(subsolarPoint(hrs, -1).lon);
    expect(Math.abs(subsolarPoint(hrs).lat)).toBeLessThan(2); // true sub-solar latitude swings about +-1.5 deg
    expect(Math.abs(earthLibration(hrs).lon)).toBeLessThan(8);
  });

  it('the Sun the globe uses is the Sun the side panels use', () => {
    // Elevation of the Sun at the south pole is about the sub-solar latitude (negated): same ephemeris, same answer.
    const hrs = h('2027-02-12T00:00:00Z');
    const m = model(hrs - 7.0667, SITES.find((s) => s.id === 'shackleton_ridge')!, 2);
    expect(Math.abs(m.sunEl + subsolarPoint(hrs).lat)).toBeLessThan(1);
  });
});
