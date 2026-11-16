// Owner: Nived
// G7 wiring seam: the ISRO preset as the UI stores it (DEFINITIONS_PRESETS.isroVikramOps, UI units) must reach the engine and
// change the Answer Strip state for CY-3 - Abhinav's Phase 3 exit check ("ISRO preset changes the Answer Strip state in the
// CY-3 fixture"). Real ephemeris, real catalog, through the shared result store exactly as the app does it.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setDataMode } from '../data/source';
import { getResult, subscribeResult } from '../resultStore';
import { DEFAULT_SCENARIO, DEFINITIONS_PRESETS, useScenario } from '../../state/scenarioStore';
import { PUBLIC, stubFetch } from './helpers';

const run = existsSync(join(PUBLIC, 'data/ephem/ephem.bin')) && statSync(join(PUBLIC, 'data/ephem/ephem.bin')).size > 1_000_000;
const TOUCHDOWN = Date.parse('2023-08-23T12:33:00Z');
const BETWEEN = Date.parse('2023-09-03T18:00:00Z'); // after the 6 deg crossing, before sunset

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
      reject(new Error('timed out waiting for the result'));
    }, ms);
  });
}

describe.skipIf(!run)('G7 through the scenario store (CY-3 + ISRO preset)', () => {
  beforeAll(() => {
    setDataMode('real');
    stubFetch();
  });
  afterAll(() => {
    setDataMode(null);
    useScenario.setState({ site: DEFAULT_SCENARIO.site, landingUtc: DEFAULT_SCENARIO.landingUtc, scrubUtc: DEFAULT_SCENARIO.scrubUtc, durationDays: DEFAULT_SCENARIO.durationDays, definitions: DEFAULT_SCENARIO.definitions, definitionsPreset: 'default' });
  });

  it('default definitions: the Answer Strip shows a normal sunsetIn for CY-3 at that instant', async () => {
    useScenario.setState({ site: { kind: 'site', id: 'cy3_shiv_shakti' }, landingUtc: TOUCHDOWN, scrubUtc: BETWEEN, durationDays: 60, definitions: DEFINITIONS_PRESETS.default, definitionsPreset: 'default' });
    await until(() => getResult().status === 'ready' && getResult().meta?.siteId === 'cy3_shiv_shakti' && getResult().answer?.tScrub === BETWEEN);
    expect(getResult().answer!.sun.state).toBe('sunsetIn');
  });

  it('switching to the ISRO preset (UI units: minSunElevationOps = 6) changes the state to belowOpsElevation', async () => {
    useScenario.setState({ definitions: DEFINITIONS_PRESETS.isroVikramOps, definitionsPreset: 'isroVikramOps' });
    await until(() => getResult().answer?.sun.state === 'belowOpsElevation');
    expect(getResult().answer!.sun.opsMinElevDeg).toBe(6);
    expect(getResult().meta!.definitionsSummary).toMatch(/6° elevation/); // the visible definitions text says so too
  });

  it('switching back restores the normal state (the preset is what changes it)', async () => {
    useScenario.setState({ definitions: DEFINITIONS_PRESETS.default, definitionsPreset: 'default' });
    await until(() => getResult().answer?.sun.state === 'sunsetIn');
    expect(getResult().answer!.sun.opsMinElevDeg).toBeNull();
  });
});
