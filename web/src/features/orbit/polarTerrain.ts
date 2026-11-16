// Owner: Abhinav
// Orbit feature — the south-pole light-and-shadow engine. Pure functions over typed arrays (no DOM, no React), so it is
// unit-tested and could move into the worker later.
//
// Data (built offline from the LOLA 80 m DEM; see pipeline/orbit/build_polar_horizons.py and web/public/content/orbit/orbit.json):
//   dem      RGBA PNG, 16-bit height in R (high byte) and G (low byte) over `heightRangeM`
//   horizon  RGBA PNG mosaic; each tile packs 3 azimuths in R/G/B; value × horizonUnitDeg = terrain horizon angle at that azimuth
//   illum    RGBA PNG; R = share of a lunar month the pixel is sunlit (0–255), G = 255 where it is never lit ("always dark")
//
// Shadows: a pixel is lit when the Sun's elevation above its local horizontal exceeds the pre-computed terrain horizon in the
// Sun's azimuth (with a ±0.5° penumbra), and the surface normal faces the Sun. Lighting is Lommel–Seeliger (how regolith scatters).
import { MOON_RADIUS_KM } from '../../engine/projection';
import { earthVector, sunVector, type Vec3 } from './ephemeris';
import { inDisc, kmPerPixel, pixelToLatLon, pixelToMap, type PolarGrid } from './polarGrid';

export interface PolarManifest {
  size: number;
  mapRadiusKm: number;
  heightRangeM: readonly [number, number];
  azimuthSteps: number;
  horizonUnitDeg: number;
  mosaic: { cols: number; rows: number };
}

export interface PolarTerrain {
  manifest: PolarManifest;
  grid: PolarGrid;
  n: number;
  /** Height above the 1737.4 km reference sphere, metres. */
  heights: Float32Array;
  /** Outward sphere normal per pixel (3 floats each) — the local "up" the horizon is measured against. */
  up: Float32Array;
  /** Terrain surface normal per pixel (3 floats each). */
  normals: Float32Array;
  /** Fixed-light relief shading (≈0.4–1.4) used by the Earth and Month layers. */
  relief: Float32Array;
  /** Horizon angle bytes, `azimuthSteps` planes of n² (value × horizonUnitDeg degrees). */
  horizon: Uint8Array;
  alwaysDark: Uint8Array;
  /** Fraction of the lunar month each pixel is sunlit, 0–1. */
  monthLit: Float32Array;
  /** 1 inside the 80°S disc. */
  disc: Uint8Array;
  discCount: number;
  /** Share of the disc that is never lit, percent. */
  alwaysDarkPct: number;
}

export type PolarLayer = 'live' | 'earth' | 'month';

export interface PolarRenderOptions {
  layer: PolarLayer;
  hoursSinceNewMoon: number;
  /** Clock used for Earth's libration when it differs from the Sun's (defaults to `hoursSinceNewMoon`). */
  earthHours?: number;
  /** Tint the always-dark ground. Off renders it like any other ground. */
  showAlwaysDark: boolean;
  subsolarLatDeg?: number;
  alwaysDarkRgb?: readonly [number, number, number];
}

export interface PolarSample {
  px: number;
  py: number;
  lat: number;
  lon: number;
  heightM: number;
  alwaysDark: boolean;
  monthLitPct: number;
  sunElevationDeg: number;
  sunHorizonDeg: number;
  sunlit: boolean;
  earthElevationDeg: number;
  earthHorizonDeg: number;
  earthVisible: boolean;
}

export const ALWAYS_DARK_RGB: readonly [number, number, number] = [118, 74, 146];
/** Half-width of the penumbra in degrees of elevation (the Sun's disc is ±0.27°). */
export const PENUMBRA_HALF_DEG = 0.5;
const REF_RADIUS_M = MOON_RADIUS_KM * 1000;
const DEG = 180 / Math.PI;
const RELIEF_LIGHT: Vec3 = (() => {
  const v = [-0.45, 0.35, -0.82];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
})();

export function decodeHeights(rgba: ArrayLike<number>, n: number, range: readonly [number, number]): Float32Array {
  const out = new Float32Array(n * n);
  const span = range[1] - range[0];
  for (let i = 0; i < n * n; i++) out[i] = ((rgba[i * 4] * 256 + rgba[i * 4 + 1]) / 65535) * span + range[0];
  return out;
}

