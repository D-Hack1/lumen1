// Owner: Nived
// Deterministic FAKE results (N-3). Shapes match types.ts exactly so UI can be built now.
// Replaced by the real worker output at N-5..N-10. Nothing here is physics.
import { deriveAnswerState } from '../engine/answerState';
import type {
  AnswerState,
  Bounded,
  CompareResults,
  EventRecord,
  MetricSet,
  QuickAnswerInput,
  QuickAnswerResult,
  ScanCandidate,
  ScanParams,
  ScenarioResult,
  Series,
  SiteRecord,
  Verdict,
  WindowRecord,
} from '../engine/types';

const H = 3_600_000;
const D = 24 * H;
const STEP = 30 * 60_000;
const SYNODIC = 29.530589 * D;

export const MOCK_LANDING = Date.UTC(2025, 2, 6, 17, 28, 50);

const b = (value: number, spread = 0): Bounded => ({ value, lo: value - spread, hi: value + spread });
/** For quantities that cannot be negative (hours, percent, Wh): the lower bound is clamped at 0. */
const nn = (value: number, spread = 0): Bounded => ({ value, lo: Math.max(0, value - spread), hi: value + spread });

export function mockScenarioResult(
  site: Pick<SiteRecord, 'id' | 'tier' | 'nearFieldResM' | 'sigmaSource' | 'psr' | 'padSlopeDeg' | 'mock'> | null,
  landingUtc = MOCK_LANDING,
  durationDays = 14,
  tScrub = landingUtc + 2 * D,
  seedPhase = 0,
  opsMinElevDeg = 0,
): ScenarioResult {
  const tier = site?.tier ?? 'A';
  const n = Math.round((durationDays * D) / STEP) + 1;
  const f = (): Float32Array => new Float32Array(n);
  const u = (): Uint8Array => new Uint8Array(n);
  const s: Series = {
    t0: landingUtc, stepMs: STEP, sunElevDeg: f(), sunAzDeg: f(), sunClearanceDeg: f(), sunDiskPct: f(), earthElevDeg: f(),
    earthAzDeg: f(), earthClearanceDeg: f(), earthDiskPct: f(), earthRangeKm: f(), powerW: f(), flatPowerW: f(), sunUp: u(), earthUp: u(), linkUp: u(), sigmaBandDeg: f(),
  };
  const mask = tier === 'C' ? -0.09 : 1.0;
  for (let i = 0; i < n; i++) {
    const t = i * STEP;
    const sunEl = 1.2 + 1.6 * Math.sin((2 * Math.PI * t) / SYNODIC + seedPhase);
    const earthEl = 6 + 5 * Math.sin((2 * Math.PI * t) / (27.3 * D) + 1 + seedPhase);
    s.sunElevDeg[i] = sunEl;
    s.sunAzDeg[i] = (((t / SYNODIC) * 360 + 90) % 360 + 360) % 360;
    s.sunClearanceDeg[i] = sunEl - mask;
    s.sunDiskPct[i] = Math.max(0, Math.min(100, 50 + (100 * (sunEl - mask)) / 0.53));
    s.earthElevDeg[i] = earthEl;
    s.earthAzDeg[i] = (((t / (27.3 * D)) * 40 + 20) % 360 + 360) % 360;
    s.earthClearanceDeg[i] = earthEl - (tier === 'C' ? -0.09 : 2.0);
    s.earthRangeKm[i] = 381_000 + 22_000 * Math.sin((2 * Math.PI * t) / (27.55 * D) + seedPhase); // within the real Earth-Moon range
    s.earthDiskPct[i] = s.earthClearanceDeg[i] > 0.27 ? 100 : s.earthClearanceDeg[i] < -0.27 ? 0 : 50;
    s.sunUp[i] = s.sunDiskPct[i] >= 50 ? 1 : 0;
    s.earthUp[i] = s.earthDiskPct[i] >= 50 && s.earthClearanceDeg[i] >= 1 ? 1 : 0;
    s.linkUp[i] = s.earthUp[i] && Math.sin((2 * Math.PI * t) / D + seedPhase) > -0.3 ? 1 : 0;
    s.powerW[i] = s.sunUp[i] ? 120 * Math.max(0.05, Math.sin((s.sunElevDeg[i] * Math.PI) / 180) * 8) * (s.sunDiskPct[i] / 100) : 0;
    s.flatPowerW[i] = s.powerW[i] * 0.97;
    s.sigmaBandDeg[i] = tier === 'C' ? 0 : tier === 'B' ? 0.5 : 0.1;
  }

  const dtMs = tier === 'C' ? null : tier === 'B' ? 9 * H : 5 * H;
  const events: EventRecord[] = [];
  const windows: WindowRecord[] = [];
  const track = (up: Uint8Array, up_t: 'sunset' | 'earthset', down_t: 'shadowExit' | 'earthrise', wtype: 'sun' | 'link', elev: Float32Array) => {
    let start = up[0] ? 0 : -1;
    for (let i = 1; i < n; i++) {
      if (up[i - 1] && !up[i]) {
        events.push(ev(up_t, landingUtc + i * STEP, dtMs, i % 2 === 0 && tier !== 'C'));
        if (start >= 0) windows.push(win(wtype, start, i, elev));
        start = -1;
      } else if (!up[i - 1] && up[i]) {
        events.push(ev(down_t, landingUtc + i * STEP, dtMs, false));
        start = i;
      }
    }
    if (start >= 0) windows.push(win(wtype, start, n - 1, elev, true));
  };
  const ev = (type: EventRecord['type'], t: number, dt: number | null, grazing: boolean): EventRecord => ({
    type, t, dtMs: dt, grazing, grazingReason: grazing ? 'rate' : null, dtMethod: 'fast',
  });
  const win = (type: WindowRecord['type'], i0: number, i1: number, elev: Float32Array, partialEnd = false): WindowRecord => {
    const hours = ((i1 - i0) * STEP) / H;
    let peak = -90;
    for (let i = i0; i <= i1; i++) peak = Math.max(peak, elev[i]);
    return {
      type, start: landingUtc + i0 * STEP, end: landingUtc + i1 * STEP, startPmMs: dtMs, endPmMs: dtMs,
      durationH: { value: hours, lo: tier === 'C' ? hours : hours - 8, hi: tier === 'C' ? hours : hours + 8 },
      peakElevDeg: peak, flags: { grazing: false, partialStart: i0 === 0, partialEnd },
    };
  };
  track(s.sunUp, 'sunset', 'shadowExit', 'sun', s.sunElevDeg);
  track(s.earthUp, 'earthset', 'earthrise', 'link', s.earthElevDeg);
  events.sort((a, c) => a.t - c.t);

  const idx = Math.max(0, Math.min(n - 1, Math.round((tScrub - landingUtc) / STEP)));
  const nextOf = (types: string[]) => events.find((e) => e.t > tScrub && types.includes(e.type)) ?? null;
  const sunUp = !!s.sunUp[idx];
  const earthUp = !!s.earthUp[idx];
  const sunNext = sunUp ? nextOf(['sunset']) : nextOf(['shadowExit']);
  const earthNext = earthUp ? nextOf(['earthset']) : nextOf(['earthrise']);
  const frac = (arr: Uint8Array) => (100 * arr.reduce((a, v) => a + v, 0)) / n;
  const sunlit = frac(s.sunUp);
  const link = frac(s.linkUp);
  const spread = tier === 'C' ? 0 : tier === 'B' ? 12 : 5;
  let darkIdx = idx;
  while (darkIdx > 0 && !s.sunUp[darkIdx]) darkIdx--;
  const linkIdx = (() => {
    for (let i = idx; i < n; i++) if (s.linkUp[i]) return i;
    return -1;
  })();
  const answer: AnswerState = deriveAnswerState({
    tScrub, sunElevDeg: s.sunElevDeg[idx], sunDiskPct: s.sunDiskPct[idx], sunUp, opsMinElevDeg: opsMinElevDeg || null,
    sunNext, darkSinceMs: !sunUp && darkIdx > 0 ? landingUtc + darkIdx * STEP : null,
    opsResumeT: null, earthElevDeg: s.earthElevDeg[idx], earthVisible: s.earthDiskPct[idx] >= 50, linkUp: !!s.linkUp[idx],
    dsnAware: true, earthNext, linkResumeT: linkIdx >= 0 ? landingUtc + linkIdx * STEP : null,
    windowSunlitPct: { value: sunlit, lo: Math.max(0, sunlit - spread), hi: Math.min(100, sunlit + spread) },
    windowLinkPct: { value: link, lo: Math.max(0, link - spread), hi: Math.min(100, link + spread) },
  });

  const longest = (up: Uint8Array, want: 0 | 1) => {
    let best = 0, run = 0;
    for (let i = 0; i < n; i++) {
      if (up[i] === want) {
        run++;
        best = Math.max(best, run);
      } else {
        run = 0;
      }
    }
    return (best * STEP) / H;
  };
  const sp = (x: number) => (tier === 'C' ? 0 : x);
  const metrics: MetricSet = {
    sunElevationDeg: b(s.sunElevDeg[idx], sp(0.1)),
    sunClearanceDeg: b(s.sunClearanceDeg[idx], sp(0.1)),
    sunDiskPct: { value: s.sunDiskPct[idx], lo: Math.max(0, s.sunDiskPct[idx] - sp(4)), hi: Math.min(100, s.sunDiskPct[idx] + sp(4)) },
    earthElevationDeg: b(s.earthElevDeg[idx], sp(0.1)),
    dteMarginDeg: b(s.earthClearanceDeg[idx] - 1, sp(0.1)),
    sunlitPct: answer.windowSunlitPct,
    linkPct: answer.windowLinkPct,
    longestNightH: nn(longest(s.sunUp, 0), sp(8)),
    longestCommGapH: nn(longest(s.linkUp, 0), sp(6)),
    opsHours: nn(((s.sunUp.reduce((a, v, i) => a + (v && s.linkUp[i] ? 1 : 0), 0)) * STEP) / H, sp(6)),
    energyPerDayWh: nn(260, sp(40)),
    sunElevationAtTouchdownDeg: site && tier !== 'pending' ? b(s.sunElevDeg[0], sp(0.1)) : null,
    padSlopeDeg: site?.padSlopeDeg != null ? b(site.padSlopeDeg, 1) : null,
    psrDistanceKm: site?.psr ? { km: site.psr.distanceKm, bearingDeg: site.psr.bearingDeg, areaKm2: site.psr.areaKm2, source: site.psr.source } : null,
  };

  const verdict: Verdict = tier === 'pending' ? 'PENDING' : sunlit > 40 && link > 25 ? 'GO' : sunlit > 25 ? 'MARGINAL' : 'NO-GO';
  const nf = site?.nearFieldResM;
  return {
    status: 'ready', error: null,
    meta: {
      siteId: site?.id ?? 'mock', tier,
      tierBadge: tier === 'A' ? `Tier A · near-field ${nf ?? '?'} m` : tier === 'B' ? 'Tier B · snapped 0.8 km' : tier === 'C' ? 'Tier C · no terrain' : 'pending',
      sigmaSource: site?.sigmaSource ?? 'default', snapDistanceKm: tier === 'B' ? 0.8 : null,
      definitionsSummary: 'Sun available = ≥50% disk above terrain @2 m · Link = Earth ≥1° above terrain + DSN ≥10° (MOCK)',
      dataVersions: { ephem: 1, catalog: 1, mock: 1 }, mock: true,
    },
    verdict, verdictReasons: ['MOCK verdict: placeholder thresholds'], viability: null, answer, events, windows, series: s, metrics,
  };
}

