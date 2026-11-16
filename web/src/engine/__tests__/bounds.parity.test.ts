// Owner: Nived
// Seam 3 (N-6): evaluateWithBounds on the REAL ephemeris with a terrain mask: three-pass sunlit/link/night bounds and per-event
// fast + exact delta t. Oracle: fixtures/bounds_parity.json, produced by running Gowri's REAL Python end to end on the same inputs
// (python3 web/src/mocks/make_bounds_parity.py). Her module leaves "which shifted event is the same event" to the caller; the
// rule is the nearest event of the same type within 36 h (else it vanished), written independently in the generator and in bounds.ts.
// Invariants (no oracle needed): sigma 0 collapses every bound and every +-; bounds always bracket the nominal value; Tier C has no +-.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluateWithBounds } from '../core/bounds';
import { DEFAULT_DEFINITIONS } from '../core/evaluate';
import { makeSite } from '../core/geometry';
import { Horizon } from '../core/visibility';
import { loadEphem, type Ephemeris } from '../data/ephem';
import { setDataMode } from '../data/source';
import fx from './fixtures/bounds_parity.json';
import { PUBLIC, stubFetch } from './helpers';

const run = existsSync(join(PUBLIC, 'data/ephem/ephem.bin')) && statSync(join(PUBLIC, 'data/ephem/ephem.bin')).size > 1_000_000;
const S = 1000;
const I = fx.input;
const sigmaAt = (az: number) => I.sigma.base + I.sigma.amp * Math.abs(Math.sin(((az * Math.PI) / 180) * I.sigma.k));
const sigmaBins = Float64Array.from({ length: 3600 }, (_, i) => sigmaAt((i + 0.5) * I.binWidthDeg));
const horizon = () => new Horizon({ elevationsDeg: I.mask, binWidthDeg: I.binWidthDeg, observerHeightM: I.heightM });

