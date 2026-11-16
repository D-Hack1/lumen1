// Owner: Nived
// TypeScript twin of pipeline/lumen_pipeline/reference/power.py (R3 generic power model, G-10): same function names (camelCase), same
// branching, same conventions. Times are seconds here (like the Python's ET seconds); no defaults for panel physics (R3 gives none).
//   site frame = (east, reference-north, up); azimuth is east of north; positive yaw increases azimuth;
//   off-nominal tilt direction = the azimuth toward which an up-facing panel tilts;
//   attitude = tilt-onto-ground * yaw * off-nominal tilt.
import { AU_KM, SOLAR_CONSTANT_W_M2 } from './constants';

export type Vec3 = readonly [number, number, number];
export type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];
export type PanelPreset = 'fourSide' | 'singleHeading' | 'horizontalDeck' | 'trackingMast';

export interface Panel {
  /** Unit normal in the site frame. */
  normal: Vec3;
  areaM2: number;
  efficiency: number;
}

export interface PowerSeries {
  generationW: Float64Array;
  loadW: Float64Array;
  netW: Float64Array;
  socFraction: Float64Array;
  storedEnergyWh: Float64Array;
  curtailedGenerationWh: Float64Array;
  unservedLoadWh: Float64Array;
}

export interface BatteryConfig {
  batteryCapacityWh: number;
  usableDepthOfDischarge: number;
  initialSocFraction: number;
}

const UP: Vec3 = [0, 0, 1];
const RAD = Math.PI / 180;
const isClose = (a: number, b: number, abs: number) => Math.abs(a - b) <= abs; // math.isclose(rel_tol=0, abs_tol=abs)
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const finite3 = (v: ArrayLike<number>) => v.length === 3 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);

function unitVector(v: ArrayLike<number>, name: string): Vec3 {
  if (!finite3(v)) throw new RangeError(`${name} must be a finite vector with shape (3,)`);
  if (!isClose(Math.hypot(v[0], v[1], v[2]), 1, 1e-12)) throw new RangeError(`${name} must be a unit vector`);
  return [v[0], v[1], v[2]];
}

function rotationAbout(axis: Vec3, angleDeg: number): Mat3 {
  if (!Number.isFinite(angleDeg)) throw new RangeError('rotation angle must be finite');
  const [x, y, z] = unitVector(axis, 'rotation axis');
  const a = angleDeg * RAD;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
    [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
    [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)],
  ];
}

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function rotationFromUp(groundNormal: ArrayLike<number>): Mat3 {
  const ground = unitVector(groundNormal, 'groundNormal');
  const cosine = dot(UP, ground);
  if (isClose(cosine, 1, 1e-12)) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (isClose(cosine, -1, 1e-12)) return rotationAbout([1, 0, 0], 180);
  const axis = cross(UP, ground);
  const n = norm(axis);
  return rotationAbout([axis[0] / n, axis[1] / n, axis[2] / n], (Math.acos(cosine) * 180) / Math.PI);
}

function horizontalDirection(azimuthDeg: number): Vec3 {
  if (!Number.isFinite(azimuthDeg)) throw new RangeError('azimuthDeg must be finite');
  const a = azimuthDeg * RAD;
  return [Math.sin(a), Math.cos(a), 0];
}

const matMul = (a: Mat3, b: Mat3): Mat3 =>
  a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j])) as Mat3;
const matVec = (m: Mat3, v: Vec3): Vec3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

/** An R3 generic preset from caller-supplied physics (no defaults). `trackingAzimuthDeg` should be updated for each Sun azimuth. */
export function genericPanelPreset(
  preset: PanelPreset,
  o: { panelAreaM2: number; efficiency: number; headingDeg?: number | null; trackingAzimuthDeg?: number | null },
): Panel[] {
  let normals: Vec3[];
  if (preset === 'fourSide') normals = [0, 90, 180, 270].map(horizontalDirection);
  else if (preset === 'singleHeading') {
    if (o.headingDeg == null) throw new RangeError('singleHeading requires headingDeg');
    normals = [horizontalDirection(o.headingDeg)];
  } else if (preset === 'horizontalDeck') normals = [UP];
  else if (preset === 'trackingMast') {
    if (o.trackingAzimuthDeg == null) throw new RangeError('trackingMast requires trackingAzimuthDeg');
    normals = [horizontalDirection(o.trackingAzimuthDeg)];
  } else throw new RangeError(`unsupported panel preset: ${String(preset)}`);
  return normals.map((normal) => ({ normal, areaM2: o.panelAreaM2, efficiency: o.efficiency }));
}

