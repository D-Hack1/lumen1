// Owner: Nived
// The 8 Metric Deck tiles as [copy key, text]. Pure; separate from the component file for fast refresh and tests.
import { fmtBounded, signed } from '../../engine/format';
import type { MetricSet } from '../../engine/types';

type T = (key: string) => string;

/** The 8 tiles as [copy key, text]. Exported so tests can assert on content without rendering. */
export function metricTiles(m: MetricSet, t: T): Array<[string, string]> {
  const psr = m.psrDistanceKm;
  const clearance = m.sunClearanceDeg.value == null ? '—' : `${signed(m.sunClearanceDeg.value, 2)}° · ${Math.round(m.sunDiskPct.value ?? 0)}%`;
  const earth = m.earthElevationDeg.value == null ? '—' : `${signed(m.earthElevationDeg.value, 2)}° · ${fmtBounded(m.dteMarginDeg, 1, '°')}`;
  return [
    ['metric.clearance', clearance],
    ['metric.earthEl', earth],
    ['metric.sunlit', fmtBounded(m.sunlitPct, 0, '%')],
    ['metric.link', fmtBounded(m.linkPct, 0, '%')],
    ['metric.longestNight', fmtBounded(m.longestNightH, 0, ' h')],
    ['metric.commGap', fmtBounded(m.longestCommGapH, 0, ' h')],
    ['metric.ops', fmtBounded(m.opsHours, 0, ' h')],
    ['metric.psr', psr ? `${psr.km.toFixed(1)} km · ${Math.round(psr.bearingDeg)}° · ${psr.areaKm2} km² (${t('metric.psrDerived')})` : '—'],
  ];
}


/** The MetricSet field each tile is about (the tile's copy key is not the field name). Used by the optional "Why?" hook. */
export const TILE_METRIC: Record<string, keyof MetricSet> = {
  'metric.clearance': 'sunClearanceDeg',
  'metric.earthEl': 'earthElevationDeg',
  'metric.sunlit': 'sunlitPct',
  'metric.link': 'linkPct',
  'metric.longestNight': 'longestNightH',
  'metric.commGap': 'longestCommGapH',
  'metric.ops': 'opsHours',
  'metric.psr': 'psrDistanceKm',
};
