// Owner: Nived
// Seam: evaluateVerdict(input) -> { verdict, requirements, ... }   (PLAN_FINAL 5.7). Pure function; public interface only.
// Expected values are worked out BY HAND from the plan's rule, not computed with the code under test:
//   GO       : every hard requirement passes at the conservative bound (lo for a minimum, hi for a maximum)
//   MARGINAL : some requirement passes only at the nominal value, or is within 10% of its limit
//   NO-GO    : some requirement fails even at the nominal value
import { describe, expect, it } from 'vitest';
import { evaluateVerdict, type VerdictInput } from '../core/verdict';
import type { Bounded, MetricSet } from '../types';

const b = (value: number | null, lo: number | null = value, hi: number | null = value): Bounded => ({ value, lo, hi });

/** A metric set where only the four judged quantities matter; everything else is null. */
function metrics(over: Partial<Record<'sunlitPct' | 'linkPct' | 'longestNightH' | 'padSlopeDeg', Bounded | null>> = {}): MetricSet {
  return {
    sunElevationDeg: b(1), sunClearanceDeg: b(1), sunDiskPct: b(100), earthElevationDeg: b(5), dteMarginDeg: b(4),
    sunlitPct: b(60, 55, 65), linkPct: b(50, 45, 55), longestNightH: b(40, 35, 45), longestCommGapH: b(10), opsHours: b(100), energyPerDayWh: b(null, null, null),
    sunElevationAtTouchdownDeg: null, padSlopeDeg: b(5, 4, 6), psrDistanceKm: null, ...over,
  } as MetricSet;
}

// Profile: >= 40 % sunlit, >= 100 link hours in a 14-day window (336 h => 29.76 %), longest night <= 96 h, pad slope <= 10 deg.
const profile = { minSunlitPct: 40, minLinkHours: 100, maxLongestNightH: 96, maxPadSlopeDeg: 10 };
const weights = { sunlit: 1, link: 1, night: 1, slope: 1 };
const input = (m: MetricSet, over: Partial<VerdictInput> = {}): VerdictInput => ({ metrics: m, windowHours: 336, profile, weights, boundsKind: 'bounded', ...over });

describe('slice 1: fail vs clear pass', () => {
  it('NO-GO when sunlit is below the minimum even at the nominal value (38 < 40)', () => {
    const r = evaluateVerdict(input(metrics({ sunlitPct: b(38, 33, 43) })));
    expect(r.verdict).toBe('NO-GO');
    expect(r.requirements.find((x) => x.id === 'sunlit')!.status).toBe('fail');
  });
  it('GO when every requirement passes at its conservative bound with room to spare', () => {
    // sunlit 60 [55-65] vs 40: lo 55 >= 40 and 60 is not within 10% of 40 (36-44). link 50% of 336 h = 168 h [151-185] vs 100: ok.
    // night 40 [35-45] vs max 96: hi 45 <= 96. slope 5 [4-6] vs max 10: hi 6 <= 10 and 5 not within 9-11.
    const r = evaluateVerdict(input(metrics()));
    expect(r.verdict).toBe('GO');
    expect(r.requirements.every((x) => x.status === 'pass')).toBe(true);
  });
});

describe('slice 2: MARGINAL', () => {
  it('passes only at the nominal value: sunlit 50 [38-60] vs 40 (conservative lo 38 < 40)', () => {
    const r = evaluateVerdict(input(metrics({ sunlitPct: b(50, 38, 60) })));
    expect(r.verdict).toBe('MARGINAL');
    expect(r.requirements.find((x) => x.id === 'sunlit')!.status).toBe('marginal');
  });
  it('is within 10% of the limit even though the conservative bound passes: 42 [41-43] vs 40 (|42-40| = 2 <= 4)', () => {
    expect(evaluateVerdict(input(metrics({ sunlitPct: b(42, 41, 43) }))).verdict).toBe('MARGINAL');
  });
  it('the 10% band is inclusive at its edge: 44 is marginal (|44-40| = 4), 44.1 is a clean pass', () => {
    expect(evaluateVerdict(input(metrics({ sunlitPct: b(44, 44, 44) }))).verdict).toBe('MARGINAL');
    expect(evaluateVerdict(input(metrics({ sunlitPct: b(44.1, 44.1, 44.1) }))).verdict).toBe('GO');
  });
  it('a failure outranks a marginal: sunlit marginal (42) + night fails (100 > 96) => NO-GO', () => {
    expect(evaluateVerdict(input(metrics({ sunlitPct: b(42, 41, 43), longestNightH: b(100, 95, 105) }))).verdict).toBe('NO-GO');
  });
});