/** attitude = tilt-onto-ground * yaw * off-nominal tilt. */
export function attitudeMatrix(groundNormal: ArrayLike<number>, yawDeg: number, offNominalTiltDeg: number, offNominalTiltDirectionDeg: number): Mat3 {
  if (!Number.isFinite(yawDeg) || !Number.isFinite(offNominalTiltDeg)) throw new RangeError('yawDeg and offNominalTiltDeg must be finite');
  const tiltDirection = horizontalDirection(offNominalTiltDirectionDeg);
  const tiltAxis = cross(UP, tiltDirection);
  return matMul(matMul(rotationFromUp(groundNormal), rotationAbout(UP, -yawDeg)), rotationAbout(tiltAxis, offNominalTiltDeg));
}

export function orientPanels(panels: readonly Panel[], groundNormal: ArrayLike<number>, yawDeg: number, offNominalTiltDeg: number, offNominalTiltDirectionDeg: number): Panel[] {
  const attitude = attitudeMatrix(groundNormal, yawDeg, offNominalTiltDeg, offNominalTiltDirectionDeg);
  return panels.map((p) => ({ normal: matVec(attitude, unitVector(p.normal, 'panel normal')), areaM2: p.areaM2, efficiency: p.efficiency }));
}

/** The first maximum of R3's required 15-degree yaw sweep. */
export function bestYawDeg(panels: readonly Panel[], sunDirection: ArrayLike<number>, groundNormal: ArrayLike<number>, offNominalTiltDeg: number, offNominalTiltDirectionDeg: number): number {
  const direction = unitVector(sunDirection, 'sunDirection');
  let best = 0;
  let bestProjection = -Infinity;
  for (let yaw = 0; yaw < 360; yaw += 15) {
    const oriented = orientPanels(panels, groundNormal, yaw, offNominalTiltDeg, offNominalTiltDirectionDeg);
    let projection = 0;
    for (const p of oriented) projection += p.areaM2 * p.efficiency * Math.max(0, dot(p.normal, direction));
    if (projection > bestProjection) {
      best = yaw;
      bestProjection = projection;
    }
  }
  return best;
}

export function solarIrradianceWM2(sunDistanceKm: number): number {
  if (!Number.isFinite(sunDistanceKm) || sunDistanceKm <= 0) throw new RangeError('sunDistanceKm must be finite and positive');
  return SOLAR_CONSTANT_W_M2 * (AU_KM / sunDistanceKm) ** 2;
}

/** Panel cosine law times the disk fraction. */
export function solarGenerationW(sunDirection: ArrayLike<number>, sunDistanceKm: number, diskFraction: number, panels: readonly Panel[]): number {
  if (!finite3(sunDirection) || !isClose(Math.hypot(sunDirection[0], sunDirection[1], sunDirection[2]), 1, 1e-12)) throw new RangeError('sunDirection must be a finite unit vector with shape (3,)');
  if (!Number.isFinite(diskFraction) || diskFraction < 0 || diskFraction > 1) throw new RangeError('diskFraction must be finite and within [0, 1]');
  const sun: Vec3 = [sunDirection[0], sunDirection[1], sunDirection[2]];
  let projected = 0;
  for (const p of panels) {
    if (!finite3(p.normal) || !isClose(norm(p.normal), 1, 1e-12)) throw new RangeError('panel normals must be finite unit vectors with shape (3,)');
    if (!Number.isFinite(p.areaM2) || p.areaM2 < 0) throw new RangeError('panel areaM2 must be finite and non-negative');
    if (!Number.isFinite(p.efficiency) || p.efficiency < 0 || p.efficiency > 1) throw new RangeError('panel efficiency must be finite and within [0, 1]');
    projected += p.areaM2 * p.efficiency * Math.max(0, dot(p.normal, sun));
  }
  return solarIrradianceWM2(sunDistanceKm) * projected * diskFraction;
}

