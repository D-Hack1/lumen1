// Owner: Ebin
// "Why this number?" — deterministic, templated explanations filled from the CURRENT ScenarioResult. No model, no
// guessing: every sentence is either a fixed template or a value read from the result, and every ± sentence is guarded.
//
// The rule (agreed with Nived, 15 Nov): a "±" is only ever stated when `dtMs != null` (events) or `lo/hi != null`
// (metrics). Otherwise the line says plainly WHY there is none, quoting `meta.sigmaSource` / `meta.tierBadge`.
// Today's real-mode results have no σ and no ±, so today these lines are the "why there is none" kind; when σ lands
// the same templates start printing numbers with no change here. Nothing below hard-codes a rate or a σ: the clearance
// rate is derived from `series.sunClearanceDeg` (per `stepMs`), σ is read from `series.sigmaBandDeg`.
//
// Reads only fields Nived promised to keep stable: status, verdict, verdictReasons, verdictRequirements, metrics.*,
// events[], windows[], meta.{siteId,tier,tierBadge,sigmaSource,definitionsSummary}, series.*, answer.
import { fmtBounded, fmtDeg, fmtSpan } from '../../engine/format';
import type { Bounded, EventRecord, MetricSet, ScenarioResult } from '../../engine/types';
import type { KnowledgeEntry } from './knowledge';

export type WhyMetricKey =
  | 'sunElevationDeg'
  | 'sunClearanceDeg'
  | 'earthElevationDeg'
  | 'sunlitPct'
  | 'linkPct'
  | 'longestNightH'
  | 'longestCommGapH'
  | 'opsHours'
  | 'psrDistanceKm';
export type WhyTarget = WhyMetricKey | 'events';
/** What a tile's `onWhy` can hand us: any MetricSet key (Nived's prop type) or 'events'. Keys without a template get a generic card. */
export type WhyRequest = keyof MetricSet | 'events';

const TEMPLATED = new Set<string>(['sunElevationDeg', 'sunClearanceDeg', 'earthElevationDeg', 'sunlitPct', 'linkPct', 'longestNightH', 'longestCommGapH', 'opsHours', 'psrDistanceKm', 'events']);
export const hasTemplate = (k: string): k is WhyTarget => TEMPLATED.has(k);

/** Honest fallback for a metric we have no template for: its value and range from the result, and nothing else. */
export function explainGeneric(key: string, r: ScenarioResult): Why {
  const why: Why = { target: 'events', title: key, context: r.meta ? `for ${r.meta.siteId}` : null, lines: [], sources: [`result.metrics.${key}`] };
  const v = (r.metrics as unknown as Record<string, Bounded | null> | null)?.[key];
  why.lines.push(v && v.value != null ? { kind: 'value', text: `${key}: ${fmtBounded(v, 2)}.` } : { kind: 'value', text: 'No value yet for this scenario.' });
  why.lines.push({ kind: 'basis', text: 'There is no written explanation for this number yet. Try a term in the search box, or ask about Sun elevation, clearance, sunlight, link or the longest night.' });
  return why;
}

export interface WhyLine {
  kind: 'what' | 'value' | 'range' | 'why' | 'basis' | 'verdict';
  text: string;
}
export interface Why {
  target: WhyTarget;
  title: string;
  /** "for <siteId> · <tierBadge>" so the reader knows WHICH result this explains. */
  context: string | null;
  lines: WhyLine[];
  /** Where each statement comes from (result fields / glossary) — shown under the answer. */
  sources: string[];
}

const TITLE: Record<WhyTarget, string> = {
  sunElevationDeg: 'Sun elevation',
  sunClearanceDeg: 'Sun clearance',
  earthElevationDeg: 'Earth elevation',
  sunlitPct: 'Time in sunlight',
  linkPct: 'Time in radio contact',
  longestNightH: 'Longest dark stretch',
  longestCommGapH: 'Longest radio silence',
  opsHours: 'Operating hours',
  psrDistanceKm: 'Distance to the nearest permanently shadowed region',
  events: 'Event times and their ±',
};

/** Which verdict requirement a metric feeds (VerdictRequirement.id). */
const REQUIREMENT: Partial<Record<WhyMetricKey, 'sunlit' | 'link' | 'night'>> = { sunlitPct: 'sunlit', linkPct: 'link', longestNightH: 'night', longestCommGapH: 'link' };
/** Metrics whose meaning depends on the Sun/link availability definitions the user can edit. */
const USES_DEFINITIONS = new Set<WhyMetricKey>(['sunlitPct', 'linkPct', 'longestNightH', 'longestCommGapH', 'opsHours']);

