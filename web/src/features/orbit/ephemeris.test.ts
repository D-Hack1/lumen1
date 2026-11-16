// Owner: Abhinav
import { describe, expect, it } from 'vitest';
import {
  SYNODIC_HOURS,
  earthLibration,
  earthSubLunarLonDeg,
  earthVector,
  hoursSinceNewMoon,
  latLonToVec,
  phaseAt,
  polarSunAzimuthDeg,
  subsolarPoint,
  sunVector,
  vecToLatLon,
  wrapLon,
  REFERENCE_NEW_MOON_UTC,
} from './ephemeris';

describe('orbit ephemeris', () => {
  it('wraps longitudes to [-180, 180)', () => {
    expect(wrapLon(190)).toBeCloseTo(-170);
    expect(wrapLon(-190)).toBeCloseTo(170);
    expect(wrapLon(180)).toBeCloseTo(-180);
    expect(wrapLon(0)).toBe(0);
  });

  it('puts the Sun over the far side at new moon and over the sub-Earth point at full moon', () => {
    expect(Math.abs(subsolarPoint(0).lon)).toBeCloseTo(180, 5);
    expect(Math.abs(subsolarPoint(SYNODIC_HOURS / 2).lon)).toBeLessThan(1e-9);
    expect(subsolarPoint(SYNODIC_HOURS / 4).lon).toBeCloseTo(90, 5); // first quarter: terminator on the Earth-facing meridian
  });

  it('closes the Sun loop after exactly one synodic month, so playback can wrap without a jump', () => {
    const a = sunVector(10);
    const b = sunVector(10 + SYNODIC_HOURS);
    for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i], 9);
  });

  it('returns unit vectors and round-trips lat/lon', () => {
    for (const h of [0, 100, 350, 700]) {
      const s = sunVector(h);
      expect(Math.hypot(...s)).toBeCloseTo(1, 12);
      const e = earthVector(h);
      expect(Math.hypot(...e)).toBeCloseTo(1, 12);
    }
    const ll = vecToLatLon(latLonToVec(-84.79, 29.2));
    expect(ll.lat).toBeCloseTo(-84.79, 9);
    expect(ll.lon).toBeCloseTo(29.2, 9);
  });

  it('keeps Earth near the sub-Earth point (libration within ±6.5°)', () => {
    for (let h = 0; h < 700; h += 7) {
      const l = earthLibration(h);
      expect(Math.abs(l.lon)).toBeLessThanOrEqual(6.5 + 1e-9);
      expect(Math.abs(l.lat)).toBeLessThanOrEqual(6.5 + 1e-9);
    }
  });

  it('names the phases in order across the month', () => {
    expect(phaseAt(0).name).toBe('New moon');
    expect(phaseAt(SYNODIC_HOURS * 0.125).name).toBe('Waxing crescent');
    expect(phaseAt(SYNODIC_HOURS * 0.25).name).toBe('First quarter');
    expect(phaseAt(SYNODIC_HOURS * 0.375).name).toBe('Waxing gibbous');
    expect(phaseAt(SYNODIC_HOURS * 0.5).name).toBe('Full moon');
    expect(phaseAt(SYNODIC_HOURS * 0.625).name).toBe('Waning gibbous');
    expect(phaseAt(SYNODIC_HOURS * 0.75).name).toBe('Last quarter');
    expect(phaseAt(SYNODIC_HOURS * 0.875).name).toBe('Waning crescent');
    expect(phaseAt(SYNODIC_HOURS * 0.5).illuminated).toBeGreaterThan(0.99);
    expect(phaseAt(0).illuminated).toBeLessThan(0.01);
  });

  it('spins Earth west under the Moon at 15° per hour', () => {
    expect(wrapLon(earthSubLunarLonDeg(1) - earthSubLunarLonDeg(0))).toBeCloseTo(-15, 9);
  });

  it('counts hours from the reference new moon and keeps the polar sun azimuth in [0, 360)', () => {
    expect(hoursSinceNewMoon(REFERENCE_NEW_MOON_UTC)).toBe(0);
    expect(hoursSinceNewMoon(new Date(REFERENCE_NEW_MOON_UTC + 3_600_000 * 24))).toBeCloseTo(24, 9);
    for (const h of [0, 177, 354, 600]) {
      const a = polarSunAzimuthDeg(h);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(360);
    }
  });
});
