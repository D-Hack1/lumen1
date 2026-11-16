// Owner: Nived
// Answer Strip: Sun now / Earth now / next-event countdowns (± or grazing range) / window sunlit % and link %.
// Implements all 9 D-14 states from the pure `deriveAnswerState` output; every string comes from `useCopyFn`.
// `state` overrides the live result (forced-state fixtures, tests). `?answerState=<id>` and `?fixture=worst-case` force one too.
import { useFixture } from '../../app/layout/fixture';
import { fill, fmtBounded, fmtDeg } from '../../engine/format';
import { useResult } from '../../engine/hooks';
import type { AnswerState, ScenarioResult } from '../../engine/types';
import { forcedAnswerFromUrl, WORST_CASE_ANSWER } from '../../mocks/forced';
import { useCopyFn } from '../../state/copy';
import { useScenario } from '../../state/scenarioStore';
import { Badge } from '../../ui/Badge';
import { InfoBadge } from '../../ui/InfoBadge';
import { earthEventText, sunEventText } from './answerText';
import { PanelState } from './PanelState';
import './answer.css';

function Cell({ label, term, value, tag, up, state, hint }: { label: string; term?: string; value: string; tag?: React.ReactNode; up?: boolean; state?: string; hint?: string }) {
  return (
    <div className="answer-strip__cell" data-up={up} data-state={state}>
      <div className="answer-strip__label truncate">
        {label} {term && <InfoBadge term={term} />}
      </div>
      <div className="answer-strip__value" aria-live={state ? 'polite' : undefined}>
        <span className="truncate" title={hint ? `${value} \u2014 ${hint}` : value}>
          {value}
        </span>
        {tag}
      </div>
    </div>
  );
}

export function AnswerStrip({ state, result: given }: { state?: AnswerState; /** Override the live result (tests, forced states). */ result?: ScenarioResult }) {
  const t = useCopyFn();
  const live = useResult();
  const result = given ?? live;
  const storeDays = useScenario((s) => s.durationDays);
  const fixture = useFixture();
  const windowDays = fixture?.scenario?.durationDays ?? storeDays; // a fixture's window length wins (it is also applied to the store)
  const worst = fixture?.name === 'worst-case';
  const a = state ?? (worst ? WORST_CASE_ANSWER : forcedAnswerFromUrl()) ?? result.answer;
  if (!a) return <PanelState status={result.status === 'error' ? 'error' : 'loading'} message={result.error} />;

  const smooth = worst || result.meta?.tier === 'C';
  const note = smooth ? <span className="answer-strip__tag"> · {t('answer.smoothMoon')}</span> : null;
  const sunNow = `${fmtDeg(a.sun.elevDeg)} · ${fill(t('answer.disk'), { n: Math.round(a.sun.diskPct) })} · ${a.sun.up ? t('answer.up') : t('answer.down')}`;
  const earthNow = `${fmtDeg(a.earth.elevDeg)} · ${a.earth.linkUp ? t('answer.linkOk') : t('answer.linkDown')}`;

  return (
    <div className="answer-strip" data-sun-state={a.sun.state} data-earth-state={a.earth.state} data-grazing={a.sun.grazing || a.earth.grazing || undefined}>
      <Cell label={t('answer.sunNow')} term="Sun now" value={sunNow} up={a.sun.up} tag={<Badge tone={a.sun.up ? 'sun' : 'blocked'}>{a.sun.up ? t('answer.up') : t('answer.down')}</Badge>} />
      <Cell label={t('answer.label.' + a.sun.state)} value={sunEventText(a, t, windowDays)} state={a.sun.state} up={a.sun.up} hint={a.sun.grazing ? t('answer.grazingFull') : undefined} />
      <Cell label={t('answer.windowSunlit')} term="Window sunlit" value={fmtBounded(a.windowSunlitPct, 0, '%')} tag={note} />
      <Cell label={t('answer.earthNow')} term="Earth now" value={earthNow} up={a.earth.visible} tag={<Badge tone={a.earth.visible ? 'earth' : 'blocked'}>{a.earth.visible ? t('answer.up') : t('answer.down')}</Badge>} />
      <Cell label={t('answer.label.' + a.earth.state)} value={earthEventText(a, t)} state={a.earth.state} up={a.earth.visible} hint={a.earth.grazing ? t('answer.grazingFull') : undefined} />
      <Cell label={t('answer.windowLink')} term="Window link" value={fmtBounded(a.windowLinkPct, 0, '%')} tag={note} />
    </div>
  );
}