/** The row fields the mock needs (structural, so this file does not import the store). */
interface MockCompareRow {
  id: string;
  site: { kind: 'site'; id: string } | { kind: 'point'; lat: number; lon: number };
  landingUtc: number;
  slipDays?: number;
  baseline: boolean;
}

/**
 * Fake compare set. With no `rows` it is the legacy three-site set. With rows it follows them (one result per row, in order, at the row's effective landing =
 * landing + global slip + row slip), so adding a 4th row, removing one, slipping a row or moving the baseline all change what the UI shows in mock mode.
 */
export function mockCompare(sites: SiteRecord[], rows?: readonly MockCompareRow[], globalSlipDays = 0): CompareResults {
  const picked: Array<{ id: string; site: SiteRecord; landing: number; baseline: boolean }> = rows
    ? rows.map((r, i) => ({
        id: r.id,
        site: (r.site.kind === 'site' ? sites.find((x) => x.id === (r.site as { id: string }).id) : undefined) ?? sites[i % sites.length],
        landing: r.landingUtc + (globalSlipDays + (r.slipDays ?? 0)) * D,
        baseline: r.baseline,
      }))
    : sites.slice(0, 3).map((site, i) => ({ id: 'ABCD'[i], site, landing: MOCK_LANDING, baseline: i === 0 }));
  const out = picked.map((p, i) => ({
    scenarioId: p.id,
    result: mockScenarioResult(p.site, p.landing, 14, p.landing + 2 * D, i * 0.8),
    deltaVsBaseline: {} as CompareResults['rows'][number]['deltaVsBaseline'],
  }));
  const baselineId = picked.find((p) => p.baseline)?.id ?? out[0]?.scenarioId ?? null;
  const base = out.find((r) => r.scenarioId === baselineId)?.result.metrics;
  for (const r of out) {
    const m = r.result.metrics;
    if (m && base) {
      r.deltaVsBaseline = {
        sunlitPct: (m.sunlitPct.value ?? 0) - (base.sunlitPct.value ?? 0),
        linkPct: (m.linkPct.value ?? 0) - (base.linkPct.value ?? 0),
        longestNightH: (m.longestNightH.value ?? 0) - (base.longestNightH.value ?? 0),
      };
    }
  }
  return { status: 'ready', rows: out, baselineId };
}

