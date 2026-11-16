// Owner: Ebin
// Pure sky geometry for the Horizon Lens (unit-tested). Works in the site's local East-North-Up frame, built from
// the engine's Sun/Earth azimuth+elevation at t_scrub (no ephemeris here — the engine owns that).
const RAD = Math.PI / 180;
type V3 = [number, number, number];

export const enu = (azDeg: number, elDeg: number): V3 => [Math.sin(azDeg * RAD) * Math.cos(elDeg * RAD), Math.cos(azDeg * RAD) * Math.cos(elDeg * RAD), Math.sin(elDeg * RAD)];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Screen-plane basis at a body: `up` = local zenith projected, `right` = increasing azimuth. */
function screenBasis(e: V3): { up: V3; right: V3 } {
  const z: V3 = [0, 0, 1];
  const k = dot(z, e);
  const up = unit([z[0] - k * e[0], z[1] - k * e[1], z[2] - k * e[2]]);
  return { up, right: cross(e, up) };
}

/** Canvas-space (x right, y down) direction of vector `v` as seen around body direction `e`, in radians. */
function screenAngle(e: V3, v: V3): number {
  const { up, right } = screenBasis(e);
  const k = dot(v, e);
  const p: V3 = [v[0] - k * e[0], v[1] - k * e[1], v[2] - k * e[2]];
  return Math.atan2(-dot(p, up), dot(p, right));
}

export interface EarthAppearance {
  /** Sun–Earth angular separation at the site (the Moon-centred elongation), degrees. */
  elongationDeg: number;
  /** Illuminated fraction of the disk, 0 (new) … 1 (full). */
  litFraction: number;
  /** Canvas angle (rad) toward the Sun from the Earth's centre — the bright limb faces this way. */
  sunAngle: number;
  /** Canvas rotation (rad) to apply to a north-up Earth image so its pole matches the local sky. */
  imageRotation: number;
}

/**
 * Earth's phase and orientation in the site's sky.
 * - Phase: elongation ε between the Sun and Earth directions; seen from the Moon the Earth's phase angle is 180°−ε,
 *   so lit fraction = (1 − cos ε)/2 (Sun behind Earth ⇒ new Earth).
 * - Orientation: Earth's rotation axis ≈ the lunar north axis (the Moon's spin axis is within 1.6° of the ecliptic
 *   pole), which in a site's ENU frame at latitude φ is (0, cosφ, sinφ). From the south pole that points straight
 *   down, so a north-up image comes out upside-down — as it should.
 */
export function earthAppearance(sunAz: number, sunEl: number, earthAz: number, earthEl: number, latDeg: number): EarthAppearance {
  const s = enu(sunAz, sunEl);
  const e = enu(earthAz, earthEl);
  const cosEps = Math.max(-1, Math.min(1, dot(s, e)));
  const north: V3 = [0, Math.cos(latDeg * RAD), Math.sin(latDeg * RAD)];
  return {
    elongationDeg: Math.acos(cosEps) / RAD,
    litFraction: (1 - cosEps) / 2,
    sunAngle: screenAngle(e, s),
    imageRotation: screenAngle(e, north) + Math.PI / 2, // image "up" is canvas (0,−1) = −π/2
  };
}

/**
 * Fraction of a disk (radius r, centre cy) lying above a terrain line, area-weighted. `terrainY(x)` gives the
 * canvas y of the horizon at column x (ground is below it). Used for the V-6 check: drawn visible area vs the
 * engine's disk fraction.
 */
export function visibleDiskFraction(cx: number, cy: number, r: number, terrainY: (x: number) => number, columns = 48): number {
  let vis = 0;
  let tot = 0;
  for (let c = 0; c < columns; c++) {
    const x = cx - r + ((c + 0.5) / columns) * 2 * r;
    const half = Math.sqrt(Math.max(0, r * r - (x - cx) ** 2));
    const chord = 2 * half;
    const above = Math.max(0, Math.min(chord, terrainY(x) - (cy - half)));
    vis += above;
    tot += chord;
  }
  return tot > 0 ? vis / tot : 0;
}
