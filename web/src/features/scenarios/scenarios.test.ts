// Owner: Abhinav — Phase 4 unit tests: compare rows (baseline, per-row slip, load into Cockpit), URL round-trip of
// rows/baseline/profile/centre tab, Mission Profile validation, battery check, requirement rows, row display helpers.
import { beforeEach, describe, expect, it } from 'vitest';
import { frameBus } from '../../state/frameBus';
import { slipBus } from '../../state/buses';
import { getCopy } from '../../state/copy';
import { DAY_MS, DEFAULT_SCENARIO, getScenario, rowLandingUtc, useScenario } from '../../state/scenarioStore';
import { decodeScenario, encodeScenario } from '../../state/urlSync';
import type { Bounded, MetricSet } from '../../engine/types';
import {
  batteryCheck,
  crossFieldErrors,
  enduranceHours,
  fmtNum,
  parseField,
  profileSummary,
  requirementRows,
} from './profileModel';
import { attitudeSummary, batteryHeadline, siteLabel } from './rowModel';

const t = (k: string) => getCopy(k, 'planner');
const b = (value: number | null, lo: number | null = value, hi: number | null = value): Bounded => ({ value, lo, hi });

beforeEach(() => useScenario.getState().reset());

describe('compare rows', () => {
  it('exactly one baseline: first row, swap, remove the baseline', () => {
    const s = getScenario();
    expect(['A', 'B', 'C', 'D'].map(() => s.addCompareRow())).toEqual(['A', 'B', 'C', 'D']);
    expect(getScenario().addCompareRow()).toBeNull(); // 5th is refused
    const base = () => getScenario().compareRows.filter((r) => r.baseline).map((r) => r.id);
    expect(base()).toEqual(['A']);
    s.setBaseline('C');
    expect(base()).toEqual(['C']);
    s.setBaseline('C'); // clicking the current baseline keeps it (cannot end with none)
    expect(base()).toEqual(['C']);
    s.removeCompareRow('C');
    expect(base()).toEqual(['A']);
    s.addCompareRow({ baseline: true }); // an explicit baseline demotes the old one
    expect(base()).toEqual(['C']);
  });

  it('selection follows the rows; removing the selected row falls back to the first', () => {
    const s = getScenario();
    s.addCompareRow();
    s.addCompareRow();
    expect(getScenario().compareSelected).toBe('A'); // first row auto-selected
    s.selectCompareRow('B');
    expect(getScenario().compareSelected).toBe('B');
    s.selectCompareRow('D'); // not a row → ignored
    expect(getScenario().compareSelected).toBe('B');
    s.removeCompareRow('B');
    expect(getScenario().compareSelected).toBe('A');
    s.removeCompareRow('A');
    expect(getScenario().compareSelected).toBeNull();
  });

  it('duplicate copies everything but the baseline flag', () => {
    const s = getScenario();
    s.addCompareRow({ tilt: { magnitudeDeg: 12, directionDeg: 45 }, heightM: 5 });
    const id = s.duplicateCompareRow('A');
    const [a, d] = getScenario().compareRows;
    expect(id).toBe('B');
    expect(d).toMatchObject({ id: 'B', tilt: a.tilt, heightM: 5, site: a.site, baseline: false });
  });

  it('slip on one row vs all: row slip stacks on the global slip', () => {
    const s = getScenario();
    s.addCompareRow();
    s.addCompareRow();
    s.setRowSlip('B', 9);
    s.setSlip(3);
    const [a, bRow] = getScenario().compareRows;
    expect(a.slipDays).toBe(0);
    expect(bRow.slipDays).toBe(9);
    expect(rowLandingUtc(a, 3) - a.landingUtc).toBe(3 * DAY_MS);
    expect(rowLandingUtc(bRow, 3) - bRow.landingUtc).toBe(12 * DAY_MS);
    s.setRowSlip('B', 99); // clamped
    expect(getScenario().compareRows[1].slipDays).toBe(30);
  });

  it('a row commit resets the live slip bus to the global slip (no stale row drag)', () => {
    const s = getScenario();
    s.addCompareRow();
    s.setSlip(4);
    slipBus.set({ slipDays: 17, dragging: true, rowId: 'A' });
    s.setRowSlip('A', 17);
    frameBus.flushNow();
    expect(slipBus.get()).toMatchObject({ slipDays: 4, dragging: false, rowId: null });
  });

  it('load into Cockpit copies site, effective landing and attitude, clears the global slip, switches view', () => {
    const s = getScenario();
    s.setView('compare');
    s.addCompareRow({
      site: { kind: 'site', id: 'cy3_shiv_shakti' },
      landingUtc: DEFAULT_SCENARIO.landingUtc,
      heightM: 10,
      panelPreset: 'trackingMast',
      tilt: { magnitudeDeg: 7, directionDeg: 180 },
    });
    s.setSlip(2);
    s.setRowSlip('A', 5);
    s.loadRowIntoCockpit('A');
    const c = getScenario();
    expect(c.view).toBe('cockpit');
    expect(c.site).toEqual({ kind: 'site', id: 'cy3_shiv_shakti' });
    expect(c.landingUtc).toBe(DEFAULT_SCENARIO.landingUtc + 7 * DAY_MS);
    expect(c.scrubUtc).toBe(c.landingUtc);
    expect(c.slipDays).toBe(0);
    expect(c).toMatchObject({ heightM: 10, panelPreset: 'trackingMast', tilt: { magnitudeDeg: 7, directionDeg: 180 } });
  });

  it('hydrate repairs rows: no baseline → first; two baselines → first flagged; selection kept valid', () => {
    const row = (id: 'A' | 'B' | 'C', baseline: boolean) => ({ ...DEFAULT_SCENARIO, id, baseline }) as never;
    getScenario().hydrate({ compareRows: [row('A', false), row('B', false)], compareSelected: 'C' });
    expect(getScenario().compareRows.map((r) => r.baseline)).toEqual([true, false]);
    expect(getScenario().compareSelected).toBe('A');
    getScenario().hydrate({ compareRows: [row('A', false), row('B', true), row('C', true)], compareSelected: 'C' });
    expect(getScenario().compareRows.map((r) => r.baseline)).toEqual([false, true, false]);
    expect(getScenario().compareSelected).toBe('C');
  });
});

