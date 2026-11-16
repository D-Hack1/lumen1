// Owner: Nived
// Per-row slip in Compare (Abhinav): effective landing = landing + global slip + the row's own slip, in real AND mock mode; mock mode follows the rows;
// the engine result carries the verdict requirements.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getCompare, subscribeCompare } from '../compareStore';
import { setDataMode } from '../data/source';
import { loadCatalog } from '../data/catalog';
import { mockCompare } from '../../mocks/mockResult';
import { DEFAULT_SCENARIO, useScenario, type CompareRow } from '../../state/scenarioStore';
import { buildScenarioResult } from '../core/buildResult';
import { DEFAULT_DEFINITIONS } from '../core/evaluate';
import { loadEphem } from '../data/ephem';
import { PUBLIC, stubFetch } from './helpers';

const DAY = 86_400_000;
const T0 = Date.parse('2025-03-06T17:28:50Z');
const run = existsSync(join(PUBLIC, 'data/ephem/ephem.bin')) && statSync(join(PUBLIC, 'data/ephem/ephem.bin')).size > 1_000_000;
const row = (id: CompareRow['id'], siteId: string, over: Partial<CompareRow> = {}): CompareRow => ({
  id, site: { kind: 'site', id: siteId }, landingUtc: T0, slipDays: 0, panelPreset: 'fourSide', yawDeg: null, tilt: { magnitudeDeg: 0, directionDeg: 0 }, heightM: 2, baseline: false, ...over,
});
function until(pred: () => boolean, ms = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (pred()) return resolve();
    const off = subscribeCompare(() => {
      if (pred()) {
        off();
        clearTimeout(t);
        resolve();
      }
    });
    const t = setTimeout(() => {
      off();
      reject(new Error('timed out waiting for the compare result'));
    }, ms);
  });
}

describe.skipIf(!run)('compare rows: per-row slip (real data)', () => {
  beforeAll(() => {
    setDataMode('real');
    stubFetch();
    useScenario.setState({ durationDays: 7, slipDays: 0, compareRows: [] });
  });
  afterAll(() => {
    setDataMode(null);
    useScenario.setState({ compareRows: DEFAULT_SCENARIO.compareRows, durationDays: DEFAULT_SCENARIO.durationDays, slipDays: DEFAULT_SCENARIO.slipDays });
  });

  it('a row\'s own slip moves its evaluation window, on top of the global slip', async () => {
    useScenario.setState({ slipDays: 1, compareRows: [row('A', 'im2_athena', { baseline: true }), row('B', 'im2_athena', { slipDays: 3 })] });
    await until(() => getCompare().status === 'ready' && getCompare().rows.length === 2 && getCompare().rows.every((r) => r.result.series != null));
    const t0 = (id: string) => getCompare().rows.find((r) => r.scenarioId === id)!.result.series!.t0;
    expect(t0('A')).toBe(T0 + 1 * DAY); // global slip only
    expect(t0('B')).toBe(T0 + (1 + 3) * DAY); // global + the row's own
  });
});

describe('mock compare follows the rows', () => {
  it('one result per row (a 4th row appears), the baseline row is the one flagged, and row slip moves the landing', async () => {
    setDataMode('mock');
    try {
      const { sites } = await loadCatalog();
      const rows = ['A', 'B', 'C', 'D'].map((id, i) => row(id as CompareRow['id'], sites[i % sites.length].id, { baseline: id === 'C' }));
      const c = mockCompare(sites, rows, 0);
      expect(c.rows.map((r) => r.scenarioId)).toEqual(['A', 'B', 'C', 'D']);
      expect(c.baselineId).toBe('C');
      expect(c.rows.find((r) => r.scenarioId === 'C')!.deltaVsBaseline.sunlitPct).toBe(0);
      const moved = mockCompare(sites, [row('A', sites[0].id, { baseline: true, slipDays: 5 })], 2);
      const still = mockCompare(sites, [row('A', sites[0].id, { baseline: true })], 0);
      expect(moved.rows[0].result.series!.t0).not.toBe(still.rows[0].result.series!.t0);
      expect(mockCompare(sites).rows.map((r) => r.scenarioId)).toEqual(['A', 'B', 'C']); // legacy call is unchanged
    } finally {
      setDataMode(null);
    }
  });
});

describe.skipIf(!run)('verdict requirements on the engine result', () => {
  it('buildScenarioResult exposes the per-requirement status behind the verdict', async () => {
    setDataMode('real');
    stubFetch();
    try {
      const eph = await loadEphem();
      const r = buildScenarioResult(eph, {
        siteId: 'im2_athena', tier: 'pending', nearFieldResM: null, latDeg: -84.7906, lonDegEast: 29.1957, heightM: 2, rotation: null, touchdownMs: T0, padSlopeDeg: null,
        psr: null, startMs: T0, durationDays: 30, tScrubMs: T0, definitions: DEFAULT_DEFINITIONS, dataVersions: { catalog: 1 },
        profile: { minSunlitPct: 90, minLinkHours: 0, maxLongestNightH: 1e9, maxPadSlopeDeg: 90 }, weights: { sunlit: 1, link: 1, night: 1, slope: 1 },
      });
      expect(r.verdictRequirements!.map((q) => q.id)).toEqual(['sunlit', 'link', 'night', 'slope']);
      expect(r.verdictRequirements!.find((q) => q.id === 'sunlit')!.status).toBe('unknown'); // ~49% nominal smooth-sphere sunlit, but terrain is unavailable
      expect(r.verdictRequirements!.find((q) => q.id === 'slope')!.status).toBe('unknown'); // no pad slope data
      expect(r.verdict).toBe('PENDING');
    } finally {
      setDataMode(null);
    }
  });
});
