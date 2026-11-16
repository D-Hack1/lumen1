// Owner: Ebin
// Geometric panel model for the Touchdown Pad bars (PLAN_FINAL §5.6). NOT the engine's power model — a cosine
// incidence factor per panel face in the local East-North-Up frame, scaled so the FLAT-ground baseline sums to
// the engine's total power at that instant (`series.powerW`). That keeps bars honest about *relative* change
// (slope / tilt / yaw / preset) while the absolute watts stay the engine's. Pure; unit-tested.
import type { PanelPreset } from '../../state/scenarioStore';

type V3 = [number, number, number];
const RAD = Math.PI / 180;
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Unit vector for compass azimuth (0 = N, clockwise) and elevation, in ENU. */
export function enu(azDeg: number, elDeg: number): V3 {
  const a = azDeg * RAD;
  const e = elDeg * RAD;
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
}

export interface PadAttitude {
  slopeDeg: number;
  downhillAzDeg: number;
  tiltMagDeg: number;
  tiltDirDeg: number;
  yawDeg: number;
}

export interface PanelFace {
  label: string;
  watts: number;
  baselineWatts: number;
}

/** Body frame {right, forward, up} from the ground normal, off-nominal tilt, and yaw (heading of body-forward). */
function bodyFrame(att: PadAttitude): { right: V3; fwd: V3; up: V3 } {
  const g = enu(att.downhillAzDeg, 90 - att.slopeDeg); // tilts toward downhill
  const t: V3 = [Math.sin(att.tiltMagDeg * RAD) * Math.sin(att.tiltDirDeg * RAD), Math.sin(att.tiltMagDeg * RAD) * Math.cos(att.tiltDirDeg * RAD), 0];
  const up = norm([g[0] + t[0], g[1] + t[1], g[2] + t[2]]);
  const heading = enu(att.yawDeg, 0);
  const h = dot(heading, up);
  const fwd = norm([heading[0] - h * up[0], heading[1] - h * up[1], heading[2] - h * up[2]]);
  return { right: cross(fwd, up), fwd, up };
}

function faces(preset: PanelPreset, att: PadAttitude, sun: V3): { label: string; n: V3 }[] {
  const { right, fwd, up } = bodyFrame(att);
  const comb = (a: number, b: number, c: number): V3 => norm([right[0] * a + fwd[0] * b + up[0] * c, right[1] * a + fwd[1] * b + up[1] * c, right[2] * a + fwd[2] * b + up[2] * c]);
  switch (preset) {
    case 'fourSide':
      return [
        { label: '+X side', n: comb(1, 0, 0) },
        { label: '+Y side', n: comb(0, 1, 0) },
        { label: '−X side', n: comb(-1, 0, 0) },
        { label: '−Y side', n: comb(0, -1, 0) },
      ];
    case 'singleHeading':
      return [{ label: 'Panel (45°)', n: comb(0, Math.SQRT1_2, Math.SQRT1_2) }];
    case 'horizontalDeck':
      return [{ label: 'Deck', n: up }];
    case 'trackingMast':
      return [{ label: 'Tracking', n: sun }];
  }
}

const cosInc = (n: V3, s: V3) => Math.max(0, dot(n, s));

/**
 * Per-face power at one instant. `totalFlatW` = engine power for flat ground at the same preset/yaw 0;
 * `sunAzDeg/sunElevDeg` = Sun direction. Returns zeros when the Sun is down or the flat baseline is dark.
 */
export function panelFaces(preset: PanelPreset, att: PadAttitude, sunAzDeg: number, sunElevDeg: number, totalFlatW: number): PanelFace[] {
  const s = enu(sunAzDeg, sunElevDeg);
  const flat: PadAttitude = { ...att, slopeDeg: 0, tiltMagDeg: 0, yawDeg: 0 };
  const cur = faces(preset, att, s);
  const base = faces(preset, flat, s);
  const baseSum = base.reduce((a, f) => a + cosInc(f.n, s), 0);
  const k = sunElevDeg > 0 && baseSum > 1e-9 ? totalFlatW / baseSum : 0;
  return cur.map((f, i) => ({ label: f.label, watts: cosInc(f.n, s) * k, baselineWatts: cosInc(base[i].n, s) * k }));
}
