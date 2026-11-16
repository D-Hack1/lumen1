// Owner: Nived
// Gate G7 (R3 delta D-13): validation against a REAL mission - Chandrayaan-3 Statio Shiv Shakti.
// Oracles are external published facts, not outputs of this code:
//   - ISRO/mission team: Sun elevation at the landing was 8.75 deg (touchdown 2023-08-23 12:33 UTC, minute precision => +-0.25 deg).
//   - Mission timeline: Pragyan rover was put to sleep 2 Sep 2023 and Vikram lander 4 Sep 2023, as the lunar afternoon ended.
//   - D-10 / D-14: with the "ISRO Vikram ops" preset (min Sun elevation 6 deg) the Answer Strip shows the ops-elevation state.
// Smooth-Moon horizon, no terrain: G7 is a quantitative ephemeris/geometry check (the plan says the same).
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildScenarioResult, type ScenarioRequest } from '../core/buildResult';
import { DEFAULT_DEFINITIONS } from '../core/evaluate';
import { loadCatalog } from '../data/catalog';
import { loadEphem, type Ephemeris } from '../data/ephem';
import { setDataMode } from '../data/source';
import type { SiteRecord } from '../types';
import { PUBLIC, stubFetch } from './helpers';

const EPHEM_BIN = join(PUBLIC, 'data/ephem/ephem.bin');
const run = existsSync(EPHEM_BIN) && statSync(EPHEM_BIN).size > 1_000_000 && existsSync(join(PUBLIC, 'data/catalog/sites.json'));
const TOUCHDOWN = Date.parse('2023-08-23T12:33:00Z');

