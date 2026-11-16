// Owner: Abhinav
import { describe, expect, it } from 'vitest';
import { SYNODIC_HOURS } from './ephemeris';
import {
  buildPolarTerrain,
  decodeHeights,
  horizonDeg,
  monthRamp,
  renderPolarFrame,
  samplePolar,
  unpackHorizon,
  type PolarManifest,
} from './polarTerrain';
import { latLonToPixel } from './polarGrid';

const N = 48;
const M: PolarManifest = {
  size: N,
  mapRadiusKm: 304,
  heightRangeM: [-8000, 8000],
  azimuthSteps: 24,
  horizonUnitDeg: 0.1,
  mosaic: { cols: 4, rows: 2 },
};

/** Synthetic flat-terrain inputs. `horizonUnits` is written into every azimuth plane. */
function synthetic(horizonUnits: number, illumR = 128, illumG = 0) {
  const dem = new Uint8ClampedArray(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    dem[i * 4] = 127; // ~0 m
    dem[i * 4 + 1] = 255;
    dem[i * 4 + 3] = 255;
  }
  const hor = new Uint8ClampedArray(M.mosaic.cols * N * M.mosaic.rows * N * 4).fill(horizonUnits);
  const illum = new Uint8ClampedArray(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    illum[i * 4] = illumR;
    illum[i * 4 + 1] = illumG;
  }
  return buildPolarTerrain(dem, hor, illum, M);
}

const FULL_MOON = SYNODIC_HOURS / 2;

