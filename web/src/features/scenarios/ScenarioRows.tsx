// Owner: Abhinav
// Compare scenario rows A–D (PLAN §8.6, WORK_DISTRIBUTION A-10). Rows live in the store (`compareRows`, ≤ 4).
// Each row: colour tag + letter · baseline ★ (exactly one, radio-like) · site name + tier · effective landing UTC
// (global + row slip) · attitude summary (panel preset · height · tilt) · verdict · duplicate / load into Cockpit /
// remove. Click a row to select it (Windows Table + "selected row" slip target). "+ Compare" on site cards and
// Shift-click on map pins add rows through the same store action (no code here).
// Fast Lane: while a slip drag runs, the landing time of the affected rows is rewritten from `slipBus` via refs
// (textContent, data-hotpath, no React state). Row add/remove: 160 ms emil transition (useListTransition).
import { useEffect, useMemo, useRef } from 'react';
import { useFixture } from '../../app/layout/fixture';
import { formatUtc } from '../../app/time';
import { VERDICT_TONE } from '../../app/verdict';
import { fill } from '../../engine/format';
import { useCatalog, useCompareResults } from '../../engine/hooks';
import type { Verdict } from '../../engine/types';
import { slipBus } from '../../state/buses';
import { useCopyFn } from '../../state/copy';
import {
  DAY_MS,
  MAX_COMPARE_ROWS,
  getScenario,
  useScenario,
  type CompareRowId,
} from '../../state/scenarioStore';
import { Badge } from '../../ui/Badge';
import { toast } from '../../ui/Toast';
import { Tooltip } from '../../ui/Tooltip';
import { attitudeSummary, fmtSlip, siteLabel } from './rowModel';
import { useListTransition } from './useListTransition';
import './scenarios.css';