const HOUR_MS = 3_600_000;

/** Which knowledge entry gives the plain-words meaning of each metric. Null = none exists yet (say nothing rather than guess). */
const METRIC_ENTRY: Record<WhyMetricKey, string | null> = {
  sunElevationDeg: 'term:sun-elevation',
  sunClearanceDeg: 'term:sun-clearance-disk',
  earthElevationDeg: 'help:how-is-earth-elevation-calculated',
  sunlitPct: 'help:how-is-the-sunlit-percentage-calculated',
  linkPct: 'help:how-is-the-link-to-earth-decided',
  longestNightH: 'term:longest-night',
  longestCommGapH: null,
  opsHours: 'term:ops-hours',
  psrDistanceKm: 'term:distance-to-psr',
};

/** Why there is no ±, from what the result itself says about its σ. Never invents a reason. */
export function reasonNoPm(r: ScenarioResult): string {
  const src = r.meta?.sigmaSource?.trim();
  if (!r.meta) return 'no result is loaded yet';
  const tier = r.meta.tierBadge ? ` (${r.meta.tierBadge})` : '';
  if (src && /pending/i.test(src)) return `terrain uncertainty (σ) isn't available for this site yet — σ source: “${src}”${tier}`;
  if (src && /smooth/i.test(src)) return `this site uses a smooth-sphere estimate because terrain data is unavailable — σ source: “${src}”${tier}`;
  if (src) return `no bounds were computed for it — σ source: “${src}”${tier}`;
  return `no bounds were computed for it${tier}`;
}

function sampleIndex(r: ScenarioResult): number | null {
  const s = r.series;
  if (!s || s.sunElevDeg.length < 3) return null;
  const t = r.answer?.tScrub ?? s.t0;
  return Math.max(1, Math.min(s.sunElevDeg.length - 2, Math.round((t - s.t0) / s.stepMs)));
}

/** Clearance rate in °/h around the scrub time, DERIVED from the series (central difference). Null if not finite. */
export function clearanceRateDegPerH(r: ScenarioResult): number | null {
  const s = r.series;
  const i = sampleIndex(r);
  if (!s || i == null) return null;
  const hours = (2 * s.stepMs) / HOUR_MS;
  const rate = (s.sunClearanceDeg[i + 1] - s.sunClearanceDeg[i - 1]) / hours;
  return Number.isFinite(rate) ? rate : null;
}

/** σ of the effective mask at the scrub time (series.sigmaBandDeg). Null unless it is a real, positive number. */
export function sigmaDeg(r: ScenarioResult): number | null {
  const s = r.series;
  const i = sampleIndex(r);
  if (!s || i == null) return null;
  const v = s.sigmaBandDeg[i];
  return Number.isFinite(v) && v > 0 ? v : null;
}

const fix = (x: number, d = 1) => (x < 0 ? '−' : '') + Math.abs(x).toFixed(d);

function eventLines(r: ScenarioResult): WhyLine[] {
  const out: WhyLine[] = [];
  const upcoming: EventRecord[] = r.events.filter((e) => e.type === 'sunset' || e.type === 'earthset' || e.type === 'shadowExit' || e.type === 'earthrise').slice(0, 3);
  const t0 = r.answer?.tScrub ?? r.series?.t0 ?? 0;
  if (upcoming.length === 0) {
    out.push({ kind: 'why', text: 'There is no sunset, Earthset or shadow exit inside the scenario window, so there is no event time to attach a ± to.' });
    return out;
  }
  for (const e of upcoming) {
    const when = fmtSpan(e.t - t0);
    if (e.dtMs == null) {
      out.push({ kind: 'range', text: `${label(e.type)} in ${when}: no ± shown — ${reasonNoPm(r)}.` });
    } else {
      const how = e.dtMethod === 'exact' ? 're-solved on the horizon shifted by its σ (both ways) and taking half the spread' : 'the horizon σ divided by how fast the Sun’s clearance is changing';
      out.push({ kind: 'range', text: `${label(e.type)} in ${when} ± ${fmtSpan(e.dtMs)} — ${how} (${e.dtMethod} method).` });
    }
    if (e.grazing) {
      const why =
        e.grazingReason === 'rate'
          ? 'the clearance changes very slowly there, so a tiny horizon error moves the time a lot'
          : e.grazingReason === 'dt_limit'
            ? 'the ± grew past the limit for a reliable time'
            : e.grazingReason === 'vanishes'
              ? 'the Sun only skims the horizon and may not actually set'
              : 'the Sun skims the horizon';
      out.push({ kind: 'why', text: `${label(e.type)} is marked “grazing”: ${why}. Its time is shown as a range, not a point.` });
    }
  }
  const rate = clearanceRateDegPerH(r);
  const sig = sigmaDeg(r);
  if (rate != null && sig != null && Math.abs(rate) > 1e-6) {
    out.push({ kind: 'why', text: `Here the clearance is changing at ${fix(rate, 3)} °/h and the horizon σ is ${sig.toFixed(2)}°, so a one-σ horizon error moves an event by about ${fix(sig / Math.abs(rate), 1)} h (σ ÷ |rate|).` });
  } else if (rate != null) {
    out.push({ kind: 'why', text: `The clearance is changing at ${fix(rate, 3)} °/h here (derived from the series). No σ is available to turn that into a time error: ${reasonNoPm(r)}.` });
  }
  return out;
}