describe('polar terrain', () => {
  it('decodes 16-bit heights across the range', () => {
    const rgba = [0, 0, 0, 255, 255, 255, 0, 255, 127, 255, 0, 255];
    const h = decodeHeights(rgba, 1, [-8000, 8000]);
    expect(h[0]).toBeCloseTo(-8000, 6);
    const h2 = decodeHeights(rgba.slice(4), 1, [-8000, 8000]);
    expect(h2[0]).toBeCloseTo(8000, 6);
    const h3 = decodeHeights(rgba.slice(8), 1, [-8000, 8000]);
    expect(Math.abs(h3[0])).toBeLessThan(1);
  });

  it('unpacks three azimuths per tile into separate planes', () => {
    const w = M.mosaic.cols * N;
    const rgba = new Uint8ClampedArray(w * M.mosaic.rows * N * 4);
    // tile 5 (col 1, row 1): R=11 (az 15), G=22 (az 16), B=33 (az 17) at its first pixel
    const o = ((1 * N + 0) * w + 1 * N) * 4;
    rgba[o] = 11;
    rgba[o + 1] = 22;
    rgba[o + 2] = 33;
    const planes = unpackHorizon(rgba, N, M);
    expect(planes[15 * N * N]).toBe(11);
    expect(planes[16 * N * N]).toBe(22);
    expect(planes[17 * N * N]).toBe(33);
    expect(planes[14 * N * N]).toBe(0);
  });

  it('builds a unit-normal terrain whose flat ground faces local up', () => {
    const t = synthetic(0);
    expect(t.discCount).toBeGreaterThan(0);
    const c = Math.floor(N / 2) * N + Math.floor(N / 2);
    expect(Math.hypot(t.normals[c * 3], t.normals[c * 3 + 1], t.normals[c * 3 + 2])).toBeCloseTo(1, 4);
    // near the pole up ≈ -z
    expect(t.up[c * 3 + 2]).toBeLessThan(-0.99);
    expect(t.normals[c * 3 + 2]).toBeLessThan(-0.99);
  });

  it('reports the always-dark share from the illumination map', () => {
    expect(synthetic(0, 0, 255).alwaysDarkPct).toBeCloseTo(100, 6);
    expect(synthetic(0, 200, 0).alwaysDarkPct).toBe(0);
  });

  it('lights ground facing the Sun and shadows it when the horizon is higher than the Sun', () => {
    const open = synthetic(0);
    const walled = synthetic(250); // 25° horizon everywhere
    const p = latLonToPixel(open.grid, -80.8, 0); // sunward rim, Sun ≈ 10° up at full moon
    const a = samplePolar(open, p.px, p.py, { hoursSinceNewMoon: FULL_MOON })!;
    const b = samplePolar(walled, p.px, p.py, { hoursSinceNewMoon: FULL_MOON })!;
    expect(a.sunElevationDeg).toBeGreaterThan(5);
    expect(a.sunlit).toBe(true);
    expect(b.sunlit).toBe(false);
    expect(b.sunHorizonDeg).toBeCloseTo(25, 6);
  });

  it('keeps the far rim dark when the Sun is below the local horizon', () => {
    const t = synthetic(0);
    const p = latLonToPixel(t.grid, -80.8, 180);
    const s = samplePolar(t, p.px, p.py, { hoursSinceNewMoon: FULL_MOON })!;
    expect(s.sunElevationDeg).toBeLessThan(0);
    expect(s.sunlit).toBe(false);
  });

  it('interpolates the horizon between azimuth planes', () => {
    const t = synthetic(0);
    const i = Math.floor(N / 2) * N + Math.floor(N / 2);
    t.horizon.fill(0);
    t.horizon[0 * N * N + i] = 100;
    t.horizon[1 * N * N + i] = 200;
    expect(horizonDeg(t, i, 0)).toBeCloseTo(10, 6);
    expect(horizonDeg(t, i, 15)).toBeCloseTo(20, 6); // 24 steps -> 15° each, so 15° is plane 1
    expect(horizonDeg(t, i, 7.5)).toBeCloseTo(15, 6); // halfway between planes 0 and 1
  });

  it('returns null for samples outside the disc', () => {
    const t = synthetic(0);
    expect(samplePolar(t, 0, 0, { hoursSinceNewMoon: 10 })).toBeNull();
    expect(samplePolar(t, -3, 5, { hoursSinceNewMoon: 10 })).toBeNull();
  });

  it('renders every layer, hides pixels outside the disc and tints always-dark ground only when asked', () => {
    const t = synthetic(0, 0, 255);
    const out = new Uint8ClampedArray(N * N * 4);
    const centre = (Math.floor(N / 2) * N + Math.floor(N / 2)) * 4;
    for (const layer of ['live', 'earth', 'month'] as const) {
      const r = renderPolarFrame(t, { layer, hoursSinceNewMoon: FULL_MOON, showAlwaysDark: false }, out);
      expect(out[3]).toBe(0); // corner
      expect(out[centre + 3]).toBe(255);
      expect(r.sunlitPct).toBeGreaterThanOrEqual(0);
    }
    renderPolarFrame(t, { layer: 'month', hoursSinceNewMoon: 0, showAlwaysDark: true }, out);
    const tinted = [out[centre], out[centre + 1], out[centre + 2]];
    renderPolarFrame(t, { layer: 'month', hoursSinceNewMoon: 0, showAlwaysDark: false }, out);
    expect(out[centre + 1]).not.toBe(tinted[1]);
    expect(tinted[0]).toBeGreaterThan(tinted[1]); // violet: red and blue above green
    expect(tinted[2]).toBeGreaterThan(tinted[1]);
  });

  it('lights a fraction of the live disc at full moon and nearly none at new moon', () => {
    const t = synthetic(0);
    const out = new Uint8ClampedArray(N * N * 4);
    const full = renderPolarFrame(
      t,
      { layer: 'live', hoursSinceNewMoon: FULL_MOON, showAlwaysDark: false },
      out,
    ).sunlitPct;
    const dark = renderPolarFrame(t, { layer: 'live', hoursSinceNewMoon: 0, showAlwaysDark: false }, out).sunlitPct;
    expect(full).toBeGreaterThan(30);
    expect(full).toBeLessThan(70);
    expect(dark).toBeGreaterThan(30); // Sun is 180° around: the opposite half is lit
    expect(dark).toBeLessThan(70);
  });

  it('ramps the month colour monotonically brighter', () => {
    const lum = (c: number[]) => c[0] + c[1] + c[2];
    expect(lum(monthRamp(0))).toBeLessThan(lum(monthRamp(0.5)));
    expect(lum(monthRamp(0.5))).toBeLessThan(lum(monthRamp(1)));
  });
});