/** The same configured panels and controls on a flat local ground plane. */
export function flatGroundBaselineW(sunDirection: ArrayLike<number>, sunDistanceKm: number, diskFraction: number, panels: readonly Panel[], yawDeg: number, offNominalTiltDeg: number, offNominalTiltDirectionDeg: number): number {
  return solarGenerationW(sunDirection, sunDistanceKm, diskFraction, orientPanels(panels, UP, yawDeg, offNominalTiltDeg, offNominalTiltDirectionDeg));
}

/** Trapezoidal interval energy with physical bounds: above full => curtailed; below the retained minimum => unserved. */
export function integrateBatterySoc(timesS: ArrayLike<number>, generationW: ArrayLike<number>, operationalLoadW: ArrayLike<number>, battery: BatteryConfig): PowerSeries {
  const n = timesS.length;
  if (n < 2 || generationW.length !== n || operationalLoadW.length !== n) throw new RangeError('times, generationW, and operationalLoadW must have matching length >= 2');
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(timesS[i]) || (i > 0 && !(timesS[i] - timesS[i - 1] > 0))) throw new RangeError('timesS must be finite and strictly increasing');
  }
  for (let i = 0; i < n; i++) if (!Number.isFinite(generationW[i]) || generationW[i] < 0) throw new RangeError('generationW must be finite and non-negative');
  for (let i = 0; i < n; i++) if (!Number.isFinite(operationalLoadW[i]) || operationalLoadW[i] < 0) throw new RangeError('operationalLoadW must be finite and non-negative');
  const { batteryCapacityWh: cap, usableDepthOfDischarge: dod, initialSocFraction: init } = battery;
  if (!Number.isFinite(cap) || cap <= 0) throw new RangeError('batteryCapacityWh must be finite and positive');
  if (!Number.isFinite(dod) || dod < 0 || dod > 1) throw new RangeError('usableDepthOfDischarge must be within [0, 1]');
  const minimumSoc = 1 - dod;
  if (!Number.isFinite(init) || init < minimumSoc || init > 1) throw new RangeError('initialSocFraction must be within the usable battery range');

  const net = new Float64Array(n);
  for (let i = 0; i < n; i++) net[i] = generationW[i] - operationalLoadW[i];
  const stored = new Float64Array(n);
  const soc = new Float64Array(n);
  const curtailed = new Float64Array(n);
  const unserved = new Float64Array(n);
  const minimumEnergy = minimumSoc * cap;
  stored[0] = init * cap;
  soc[0] = init;
  for (let i = 1; i < n; i++) {
    const hours = (timesS[i] - timesS[i - 1]) / 3600;
    const requested = stored[i - 1] + ((net[i - 1] + net[i]) * hours) / 2;
    curtailed[i] = Math.max(0, requested - cap);
    unserved[i] = Math.max(0, minimumEnergy - requested);
    stored[i] = Math.min(cap, Math.max(minimumEnergy, requested));
    soc[i] = stored[i] / cap;
  }
  return { generationW: Float64Array.from(generationW), loadW: Float64Array.from(operationalLoadW), netW: net, socFraction: soc, storedEnergyWh: stored, curtailedGenerationWh: curtailed, unservedLoadWh: unserved };
}

/** Generation, eclipse attenuation, loads and battery SOC together. */
export function evaluatePowerSeries(
  timesS: ArrayLike<number>,
  sunDirections: ReadonlyArray<ArrayLike<number>>,
  sunDistancesKm: ArrayLike<number>,
  sunDiskFractions: ArrayLike<number>,
  panels: readonly Panel[],
  operationalLoadW: ArrayLike<number>,
  battery: BatteryConfig,
): PowerSeries {
  const n = timesS.length;
  if (sunDirections.length !== n || sunDistancesKm.length !== n || sunDiskFractions.length !== n) throw new RangeError('sun geometry series must match timesS');
  const generation = Array.from({ length: n }, (_, i) => solarGenerationW(sunDirections[i], sunDistancesKm[i], sunDiskFractions[i], panels));
  return integrateBatterySoc(timesS, generation, operationalLoadW, battery);
}
