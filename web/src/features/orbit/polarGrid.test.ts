// Owner: Abhinav
import { describe, expect, it } from 'vitest';
import { halfExtentKm } from '../../engine/projection';
import {
  inDisc,
  insidePolarView,
  kmPerPixel,
  latLonToPixel,
  latLonToUnit,
  pixelToLatLon,
  pixelToMap,
  ringFraction,
  unitToLatLon,
  type PolarGrid,
} from './polarGrid';

const G: PolarGrid = { n: 768, halfKm: halfExtentKm(80) };

describe('polar grid', () => {
  it('uses ~0.79 km pixels over the 80°S disc', () => {
    expect(kmPerPixel(G)).toBeCloseTo((2 * G.halfKm) / 768, 9);
    expect(G.halfKm).toBeCloseTo(304, 0);
  });

  it('puts the pole at the centre and 0° E straight up', () => {
    const c = latLonToPixel(G, -90, 0);
    expect(c.px).toBeCloseTo(383.5, 6);
    expect(c.py).toBeCloseTo(383.5, 6);
    const up = latLonToPixel(G, -85, 0);
    expect(up.px).toBeCloseTo(383.5, 6);
    expect(up.py).toBeLessThan(383.5);
    const east = latLonToPixel(G, -85, 90);
    expect(east.px).toBeGreaterThan(383.5);
    expect(east.py).toBeCloseTo(383.5, 4);
  });

  it('round-trips lat/lon through pixels', () => {
    for (const [lat, lon] of [
      [-84.79, 29.2],
      [-88.1, -120.5],
      [-81, 179],
    ] as const) {
      const p = latLonToPixel(G, lat, lon);
      const back = pixelToLatLon(G, p.px, p.py);
      expect(back.lat).toBeCloseTo(lat, 6);
      expect(back.lon).toBeCloseTo(lon, 6);
    }
  });

  it('maps pixel centres to symmetric map coordinates', () => {
    const a = pixelToMap(G, 0, 0);
    const b = pixelToMap(G, 767, 767);
    expect(a.x).toBeCloseTo(-b.x, 9);
    expect(a.y).toBeCloseTo(-b.y, 9);
  });

  it('knows the inscribed disc', () => {
    expect(inDisc(G, 384, 384)).toBe(true);
    expect(inDisc(G, 0, 0)).toBe(false);
    expect(inDisc(G, 767, 0)).toBe(false);
  });

  it('converts between lat/lon and unit-square fractions, refusing points outside the 80°S view', () => {
    const u = latLonToUnit(G, -85, 0);
    expect(u).not.toBeNull();
    expect(u!.u).toBeCloseTo(0.5, 9);
    expect(u!.v).toBeLessThan(0.5);
    expect(latLonToUnit(G, -70, 0)).toBeNull();
    const back = unitToLatLon(G, u!.u, u!.v);
    expect(back!.lat).toBeCloseTo(-85, 6);
    expect(unitToLatLon(G, 0.01, 0.01)).toBeNull();
  });

  it('places the 85°S and 88°S rings at ~50% and ~20% of the radius', () => {
    expect(ringFraction(G, 85)).toBeCloseTo(0.5, 2);
    expect(ringFraction(G, 88)).toBeCloseTo(0.2, 2);
    expect(insidePolarView(-80)).toBe(true);
    expect(insidePolarView(-79.9)).toBe(false);
  });
});
