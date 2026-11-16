// Owner: Nived
// Turns one `evaluate()` run into the public `ScenarioResult` the UI hooks return. Pure and synchronous, so it runs
// identically in the Web Worker and in unit tests. Geometry-only for now: terrain mask, sigma bounds, DSN and power are
// not available yet, so their fields are null (never invented) and the verdict stays PENDING.
import type { Ephemeris } from '../data/ephem';
import { deriveAnswerState } from '../answerState';
import type { AnswerState, Bounded, EventRecord, MetricSet, ScenarioResult, Series, Tier } from '../types';
import { evaluate, stateAt, DEFAULT_DEFINITIONS, type Definitions, type Evaluation } from './evaluate';
import { makeSite, type Mat3 } from './geometry';
import { inEphemerisRange } from './interp';
import { evaluateVerdict, type VerdictProfile, type VerdictWeights } from './verdict';
import { FINE_STEP_MS, refineTransition } from './events';
import { energyPerDayWh, powerSeries, type PowerConfig } from './padPower';
import type { DsnSeries } from '../data/dsn';
import { Horizon, diskFractionVisible } from './visibility';
import { horizonFromMask, sigmaAtAzimuth, sigmaRowFor } from './terrainHorizon';
import { evaluateWithBounds, type BoundedEvaluation } from './bounds';
import { sigmaSourceLabel, type Sigma } from '../data/sigma';
import type { Mask } from '../data/masks';
import { toWindowRecord } from './windows';

/** Everything the worker needs, as plain serialisable data (no store, no catalog objects). */
export interface ScenarioRequest {
  siteId: string | null;
  tier: Tier;
  nearFieldResM: number | null;
  latDeg: number;
  lonDegEast: number;
  heightM: number;
  rotation: Mat3 | null;
  touchdownMs: number | null;
  padSlopeDeg: number | null;
  psr: { distanceKm: number; bearingDeg: number; areaKm2: number; source: 'published' | 'derived' } | null;
  startMs: number;
  durationDays: number;
  tScrubMs: number;
  definitions: Definitions;
  /** Mission Profile thresholds and Viability Index weights (from the store). */
  profile: VerdictProfile;
  weights: VerdictWeights;
  dataVersions: Record<string, number | string>;
  /** Panel preset, yaw, tilt and pad ground normal; omitted/null = no power model (powerW stays 0, no energy metric). */
  power?: PowerConfig | null;
}

/** Masks built from a DEM coarser than this (metres per pixel) are labelled "coarse". The polar Tier-A masks are 5-60 m. */
export const COARSE_TERRAIN_M = 100;

const nulls: Bounded = { value: null, lo: null, hi: null };
const val = (v: number | null): Bounded => ({ value: v, lo: null, hi: null });

const DAY = 86_400_000;

function emptyError(message: string): ScenarioResult {
  return {
    status: 'error',
    error: message,
    meta: null,
    verdict: 'PENDING',
    verdictReasons: [],
    viability: null,
    answer: null,
    events: [],
    windows: [],
    series: null,
    metrics: null,
  };
}

function buildSeries(
  ev: Evaluation,
  power: PowerConfig | null,
  sigmaBand: ((azimuthDeg: number) => number) | null = null,
): Series {
  const n = ev.samples.length;
  const f = () => new Float32Array(n);
  const u = () => new Uint8Array(n);
  const s: Series = {
    t0: ev.times[0],
    stepMs: FINE_STEP_MS,
    sunElevDeg: f(),
    sunAzDeg: f(),
    sunClearanceDeg: f(),
    sunDiskPct: f(),
    earthElevDeg: f(),
    earthAzDeg: f(),
    earthClearanceDeg: f(),
    earthDiskPct: f(),
    earthRangeKm: f(),
    powerW: f(),
    flatPowerW: f(),
    sunUp: u(),
    earthUp: u(),
    linkUp: u(),
    sigmaBandDeg: f(),
  };
  ev.samples.forEach((p, i) => {
    s.sunElevDeg[i] = p.sun.elevationDeg;
    s.sunAzDeg[i] = p.sun.azimuthDeg;
    s.sunClearanceDeg[i] = p.sun.clearanceDeg;
    s.sunDiskPct[i] = 100 * p.sun.diskFraction;
    s.earthElevDeg[i] = p.earth.elevationDeg;
    s.earthAzDeg[i] = p.earth.azimuthDeg;
    s.earthClearanceDeg[i] = p.earth.clearanceDeg;
    s.earthDiskPct[i] = 100 * p.earth.diskFraction;
    s.earthRangeKm[i] = p.earth.distanceKm;
    s.sunUp[i] = p.sun.up ? 1 : 0;
    s.earthUp[i] = p.earth.up ? 1 : 0;
    s.linkUp[i] = p.linkUp ? 1 : 0; // Earth visible AND (when the DSN rule applies) a complex above the mask
    if (sigmaBand) s.sigmaBandDeg[i] = sigmaBand(p.sun.azimuthDeg); // +/- sigma of the effective mask at the Sun azimuth; stays 0 without sigma
  });
  if (power) {
    const g = powerSeries(
      power,
      ev.samples.map((p) => ({
        azimuthDeg: p.sun.azimuthDeg,
        elevationDeg: p.sun.elevationDeg,
        distanceKm: p.sun.distanceKm,
        diskFraction: p.sun.diskFraction,
      })),
    );
    s.powerW.set(g.powerW);
    s.flatPowerW.set(g.flatW);
  }
  return s;
}