/** Unpack the horizon mosaic (3 azimuths per RGB tile) into one contiguous plane per azimuth. */
export function unpackHorizon(rgba: ArrayLike<number>, n: number, m: PolarManifest): Uint8Array {
  const n2 = n * n;
  const out = new Uint8Array(m.azimuthSteps * n2);
  const width = m.mosaic.cols * n;
  for (let k = 0; k < m.azimuthSteps; k++) {
    const tile = Math.floor(k / 3);
    const ch = k % 3;
    const tc = tile % m.mosaic.cols;
    const tr = Math.floor(tile / m.mosaic.cols);
    for (let y = 0; y < n; y++) {
      const rowBase = ((tr * n + y) * width + tc * n) * 4 + ch;
      const dst = k * n2 + y * n;
      for (let x = 0; x < n; x++) out[dst + x] = rgba[rowBase + x * 4];
    }
  }
  return out;
}

export function buildPolarTerrain(
  demRgba: ArrayLike<number>,
  horizonRgba: ArrayLike<number>,
  illumRgba: ArrayLike<number>,
  manifest: PolarManifest,
): PolarTerrain {
  const n = manifest.size;
  const n2 = n * n;
  const grid: PolarGrid = { n, halfKm: manifest.mapRadiusKm };
  const heights = decodeHeights(demRgba, n, manifest.heightRangeM);

  const up = new Float32Array(n2 * 3);
  const pos = new Float64Array(n2 * 3);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const m = pixelToMap(grid, x, y);
      const rM = Math.hypot(m.x, m.y) * 1000;
      const lat = -Math.PI / 2 + 2 * Math.atan(rM / (2 * REF_RADIUS_M));
      const lon = Math.atan2(m.x, m.y);
      const cl = Math.cos(lat);
      const ux = cl * Math.cos(lon);
      const uy = cl * Math.sin(lon);
      const uz = Math.sin(lat);
      up[i * 3] = ux;
      up[i * 3 + 1] = uy;
      up[i * 3 + 2] = uz;
      const rho = REF_RADIUS_M + heights[i];
      pos[i * 3] = ux * rho;
      pos[i * 3 + 1] = uy * rho;
      pos[i * 3 + 2] = uz * rho;
    }
  }

  const normals = new Float32Array(n2 * 3);
  const relief = new Float32Array(n2);
  const monthLit = new Float32Array(n2);
  const alwaysDark = new Uint8Array(n2);
  const disc = new Uint8Array(n2);
  let discCount = 0;
  let darkCount = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const i3 = i * 3;
      let nx = up[i3];
      let ny = up[i3 + 1];
      let nz = up[i3 + 2];
      if (x > 0 && y > 0 && x < n - 1 && y < n - 1) {
        const ax = pos[(i + 1) * 3] - pos[(i - 1) * 3];
        const ay = pos[(i + 1) * 3 + 1] - pos[(i - 1) * 3 + 1];
        const az = pos[(i + 1) * 3 + 2] - pos[(i - 1) * 3 + 2];
        const bx = pos[(i + n) * 3] - pos[(i - n) * 3];
        const by = pos[(i + n) * 3 + 1] - pos[(i - n) * 3 + 1];
        const bz = pos[(i + n) * 3 + 2] - pos[(i - n) * 3 + 2];
        let cx = ay * bz - az * by;
        let cy = az * bx - ax * bz;
        let cz = ax * by - ay * bx;
        const len = Math.hypot(cx, cy, cz) || 1;
        cx /= len;
        cy /= len;
        cz /= len;
        if (cx * up[i3] + cy * up[i3 + 1] + cz * up[i3 + 2] < 0) {
          cx = -cx;
          cy = -cy;
          cz = -cz;
        }
        nx = cx;
        ny = cy;
        nz = cz;
      }
      normals[i3] = nx;
      normals[i3 + 1] = ny;
      normals[i3 + 2] = nz;
      const d = nx * RELIEF_LIGHT[0] + ny * RELIEF_LIGHT[1] + nz * RELIEF_LIGHT[2];
      relief[i] = 0.42 + 0.95 * (d > 0 ? d : 0);
      monthLit[i] = illumRgba[i * 4] / 255;
      alwaysDark[i] = illumRgba[i * 4 + 1] > 127 ? 1 : 0;
      if (inDisc(grid, x, y)) {
        disc[i] = 1;
        discCount++;
        if (alwaysDark[i]) darkCount++;
      }
    }
  }

  return {
    manifest,
    grid,
    n,
    heights,
    up,
    normals,
    relief,
    horizon: unpackHorizon(horizonRgba, n, manifest),
    alwaysDark,
    monthLit,
    disc,
    discCount,
    alwaysDarkPct: discCount ? (darkCount / discCount) * 100 : 0,
  };
}

