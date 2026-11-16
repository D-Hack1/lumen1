// Owner: Nived
// Cubic Hermite interpolation of the Sun and Earth positions (Python twin: ephem/ephemeris.py `hermite_position`).
// Positions come from the file in float32; ALL arithmetic here is float64 (JS numbers), as it must be: the Sun is
// ~1.5e8 km away and float32 would lose ~10 km.  Time is epoch ms UTC; the nodes are uniform in time so the index is
// (t - start) / step. Velocity terms are scaled by the node spacing in SECONDS (velocities are km/s).
import { EPHEM, EPHEM_STRIDE, type Ephemeris } from '../data/ephem';

export type Vec3 = [number, number, number];
export type BodyId = 'sun' | 'earth';

export interface BodyPositions {
  sun: Vec3;
  earth: Vec3;
}

export function hermitePositions(eph: Ephemeris, tMs: number): BodyPositions {
  const interval = (tMs - eph.startMs) / eph.cadenceMs;
  const index = Math.floor(interval);
  if (!(index >= 0 && index < eph.count - 1)) {
    throw new RangeError(`epoch ${new Date(tMs).toISOString()} falls outside the ephemeris nodes`);
  }
  const f = interval - index;
  const t2 = f * f;
  const t3 = t2 * f;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + f;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const dt = eph.stepSeconds;
  const a = index * EPHEM_STRIDE;
  const b = a + EPHEM_STRIDE;
  const d = eph.data;
  const body = (pos: number, vel: number): Vec3 => [
    h00 * d[a + pos] + h10 * dt * d[a + vel] + h01 * d[b + pos] + h11 * dt * d[b + vel],
    h00 * d[a + pos + 1] + h10 * dt * d[a + vel + 1] + h01 * d[b + pos + 1] + h11 * dt * d[b + vel + 1],
    h00 * d[a + pos + 2] + h10 * dt * d[a + vel + 2] + h01 * d[b + pos + 2] + h11 * dt * d[b + vel + 2],
  ];
  return { sun: body(EPHEM.sunPos, EPHEM.sunVel), earth: body(EPHEM.earthPos, EPHEM.earthVel) };
}

/** Is `tMs` inside the span the ephemeris can interpolate? */
export const inEphemerisRange = (eph: Ephemeris, tMs: number): boolean => tMs >= eph.startMs && tMs < eph.endMs;
