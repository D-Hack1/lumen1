// Owner: Nived
// The shared result store: one evaluation per scenario change for ALL consumers, latest-wins, jumpTo.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIO, useScenario } from '../../state/scenarioStore';
import { setDataMode } from '../data/source';
import { getResult, jumpTo, subscribeResult } from '../resultStore';
import { PUBLIC, stubFetch } from './helpers';

const EPHEM_BIN = join(PUBLIC, 'data/ephem/ephem.bin');
const run = existsSync(EPHEM_BIN) && statSync(EPHEM_BIN).size > 1_000_000;

/** Wait until the snapshot satisfies `pred` (the store notifies subscribers). */
function until(pred: () => boolean, ms = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (pred()) return resolve();
    const off = subscribeResult(() => {
      if (pred()) {
        off();
        clearTimeout(t);
        resolve();
      }
    });
    const t = setTimeout(() => {
      off();
      reject(new Error('timed out waiting for a result'));
    }, ms);
  });
}

describe.skipIf(!run)('result store (real data, in-thread engine)', () => {
  beforeAll(() => {
    setDataMode('real');
    stubFetch();
  });
  afterAll(() => setDataMode(null));

  it('delivers the same snapshot to every subscriber (not one evaluation per component)', async () => {
    const seen: unknown[] = [];
    const offs = [0, 1, 2].map(() => subscribeResult(() => seen.push(getResult())));
    await until(() => getResult().status === 'ready');
    offs.forEach((f) => f());
    expect(getResult().meta!.siteId).toBe('im2_athena');
    expect(new Set(seen).size).toBe(1); // 3 consumers, 1 distinct result object
    expect(seen.length).toBe(3);
  });

  it('a scenario change recomputes; rapid changes end on the LAST one and never publish the superseded ones (latest wins)', async () => {
    const lengths: number[] = [];
    const off = subscribeResult(() => {
      const r = getResult();
      if (r.series) lengths.push(r.series.sunUp.length);
    });
    useScenario.setState({ durationDays: 7 });
    useScenario.setState({ durationDays: 60 });
    useScenario.setState({ durationDays: 30 }); // default is 14, so the result must visibly change
    await until(() => getResult().status === 'ready' && getResult().series!.sunUp.length === 30 * 720 + 1);
    await new Promise((r) => setTimeout(r, 100)); // let anything straggling arrive
    off();
    expect(lengths.every((n) => n === 30 * 720 + 1)).toBe(true); // 7 d and 60 d were superseded before they ever published
    expect(getResult().series!.sunUp.length).toBe(30 * 720 + 1);
  });

  it('changes that do not affect the engine (persona, view) do not recompute', async () => {
    const before = getResult();
    useScenario.setState({ persona: 'educator' });
    useScenario.setState({ view: 'compare' });
    await new Promise((r) => setTimeout(r, 200));
    expect(getResult()).toBe(before); // identical object: nothing was re-run
    useScenario.setState({ persona: 'planner', view: 'cockpit' });
  });

  it('jumpTo returns the next event after the scrub time', async () => {
    const t = jumpTo('sunset');
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThan(DEFAULT_SCENARIO.scrubUtc);
    expect(jumpTo('earthset')).not.toBeNull();
    expect(jumpTo('earthrise')!).toBeGreaterThan(jumpTo('earthset')!); // Earth sets first, then rises (30-day window)
    expect(jumpTo('sunset')!).toBeLessThan(jumpTo('shadowExit')!);
  });

  it('the Pointing/Pad panel controls reach the engine: power is non-zero, and changing the preset or the tilt recomputes it', async () => {
    useScenario.setState({ durationDays: 14 });
    await until(() => getResult().status === 'ready' && getResult().series!.sunUp.length === 14 * 720 + 1);
    const peak = (r = getResult()) => Math.max(...r.series!.powerW);
    const fourSide = peak();
    expect(fourSide).toBeGreaterThan(0);
    expect(getResult().metrics!.energyPerDayWh.value).toBeGreaterThan(0);
    useScenario.setState({ panelPreset: 'horizontalDeck', yawDeg: 0 });
    await until(() => peak() !== fourSide);
    // A deck lying on the pad cannot make much at a polar site (Sun < 8 deg). The pad itself is tilted (real pad file, 2.8 deg at IM-2), which can only
    // add its slope to the Sun's elevation relative to the deck, so the bound is the Sun elevation plus the pad slope.
    const padFile = join(PUBLIC, 'data/terrain/pad/im2_athena.json');
    const padSlope = existsSync(padFile) ? (JSON.parse(readFileSync(padFile, 'utf8')) as { slope_deg: number }).slope_deg : 0;
    expect(peak()).toBeLessThan(1361 * Math.sin(((8 + padSlope) * Math.PI) / 180));
    useScenario.setState({ panelPreset: 'fourSide', yawDeg: null, tilt: { magnitudeDeg: 0, directionDeg: 0 } });
    await until(() => peak() === fourSide);
  });

  it('a window outside the ephemeris is reported as an error, not a crash', async () => {
    useScenario.setState({ landingUtc: Date.UTC(2035, 0, 1), scrubUtc: Date.UTC(2035, 0, 1) });
    await until(() => getResult().status === 'error');
    expect(getResult().error).toMatch(/outside it/);
    useScenario.setState({ landingUtc: DEFAULT_SCENARIO.landingUtc, scrubUtc: DEFAULT_SCENARIO.scrubUtc });
    await until(() => getResult().status === 'ready');
  });
});