export function mockScan(params: ScanParams, sites: SiteRecord[]): ScanCandidate[] {
  const ids = params.siteIds ?? sites.slice(0, 1).map((s) => s.id);
  const out: ScanCandidate[] = [];
  for (const id of ids) {
    for (let d = -params.plusMinusDays; d <= params.plusMinusDays; d++) {
      const vi = 50 + 40 * Math.sin((d + id.length) / 4.7);
      const verdict: Verdict = vi > 75 ? 'GO' : vi > 55 ? 'MARGINAL' : 'NO-GO';
      out.push({
        siteId: id, landingUtc: params.baseLandingUtc + d * D, viabilityIndex: vi, verdict, provisional: true, boundsStatus: 'nominal',
        sunlitPct: b(vi, 5), linkPct: b(vi * 0.7, 5), longestNightH: nn(100 - vi, 8),
      });
    }
  }
  return out.sort((a, c) => c.viabilityIndex - a.viabilityIndex);
}

export function mockQuickAnswer(input: QuickAnswerInput, sites: SiteRecord[]): QuickAnswerResult {
  const match = sites.find((s) => Math.abs(s.lat - input.lat) < 0.05 && Math.abs(s.lon - input.lon) < 0.05) ?? null;
  const tier = match?.tier ?? (input.lat < -80 ? 'B' : 'C');
  const r = mockScenarioResult(match, input.utc, input.durationDays, input.utc);
  const m = r.metrics!;
  const a = r.answer!;
  const pick = (t: EventRecord['type']) => r.events.find((e) => e.type === t) ?? null;
  const tierBadge = tier === 'A' ? `Tier A · ${match?.name}` : tier === 'B' ? 'Tier B · snapped 0.8 km' : 'Tier C · no terrain';
  return {
    status: 'ready', error: null, tier, tierBadge, matchedSiteId: match?.id ?? null, snapDistanceKm: tier === 'B' ? 0.8 : null,
    sunElevDeg: a.sun.elevDeg, sunAzDeg: r.series!.sunAzDeg[0], sunDiskPct: a.sun.diskPct, sunUp: a.sun.up,
    earthElevDeg: a.earth.elevDeg, earthAzDeg: r.series!.earthAzDeg[0], earthRangeKm: 384_400, linkUp: a.earth.linkUp,
    nextSunset: pick('sunset'), nextEarthset: pick('earthset'), nextShadowExit: pick('shadowExit'),
    sunlitPct: m.sunlitPct, linkPct: m.linkPct, psrDistanceKm: m.psrDistanceKm?.km ?? null,
    text: `MOCK quick answer for ${input.lat.toFixed(3)}, ${input.lon.toFixed(3)} (${tierBadge}): Sun ${a.sun.elevDeg.toFixed(1)}°, Earth ${a.earth.elevDeg.toFixed(1)}°, sunlit ${m.sunlitPct.value?.toFixed(0)}%, link ${m.linkPct.value?.toFixed(0)}%.`,
  };
}
