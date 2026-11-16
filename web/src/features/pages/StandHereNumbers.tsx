// Owner: Nived
// "Numbers for this window" on Stand here: the engine's real numbers for the chosen site and array height, in the page's own (lm-) styling.
// Reuses the Metric Deck's pure, tested pieces (metricTiles, verdictLines) so formatting, +/- handling and labels have one source. Each tile has a
// "Why?" that opens Ask LUMEN on the explanation for that metric.
import { askWhy } from '../ask';
import type { MetricSet, ScenarioResult } from '../../engine/types';
import { TILE_METRIC, metricTiles } from '../metrics/metricTiles';
import { verdictLines } from '../metrics/verdictLines';
import { useCopyFn } from '../../state/copy';
import './standHereNumbers.css';

export function StandHereNumbers({ result, terrain, windowLabel }: { result: ScenarioResult; terrain: boolean; windowLabel: string }) {
  const t = useCopyFn();
  const m: MetricSet | null = result.metrics;
  if (!m || result.status !== 'ready') return null;
  const pending = result.meta?.stage === 'nominal'; // stage 1 of a staged evaluation: numbers only; the verdict and +/- are still being computed
  const verdict = pending ? { headline: 'Computing the uncertainty (±) and the verdict…', lines: [] as string[] } : verdictLines(result.verdict, result.verdictReasons, t);
  return (
    <section className="lm-nums lm-box" aria-label="Numbers for this window" data-verdict={pending ? 'computing' : result.verdict} data-stage={pending ? 'nominal' : 'final'}>
      <div className="lm-nums__head">
        <h2 className="lm-nums__title">Numbers for this window</h2>
        <span className="lm-nums__window">{windowLabel}</span>
      </div>
      <div className="lm-nums__badge" data-terrain={terrain ? 'mask' : 'smooth'}>
        {result.meta?.tierBadge}
        {terrain ? '' : ' · no terrain data for this site, so these are smooth-Moon values, not a real skyline'}
      </div>
      <div className="lm-nums__verdict">
        <strong>{verdict.headline}</strong>
        {verdict.lines.length > 0 && (
          <ul>
            {verdict.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="lm-nums__grid">
        {metricTiles(m, t).map(([key, text]) => (
          <div key={key} className="lm-nums__tile" data-metric={key}>
            <div className="lm-nums__label">
              {t(key)}
              {TILE_METRIC[key] && (
                <button type="button" className="lm-nums__why" aria-label={`Why this number? ${t(key)}`} onClick={() => askWhy(TILE_METRIC[key])}>
                  Why?
                </button>
              )}
            </div>
            <div className="lm-nums__value" title={text}>
              {text}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
