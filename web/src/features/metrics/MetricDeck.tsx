// Owner: Nived
// Metric Deck: Sun elevation hero tile + 2x4 tiles, each with its +/- (or [lo-hi]) and an InfoBadge.
// Reads the live result; `metrics` overrides it (forced-state fixtures, tests). `?fixture=worst-case` shows the worst-case strings.
import { useFixture } from '../../app/layout/fixture';
import { fmtPm } from '../../engine/format';
import { useResult } from '../../engine/hooks';
import type { MetricSet, ScenarioResult } from '../../engine/types';
import { PanelState } from '../answer/PanelState';
import { TILE_METRIC, metricTiles } from './metricTiles';
import { verdictLines } from './verdictLines';
import { WORST_CASE_METRICS } from '../../mocks/forced';
import { useCopyFn } from '../../state/copy';
import { InfoBadge } from '../../ui/InfoBadge';
import './metrics.css';

export function MetricDeck({
  metrics,
  result: given,
  onWhy,
}: {
  metrics?: MetricSet;
  /** Override the live result (tests, forced states). */
  result?: ScenarioResult;
  /** Optional: when given, the hero and every tile show a small "Why?" button that calls this with the tile's MetricSet field. Omitted = no button, markup unchanged. */
  onWhy?: (metricKey: keyof MetricSet) => void;
}) {
  const t = useCopyFn();
  const live = useResult();
  const result = given ?? live;
  const worst = useFixture()?.name === 'worst-case';
  const m = metrics ?? (worst ? WORST_CASE_METRICS : result.metrics);
  if (!m) return <PanelState status={result.status === 'error' ? 'error' : 'loading'} message={result.error} />;
  const hero = fmtPm(m.sunElevationDeg, 2, '\u00b0');
  const verdict = verdictLines(result.verdict, result.verdictReasons, t);
  return (
    <div className="metric-deck" data-tier={result.meta?.tier}>
      <div>
        <div className="metric-deck__hero-label">
          {t('metric.sunElevation')} <InfoBadge term="Sun elevation" />
          {onWhy && <WhyButton label={t('metric.sunElevation')} onClick={() => onWhy('sunElevationDeg')} />}
        </div>
        <div className="metric-deck__hero">
          <span>{hero.value}</span>
          {hero.pm && <span className="metric-deck__pm">{hero.pm}</span>}
        </div>
      </div>
      <div className="metric-deck__grid">
        {metricTiles(m, t).map(([key, text]) => (
          <div key={key} className="metric-deck__tile" data-metric={key}>
            <div className="metric-deck__label truncate">
              {t(key)} <InfoBadge term={t(key)} />
              {onWhy && TILE_METRIC[key] && <WhyButton label={t(key)} onClick={() => onWhy(TILE_METRIC[key])} />}
            </div>
            <div className="metric-deck__value truncate" title={text}>
              {text}
            </div>
          </div>
        ))}
      </div>
      <div className="metric-deck__verdict" data-verdict={result.verdict}>
        <div className="metric-deck__headline">{verdict.headline}</div>
        {verdict.lines.length > 0 && (
          <ul className="metric-deck__reasons">
            {verdict.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function WhyButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="metric-deck__why" aria-label={`Why this number? ${label}`} onClick={onClick}>
      Why?
    </button>
  );
}
