// Owner: Nived
// Seam: startScan(params, onUpdate) -> { cancel, done }  (the call the Scan panel makes). Real mode, real ephemeris.
// Contract (R3 D-15): stage 1 first (all provisional), then stage 2 refines the TOP 10, ranked best-first throughout.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startScan, STAGE2_MAX_TOTAL } from '../compare/scan';
import { selectForStage2 } from '../compare/stage2';
import { getScenario, useScenario } from '../../state/scenarioStore';
import { setDataMode } from '../data/source';
import type { ScanParams, ScanResult } from '../types';
import { PUBLIC, stubFetch } from './helpers';

const EPHEM_BIN = join(PUBLIC, 'data/ephem/ephem.bin');
const run = existsSync(EPHEM_BIN) && statSync(EPHEM_BIN).size > 1_000_000;
const T0 = Date.parse('2025-03-06T17:28:50Z');
const params: ScanParams = { mode: 'dates', baseLandingUtc: T0, plusMinusDays: 15, siteIds: ['im2_athena'], durationDays: 14 };

describe.skipIf(!run)('startScan (real data)', () => {
  beforeAll(() => {
    setDataMode('real');
    stubFetch();
  });
  afterAll(() => setDataMode(null));

  it('emits stage 1 (all provisional), then stage 2 refining at least the top 10, ending done', async () => {
    const updates: ScanResult[] = [];
    const final = await startScan(params, (r) => updates.push(r)).done;
    expect(updates[0].stage).toBe(1);
    expect(updates[0].done).toBe(false);
    expect(updates[0].candidates.length).toBe(31);
    expect(updates[0].candidates.every((c) => c.provisional)).toBe(true);
    expect(final.stage).toBe(2);
    expect(final.done).toBe(true);
    const refined = final.candidates.filter((c) => !c.provisional);
    expect(refined.length).toBeGreaterThanOrEqual(10); // the top 10, plus any candidate within 10% of a threshold (D-15)
    expect(refined.length).toBeLessThanOrEqual(STAGE2_MAX_TOTAL);
    expect(final.candidates.length).toBe(31);
    expect(new Set(final.candidates.map((c) => c.landingUtc)).size).toBe(31); // no candidate lost or duplicated
  });

  it('every emission is ranked best-first, and stage 2 arrives progressively', async () => {
    const updates: ScanResult[] = [];
    await startScan(params, (r) => updates.push(r)).done;
    for (const u of updates) {
      const vi = u.candidates.map((c) => c.viabilityIndex);
      expect(vi).toEqual([...vi].sort((a, b) => b - a));
    }
    const stage2 = updates.filter((u) => u.stage === 2);
    expect(stage2.length).toBeGreaterThan(1); // streamed, not one lump
    const counts = stage2.map((u) => u.candidates.filter((c) => !c.provisional).length);
    expect(counts).toEqual([...counts].sort((a, b) => a - b)); // the refined count only grows
  });

  it('cancel() stops further updates (a superseded scan never overwrites a newer one)', async () => {
    const updates: ScanResult[] = [];
    const h = startScan(params, (r) => {
      updates.push(r);
      if (r.stage === 1) h.cancel();
    });
    await h.done.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 300));
    expect(updates.length).toBe(1); // stage 1 was delivered, and nothing after the cancel
    expect(updates[0].stage).toBe(1);
  });

  it('stage 2 also refines every candidate within 10% of a hard threshold, not just the top 10 (D-15)', async () => {
    const before = getScenario().profile;
    useScenario.setState({ profile: { ...before, minSunlitPct: 60 } }); // many candidates now sit within 10% of 60 %
    try {
      const updates: ScanResult[] = [];
      const final = await startScan(params, (r) => updates.push(r)).done;
      const stage1 = updates[0].candidates;
      const profile = getScenario().profile;
      const expected = selectForStage2(stage1, profile, params.durationDays * 24, { topN: 10, maxTotal: STAGE2_MAX_TOTAL });
      expect(expected.length).toBeGreaterThan(10); // the premise: near-threshold candidates exist beyond the top 10
      const refined = new Set(final.candidates.filter((c) => !c.provisional).map((c) => c.landingUtc));
      expect(refined.size).toBe(expected.length);
      for (const e of expected) expect(refined.has(e.landingUtc)).toBe(true);
    } finally {
      useScenario.setState({ profile: before });
    }
  });

  it('G13 latency: stage 1 <= 100 ms and the first stage-2 row <= 300 ms for a 60-day sweep (CI slack via LUMEN_PERF_SLACK)', async () => {
    const slack = Number(process.env.LUMEN_PERF_SLACK ?? 1);
    const sweep: ScanParams = { ...params, plusMinusDays: 30 }; // 61 landing dates
    await startScan(sweep, () => undefined).done; // warm-up: ephemeris + catalog cached, JIT warm
    const t0 = performance.now();
    let stage1Ms = -1;
    let firstStage2Ms = -1;
    await startScan(sweep, (r) => {
      const dt = performance.now() - t0;
      if (r.stage === 1 && stage1Ms < 0) stage1Ms = dt;
      if (r.stage === 2 && firstStage2Ms < 0) firstStage2Ms = dt;
    }).done;
    expect(stage1Ms, `stage 1 arrived after ${stage1Ms.toFixed(0)} ms`).toBeLessThanOrEqual(100 * slack);
    expect(firstStage2Ms, `first stage-2 row arrived after ${firstStage2Ms.toFixed(0)} ms`).toBeLessThanOrEqual(300 * slack);
  });
});