export function ScenarioRows() {
  const t = useCopyFn();
  const fixture = useFixture();
  const catalog = useCatalog();
  const sites = fixture?.sites ?? catalog.sites;
  const rows = useScenario((s) => s.compareRows);
  const selected = useScenario((s) => s.compareSelected);
  const globalSlip = useScenario((s) => s.slipDays);
  const compare = useCompareResults();
  const { list, ref } = useListTransition(rows, (r) => r.id);
  const full = rows.length >= MAX_COMPARE_ROWS;

  const verdictOf = useMemo(() => {
    const m = new Map<string, Verdict>();
    if (compare.status === 'ready') for (const r of compare.rows) m.set(r.scenarioId, r.result.verdict);
    return m;
  }, [compare]);

  // Fast Lane: live landing times during a slip drag (refs + textContent only).
  const landingEls = useRef(new Map<CompareRowId, HTMLElement>());
  const slipEls = useRef(new Map<CompareRowId, HTMLElement>());
  useEffect(() => {
    const paint = () => {
      const bus = slipBus.get();
      const s = getScenario();
      for (const r of s.compareRows) {
        const g = bus.dragging && bus.rowId == null ? bus.slipDays : s.slipDays;
        const own = bus.dragging && bus.rowId === r.id ? bus.slipDays : (r.slipDays ?? 0);
        const total = g + own;
        const el = landingEls.current.get(r.id);
        if (el) el.textContent = formatUtc(r.landingUtc + total * DAY_MS);
        const chip = slipEls.current.get(r.id);
        if (chip) {
          chip.textContent = total === 0 ? '' : fill(t('rows.slip'), { d: fmtSlip(total) });
          chip.hidden = total === 0;
        }
      }
    };
    return slipBus.subscribe(paint);
  }, [t]);

  const add = () => {
    const id = getScenario().addCompareRow();
    if (id) toast(fill(t('sb.compare.added'), { id }), { tone: 'success' });
  };
  const dup = (id: CompareRowId) => {
    const n = getScenario().duplicateCompareRow(id);
    if (n) toast(fill(t('rows.duplicated'), { id, n }), { tone: 'success' });
  };
  const load = (id: CompareRowId) => {
    getScenario().loadRowIntoCockpit(id);
    toast(fill(t('rows.loaded'), { id }), { tone: 'success' });
  };

  const addBtn = (
    <button
      type="button"
      className="sc-add"
      onClick={add}
      disabled={full}
      aria-disabled={full || undefined}
      aria-label={full ? t('rows.full') : t('rows.add.long')}
    >
      {t('rows.add')}
    </button>
  );

  return (
    <div className="sc-rows" data-count={rows.length}>
      <div className="sc-rows__head">
        <span className="sc-rows__title">{t('rows.title')}</span>
        <span className="sc-rows__count num">
          {rows.length}/{MAX_COMPARE_ROWS}
        </span>
        <span className="sc-rows__spacer" />
        {/* disabled buttons get no pointer events, so the tooltip sits on a wrapper */}
        <Tooltip content={full ? t('rows.full') : t('rows.add.long')} side="bottom">
          <span className="sc-add-wrap" tabIndex={full ? 0 : -1}>
            {addBtn}
          </span>
        </Tooltip>
      </div>

      {rows.length === 0 && list.length === 0 && <p className="sc-rows__empty">{t('rows.empty')}</p>}

      <ul className="sc-rows__list" role="list">
        {list.map(({ key, item: r, leaving }) => {
          const { name, tier } = siteLabel(r, sites, t);
          const total = globalSlip + (r.slipDays ?? 0);
          const v = verdictOf.get(r.id);
          const isSel = r.id === selected;
          return (
            <li
              key={key}
              ref={ref(key)}
              className="sc-row"
              data-row={r.id}
              data-selected={isSel || undefined}
              data-baseline={r.baseline || undefined}
              data-leaving={leaving || undefined}
              aria-hidden={leaving || undefined}
            >
              <span className="sc-row__tag" aria-hidden="true">
                {r.id}
              </span>
              <button
                type="button"
                className="ui-icon-btn sc-row__star"
                aria-pressed={r.baseline}
                aria-label={fill(t(r.baseline ? 'rows.isBaseline' : 'rows.makeBaseline'), { id: r.id })}
                title={fill(t(r.baseline ? 'rows.isBaseline' : 'rows.makeBaseline'), { id: r.id })}
                onClick={() => getScenario().setBaseline(r.id)}
                disabled={leaving}
              >
                {r.baseline ? '★' : '☆'}
              </button>
              <button
                type="button"
                className="sc-row__main"
                aria-pressed={isSel}
                aria-label={`${fill(t('rows.select'), { id: r.id })}: ${name}`}
                onClick={() => getScenario().selectCompareRow(r.id)}
                disabled={leaving}
              >
                <span className="sc-row__l1">
                  <span className="sc-row__name truncate" title={name}>
                    {name}
                  </span>
                  {tier && (
                    <Badge tone="tier" className="sc-row__tier">
                      {tier}
                    </Badge>
                  )}
                </span>
                <span className="sc-row__l2">
                  <span
                    className="num sc-row__utc"
                    data-hotpath=""
                    ref={(el) => {
                      if (el) landingEls.current.set(r.id, el);
                      else landingEls.current.delete(r.id);
                    }}
                  >
                    {formatUtc(r.landingUtc + total * DAY_MS)}
                  </span>
                  <span
                    className="num sc-row__slip"
                    data-hotpath=""
                    hidden={total === 0}
                    ref={(el) => {
                      if (el) slipEls.current.set(r.id, el);
                      else slipEls.current.delete(r.id);
                    }}
                  >
                    {total === 0 ? '' : fill(t('rows.slip'), { d: fmtSlip(total) })}
                  </span>
                  <span className="sc-row__att truncate" title={attitudeSummary(r, t)}>
                    {attitudeSummary(r, t)}
                  </span>
                </span>
              </button>
              <span className="sc-row__side">
                {v ? (
                  <Badge tone={VERDICT_TONE[v]} className="sc-row__verdict" title={t(`verdict.${v}.long`)}>
                    {t(`verdict.${v}`)}
                  </Badge>
                ) : (
                  <span className="sc-row__verdict-ph" aria-hidden="true" />
                )}
                <span className="sc-row__acts">
                  <button
                    type="button"
                    className="ui-icon-btn"
                    aria-label={full ? t('rows.full') : fill(t('rows.duplicate'), { id: r.id })}
                    title={full ? t('rows.full') : fill(t('rows.duplicate'), { id: r.id })}
                    disabled={full || leaving}
                    onClick={() => dup(r.id)}
                  >
                    ⧉
                  </button>
                  <button
                    type="button"
                    className="ui-icon-btn"
                    aria-label={fill(t('rows.load'), { id: r.id })}
                    title={fill(t('rows.load'), { id: r.id })}
                    disabled={leaving}
                    onClick={() => load(r.id)}
                  >
                    ↗
                  </button>
                  <button
                    type="button"
                    className="ui-icon-btn"
                    aria-label={fill(t('rows.remove'), { id: r.id })}
                    title={fill(t('rows.remove'), { id: r.id })}
                    disabled={leaving}
                    onClick={() => getScenario().removeCompareRow(r.id)}
                  >
                    ×
                  </button>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