describe('slice 3: link hours and the direction of the conservative bound', () => {
  it('link hours = link % of the window: 25% of 336 h = 84 h < 100 h => NO-GO', () => {
    const r = evaluateVerdict(input(metrics({ linkPct: b(25, 23, 27) })));
    expect(r.verdict).toBe('NO-GO');
    expect(r.requirements.find((x) => x.id === 'link')!.status).toBe('fail');
  });
  it('30% of 336 h = 100.8 h passes nominally, but lo 28% = 94.08 h fails the bound => MARGINAL', () => {
    expect(evaluateVerdict(input(metrics({ linkPct: b(30, 28, 32) }))).verdict).toBe('MARGINAL');
  });
  it('a MAXIMUM uses the high bound: night 90 [80-100] vs 96 passes nominally but hi 100 > 96 => MARGINAL', () => {
    expect(evaluateVerdict(input(metrics({ longestNightH: b(90, 80, 100) }))).verdict).toBe('MARGINAL');
  });
  it('night 96.5 > 96 fails outright; night exactly at the limit (96) passes nominally but is inside the 10% band => MARGINAL', () => {
    expect(evaluateVerdict(input(metrics({ longestNightH: b(96.5, 96.5, 96.5) }))).verdict).toBe('NO-GO');
    expect(evaluateVerdict(input(metrics({ longestNightH: b(96, 96, 96) }))).verdict).toBe('MARGINAL');
  });
});

describe('slice 4: honesty when the data cannot support a verdict', () => {
  it('insufficient terrain evidence: a nominal pass cannot be GO => PENDING, with a reason', () => {
    const r = evaluateVerdict(input(metrics(), { boundsKind: 'insufficient' }));
    expect(r.verdict).toBe('PENDING');
    expect(r.reasons.join(' ')).toMatch(/terrain/i);
  });
  it('a nominal geometry failure with insufficient terrain evidence is PENDING, not NO-GO', () => {
    const r = evaluateVerdict(input(metrics({ sunlitPct: b(30, null, null) }), { boundsKind: 'insufficient' }));
    expect(r.verdict).toBe('PENDING');
    expect(r.requirements.find((x) => x.id === 'sunlit')!.status).toBe('unknown');
  });
  it('preserves an independently verified failure while geometry evidence is insufficient', () => {
    const r = evaluateVerdict(input(metrics({ padSlopeDeg: b(20) }), { boundsKind: 'insufficient', verifiedRequirements: ['slope'] }));
    expect(r.verdict).toBe('NO-GO');
    expect(r.requirements.find((x) => x.id === 'slope')!.status).toBe('fail');
  });
  it('a missing value is "unknown", not a failure: no pad data => PENDING when everything else passes', () => {
    const r = evaluateVerdict(input(metrics({ padSlopeDeg: null })));
    expect(r.verdict).toBe('PENDING');
    expect(r.requirements.find((x) => x.id === 'slope')!.status).toBe('unknown');
  });
  it('...and unknown never hides a real failure: no pad data + sunlit 30 => NO-GO', () => {
    expect(evaluateVerdict(input(metrics({ padSlopeDeg: null, sunlitPct: b(30, 25, 35) }))).verdict).toBe('NO-GO');
  });
  it('MARGINAL outranks PENDING (a known marginal is more informative than an unknown)', () => {
    expect(evaluateVerdict(input(metrics({ padSlopeDeg: null, sunlitPct: b(42, 41, 43) }))).verdict).toBe('MARGINAL');
  });
});

