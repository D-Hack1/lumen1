// Owner: Nived
// What the Touchdown Pad and the Power curve show: generation of the configured panels on the ACTUAL pad (ground slope, off-nominal tilt, yaw)
// vs the flat-ground baseline (PLAN §5.6), from the Sun's azimuth/elevation. A thin layer over core/power.ts (the parity-tested twin of Gowri's
// power.py): this file only decides the inputs R3 leaves open, and each decision is declared here, not hidden:
//   * panel physics: R3 gives no area/efficiency, so ASSUMED_PANEL = 1 m2, eta 1 (a declared placeholder). Results are "W per m2 of panel aperture";
//   * singleHeading faces reference-north (heading 0) before yaw; trackingMast turns to the Sun azimuth at every sample;
//   * yaw null (auto) = the best 15 degree yaw of R3's sweep, re-chosen per sample.
import { attitudeMatrix, bestYawDeg, flatGroundBaselineW, genericPanelPreset, orientPanels, solarGenerationW, solarIrradianceWM2, type Mat3, type PanelPreset, type Vec3 } from './power';

export type { PanelPreset, Vec3 };

export const ASSUMED_PANEL = { panelAreaM2: 1, efficiency: 1 } as const;

export interface PowerConfig {
  preset: PanelPreset;
  /** Fixed yaw (deg, positive toward increasing azimuth), or null = best of the 15 degree sweep. */
  yawDeg: number | null;
  tiltMagDeg: number;
  /** Azimuth toward which an up-facing panel tilts (R3 / power.py convention). */
  tiltDirDeg: number;
  /** Ground normal in the site frame (east, reference-north, up); null = flat. */
  groundNormal: Vec3 | null;
  panelAreaM2: number;
  efficiency: number;
}

export interface SunSample {
  azimuthDeg: number;
  elevationDeg: number;
  distanceKm: number;
  /** 0-1: the visible fraction of the Sun's disk (terrain and the horizon already applied). */
  diskFraction: number;
}

export interface PowerAt {
  watts: number;
  flatWatts: number;
  /** The yaw used (the sweep's choice when auto). */
  yawDeg: number;
  faces: Array<{ watts: number; flatWatts: number }>;
}

const FLAT: Vec3 = [0, 0, 1];
const RAD = Math.PI / 180;

/** Site-frame unit vector for compass azimuth (0 = north, clockwise) and elevation. */
export function sunDirection(azimuthDeg: number, elevationDeg: number): Vec3 {
  const a = azimuthDeg * RAD;
  const e = elevationDeg * RAD;
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
}

/** The ground normal tilts toward the downhill azimuth by the slope angle. */
export function groundNormalFromPad(slopeDeg: number, downhillAzimuthDeg: number): Vec3 {
  if (slopeDeg === 0) return FLAT;
  const s = slopeDeg * RAD;
  const d = downhillAzimuthDeg * RAD;
  return [Math.sin(s) * Math.sin(d), Math.sin(s) * Math.cos(d), Math.cos(s)];
}

export function generationAt(cfg: PowerConfig, sun: SunSample): PowerAt {
  const dir = sunDirection(sun.azimuthDeg, sun.elevationDeg);
  const panels = genericPanelPreset(cfg.preset, { panelAreaM2: cfg.panelAreaM2, efficiency: cfg.efficiency, headingDeg: 0, trackingAzimuthDeg: sun.azimuthDeg });
  const ground = cfg.groundNormal ?? FLAT;
  const yaw = cfg.yawDeg ?? (sun.diskFraction > 0 && sun.elevationDeg > 0 ? bestYawDeg(panels, dir, ground, cfg.tiltMagDeg, cfg.tiltDirDeg) : 0);
  const oriented = orientPanels(panels, ground, yaw, cfg.tiltMagDeg, cfg.tiltDirDeg);
  const flat = orientPanels(panels, FLAT, yaw, cfg.tiltMagDeg, cfg.tiltDirDeg);
  const faces = oriented.map((p, k) => ({
    watts: solarGenerationW(dir, sun.distanceKm, sun.diskFraction, [p]),
    flatWatts: solarGenerationW(dir, sun.distanceKm, sun.diskFraction, [flat[k]]),
  }));
  return {
    watts: solarGenerationW(dir, sun.distanceKm, sun.diskFraction, oriented),
    flatWatts: flatGroundBaselineW(dir, sun.distanceKm, sun.diskFraction, panels, yaw, cfg.tiltMagDeg, cfg.tiltDirDeg),
    yawDeg: yaw,
    faces,
  };
}

const dotV = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const applyM = (m: Mat3, v: Vec3): Vec3 => [dotV(m[0], v), dotV(m[1], v), dotV(m[2], v)];

/**
 * Actual and flat-ground generation for a run of samples (same grid). Same results as calling `generationAt` per sample, but the attitude
 * matrices (which depend only on pad, tilt and yaw, not on the Sun) are built once: the auto-yaw sweep would otherwise rebuild 24 of them per sample.
 */
export function powerSeries(cfg: PowerConfig, samples: readonly SunSample[]): { powerW: Float32Array; flatW: Float32Array } {
  const powerW = new Float32Array(samples.length);
  const flatW = new Float32Array(samples.length);
  const ground = cfg.groundNormal ?? FLAT;
  const yaws = cfg.yawDeg == null ? Array.from({ length: 24 }, (_, k) => k * 15) : [cfg.yawDeg];
  const actual = yaws.map((y) => attitudeMatrix(ground, y, cfg.tiltMagDeg, cfg.tiltDirDeg));
  const flat = yaws.map((y) => attitudeMatrix(FLAT, y, cfg.tiltMagDeg, cfg.tiltDirDeg));
  const fixedPanels = cfg.preset === 'trackingMast' ? null : genericPanelPreset(cfg.preset, { panelAreaM2: cfg.panelAreaM2, efficiency: cfg.efficiency, headingDeg: 0 });
  const weight = cfg.panelAreaM2 * cfg.efficiency;
  samples.forEach((s, i) => {
    if (s.diskFraction <= 0) return; // dark: 0 W (also skips the yaw sweep)
    const dir = sunDirection(s.azimuthDeg, s.elevationDeg);
    const panels = fixedPanels ?? genericPanelPreset(cfg.preset, { panelAreaM2: cfg.panelAreaM2, efficiency: cfg.efficiency, trackingAzimuthDeg: s.azimuthDeg });
    const projection = (m: Mat3) => {
      let sum = 0;
      for (const p of panels) sum += Math.max(0, dotV(applyM(m, p.normal), dir));
      return sum * weight;
    };
    let k = 0;
    if (cfg.yawDeg == null && s.elevationDeg > 0) {
      let best = -Infinity; // first maximum, as bestYawDeg
      actual.forEach((m, j) => {
        const v = projection(m);
        if (v > best) {
          best = v;
          k = j;
        }
      });
    }
    const irradiance = solarIrradianceWM2(s.distanceKm) * s.diskFraction;
    powerW[i] = irradiance * projection(actual[k]);
    flatW[i] = irradiance * projection(flat[k]);
  });
  return { powerW, flatW };
}

/** Mean generation over the window, scaled to 24 h (trapezoidal), in Wh per day. null for fewer than two samples. */
export function energyPerDayWh(powerW: ArrayLike<number>, stepMs: number): number | null {
  const n = powerW.length;
  if (n < 2) return null;
  let wh = 0;
  for (let i = 1; i < n; i++) wh += ((powerW[i - 1] + powerW[i]) / 2) * (stepMs / 3_600_000);
  const hours = ((n - 1) * stepMs) / 3_600_000;
  return (wh / hours) * 24;
}
