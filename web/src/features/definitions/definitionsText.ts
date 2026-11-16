// Owner: Abhinav
// The one-line rule text shown in the Definitions Bar (PLAN §8.3 / §8.1 #4 "Definitions are visible"), built from the
// committed scenario — so it always states exactly what the engine was asked to use. Pure, unit-tested.
//   Planner:  "Sun available = ≥50% disk above terrain @2 m" · "Link = Earth ≥1° above terrain + DSN ≥10°"
//   Educator: plain-language sentences with the same numbers.
import { fill } from '../../engine/format';
import type { Definitions, MastHeightM } from '../../state/scenarioStore';

type T = (key: string) => string;

const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

export function sunRuleText(d: Definitions, heightM: MastHeightM, t: T): string {
  const ops = d.minSunElevationOps > 0 ? fill(t('def.sun.ops'), { deg: n(d.minSunElevationOps) }) : '';
  return fill(t('def.sun'), { disk: n(d.sunDiskThresholdPct), ops, h: heightM });
}

export function linkRuleText(d: Definitions, t: T): string {
  const disk = d.dteDiskThresholdPct !== 50 ? fill(t('def.link.disk'), { n: n(d.dteDiskThresholdPct) }) : '';
  const dsn = d.dsnMode === 'dsnAware' ? fill(t('def.link.dsn'), { deg: n(d.dsnMaskDeg) }) : t('def.link.noDsn');
  return fill(t('def.link'), { margin: n(d.earthMarginDeg), disk, dsn });
}

export function definitionsLine(d: Definitions, heightM: MastHeightM, t: T): string {
  return `${sunRuleText(d, heightM, t)} · ${linkRuleText(d, t)}`;
}