interface AzPair {
  o0: number;
  o1: number;
  f: number;
}

function azPair(t: PolarTerrain, azimuthDeg: number): AzPair {
  const steps = t.manifest.azimuthSteps;
  const a = ((((azimuthDeg % 360) + 360) % 360) / 360) * steps;
  const k0 = Math.floor(a) % steps;
  const k1 = (k0 + 1) % steps;
  return { o0: k0 * t.n * t.n, o1: k1 * t.n * t.n, f: a - Math.floor(a) };
}

/** Terrain horizon angle (degrees above local horizontal) at pixel index `i` looking along `azimuthDeg` (0° up, clockwise). */
export function horizonDeg(t: PolarTerrain, i: number, azimuthDeg: number): number {
  const p = azPair(t, azimuthDeg);
  return (t.horizon[p.o0 + i] * (1 - p.f) + t.horizon[p.o1 + i] * p.f) * t.manifest.horizonUnitDeg;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const byte = (v: number): number => (v > 255 ? 255 : v < 0 ? 0 : v);

/** Month-map colour ramp: dark slate -> deep amber (half the month) -> pale yellow (always sunlit). */
export function monthRamp(f: number): [number, number, number] {
  if (f < 0.5) {
    const u = f / 0.5;
    return [22 + 128 * u, 24 + 64 * u, 30 - 8 * u];
  }
  const u = (f - 0.5) / 0.5;
  return [150 + 105 * u, 88 + 134 * u, 22 + 118 * u];
}

/** Direction (map azimuth, degrees clockwise from up) toward Earth on the polar map. */
export const polarEarthAzimuthDeg = (hours: number): number => {
  const e = earthVector(hours);
  return Math.atan2(e[1], e[0]) * DEG;
};

/**
 * Fill `out` (n²×4 RGBA, e.g. an ImageData buffer) for one frame. Pixels outside the 80°S disc get alpha 0.
 * Returns the share of the disc that is sunlit right now (percent) — meaningful for the 'live' layer only.
 */
export function renderPolarFrame(
  t: PolarTerrain,
  o: PolarRenderOptions,
  out: Uint8ClampedArray,
): { sunlitPct: number } {
  const n = t.n;
  const sv = sunVector(o.hoursSinceNewMoon, o.subsolarLatDeg);
  const ev = earthVector(o.earthHours ?? o.hoursSinceNewMoon);
  const sunAz = azPair(t, Math.atan2(sv[1], sv[0]) * DEG);
  const earthAz = azPair(t, Math.atan2(ev[1], ev[0]) * DEG);
  const unit = t.manifest.horizonUnitDeg;
  const dark = o.alwaysDarkRgb ?? ALWAYS_DARK_RGB;
  const { up, normals, relief, horizon, disc, alwaysDark, monthLit, heights } = t;
  const live = o.layer === 'live';
  const earth = o.layer === 'earth';
  let nLit = 0;

  for (let i = 0; i < n * n; i++) {
    const p = i * 4;
    if (!disc[i]) {
      out[p + 3] = 0;
      continue;
    }
    const i3 = i * 3;
    let r: number;
    let g: number;
    let b: number;
    const showDark = o.showAlwaysDark && alwaysDark[i] === 1;
    let rl = relief[i];

    if (live) {
      const el = Math.asin(clamp(up[i3] * sv[0] + up[i3 + 1] * sv[1] + up[i3 + 2] * sv[2])) * DEG;
      const hor = (horizon[sunAz.o0 + i] * (1 - sunAz.f) + horizon[sunAz.o1 + i] * sunAz.f) * unit;
      const lit = clamp01((el - hor + PENUMBRA_HALF_DEG) / (2 * PENUMBRA_HALF_DEG));
      let mu0 = normals[i3] * sv[0] + normals[i3 + 1] * sv[1] + normals[i3 + 2] * sv[2];
      if (mu0 < 0) mu0 = 0;
      let mu = -normals[i3 + 2];
      if (mu < 0.3) mu = 0.3;
      const v = lit * (mu0 / (mu0 + mu)) * 2.0 + 0.035;
      const h01 = clamp01((heights[i] + 6000) / 12000);
      r = (168 + 22 * h01) * v;
      g = (160 + 14 * h01) * v;
      b = (148 + 6 * h01) * v;
      if (showDark && lit < 0.5) {
        const pv = 0.5 + 0.4 * rl;
        r = dark[0] * pv;
        g = dark[1] * pv;
        b = dark[2] * pv;
      }
      if (lit > 0.5 && mu0 > 0.02) nLit++;
    } else if (earth) {
      const el = Math.asin(clamp(up[i3] * ev[0] + up[i3 + 1] * ev[1] + up[i3 + 2] * ev[2])) * DEG;
      const hor = (horizon[earthAz.o0 + i] * (1 - earthAz.f) + horizon[earthAz.o1 + i] * earthAz.f) * unit;
      const vis = clamp01((el - hor + PENUMBRA_HALF_DEG) / (2 * PENUMBRA_HALF_DEG));
      rl = 0.5 + 0.33 * rl;
      r = (46 + 81 * vis) * rl;
      g = (52 + 129 * vis) * rl;
      b = (56 + 107 * vis) * rl;
    } else {
      const c = monthRamp(monthLit[i]);
      rl = 0.55 + 0.3 * rl;
      if (showDark) {
        r = dark[0] * rl;
        g = dark[1] * rl;
        b = dark[2] * rl;
      } else {
        r = c[0] * rl;
        g = c[1] * rl;
        b = c[2] * rl;
      }
    }
    out[p] = byte(r);
    out[p + 1] = byte(g);
    out[p + 2] = byte(b);
    out[p + 3] = 255;
  }
  return { sunlitPct: t.discCount ? (nLit / t.discCount) * 100 : 0 };
}

function clamp(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** Everything the tooltip and the pin readout need for one pixel. Returns null outside the 80°S disc. */
export function samplePolar(
  t: PolarTerrain,
  px: number,
  py: number,
  o: Pick<PolarRenderOptions, 'hoursSinceNewMoon' | 'subsolarLatDeg' | 'earthHours'>,
): PolarSample | null {
  const x = Math.floor(px);
  const y = Math.floor(py);
  if (x < 0 || y < 0 || x >= t.n || y >= t.n) return null;
  const i = y * t.n + x;
  if (!t.disc[i]) return null;
  const i3 = i * 3;
  const sv = sunVector(o.hoursSinceNewMoon, o.subsolarLatDeg);
  const ev = earthVector(o.earthHours ?? o.hoursSinceNewMoon);
  const sunEl = Math.asin(clamp(t.up[i3] * sv[0] + t.up[i3 + 1] * sv[1] + t.up[i3 + 2] * sv[2])) * DEG;
  const sunHor = horizonDeg(t, i, Math.atan2(sv[1], sv[0]) * DEG);
  const mu0 = t.normals[i3] * sv[0] + t.normals[i3 + 1] * sv[1] + t.normals[i3 + 2] * sv[2];
  const earthEl = Math.asin(clamp(t.up[i3] * ev[0] + t.up[i3 + 1] * ev[1] + t.up[i3 + 2] * ev[2])) * DEG;
  const earthHor = horizonDeg(t, i, Math.atan2(ev[1], ev[0]) * DEG);
  const ll = pixelToLatLon(t.grid, x, y);
  return {
    px: x,
    py: y,
    lat: ll.lat,
    lon: ll.lon,
    heightM: t.heights[i],
    alwaysDark: t.alwaysDark[i] === 1,
    monthLitPct: t.monthLit[i] * 100,
    sunElevationDeg: sunEl,
    sunHorizonDeg: sunHor,
    sunlit: sunEl > sunHor && mu0 > 0.02,
    earthElevationDeg: earthEl,
    earthHorizonDeg: earthHor,
    earthVisible: earthEl > earthHor,
  };
}

/** Pixel size in km — re-exported so views do not import polarGrid just for it. */
export const terrainKmPerPixel = (t: PolarTerrain): number => kmPerPixel(t.grid);