describe.skipIf(!run)('three-pass bounds + event uncertainty vs Gowri\'s Python (real ephemeris, mask at IM-2)', () => {
  let eph: Ephemeris;
  let out: ReturnType<typeof evaluateWithBounds>;
  beforeAll(async () => {
    setDataMode('real');
    stubFetch();
    eph = await loadEphem();
    out = evaluateWithBounds({ eph, site: makeSite(I.latDeg, I.lonDegEast, I.heightM), horizon: horizon(), startMs: I.startUtcMs, durationDays: I.durationDays, definitions: DEFAULT_DEFINITIONS }, { sigmaDeg: sigmaBins, sigmaAtAzimuthDeg: sigmaAt, pairWindowSeconds: I.pairWindowSeconds });
  });
  afterAll(() => setDataMode(null));

  const E = fx.expected;

  it('finds the same number of events on each of the three masks', () => {
    expect(out.hasBounds).toBe(true);
    expect([out.nominal.sunEvents.length, out.lower.sunEvents.length, out.upper.sunEvents.length]).toEqual([E.counts.sunNominal, E.counts.sunLower, E.counts.sunUpper]);
    expect([out.nominal.earthEvents.length, out.lower.earthEvents.length, out.upper.earthEvents.length]).toEqual([E.counts.earthNominal, E.counts.earthLower, E.counts.earthUpper]);
  });

  it('metric bounds [lo, nominal, hi] for sunlit %, link % (Earth visible) and longest night match her three-pass values', () => {
    for (const [key, got] of [['sunlitPct', out.metrics.sunlitPct], ['earthVisiblePct', out.metrics.earthVisiblePct], ['longestNightH', out.metrics.longestNightH]] as const) {
      const want = E.metrics[key];
      expect(got.lo!, `${key} lo`).toBeCloseTo(want.lo, 4);
      expect(got.value!, `${key} nominal`).toBeCloseTo(want.nominal, 4);
      expect(got.hi!, `${key} hi`).toBeCloseTo(want.hi, 4);
    }
  });

  it.each([['sun', 'sunEvents', 'fastSunEvents'], ['earth', 'earthEvents', 'fastEarthEvents']] as const)('%s events: time, fast delta t + rate + grazing, exact delta t', (_b, key, fastKey) => {
    const want = E[key];
    const exact = out[key];
    const fast = out[fastKey];
    expect(exact.length).toBe(want.length);
    want.forEach((w, i) => {
      expect(exact[i].type).toBe(w.type);
      expect(Math.abs(exact[i].t - w.utcMs)).toBeLessThan(1 * S); // within a second
      // exact path (re-solved on the shifted masks)
      expect(exact[i].dtMethod).toBe('exact');
      expect(Math.abs(exact[i].dtMs! / S - (w.exact.deltaTSeconds as number))).toBeLessThan(0.5);
      expect(exact[i].grazingReason).toBe(w.exact.grazingReason);
      // fast path (sigma / |dC/dt|)
      expect(fast[i].dtMethod).toBe('fast');
      expect(Math.abs(fast[i].dtMs! / S - (w.fast.deltaTSeconds as number)) / (w.fast.deltaTSeconds as number)).toBeLessThan(1e-3); // ephemeris twin agrees to ~5e-6 deg, which moves a slow rate by ~1e-5 relative
      expect(fast[i].grazingReason).toBe(w.fast.grazingReason);
      expect(fast[i].bracketStartMs! - I.startUtcMs).toBeCloseTo(w.bracketMs[0], 3); // the retained bracket is hers
    });
  });

  it('the fast and exact paths broadly agree on well-conditioned events (sunset: both ~1.6 h) - a sanity check on the pairing rule', () => {
    const sunset = out.sunEvents.find((e) => e.type === 'sunset')!;
    const fast = out.fastSunEvents.find((e) => e.type === 'sunset')!;
    expect(Math.abs(sunset.dtMs! - fast.dtMs!) / fast.dtMs!).toBeLessThan(0.05);
  });

  it('bounds always bracket the nominal value', () => {
    for (const b of [out.metrics.sunlitPct, out.metrics.earthVisiblePct, out.metrics.longestNightH]) {
      expect(b.lo!).toBeLessThanOrEqual(b.value!);
      expect(b.hi!).toBeGreaterThanOrEqual(b.value!);
    }
  });

  it('sigma = 0 collapses every bound and every +-: lo = nominal = hi, delta t = 0 on both paths', () => {
    const zero = evaluateWithBounds({ eph, site: makeSite(I.latDeg, I.lonDegEast, I.heightM), horizon: horizon(), startMs: I.startUtcMs, durationDays: I.durationDays, definitions: DEFAULT_DEFINITIONS }, { sigmaDeg: 0, sigmaAtAzimuthDeg: () => 0 });
    for (const b of [zero.metrics.sunlitPct, zero.metrics.earthVisiblePct, zero.metrics.longestNightH]) {
      expect(b.lo).toBe(b.value);
      expect(b.hi).toBe(b.value);
    }
    for (const e of [...zero.sunEvents, ...zero.earthEvents]) expect(e.dtMs).toBe(0);
    for (const e of [...zero.fastSunEvents, ...zero.fastEarthEvents]) expect(e.dtMs).toBe(0);
  });

  it('Tier C (smooth horizon, no mask) has NO +-: bounds are null and events stay unannotated, never a made-up number', () => {
    const smooth = evaluateWithBounds({ eph, site: makeSite(-84.7906, 29.1957, 2), horizon: new Horizon({ observerHeightM: 2 }), startMs: I.startUtcMs, durationDays: 14, definitions: DEFAULT_DEFINITIONS }, { sigmaDeg: 0.1, sigmaAtAzimuthDeg: () => 0.1 });
    expect(smooth.hasBounds).toBe(false);
    expect(smooth.metrics.sunlitPct.lo).toBeNull();
    expect(smooth.metrics.sunlitPct.hi).toBeNull();
    expect(smooth.metrics.sunlitPct.value).not.toBeNull();
    for (const e of smooth.sunEvents) expect(e.dtMs).toBeNull();
  });

  it('a window of 28 days with three passes computes in a background-friendly time (<= 10 s, CI slack via LUMEN_PERF_SLACK)', () => {
    const slack = Number(process.env.LUMEN_PERF_SLACK ?? 1);
    const t0 = performance.now();
    evaluateWithBounds({ eph, site: makeSite(I.latDeg, I.lonDegEast, I.heightM), horizon: horizon(), startMs: I.startUtcMs, durationDays: I.durationDays, definitions: DEFAULT_DEFINITIONS }, { sigmaDeg: sigmaBins, sigmaAtAzimuthDeg: sigmaAt });
    const ms = performance.now() - t0;
    console.log(`evaluateWithBounds, 28 d, 3 passes: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(10_000 * slack);
  });
});