function label(t: EventRecord['type']): string {
  return { sunset: 'Sunset', earthset: 'Earthset', shadowExit: 'Shadow exit', earthrise: 'Earthrise' }[t];
}

function boundedLine(key: WhyMetricKey, b: Bounded | null, r: ScenarioResult, unit: string, digits: number): WhyLine[] {
  if (!b || b.value == null) return [{ kind: 'value', text: 'No value yet for this scenario.' }];
  const lines: WhyLine[] = [{ kind: 'value', text: `${TITLE[key]}: ${fmtBounded(b, digits, unit)}.` }];
  if (b.lo != null && b.hi != null && !(b.lo === b.value && b.hi === b.value)) {
    lines.push({ kind: 'range', text: `The range [${fmtBounded({ value: b.lo, lo: null, hi: null }, digits, unit)}–${fmtBounded({ value: b.hi, lo: null, hi: null }, digits, unit)}] comes from the horizon uncertainty (σ source: “${r.meta?.sigmaSource ?? 'n/a'}”).` });
  } else {
    lines.push({ kind: 'range', text: `No ± range: ${reasonNoPm(r)}.` });
  }
  return lines;
}

function metricLines(key: WhyMetricKey, r: ScenarioResult): WhyLine[] {
  const m = r.metrics;
  if (!m) return [];
  switch (key) {
    case 'sunElevationDeg': {
      const lines = boundedLine(key, m.sunElevationDeg, r, '°', 1);
      const i = sampleIndex(r);
      const clr = i != null && r.series ? r.series.sunClearanceDeg[i] : null;
      if (r.answer && clr != null && Number.isFinite(clr)) {
        const horizon = r.answer.sun.elevDeg - clr;
        lines.push({ kind: 'why', text: `Sun elevation is measured to the Sun’s centre. The terrain horizon in the Sun’s direction is ${fmtDeg(horizon, 2)} (elevation ${fmtDeg(r.answer.sun.elevDeg, 2)} minus clearance ${fmtDeg(clr, 2)}), so the Sun is ${clr >= 0 ? 'above' : 'below'} it by ${Math.abs(clr).toFixed(2)}°.` });
      }
      return lines;
    }
    case 'sunClearanceDeg': {
      const lines = boundedLine(key, m.sunClearanceDeg, r, '°', 2);
      lines.push({ kind: 'why', text: 'Clearance is how far the Sun’s disk is above the terrain horizon in its direction (negative = blocked). It is what decides sunrise and sunset, and how fast it changes sets how large the timing ± is.' });
      return [...lines, ...eventLines(r)];
    }
    case 'earthElevationDeg':
      return [...boundedLine(key, m.earthElevationDeg, r, '°', 1), { kind: 'why', text: 'Earth counts as visible when its disk clears the terrain horizon in its direction; radio contact additionally needs a Deep Space Network station to see the Moon.' }];
    case 'sunlitPct':
      return boundedLine(key, m.sunlitPct, r, '%', 0);
    case 'linkPct':
      return boundedLine(key, m.linkPct, r, '%', 0);
    case 'longestNightH':
      return boundedLine(key, m.longestNightH, r, ' h', 0);
    case 'longestCommGapH':
      return boundedLine(key, m.longestCommGapH, r, ' h', 0);
    case 'opsHours':
      return boundedLine(key, m.opsHours, r, ' h', 0);
    case 'psrDistanceKm': {
      const p = m.psrDistanceKm;
      if (!p) return [{ kind: 'value', text: 'No permanently shadowed region distance for this site.' }];
      return [
        { kind: 'value', text: `Nearest permanently shadowed region: ${p.km.toFixed(1)} km away, bearing ${Math.round(p.bearingDeg)}°, area ${p.areaKm2.toFixed(2)} km².` },
        { kind: 'basis', text: p.source === 'derived' ? 'Source: derived from the illumination data (not a published figure).' : 'Source: published.' },
      ];
    }
  }
}

