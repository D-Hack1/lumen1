// Owner: Nived
// G11: export -> parse round trip is lossless; header block present; earthTwin sanity.
import { describe, expect, it } from 'vitest';
import { dayLengthHours, declinationDeg, earthTwinDay, hasTwilight } from '../core/earthTwin';
import { exportCsv, parseExportCsv, parseWindowsCsv } from '../export/csv';
import { exportJson } from '../export/json';
import { mockScenarioResult } from '../../mocks/mockResult';
import type { ScenarioResult, WindowRecord } from '../types';

const site = { id: 'im2_athena', tier: 'A' as const, nearFieldResM: 5, sigmaSource: 'default', psr: { distanceKm: 4.2, bearingDeg: 312, areaKm2: 2.8, source: 'derived' as const }, padSlopeDeg: 7, mock: true };
const result = mockScenarioResult(site);
// a window with the awkward cases: null +/-, a comma in no field, fractional ms-free times, partial flags
const tricky: WindowRecord = { type: 'link', start: Date.UTC(2025, 2, 6, 17, 28, 50, 123), end: Date.UTC(2025, 2, 9, 4, 10, 0, 7), startPmMs: 5 * 3_600_000, endPmMs: null, durationH: { value: 58.6, lo: 50.25, hi: null }, peakElevDeg: 1.23456789012345, flags: { grazing: true, partialStart: true, partialEnd: false } };
const withTricky: ScenarioResult = { ...result, windows: [...result.windows, tricky] };

describe('export round trip (G11)', () => {
  it('CSV windows come back identical, including nulls, full precision and flags', () => {
    const back = parseWindowsCsv(exportCsv(withTricky, 'windows'));
    expect(back).toEqual(withTricky.windows);
    expect(back.at(-1)!.peakElevDeg).toBe(1.23456789012345);
  });
  it('header block carries site, tier, sigma source, definitions, data versions, and the mock flag', () => {
    const { header } = parseExportCsv(exportCsv(result, 'windows'));
    expect(header.site).toBe('im2_athena');
    expect(header.sigma_source).toBe('default');
    expect(header.definitions).toMatch(/Sun available/);
    expect(JSON.parse(header.data_versions)).toEqual(result.meta!.dataVersions);
    expect(header.mock).toBe('true');
    expect(header.lumen_export_version).toBe('1');
  });
  it('metrics CSV keeps value / lo / hi and survives commas in text fields', () => {
    const csv = exportCsv({ ...result, meta: { ...result.meta!, definitionsSummary: 'a, "quoted", definition' } }, 'metrics');
    const { header, columns, rows } = parseExportCsv(csv);
    expect(header.definitions).toBe('a, "quoted", definition');
    expect(columns).toEqual(['metric', 'value', 'lo', 'hi']);
    const sunlit = rows.find((r) => r[0] === 'sunlitPct')!;
    expect(Number(sunlit[1])).toBe(result.metrics!.sunlitPct.value);
    expect(rows.some((r) => r[0] === 'psrDistanceKm.km' && Number(r[1]) === 4.2)).toBe(true);
  });
  it('JSON is lossless', () => {
    const j = JSON.parse(exportJson(withTricky, 'windows'));
    expect(j.windows).toEqual(JSON.parse(JSON.stringify(withTricky.windows)));
    expect(j.header.site).toBe('im2_athena');
    expect(JSON.parse(exportJson(result, 'metrics')).metrics.sunlitPct).toEqual(result.metrics!.sunlitPct);
  });
  it('rejects a file that is not a windows export', () => {
    expect(() => parseWindowsCsv(exportCsv(result, 'metrics'))).toThrow(/not a LUMEN windows export/);
  });
});

describe('Earth Twin', () => {
  const dec = Date.UTC(2025, 11, 21);
  const jun = Date.UTC(2025, 5, 21);
  it('declination swings +/-23.4 deg across the year', () => {
    expect(declinationDeg(dec)).toBeCloseTo(-23.44, 0);
    expect(declinationDeg(jun)).toBeCloseTo(23.44, 0);
    expect(Math.abs(declinationDeg(Date.UTC(2025, 2, 21)))).toBeLessThan(1);
  });
  it('day length: polar day/night at 85S, ~12 h at the equator, ordinary mid-latitude', () => {
    expect(dayLengthHours(-85, dec)).toBe(24);
    expect(dayLengthHours(-85, jun)).toBe(0);
    expect(dayLengthHours(0, Date.UTC(2025, 2, 21))).toBeCloseTo(12, 0);
    expect(dayLengthHours(-45, dec)).toBeGreaterThan(14);
  });
  it('the Sun path peaks at local noon and is symmetric', () => {
    const day = earthTwinDay(-45, dec);
    const peak = day.reduce((a, b) => (b.elevationDeg > a.elevationDeg ? b : a));
    expect(peak.hour).toBeCloseTo(12, 0);
    expect(peak.elevationDeg).toBeCloseTo(90 - Math.abs(-45 + 23.44), 0); // southern summer: Sun is high (68.4 deg)
    expect(day[0].elevationDeg).toBeCloseTo(day.at(-1)!.elevationDeg, 6);
  });
  it('Earth has twilight where the Sun skims the horizon; polar-night 85S in June has none', () => {
    expect(hasTwilight(-45, dec)).toBe(true);
    expect(hasTwilight(-85, jun)).toBe(false); // Sun stays far below -6 deg all day
  });
});
