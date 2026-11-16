import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ScenarioResult, Series } from '../../engine/types';
import { clearanceRateDegPerH, detectWhy, explain, explainGeneric, hasTemplate, reasonNoPm, sigmaDeg } from './why';
import type { KnowledgeEntry } from './knowledge';

const H = 3_600_000;
const STEP = 2 * 60_000; // the real series grid: 2 minutes

/** Synthetic fixture (not any real site's numbers). 11 samples; clearance rises 0.02 °/h (so +0.00066…°/step); σ band constant (or 0). */
function series(sigma: number, ratePerH = 0.02): Series {
  const n = 11;
  const f = (g: (i: number) => number) => Float32Array.from({ length: n }, (_, i) => g(i));
  const z = f(() => 0);
  return {
    t0: 0,
    stepMs: STEP,
    sunElevDeg: f((i) => 1 + (i * STEP * ratePerH) / H),
    sunAzDeg: z,
    sunClearanceDeg: f((i) => 0.4 + (i * STEP * ratePerH) / H),
    sunDiskPct: z,
    earthElevDeg: z,
    earthAzDeg: z,
    earthClearanceDeg: z,
    earthDiskPct: z,
    earthRangeKm: z,
    powerW: z,
    sunUp: new Uint8Array(n),
    earthUp: new Uint8Array(n),
    linkUp: new Uint8Array(n),
    sigmaBandDeg: f(() => sigma),
  } as unknown as Series;
}

const b = (value: number | null, lo: number | null = null, hi: number | null = null) => ({ value, lo, hi });

function result(over: Partial<ScenarioResult> & { sigmaSource?: string; dtMs?: number | null; sigma?: number } = {}): ScenarioResult {
  const { sigmaSource = 'terrain mask, σ pending', dtMs = null, sigma = 0, ...rest } = over;
  return {
    status: 'ready',
    error: null,
    meta: { siteId: 'test_site', tier: 'A', tierBadge: 'Terrain mask · σ pending', sigmaSource, snapDistanceKm: null, definitionsSummary: 'Sun ≥ 50% disk; link = Earth + DSN', dataVersions: {}, mock: false },
    verdict: 'MARGINAL',
    verdictReasons: ['Sunlit 62% is below the 70% requirement'],
    verdictRequirements: [{ id: 'sunlit', status: 'marginal' }],
    viability: null,
    answer: { tScrub: 5 * STEP, sun: { elevDeg: 1.1, diskPct: 100, up: true, state: 'sunsetIn', nextEventT: 5 * H, nextEventPmMs: dtMs, grazing: false, darkForMs: null, opsMinElevDeg: null }, earth: { elevDeg: 5, visible: true, linkUp: true, state: 'earthsetIn', nextEventT: 9 * H, nextEventPmMs: null, grazing: false }, windowSunlitPct: b(62), windowLinkPct: b(70) },
    events: [{ type: 'sunset', t: 5 * H, dtMs, grazing: false, grazingReason: null, dtMethod: 'fast' }],
    windows: [],
    series: series(sigma),
    metrics: {
      sunElevationDeg: b(1.1),
      sunClearanceDeg: b(0.45),
      sunDiskPct: b(100),
      earthElevationDeg: b(5),
      dteMarginDeg: b(3),
      sunlitPct: b(62),
      linkPct: b(70),
      longestNightH: b(30),
      longestCommGapH: b(12),
      opsHours: b(200),
      energyPerDayWh: b(1000),
      sunElevationAtTouchdownDeg: null,
      padSlopeDeg: null,
      psrDistanceKm: { km: 12.3, bearingDeg: 190, areaKm2: 2.5, source: 'derived' },
    },
    ...rest,
  } as ScenarioResult;
}
const text = (w: ReturnType<typeof explain>) => w.lines.map((l) => l.text).join('\n');

describe('derived numbers (never hard-coded)', () => {
  it('clearance rate comes from the series: 0.02 °/h', () => expect(clearanceRateDegPerH(result())!).toBeCloseTo(0.02, 4));
  it('σ is null unless it is a real positive number', () => {
    expect(sigmaDeg(result({ sigma: 0 }))).toBeNull();
    expect(sigmaDeg(result({ sigma: 0.1 }))).toBeCloseTo(0.1, 6);
  });
});

describe('today’s real-mode result: no σ, no ± → says WHY, invents nothing', () => {
  const w = explain('sunClearanceDeg', result());
  it('has no number after a ±', () => expect(text(w)).not.toMatch(/±\s*\d/));
  it('quotes the σ source and the tier badge', () => {
    expect(text(w)).toContain('terrain mask, σ pending');
    expect(text(w)).toContain('Terrain mask · σ pending');
    expect(text(w)).toContain("isn't available for this site yet");
  });
  it('still reports the derived clearance rate, labelled as derived', () => expect(text(w)).toMatch(/0\.020 °\/h .*derived from the series/));
  it('metric ranges say there is none', () => expect(text(explain('sunlitPct', result()))).toContain('No ± range:'));
});

describe('when σ lands: the same templates fill in (Nived’s example, computed not copied)', () => {
  // σ = 0.1°, rate = 0.02 °/h  →  σ ÷ |rate| = 5 h; dtMs = 5 h
  const r = result({ sigma: 0.1, dtMs: 5 * H, sigmaSource: 'default' });
  const w = explain('events', r);
  it('prints ± only now, from dtMs', () => expect(text(w)).toMatch(/Sunset in 5 h ± 5 h/));
  it('derives "σ ÷ rate" from the series', () => expect(text(w)).toMatch(/horizon σ is 0\.10°, so .* about 5\.0 h/));
  it('names the timing method', () => expect(text(w)).toContain('fast method'));
});

