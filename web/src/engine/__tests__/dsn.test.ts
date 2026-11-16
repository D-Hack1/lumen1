// Owner: Nived
// Seam 1 (N-8, DSN-aware link): the pure DSN functions on the Moon-elevation series.
// Oracle for real data: fixtures/dsn_parity.json = a numpy decode of dsn.bin that does NOT use the TS loader or Gowri's dsn.py
// (python3 web/src/mocks/make_dsn_parity.py), plus hand-built series with known answers.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dsnElevationsAt, dsnLinkUp, dsnStationsUp } from '../core/dsn';
import type { DsnSeries } from '../data/dsn';
import { loadDsn } from '../data/dsn';
import { setDataMode } from '../data/source';
import fixture from './fixtures/dsn_parity.json';
import { PUBLIC, stubFetch } from './helpers';

/** Three stations, 10-minute nodes starting at t=0: a[k][i] in degrees. */
const series = (a: number[][]): DsnSeries => ({ stations: ['A', 'B', 'C'], startMs: 0, cadenceMs: 600_000, count: a[0].length, elevDeg: (k, i) => a[k][i] });
const MIN = 60_000;

describe('dsnElevationsAt (linear interpolation between the 10-minute nodes)', () => {
  const s = series([[0, 10, 20], [-5, -5, -5], [40, 30, 20]]);
  it('returns the node value on a node and the linear blend between nodes', () => {
    expect(dsnElevationsAt(s, 0)).toEqual([0, -5, 40]);
    expect(dsnElevationsAt(s, 10 * MIN)).toEqual([10, -5, 30]);
    expect(dsnElevationsAt(s, 15 * MIN)![0]).toBeCloseTo(15, 12);
    expect(dsnElevationsAt(s, 5 * MIN)![2]).toBeCloseTo(35, 12);
  });
  it('is null outside the series (no extrapolation): before the start, after the last node', () => {
    expect(dsnElevationsAt(s, -1)).toBeNull();
    expect(dsnElevationsAt(s, 20 * MIN + 1)).toBeNull();
    expect(dsnElevationsAt(s, 20 * MIN)).toEqual([20, -5, 20]); // the last node itself is inside
  });
});

describe('dsnLinkUp: at least one complex sees the Moon at or above the mask', () => {
  const s = series([[0, 10, 20], [-5, -5, -5], [40, 30, 20]]);
  it('true when any station is at or above the mask (inclusive), false when none is', () => {
    expect(dsnLinkUp(s, 0, 10)).toBe(true); // C = 40
    expect(dsnLinkUp(s, 20 * MIN, 20)).toBe(true); // A and C exactly 20: inclusive
    expect(dsnLinkUp(s, 20 * MIN, 20.5)).toBe(false);
    expect(dsnLinkUp(series([[1, 1], [2, 2], [3, 3]]), 5 * MIN, 10)).toBe(false);
  });
  it('a lower mask admits more: monotone in the mask', () => {
    for (let t = 0; t <= 20 * MIN; t += 3 * MIN) {
      const up = [-10, 0, 10, 25, 45].map((m) => dsnLinkUp(s, t, m));
      for (let i = 1; i < up.length; i++) expect(up[i] && !up[i - 1], `t=${t / MIN} min`).toBe(false); // once down at a mask, never up at a higher one
    }
  });
  it('is false outside the series (an unknown is not a link)', () => {
    expect(dsnLinkUp(s, -MIN, -90)).toBe(false);
    expect(dsnLinkUp(s, 21 * MIN, -90)).toBe(false);
  });
  it('dsnStationsUp tells which complexes', () => {
    expect(dsnStationsUp(s, 10 * MIN, 10)).toEqual([true, false, true]);
  });
});

const run = existsSync(join(PUBLIC, 'data/dsn/dsn.bin')) && statSync(join(PUBLIC, 'data/dsn/dsn.bin')).size > 1_000_000;
describe.skipIf(!run)('real dsn.bin vs the independent numpy decode', () => {
  let dsn: DsnSeries;
  beforeAll(async () => {
    setDataMode('real');
    stubFetch();
    dsn = await loadDsn();
  });
  afterAll(() => setDataMode(null));

  it('has the documented layout: Goldstone, Canberra, Madrid at 10-minute nodes from 2023-01-01', () => {
    expect(dsn.stations).toEqual(fixture.stations);
    expect(dsn.cadenceMs).toBe(fixture.cadenceS * 1000);
    expect(dsn.startMs).toBe(Date.parse(fixture.startUtc));
  });

  it(`interpolated elevations and the 10 deg link flag agree on ${fixture.cases.length} instants (incl. ${fixture.cases.filter((c) => !c.any10).length} with the link DOWN)`, () => {
    expect(fixture.cases.some((c) => !c.any10)).toBe(true);
    expect(fixture.cases.some((c) => c.any10)).toBe(true);
    for (const c of fixture.cases) {
      const e = dsnElevationsAt(dsn, c.utcMs)!;
      c.elevDeg.forEach((want, k) => expect(Math.abs(e[k] - want), `${c.utcMs} station ${k}`).toBeLessThan(1e-9));
      expect(dsnLinkUp(dsn, c.utcMs, 10), `${new Date(c.utcMs).toISOString()}`).toBe(c.any10);
      expect(dsnLinkUp(dsn, c.utcMs, 0)).toBe(c.any0);
      expect(dsnStationsUp(dsn, c.utcMs, 10)).toEqual(c.stations);
    }
  });

  it('physics: three complexes ~120 deg apart cover the Moon above 10 deg almost all the time (2025: numpy says 98.0%)', () => {
    const t0 = Date.UTC(2025, 0, 1);
    const n = 365 * 144;
    let up = 0;
    for (let i = 0; i < n; i++) if (dsnLinkUp(dsn, t0 + i * 600_000, 10)) up++;
    expect(Math.abs(up / n - fixture.fraction2025Any10)).toBeLessThan(0.003);
    expect(up / n).toBeGreaterThan(0.9);
    expect(up / n).toBeLessThan(1);
  });
});