describe.skipIf(!run)('G7: Chandrayaan-3 (real 2023 ephemeris)', () => {
  let eph: Ephemeris;
  let cy3: SiteRecord;
  beforeAll(async () => {
    setDataMode('real');
    stubFetch();
    eph = await loadEphem();
    cy3 = (await loadCatalog()).sites.find((s) => s.id === 'cy3_shiv_shakti')!;
  });
  afterAll(() => setDataMode(null));

  const request = (over: Partial<ScenarioRequest> = {}): ScenarioRequest => ({
    siteId: cy3.id, tier: 'pending', nearFieldResM: null, latDeg: cy3.landingCoords.lat, lonDegEast: cy3.landingCoords.lon, heightM: 0,
    rotation: cy3.rotationMatrix, touchdownMs: TOUCHDOWN, padSlopeDeg: null, psr: null, startMs: TOUCHDOWN, durationDays: 20, tScrubMs: TOUCHDOWN,
    definitions: DEFAULT_DEFINITIONS, dataVersions: {}, profile: { minSunlitPct: 0, minLinkHours: 0, maxLongestNightH: 1e9, maxPadSlopeDeg: 90 },
    weights: { sunlit: 1, link: 1, night: 1, slope: 1 }, ...over,
  });

  describe('slice 1: Sun elevation at touchdown', () => {
    it('the catalog has the touchdown time and the landing coordinates D-12 specifies', () => {
      expect(cy3.touchdownUtc).toBe(TOUCHDOWN);
      expect(cy3.landingCoords.lat).toBeCloseTo(-69.373, 3);
      expect(cy3.landingCoords.lon).toBeCloseTo(32.319, 3);
    });
    it('is 8.75 deg within the +-0.25 deg tolerance the plan sets for a minute-precision time', () => {
      const r = buildScenarioResult(eph, request());
      expect(r.status).toBe('ready');
      expect(r.metrics!.sunElevationAtTouchdownDeg!.value!).toBeGreaterThan(8.5);
      expect(r.metrics!.sunElevationAtTouchdownDeg!.value!).toBeLessThan(9.0);
    });
  });

  describe('slice 2: the ISRO 6 deg ops preset on the real mission timeline', () => {
    const ISRO = { ...DEFAULT_DEFINITIONS, minSunElevationOpsDeg: 6 };
    const PRAGYAN_SLEEP = Date.parse('2023-09-02T00:00:00Z'); // reported: rover put to sleep 2 Sep 2023
    const VIKRAM_SLEEP_END = Date.parse('2023-09-04T23:59:59Z'); // reported: lander put to sleep 4 Sep 2023

    it('the Sun is available for ops at touchdown (8.6 deg is above the 6 deg minimum)', () => {
      const r = buildScenarioResult(eph, request({ definitions: ISRO }));
      expect(r.answer!.sun.state).toBe('sunsetIn'); // not belowOpsElevation
      expect(r.answer!.sun.opsMinElevDeg).toBe(6);
    });
    it('the ops window ends inside the reported shutdown period (between the rover and lander sleeps)', () => {
      const r = buildScenarioResult(eph, request({ definitions: ISRO }));
      const opsEnd = r.events.find((e) => e.type === 'sunset')!.t;
      expect(opsEnd).toBeGreaterThan(PRAGYAN_SLEEP);
      expect(opsEnd).toBeLessThan(VIKRAM_SLEEP_END);
    });
    it('the 6 deg requirement ends the ops window EARLIER than plain Sun-up (it is stricter)', () => {
      const ops = buildScenarioResult(eph, request({ definitions: ISRO })).events.find((e) => e.type === 'sunset')!.t;
      const plain = buildScenarioResult(eph, request()).events.find((e) => e.type === 'sunset')!.t;
      expect(ops).toBeLessThan(plain);
      expect(plain - ops).toBeGreaterThan(3_600_000); // by hours, not seconds: the Sun takes a day or so to fall from 6 deg to 0
    });
    it('sunlit % is smaller with the stricter definition', () => {
      const ops = buildScenarioResult(eph, request({ definitions: ISRO })).metrics!.sunlitPct.value!;
      const plain = buildScenarioResult(eph, request()).metrics!.sunlitPct.value!;
      expect(ops).toBeLessThan(plain);
    });
  });

  describe('slice 3: Answer Strip state machine (D-14) on CY-3', () => {
    const ISRO = { ...DEFAULT_DEFINITIONS, minSunElevationOpsDeg: 6 };
    const BETWEEN = Date.parse('2023-09-03T18:00:00Z'); // after the 6 deg crossing (3 Sep ~06:00), before sunset (4 Sep ~16:00)
    const AFTER_SET = Date.parse('2023-09-10T00:00:00Z'); // lunar night
    const SYNODIC_DAYS = 29.53;

    it('between the 6 deg crossing and sunset the Sun is up but below the ops minimum: belowOpsElevation', () => {
      const r = buildScenarioResult(eph, request({ definitions: ISRO, tScrubMs: BETWEEN, durationDays: 40 }));
      expect(r.answer!.sun.up).toBe(true); // still geometrically visible
      expect(r.answer!.sun.elevDeg).toBeLessThan(6);
      expect(r.answer!.sun.elevDeg).toBeGreaterThan(0);
      expect(r.answer!.sun.state).toBe('belowOpsElevation');
    });
    it('ops resume about one synodic month after the previous equivalent phase (physical oracle: the Sun repeats every 29.53 d)', () => {
      const r = buildScenarioResult(eph, request({ definitions: ISRO, tScrubMs: BETWEEN, durationDays: 40 }));
      const resume = r.answer!.sun.nextEventT!;
      expect(resume).not.toBeNull();
      // The 6 deg up-crossing that preceded touchdown was < 3 days before it; one synodic month later is the next one.
      expect((resume - TOUCHDOWN) / 86_400_000).toBeGreaterThan(SYNODIC_DAYS - 3.5);
      expect((resume - TOUCHDOWN) / 86_400_000).toBeLessThan(SYNODIC_DAYS + 0.5);
    });
    it('with no resume inside a short window, the state still reports belowOps but gives no resume time', () => {
      const r = buildScenarioResult(eph, request({ definitions: ISRO, tScrubMs: BETWEEN, durationDays: 14 }));
      expect(r.answer!.sun.state).toBe('belowOpsElevation');
      expect(r.answer!.sun.nextEventT).toBeNull();
    });
    it('in the lunar night the state is sunriseIn (not belowOps), with "dark for" measured from the last sunset', () => {
      const r = buildScenarioResult(eph, request({ definitions: ISRO, tScrubMs: AFTER_SET, durationDays: 40 }));
      expect(r.answer!.sun.up).toBe(false);
      expect(r.answer!.sun.state).toBe('sunriseIn');
      expect(r.answer!.sun.darkForMs!).toBeGreaterThan(0);
    });
    it('without the preset the same instant is a normal sunsetIn (the preset is what changes the state)', () => {
      const r = buildScenarioResult(eph, request({ tScrubMs: BETWEEN, durationDays: 40 }));
      expect(r.answer!.sun.state).toBe('sunsetIn');
    });
  });
});