describe('URL round-trip (Phase 4 fields)', () => {
  it('rows, baseline, per-row slip, selection, slip target, profile and centre tab survive encode → decode → hydrate', () => {
    const s = getScenario();
    s.addCompareRow({ site: { kind: 'site', id: 'shackleton_ridge' } });
    s.addCompareRow({ site: { kind: 'point', lat: -85.1, lon: 31.5 }, heightM: 5 });
    s.addCompareRow();
    s.setBaseline('B');
    s.setRowSlip('C', -6);
    s.selectCompareRow('C');
    s.setCompareSlipTarget('selected');
    s.setProfile({ minSunlitPct: 62, usableDodPct: 70, loadW: 45.5 });
    s.setCompareTab('calendar');
    const before = getScenario();
    const token = encodeScenario(before);

    s.reset();
    getScenario().hydrate(decodeScenario(token)!);
    const after = getScenario();
    expect(after.compareRows).toEqual(before.compareRows);
    expect(after.compareRows.find((r) => r.baseline)?.id).toBe('B');
    expect(after.compareSelected).toBe('C');
    expect(after.compareSlipTarget).toBe('selected');
    expect(after.profile).toEqual(before.profile);
    expect(after.compareTab).toBe('calendar');
  });

  it('rejects malformed Phase 4 fields', () => {
    const tok = (o: object) => `1.${Buffer.from(JSON.stringify(o)).toString('base64url')}`;
    const d = decodeScenario(
      tok({
        compareSelected: 'Z',
        compareSlipTarget: 'some',
        compareRows: [
          { id: 'A', slipDays: 400, heightM: 3, panelPreset: 'nope' },
          { id: 'A', baseline: true }, // duplicate id dropped
        ],
        profile: { usableDodPct: 'x' },
      }),
    )!;
    expect(d.compareSelected).toBeUndefined();
    expect(d.compareSlipTarget).toBeUndefined();
    expect(d.compareRows).toHaveLength(1);
    expect(d.compareRows![0]).toMatchObject({ slipDays: 30, heightM: 2, panelPreset: 'fourSide' });
    expect(d.profile!.usableDodPct).toBe(DEFAULT_SCENARIO.profile.usableDodPct);
  });

  it('old links without row slip / DoD still load', () => {
    const tok = (o: object) => `1.${Buffer.from(JSON.stringify(o)).toString('base64url')}`;
    const d = decodeScenario(tok({ compareRows: [{ id: 'B' }], profile: { batteryWh: 900 } }))!;
    expect(d.compareRows![0].slipDays).toBe(0);
    expect(d.profile).toMatchObject({ batteryWh: 900, usableDodPct: 80 });
  });
});

describe('Mission Profile validation', () => {
  it('parses numbers with units removed, rejects junk, ranges and fractions of days', () => {
    expect(parseField('minSunlitPct', ' 55 ')).toEqual({ value: 55 });
    expect(parseField('loadW', '12,5')).toEqual({ value: 12.5 });
    expect(parseField('minSunlitPct', '')).toEqual({ error: 'profile.err.number' });
    expect(parseField('minSunlitPct', '5x')).toEqual({ error: 'profile.err.number' });
    expect(parseField('minSunlitPct', '101')).toEqual({ error: 'profile.err.range' });
    expect(parseField('loadW', '0')).toEqual({ error: 'profile.err.range' }); // load must be > 0
    expect(parseField('surfaceDurationDays', '2.5')).toEqual({ error: 'profile.err.int' });
  });

  it('link hours cannot exceed the surface duration', () => {
    const p = { ...DEFAULT_SCENARIO.profile, surfaceDurationDays: 2, minLinkHours: 49 };
    expect(crossFieldErrors(p)).toEqual({ minLinkHours: 'profile.err.linkExceeds' });
    expect(crossFieldErrors({ ...p, minLinkHours: 48 })).toEqual({});
  });
});