export function buildScenarioResult(
  eph: Ephemeris,
  req: ScenarioRequest,
  dsn: DsnSeries | null = null,
  mask: Mask | null = null,
  sigma: Sigma | null = null,
): ScenarioResult {
  const endMs = req.startMs + req.durationDays * DAY;
  if (!inEphemerisRange(eph, req.startMs) || !inEphemerisRange(eph, endMs)) {
    return emptyError(
      `The ephemeris covers ${new Date(eph.startMs).toISOString().slice(0, 10)} to ${new Date(eph.endMs).toISOString().slice(0, 10)}; this window is outside it.`,
    );
  }
  // A site with a usable terrain mask (right height, no gaps) is evaluated on it. Everything else uses the smooth-sphere model.
  const site = makeSite(req.latDeg, req.lonDegEast, req.heightM, req.rotation ?? undefined);
  const terrainHorizon = horizonFromMask(mask, req.heightM);
  // A mask from the global ~237 m elevation model (sites outside the polar DEM products) is real terrain but coarse: horizons near the site are smoothed.
  const coarse = terrainHorizon !== null && mask !== null && mask.meta.nearFieldResolutionM >= COARSE_TERRAIN_M;
  const horizon = terrainHorizon ?? new Horizon({ observerHeightM: req.heightM });
  const d = req.definitions;
  // With a usable sigma for this mask and height (data_masks.md §4/§8) the scenario is evaluated on the -sigma / nominal / +sigma masks (three-pass bounds): metrics get
  // lo/hi, events get a +/- time, and the verdict is judged on the conservative bound (so GO becomes possible). Without it nothing below changes.
  const sigmaRow = terrainHorizon ? sigmaRowFor(sigma, mask, req.heightM) : null;
  const sigmaAt = sigmaRow && mask ? (az: number) => sigmaAtAzimuth(sigmaRow, mask.binWidthDeg, az) : null;
  const input = { eph, site, horizon, startMs: req.startMs, durationDays: req.durationDays, definitions: d, dsn };
  const bw: BoundedEvaluation | null =
    sigmaRow && sigmaAt ? evaluateWithBounds(input, { sigmaDeg: sigmaRow, sigmaAtAzimuthDeg: sigmaAt }) : null;
  const ev = bw ? bw.nominal : evaluate(input);
  const series = buildSeries(ev, req.power ?? null, sigmaAt);

  const tScrub = Math.min(Math.max(req.tScrubMs, req.startMs), endMs);
  const cur = stateAt(eph, site, horizon, d, tScrub, dsn);
  const events: EventRecord[] = [...(bw?.sunEvents ?? ev.sunEvents), ...(bw?.earthEvents ?? ev.earthEvents)].sort(
    (a, b) => a.t - b.t,
  );

  // Answer Strip facts (D-14). "Sun up" = geometrically visible; the ops-elevation requirement is handled by the state.
  const geomSunUp = diskFractionVisible(cur.sun.diskFraction, d.sunDiskThreshold) && cur.sun.clearanceDeg >= 0;
  const sunAvailable = cur.sun.up;
  const sunNext = ev.sunEvents.find((e) => e.t > tScrub && e.type === (sunAvailable ? 'sunset' : 'shadowExit')) ?? null;
  const resume = ev.sunEvents.find((e) => e.t > tScrub && e.type === 'shadowExit') ?? null;
  const lastSunset = [...ev.sunEvents].reverse().find((e) => e.type === 'sunset' && e.t <= tScrub) ?? null;
  // "Link resumes (DSN)": Earth visible but the DSN-aware link is down => the first instant the link is up again (bisected like the events).
  let linkResumeT: number | null = null;
  if (ev.dsnApplied && cur.earth.up && !cur.linkUp) {
    const i = ev.times.findIndex((t, k) => t > tScrub && ev.linkUp[k]);
    if (i > 0)
      linkResumeT = refineTransition(
        (t) => stateAt(eph, site, horizon, d, t, dsn).linkUp,
        Math.max(ev.times[i - 1], tScrub),
        ev.times[i],
      );
  }
  const earthNext =
    ev.earthEvents.find((e) => e.t > tScrub && e.type === (cur.earth.up ? 'earthset' : 'earthrise')) ?? null;
  const m = ev.refined.metrics; // canonical demo metrics: refined-window durations (Gowri, G-10 final), not 2-minute sample counts
  const answer: AnswerState = deriveAnswerState({
    tScrub,
    sunElevDeg: cur.sun.elevationDeg,
    sunDiskPct: 100 * cur.sun.diskFraction,
    sunUp: geomSunUp,
    opsMinElevDeg: d.minSunElevationOpsDeg > 0 ? d.minSunElevationOpsDeg : null,
    sunNext,
    darkSinceMs: !geomSunUp ? (lastSunset?.t ?? null) : null,
    opsResumeT: resume?.t ?? null,
    earthElevDeg: cur.earth.elevationDeg,
    earthVisible: cur.earth.up,
    linkUp: cur.linkUp,
    dsnAware: ev.dsnApplied,
    earthNext,
    linkResumeT,
    windowSunlitPct: bw ? bw.metrics.sunlitPct : val(m.sunlitPct),
    windowLinkPct: bw ? bw.metrics.linkPct : val(m.linkPct),
  });

  const touch =
    req.touchdownMs != null && inEphemerisRange(eph, req.touchdownMs)
      ? stateAt(eph, site, horizon, d, req.touchdownMs, dsn)
      : null;

  const metrics: MetricSet = {
    sunElevationDeg: val(cur.sun.elevationDeg),
    sunClearanceDeg: val(cur.sun.clearanceDeg),
    sunDiskPct: val(100 * cur.sun.diskFraction),
    earthElevationDeg: val(cur.earth.elevationDeg),
    dteMarginDeg: val(cur.earth.clearanceDeg),
    sunlitPct: bw ? bw.metrics.sunlitPct : val(m.sunlitPct),
    linkPct: bw ? bw.metrics.linkPct : val(m.linkPct), // Earth visible AND, when the DSN rule applies, a complex above the mask
    longestNightH: bw ? bw.metrics.longestNightH : val(m.longestNightH),
    longestCommGapH: bw ? bw.metrics.longestCommGapH : val(m.longestCommGapH),
    opsHours: bw ? bw.metrics.opsHours : val(m.opsHours),
    energyPerDayWh: req.power ? val(energyPerDayWh(series.powerW, series.stepMs)) : nulls,
    sunElevationAtTouchdownDeg: touch ? val(touch.sun.elevationDeg) : null,
    padSlopeDeg: req.padSlopeDeg != null ? val(req.padSlopeDeg) : null,
    psrDistanceKm: req.psr
      ? { km: req.psr.distanceKm, bearingDeg: req.psr.bearingDeg, areaKm2: req.psr.areaKm2, source: req.psr.source }
      : null,
  };

  // Without terrain and sigma-qualified bounds, geometry metrics remain nominal and cannot confirm either pass or failure.
  const verdict = evaluateVerdict({
    metrics,
    windowHours: req.durationDays * 24,
    profile: req.profile,
    weights: req.weights,
    boundsKind: bw ? 'bounded' : 'insufficient',
    basis: terrainHorizon ? 'mask' : 'smooth-moon',
    verifiedRequirements: req.padSlopeDeg == null ? [] : ['slope'],
  });

  return {
    status: 'ready',
    error: null,
    meta: {
      siteId: req.siteId ?? 'custom',
      tier: req.tier,
      tierBadge:
        bw && sigma
          ? `Terrain mask · σ ${sigmaSourceLabel(sigma)}`
          : terrainHorizon
            ? `${coarse ? `Coarse terrain mask (${Math.round(mask!.meta.nearFieldResolutionM)} m)` : 'Terrain mask'} · σ unavailable`
            : 'Smooth-Moon horizon · terrain pending',
      sigmaSource:
        bw && sigma
          ? sigmaSourceLabel(sigma)
          : terrainHorizon
            ? `${coarse ? 'coarse terrain mask' : 'terrain mask'}, σ unavailable`
            : 'smooth-sphere estimate; terrain unavailable',
      snapDistanceKm: null,
      definitionsSummary: `Sun available = ≥${Math.round(d.sunDiskThreshold * 100)}% disk above the horizon${d.minSunElevationOpsDeg > 0 ? ` and ≥${d.minSunElevationOpsDeg}° elevation` : ''} @${req.heightM} m · Link = Earth ≥${d.earthMarginDeg}° above the horizon${ev.dsnApplied ? ` + DSN ≥${d.dsnMaskDeg}°` : ' (DSN not applied)'}`,
      dataVersions: req.dataVersions,
      mock: eph.mock,
    },
    verdict: verdict.verdict,
    verdictReasons: verdict.reasons,
    verdictRequirements: verdict.requirements,
    viability: { index: verdict.viabilityIndex, components: verdict.components },
    answer,
    events,
    windows: ev.refined.windows.map(toWindowRecord),
    series,
    metrics,
  };
}

export { DEFAULT_DEFINITIONS };
