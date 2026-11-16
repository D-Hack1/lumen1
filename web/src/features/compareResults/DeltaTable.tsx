// Owner: Nived
// Delta Table: each scenario row vs the baseline (Δ sunlit %, Δ link %, Δ longest night) with propagated ±.
// Colour is never the only signal: every delta carries a sign and a ▲/▼ glyph. Baseline row is starred.
import { computeDeltas, DELTA_METRICS, higherIsBetter, type Delta, type DeltaMetric } from '../../engine/compare/delta';
import { signed } from '../../engine/format';
import { useCompareResults } from '../../engine/hooks';
import { useCopyFn } from '../../state/copy';
import './compareResults.css';

const UNIT: Record<DeltaMetric, string> = { sunlitPct: '%', linkPct: '%', longestNightH: ' h' };
const KEY: Record<DeltaMetric, string> = { sunlitPct: 'delta.sunlit', linkPct: 'delta.link', longestNightH: 'delta.night' };

export function DeltaCell({ metric, d }: { metric: DeltaMetric; d: Delta | null }) {
  if (!d) return <span>{'—'}</span>;
  const flat = Math.abs(d.value) < 1e-9;
  const good = higherIsBetter(metric) ? d.value > 0 : d.value < 0;
  return (
    <span className="delta__v" data-tone={flat ? 'flat' : good ? 'good' : 'bad'}>
      {flat ? '' : d.value > 0 ? '▲ ' : '▼ '}
      {signed(d.value, 0)}
      {UNIT[metric]}
      {d.pm > 0 && ` ± ${d.pm.toFixed(0)}${UNIT[metric]}`}
    </span>
  );
}

export function DeltaTable() {
  const t = useCopyFn();
  const { rows, baselineId, status } = useCompareResults();
  if (status !== 'ready' || rows.length < 2) {
    return <div className="delta__empty">{t('delta.empty')}</div>;
  }
  const deltas = computeDeltas(rows, baselineId);
  return (
    <div className="delta">
      <table className="rt">
        <thead>
          <tr>
            <th>{t('delta.metric')}</th>
            {DELTA_METRICS.map((m) => (
              <th key={m}>{t(KEY[m])}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.scenarioId} data-row={r.scenarioId} data-baseline={r.scenarioId === baselineId || undefined}>
              <td>
                {r.scenarioId}
                {r.scenarioId === baselineId ? ' ★' : ''}
              </td>
              {DELTA_METRICS.map((m) => (
                <td key={m}>{r.scenarioId === baselineId ? <span>{t('delta.baseline')}</span> : <DeltaCell metric={m} d={deltas[r.scenarioId]?.[m] ?? null} />}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