describe('grazing and exact method', () => {
  it('explains a grazing event by its reason', () => {
    const r = result({ dtMs: 3 * H });
    r.events = [{ type: 'sunset', t: 5 * H, dtMs: 3 * H, grazing: true, grazingReason: 'rate', dtMethod: 'exact' }];
    const t = text(explain('events', r));
    expect(t).toContain('grazing');
    expect(t).toContain('changes very slowly');
    expect(t).toContain('exact method');
  });
});

describe('metric ranges when bounds exist', () => {
  it('prints [lo–hi] only when lo/hi are numbers', () => {
    const r = result();
    r.metrics!.sunlitPct = b(62, 55, 68);
    const t = text(explain('sunlitPct', r));
    expect(t).toContain('[55%–68%]');
    expect(t).not.toContain('No ± range');
  });
});

describe('verdict and definitions are quoted, not paraphrased', () => {
  it('quotes the engine’s verdict reasons and requirement status', () => {
    const t = text(explain('sunlitPct', result()));
    expect(t).toContain('Sunlit 62% is below the 70% requirement');
    expect(t).toContain('Verdict check “sunlit”: marginal');
    expect(t).toContain('Definitions used: Sun ≥ 50% disk; link = Earth + DSN');
  });
  it('does not quote verdict reasons while the verdict is PENDING', () => {
    expect(text(explain('sunlitPct', result({ verdict: 'PENDING' })))).not.toContain('requirement');
  });
});

describe('glossary text is used when provided', () => {
  const term: KnowledgeEntry = { id: 'term:sun-elevation', kind: 'term', title: 'Sun elevation', summary: 'The angle of the Sun’s centre above the local horizontal plane.', body: '', source: 'PLAN_FINAL.md §8.10', metrics: ['sunElevationDeg'] };
  it('adds the plain-words definition and its source', () => {
    const w = explain('sunElevationDeg', result(), [term]);
    expect(w.lines[0]).toEqual({ kind: 'what', text: term.summary });
    expect(w.sources.join(' ')).toContain('PLAN_FINAL.md §8.10');
  });
});

describe('not ready', () => {
  it('says so instead of guessing', () => {
    expect(text(explain('sunlitPct', { ...result(), status: 'loading', metrics: null }))).toContain('still being computed');
    expect(text(explain('sunlitPct', { ...result(), status: 'error', error: 'boom', metrics: null }))).toContain('boom');
  });
});

describe('reasonNoPm', () => {
  it('distinguishes pending-σ from a smooth-sphere estimate', () => {
    expect(reasonNoPm(result({ sigmaSource: 'terrain mask, σ pending' }))).toContain("isn't available");
    expect(reasonNoPm(result({ sigmaSource: 'smooth-sphere estimate; terrain unavailable' }))).toContain('smooth-sphere estimate because terrain data is unavailable');
  });
});

describe('detectWhy', () => {
  it.each([
    ['why is this ± so big?', 'events'],
    ['why is sunset uncertain', 'events'],
    ['why is the sun elevation so low', 'sunElevationDeg'],
    ['explain time in sunlight', 'sunlitPct'],
    ['how was the link percentage worked out', 'linkPct'],
    ['why is the longest night so long', 'longestNightH'],
  ])('%s → %s', (q, t) => expect(detectWhy(q)).toBe(t));
  it('ignores things that are not "why" questions', () => {
    expect(detectWhy('go to compare')).toBeNull();
    expect(detectWhy('banana')).toBeNull();
  });
});

describe('any MetricSet key is accepted (Nived’s onWhy hands us keyof MetricSet)', () => {
  it('knows which keys have a template', () => {
    for (const k of ['sunElevationDeg', 'sunClearanceDeg', 'earthElevationDeg', 'sunlitPct', 'linkPct', 'longestNightH', 'longestCommGapH', 'opsHours', 'psrDistanceKm', 'events']) expect(hasTemplate(k)).toBe(true);
    expect(hasTemplate('dteMarginDeg')).toBe(false);
  });
  it('an untemplated metric gets its value and an honest "no explanation yet", nothing invented', () => {
    const w = explainGeneric('dteMarginDeg', result());
    const t = text(w);
    expect(t).toContain('dteMarginDeg: 3.00');
    expect(t).toContain('no written explanation for this number yet');
    expect(t).not.toMatch(/±\s*\d/);
  });
});

describe('the “what it is” line is the RIGHT definition (regression: Earth elevation showed Libration’s)', () => {
  const entries: KnowledgeEntry[] = JSON.parse(readFileSync(resolve(__dirname, '../../../public/content/knowledge.json'), 'utf8')).entries;
  it('Earth elevation uses its own method text, never the Libration definition', () => {
    const w = explain('earthElevationDeg', result(), entries);
    const first = w.lines[0].text;
    expect(first).toContain('Earth elevation is worked out');
    expect(first).not.toContain('oscillation');
  });
  it('every templated metric either has a matching entry or says nothing — never an unrelated one', () => {
    for (const k of ['sunElevationDeg', 'sunClearanceDeg', 'earthElevationDeg', 'sunlitPct', 'linkPct', 'longestNightH', 'opsHours', 'psrDistanceKm'] as const) {
      const w = explain(k, result(), entries);
      expect(w.lines[0].kind, k).toBe('what');
      expect(w.sources.join(' '), k).not.toContain('Libration');
    }
  });
});

describe('mock data is flagged', () => {
  it('says MOCK DATA in the context line when the result is mock', () => {
    const r = result();
    r.meta!.mock = true;
    expect(explain('sunlitPct', r).context).toContain('MOCK DATA');
    r.meta!.mock = false;
    expect(explain('sunlitPct', r).context).not.toContain('MOCK');
  });
});
