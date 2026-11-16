// Owner: Nived
// Seam: quickAnswer(input) -> QuickAnswerResult   (PLAN_FINAL 8.5). Real ephemeris, real catalog.
// Oracle = Gowri's golden set 1 (computed by the Python reference), read straight from the file; nothing is recomputed here.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildScenarioResult } from '../core/buildResult';
import { DEFAULT_DEFINITIONS } from '../core/evaluate';
import { loadDsn } from '../data/dsn';
import { loadEphem } from '../data/ephem';
import { setDataMode } from '../data/source';
import { quickAnswer } from '../quickAnswer';
import { IM2_REFINED, PUBLIC, stubFetch } from './helpers';

const EPHEM_BIN = join(PUBLIC, 'data/ephem/ephem.bin');
const GOLDEN = join(PUBLIC, 'data/golden/golden_set1.json');
const run = existsSync(EPHEM_BIN) && statSync(EPHEM_BIN).size > 1_000_000 && existsSync(GOLDEN);
const TOUCHDOWN = Date.parse('2025-03-06T17:28:50Z');

describe.skipIf(!run)('quickAnswer (real data)', () => {
  const g = run ? JSON.parse(readFileSync(GOLDEN, 'utf8')).cases[0] : null;
  const first = g?.render_samples_hourly[0];
  beforeAll(() => {
    setDataMode('real');
    stubFetch();
  });
  afterAll(() => setDataMode(null));

  const imTwo = { lat: -84.7906, lon: 29.1957, utc: TOUCHDOWN, durationDays: 30, heightM: 2 };

  it('IM-2 at touchdown reproduces the golden Sun/Earth state and recognises the curated site', async () => {
    const r = await quickAnswer(imTwo);
    expect(r.status).toBe('ready');
    expect(r.matchedSiteId).toBe('im2_athena');
    expect(r.sunElevDeg).toBeCloseTo(first.sun.elevation_deg, 3);
    expect(r.sunUp).toBe(first.sun.up);
    expect(r.earthElevDeg).toBeCloseTo(first.earth.elevation_deg, 3);
    expect(Math.abs(r.earthRangeKm - first.earth.range_km)).toBeLessThan(1);
    expect(r.linkUp).toBe(first.earth.up);
  });

  it('applies the DSN-aware link by default (PLAN: ON): link % equals the Cockpit engine with the 10 deg DSN rule, and is below Earth-visible %', async () => {
    const r = await quickAnswer(imTwo);
    const req = {
      siteId: 'im2_athena', tier: 'C' as const, nearFieldResM: null, latDeg: imTwo.lat, lonDegEast: imTwo.lon, heightM: 2, rotation: null, touchdownMs: null, padSlopeDeg: null, psr: null,
      startMs: TOUCHDOWN, durationDays: 30, tScrubMs: TOUCHDOWN, definitions: { ...DEFAULT_DEFINITIONS, dsnMaskDeg: 10 }, dataVersions: { catalog: 1 },
      profile: { minSunlitPct: 0, minLinkHours: 0, maxLongestNightH: Number.MAX_VALUE, maxPadSlopeDeg: 90 }, weights: { sunlit: 1, link: 1, night: 1, slope: 1 },
    };
    const cockpit = buildScenarioResult(await loadEphem(), req, await loadDsn());
    expect(r.linkPct.value!).toBeCloseTo(cockpit.metrics!.linkPct.value!, 9);
    expect(r.linkPct.value!).toBeLessThan(g.metrics.earthVisiblePct.value); // the DSN rule removes some of the Earth-visible time
  });

  it('gives the next sunset / earthset / shadow exit as golden event times (within the 60 s tolerance)', async () => {
    const r = await quickAnswer(imTwo);
    const want = (type: string) => Date.parse(g.events.find((e: { type: string }) => e.type === type).utc);
    expect(Math.abs(r.nextSunset!.t - want('sunset'))).toBeLessThan(60_000);
    expect(Math.abs(r.nextEarthset!.t - want('earthset'))).toBeLessThan(60_000);
    expect(Math.abs(r.nextShadowExit!.t - want('shadowExit'))).toBeLessThan(60_000);
  });

  it('window sunlit % equals the golden 30-day value, and the text states the numbers it shows', async () => {
    const r = await quickAnswer(imTwo);
    expect(r.sunlitPct.value!).toBeCloseTo(IM2_REFINED.sunlitPct, 3);
    expect(r.text).toContain('+2.46');
    expect(r.text).toContain(String(Math.round(g.metrics.sunlitPct.value)));
    expect(r.text).toMatch(/terrain/i); // honest about what it is not using
  });

  it('a point that is not a curated site is a Tier C smooth-Moon answer (no site match, no snap)', async () => {
    const r = await quickAnswer({ lat: -80, lon: 10, utc: TOUCHDOWN, durationDays: 14, heightM: 2 });
    expect(r.status).toBe('ready');
    expect(r.matchedSiteId).toBeNull();
    expect(r.tier).toBe('C');
    expect(r.snapDistanceKm).toBeNull();
  });

  it('a time outside the ephemeris is an error result, not an exception', async () => {
    const r = await quickAnswer({ ...imTwo, utc: Date.UTC(2040, 0, 1) });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/outside it/);
  });
});
