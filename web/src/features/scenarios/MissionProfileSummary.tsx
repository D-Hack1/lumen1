// Owner: Abhinav
// Mission Profile popover body, opened from the Mission Bar verdict chip (PLAN §8.2, §5.7).
// Lists every hard requirement with pass / marginal / fail / no data judged at the CONSERVATIVE bound (lo for a
// minimum, hi for a maximum), showing limit · conservative · nominal. Statuses come from the engine's verdict rule
// (profileModel → evaluateVerdict), so this list and the chip cannot disagree on the rule. The battery check is listed
// as advisory (not part of the engine verdict yet). Shows "provisional" when the chip is provisional or the Scan list
// holds stage-1 (nominal) results only (D-15). Footer: the one-line profile summary + "Edit in Compare".
import { useResult } from '../../engine/hooks';
import type { Verdict } from '../../engine/types';
import { useCopyFn } from '../../state/copy';
import { useScanStage } from '../../state/scanStatus';
import { useScenario } from '../../state/scenarioStore';
import { VERDICT_TONE } from '../../app/verdict';
import { Badge } from '../../ui/Badge';
import { profileSummary } from './profileModel';
import { RequirementList } from './RequirementList';
import './scenarios.css';

const MAX_REASONS = 3;

export interface MissionProfileSummaryProps {
  verdict: Verdict;
  provisional: boolean;
  reasons: string[];
  onEdit: () => void;
}

export function MissionProfileSummary({ verdict, provisional, reasons, onEdit }: MissionProfileSummaryProps) {
  const t = useCopyFn();
  const profile = useScenario((s) => s.profile);
  const result = useResult();
  const scanStage = useScanStage();
  const scanProvisional = scanStage === 1;
  const isProv = provisional || scanProvisional;

  const shownReasons = reasons.slice(0, MAX_REASONS);

  return (
    <div className="mp-summary" data-testid="verdict-popover">
      <div className="mp-summary__head">
        <span className="mp-summary__title">{t('profile.title')}</span>
        <Badge tone={isProv ? 'provisional' : VERDICT_TONE[verdict]} size="md" data-testid="verdict-popover-badge">
          {t(`verdict.${verdict}`)}
          {isProv && ` · ${t('verdict.provisional')}`}
        </Badge>
      </div>
      <p className="mp-summary__lede">{t(provisional ? 'verdict.provisional.long' : `verdict.${verdict}.long`)}</p>
      {scanProvisional && (
        <p className="mp-summary__prov" data-testid="verdict-scan-provisional">
          {t('profile.provisional.scan')}
        </p>
      )}

      <div className="mp-summary__section">{t('profile.req.title')}</div>
      <RequirementList result={result} />
      <p className="mp-summary__muted">{t('profile.req.legend')}</p>

      {shownReasons.length > 0 && (
        <>
          <div className="mp-summary__section">{t('profile.reasons')}</div>
          <ul className="mp-summary__reasons">
            {/* reasons are copy keys once the engine emits them (contract: "copy keys later"); raw text falls through */}
            {shownReasons.map((r) => (
              <li key={r}>{t(r)}</li>
            ))}
          </ul>
        </>
      )}

      <div className="mp-summary__foot">
        <span className="mp-summary__line num" data-testid="verdict-profile-summary" title={profileSummary(profile, t)}>
          {profileSummary(profile, t)}
        </span>
        <button type="button" className="mb-btn" onClick={onEdit}>
          {t('profile.edit')}
        </button>
      </div>
    </div>
  );
}