/**
 * Explain one metric (or the event ± in general) for the current result. `knowledge` is optional: if given, the
 * glossary term that lists this metric under `metrics` supplies the plain-words definition and its source.
 */
export function explain(target: WhyTarget, r: ScenarioResult, knowledge: readonly KnowledgeEntry[] = []): Why {
  const why: Why = { target, title: TITLE[target], context: null, lines: [], sources: [] };
  if (r.status !== 'ready' || !r.metrics || !r.meta) {
    why.lines.push({ kind: 'value', text: r.status === 'error' ? `The result failed to compute: ${r.error ?? 'unknown error'}.` : 'The result is still being computed — ask again in a moment.' });
    return why;
  }
  why.context = `for ${r.meta.siteId}${r.meta.tierBadge ? ` · ${r.meta.tierBadge}` : ''}${r.meta.mock ? ' · MOCK DATA, not real results' : ''}`;

  if (target !== 'events') {
    // Explicit metric → entry map. (The glossary lists some metrics under several terms — e.g. earthElevationDeg under
    // "Libration" first — so "first entry that mentions the metric" gave the WRONG definition. Never search by metric.)
    const id = METRIC_ENTRY[target];
    const entry = id ? knowledge.find((k) => k.id === id) : undefined;
    if (entry) {
      why.lines.push({ kind: 'what', text: entry.kind === 'term' ? entry.summary : entry.body });
      why.sources.push(entry.kind === 'term' ? `${entry.source} (glossary: ${entry.title})` : `${entry.source} (help: ${entry.title})`);
    }
  }

  why.lines.push(...(target === 'events' ? eventLines(r) : metricLines(target, r)));
  why.sources.push(target === 'events' ? 'result.events, result.series' : `result.metrics.${target}`);

  if (target !== 'events' && USES_DEFINITIONS.has(target) && r.meta.definitionsSummary) {
    why.lines.push({ kind: 'basis', text: `Definitions used: ${r.meta.definitionsSummary}` });
    why.sources.push('result.meta.definitionsSummary');
  }

  const req = target !== 'events' ? REQUIREMENT[target as WhyMetricKey] : undefined;
  if (req && r.verdict !== 'PENDING') {
    const st = r.verdictRequirements?.find((q) => q.id === req)?.status;
    if (st) why.lines.push({ kind: 'verdict', text: `Verdict check “${req}”: ${st}.` });
    for (const reason of r.verdictReasons.slice(0, 3)) why.lines.push({ kind: 'verdict', text: reason });
    why.sources.push('result.verdict, result.verdictReasons');
  }

  if (r.meta.sigmaSource) why.sources.push(`σ source: ${r.meta.sigmaSource}`);
  return why;
}

// ---- turning a typed question into a target ("why is this ± so big?" → events)
const KEYWORDS: readonly [RegExp, WhyTarget][] = [
  [/±|plus.?minus|uncertain|sigma|σ|error bar|sunset|sunrise|earthset|earthrise|shadow exit|event/, 'events'],
  [/clearance/, 'sunClearanceDeg'],
  [/earth.*(elevation|angle|high)|elevation.*earth/, 'earthElevationDeg'],
  [/sun.*elevation|elevation|how high.*sun/, 'sunElevationDeg'],
  [/sunlit|sunlight|time in sun|in the sun/, 'sunlitPct'],
  [/silence|comm.*gap|gap/, 'longestCommGapH'],
  [/night|dark/, 'longestNightH'],
  [/link|contact|dsn|radio/, 'linkPct'],
  [/ops|operating/, 'opsHours'],
  [/psr|shadowed|ice/, 'psrDistanceKm'],
];

/** Returns a target only for "why …"/"how come …"/"explain …" style questions that name something we can explain. */
export function detectWhy(query: string): WhyTarget | null {
  const q = query.toLowerCase();
  if (!/\b(why|how come|how is|how was|explain|where does)\b/.test(q)) return null;
  for (const [re, target] of KEYWORDS) if (re.test(q)) return target;
  return null;
}