describe('slice 5: Viability Index (weighted components, 0-100)', () => {
  // Component score: minimum-type = value/limit capped at 1; maximum-type = limit/value capped at 1 (value 0 => 1).
  // Hand-worked: sunlit 40 vs 40 => 1.0 | link 14.88% of 336 h = 50 h vs 100 => 0.5 | night 96 vs 96 => 1.0 | slope 20 vs 10 => 0.5
  const m = metrics({ sunlitPct: b(40), linkPct: b(100 * 50 / 336), longestNightH: b(96), padSlopeDeg: b(20) });
  it('equal weights: (1 + 0.5 + 1 + 0.5) / 4 = 0.75 => 75', () => {
    const r = evaluateVerdict(input(m));
    expect(r.viabilityIndex).toBeCloseTo(75, 6);
    expect(r.components.map((c) => [c.id, c.score])).toEqual([['sunlit', 1], ['link', 0.5], ['night', 1], ['slope', 0.5]]);
  });
  it('weights matter: sunlit 2, link 1, night 1, slope 0 => (2 + 0.5 + 1 + 0) / 4 = 0.875 => 87.5', () => {
    expect(evaluateVerdict(input(m, { weights: { sunlit: 2, link: 1, night: 1, slope: 0 } })).viabilityIndex).toBeCloseTo(87.5, 6);
  });
  it('a component with no data is left out and the rest are renormalised: slope missing => (1 + 0.5 + 1) / 3 = 83.33', () => {
    expect(evaluateVerdict(input({ ...m, padSlopeDeg: null })).viabilityIndex).toBeCloseTo(250 / 3, 6);
  });
  it('scores are capped at 1: sunlit 80 vs 40 is 1, not 2; and a zero-hour night scores 1 (no division by zero)', () => {
    const r = evaluateVerdict(input(metrics({ sunlitPct: b(80), longestNightH: b(0) })));
    expect(r.components.find((c) => c.id === 'sunlit')!.score).toBe(1);
    expect(r.components.find((c) => c.id === 'night')!.score).toBe(1);
  });
  it('is null when no component can be scored, and is still given for a NO-GO', () => {
    const none = metrics({ sunlitPct: null, linkPct: null, longestNightH: null, padSlopeDeg: null });
    expect(evaluateVerdict(input(none)).viabilityIndex).toBeNull();
    expect(evaluateVerdict(input(metrics({ sunlitPct: b(20) }))).viabilityIndex).not.toBeNull();
  });
});

describe('slice 6: one sentence per cause, not one per requirement', () => {
  it('insufficient geometry evidence is reported once, naming every affected requirement', () => {
    const r = evaluateVerdict(input(metrics(), { boundsKind: 'insufficient' }));
    expect(r.reasons).toEqual(['Sunlit time, link time, longest night and pad slope are smooth-sphere estimates; terrain data is needed to determine pass or fail.']);
  });
  it('a single requirement uses the singular verb', () => {
    const r = evaluateVerdict(input(metrics({ linkPct: null, longestNightH: null, padSlopeDeg: null }), { boundsKind: 'insufficient' }));
    expect(r.reasons[0]).toBe('Sunlit time is a smooth-sphere estimate; terrain data is needed to determine pass or fail.');
  });
  it('missing data is still listed separately, after the combined line', () => {
    const r = evaluateVerdict(input(metrics({ padSlopeDeg: null }), { boundsKind: 'insufficient' }));
    expect(r.reasons).toEqual([
      'Sunlit time, link time and longest night are smooth-sphere estimates; terrain data is needed to determine pass or fail.',
      'Pad slope: no data yet.',
    ]);
  });
  it('a nominal geometry failure is folded into the insufficient-evidence reason', () => {
    const r = evaluateVerdict(input(metrics({ sunlitPct: b(30, null, null) }), { boundsKind: 'insufficient' }));
    expect(r.reasons).toEqual(['Sunlit time, link time, longest night and pad slope are smooth-sphere estimates; terrain data is needed to determine pass or fail.']);
  });
});

