// Owner: Abhinav
// Pure display helpers for Compare rows and the battery verdict (unit-tested; no React).
import { fill } from '../../engine/format';
import type { SiteRecord } from '../../engine/types';
import type { CompareRow } from '../../state/scenarioStore';
import { fmtLatLon } from '../sidebar/siteModel';
import { fmtNum, type BatteryCheck } from './profileModel';

type T = (k: string) => string;

/** Row site name + tier label (catalog lookup; custom points get their coordinates). */
export function siteLabel(row: Pick<CompareRow, 'site'>, sites: readonly SiteRecord[], t: T): { name: string; tier: string | null } {
  if (row.site.kind === 'point') return { name: fill(t('rows.custom'), { coords: fmtLatLon(row.site) }), tier: null };
  const id = row.site.id;
  const s = sites.find((x) => x.id === id);
  if (!s) return { name: id, tier: null };
  return { name: s.name, tier: s.tier === 'pending' ? t('sb.tier.pending') : fill(t('sb.tier'), { tier: s.tier }) };
}

/** "4 side panels · 2 m · tilt 10° @ 90°" */
export function attitudeSummary(row: Pick<CompareRow, 'panelPreset' | 'heightM' | 'tilt'>, t: T): string {
  const tilt =
    row.tilt.magnitudeDeg > 0
      ? fill(t('rows.tilt'), { m: Math.round(row.tilt.magnitudeDeg), d: Math.round(row.tilt.directionDeg) })
      : t('rows.noTilt');
  return `${t(`rows.preset.${row.panelPreset}`)} · ${row.heightM} m · ${tilt}`;
}

export const fmtSlip = (d: number) => (d > 0 ? `+${d}` : `${d}`);

/** Battery verdict headline: glyph + persona text (never colour alone). */
export function batteryHeadline(b: BatteryCheck, t: T): { glyph: string; text: string } {
  if (b.status === 'unknown') return { glyph: '○', text: t('battery.unknown') };
  const h = fmtNum(Math.abs(b.marginH!), 1);
  return b.status === 'pass'
    ? { glyph: '✓', text: fill(t('battery.survives'), { h }) }
    : { glyph: '✗', text: fill(t('battery.short'), { h }) };
}