describe('battery check (endurance = Wh × DoD ÷ W vs longest night)', () => {
  const p = { ...DEFAULT_SCENARIO.profile, batteryWh: 2000, usableDodPct: 80, loadW: 40 }; // 40 h
  it('uses the conservative (upper) night bound', () => {
    expect(enduranceHours(p)).toBe(40);
    const r = batteryCheck(p, b(30, 25, 36));
    expect(r).toMatchObject({ nightH: 36, nightBound: 'conservative', marginH: 4, status: 'pass' });
    expect(batteryHeadline(r, t).text).toBe('Survives longest night ✓ with 4.0 h margin');
  });
  it('fails when the upper bound exceeds endurance even if nominal passes', () => {
    const r = batteryCheck(p, b(38, 30, 46.5));
    expect(r.status).toBe('fail');
    expect(batteryHeadline(r, t)).toEqual({ glyph: '✗', text: 'Short of the longest night ✗ by 6.5 h' });
  });
  it('falls back to nominal, or unknown without data', () => {
    expect(batteryCheck(p, b(20, null, null))).toMatchObject({ nightBound: 'nominal', status: 'pass' });
    expect(batteryCheck(p, null).status).toBe('unknown');
  });
});

describe('requirement rows at the conservative bound', () => {
  const metrics = {
    sunlitPct: b(60, 48, 70), // limit ≥ 50: nominal passes, lo fails → marginal
    linkPct: b(80, 75, 85), // 14 d window = 336 h → lo 252 h ≥ 100 → pass
    longestNightH: b(40, 30, 90), // ≤ 72: hi 90 fails → marginal
    padSlopeDeg: b(14, 12, 16), // ≤ 10: nominal fails → fail
  } as unknown as MetricSet;
  it('shows limit, conservative and nominal, statuses from the engine rule', () => {
    const rows = requirementRows(metrics, DEFAULT_SCENARIO.profile, DEFAULT_SCENARIO.weights, 336, 'bounded');
    expect(rows.map((r) => [r.id, r.status, r.conservative])).toEqual([
      ['sunlit', 'marginal', 48],
      ['link', 'pass', 252],
      ['night', 'marginal', 90],
      ['slope', 'fail', 16],
    ]);
    expect(rows[0]).toMatchObject({ op: '≥', limit: 50, nominal: 60 });
  });
  it("uses the engine's own statuses when the result carries them (real mode)", () => {
    const eng = [
      { id: 'sunlit', status: 'pass' },
      { id: 'link', status: 'fail' },
      { id: 'night', status: 'unknown' },
      { id: 'slope', status: 'marginal' },
    ] as const;
    const rows = requirementRows(metrics, DEFAULT_SCENARIO.profile, DEFAULT_SCENARIO.weights, 336, 'bounded', eng);
    expect(rows.map((r) => r.status)).toEqual(['pass', 'fail', 'unknown', 'marginal']);
    expect(rows[1].conservative).toBe(252); // display values are still computed here
  });
  it('insufficient terrain evidence never confirms a geometry requirement; no metrics → all unknown', () => {
    const rows = requirementRows(metrics, DEFAULT_SCENARIO.profile, DEFAULT_SCENARIO.weights, 336, 'insufficient');
    expect(rows.find((r) => r.id === 'link')!.status).toBe('unknown');
    expect(rows.find((r) => r.id === 'slope')!.status).toBe('unknown');
    expect(requirementRows(null, DEFAULT_SCENARIO.profile, DEFAULT_SCENARIO.weights, 336, 'bounded').every((r) => r.status === 'unknown')).toBe(true);
  });
});

describe('display helpers', () => {
  it('summary line and number formatting', () => {
    expect(fmtNum(2000)).toBe('2 000');
    expect(fmtNum(26.666, 1)).toBe('26.7');
    expect(profileSummary(DEFAULT_SCENARIO.profile, t)).toBe(
      '14 d · sunlit ≥ 50% · link ≥ 100 h · night ≤ 72 h · slope ≤ 10° · 2 000 Wh × 80% ÷ 60 W = 26.7 h',
    );
  });
  it('site label + attitude summary', () => {
    const sites = [{ id: 'x', name: 'Ridge X', tier: 'A' }] as never;
    expect(siteLabel({ site: { kind: 'site', id: 'x' } }, sites, t)).toEqual({ name: 'Ridge X', tier: 'Tier A' });
    expect(siteLabel({ site: { kind: 'site', id: 'missing' } }, sites, t)).toEqual({ name: 'missing', tier: null });
    expect(siteLabel({ site: { kind: 'point', lat: -85, lon: 30 } }, sites, t).name).toMatch(/^Custom point /);
    expect(attitudeSummary({ panelPreset: 'fourSide', heightM: 2, tilt: { magnitudeDeg: 0, directionDeg: 0 } }, t)).toBe(
      '4 side panels · 2 m · no tilt',
    );
    expect(attitudeSummary({ panelPreset: 'trackingMast', heightM: 10, tilt: { magnitudeDeg: 9.6, directionDeg: 90 } }, t)).toBe(
      'tracking mast · 10 m · tilt 10° @ 90°',
    );
  });
});
