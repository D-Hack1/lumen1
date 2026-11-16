// Owner: Abhinav
// Hard requirements at the conservative bound (+ the advisory battery row). Shared by the verdict popover (Cockpit
// result) and the Compare Mission Profile panel (selected row's result). Glyph + text per status, never colour alone.
import type { Bounded, ScenarioResult } from '../../engine/types';
import { useCopyFn } from '../../state/copy';
import { useScenario } from '../../state/scenarioStore';
import { batteryCheck, boundsKindOf, fmtNum, requirementRows } from './profileModel';
import { batteryHeadline } from './rowModel';

const GLYPH = { pass: '✓', marginal: '◐', fail: '✗', unknown: '○' } as const;

export function RequirementList({ result, compact }: { result: Pick<ScenarioResult, 'metrics' | 'meta'> & Partial<Pick<ScenarioResult, 'verdictRequirements'>> | null; compact?: boolean }) {
  const t = useCopyFn();
  const profile = useScenario((s) => s.profile);
  const weights = useScenario((s) => s.weights);
  const durationDays = useScenario((s) => s.durationDays);
  const metrics = result?.metrics ?? null;
  const rows = requirementRows(metrics, profile, weights, durationDays * 24, result ? boundsKindOf(result) : 'insufficient', result?.verdictRequirements);
  const night: Bounded | null = metrics?.longestNightH ?? null;
  const bat = batteryCheck(profile, night);
  const batHead = batteryHeadline(bat, t);

  return (
    <ul className="mp-req" data-compact={compact || undefined} aria-label={t('profile.req.title')}>
      {rows.map((r) => (
        <li key={r.id} className="mp-req__row" data-req={r.id} data-status={r.status}>
          <span className="mp-req__glyph" aria-hidden="true">
            {GLYPH[r.status]}
          </span>
          <span className="mp-req__label truncate">{t(`profile.${r.field}`)}</span>
          <span className="mp-req__limit num">
            {r.op} {fmtNum(r.limit)}
            {r.unit === '°' ? '°' : ` ${r.unit}`}
          </span>
          <span className="mp-req__value num" title={t('profile.req.valueHint')}>
            {r.conservative == null ? '—' : fmtNum(r.conservative, 1)}
            {r.nominal != null && r.conservative !== r.nominal && <span className="mp-req__nom"> ({fmtNum(r.nominal, 1)})</span>}
          </span>
          <span className="mp-req__status">{t(`profile.req.${r.status}`)}</span>
        </li>
      ))}
      <li className="mp-req__row mp-req__row--adv" data-req="battery" data-status={bat.status}>
        <span className="mp-req__glyph" aria-hidden="true">
          {bat.status === 'pass' ? '✓' : bat.status === 'fail' ? '✗' : '○'}
        </span>
        <span className="mp-req__label truncate" title={batHead.text}>
          {t('profile.req.battery')}
        </span>
        <span className="mp-req__limit num">{fmtNum(bat.enduranceH, 1)} h</span>
        <span className="mp-req__value num">{bat.nightH == null ? '—' : fmtNum(bat.nightH, 1)}</span>
        <span className="mp-req__status" title={t('battery.advisory.long')}>
          {t('battery.advisory')}
        </span>
      </li>
    </ul>
  );
}
