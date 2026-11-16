// Owner: Abhinav
// Compare view global Slip slider (PLAN §8.6: ±30 d, all rows or the selected row).
// Target toggle [All rows | Row X]: "all" slips every row (global `slipDays`, also the Cockpit's), "selected" slips only
// the selected row (`row.slipDays`, on top of the global slip).
// Fast Lane (§1.3): the kit Slider is uncontrolled and native (no spring). Drag → `slipBus { slipDays, dragging,
// rowId }` only (rowId = the row being slipped, null = all) — subscribers redraw imperatively; no React state at
// pointer rate. Release / key → one store commit (`setSlip` or `setRowSlip`) → one recompute.
// The "slipped +N d" readout is written from slipBus via a ref.
import { useEffect, useRef } from 'react';
import { fill } from '../../engine/format';
import { slipBus } from '../../state/buses';
import { useCopyFn } from '../../state/copy';
import { getScenario, useScenario, type CompareSlipTarget } from '../../state/scenarioStore';
import { Chip } from '../../ui/Chip';
import { Segmented } from '../../ui/Segmented';
import { Slider } from '../../ui/Slider';
import './scenarios.css';

const clamp = (d: number) => Math.max(-30, Math.min(30, Math.round(d)));

export function CompareSlip() {
  const t = useCopyFn();
  const target = useScenario((s) => s.compareSlipTarget);
  const selected = useScenario((s) => s.compareSelected);
  const globalSlip = useScenario((s) => s.slipDays);
  const rowSlip = useScenario((s) => s.compareRows.find((r) => r.id === s.compareSelected)?.slipDays ?? 0);
  const hasRows = useScenario((s) => s.compareRows.length > 0);
  const rowMode = target === 'selected' && selected != null;
  const value = rowMode ? rowSlip : globalSlip;
  const chipRef = useRef<HTMLSpanElement>(null);

  // Readout follows the live drag value (ref write), and the committed value otherwise.
  useEffect(() => {
    const paint = () => {
      const bus = slipBus.get();
      const live = bus.dragging && (rowMode ? bus.rowId === selected : bus.rowId == null);
      const d = live ? bus.slipDays : value;
      if (chipRef.current) chipRef.current.textContent = d === 0 ? t('slip.none') : fill(t('slip.chip'), { d: d > 0 ? `+${d}` : `${d}` });
    };
    paint();
    return slipBus.subscribe(paint);
  }, [rowMode, selected, value, t]);

  const commit = (v: number) => {
    const d = clamp(v);
    if (rowMode && selected) getScenario().setRowSlip(selected, d);
    else getScenario().setSlip(d);
  };

  return (
    <div className="cmp-slip">
      <Segmented<CompareSlipTarget>
        size="sm"
        ariaLabel={t('slip.target.label')}
        value={target}
        onChange={(v) => getScenario().setCompareSlipTarget(v)}
        options={[
          { value: 'all', label: t('slip.target.all') },
          {
            value: 'selected',
            label: selected ? fill(t('slip.target.row'), { id: selected }) : t('slip.target.selected'),
            disabled: !hasRows,
            title: hasRows ? undefined : t('slip.target.noRows'),
          },
        ]}
      />
      <Chip aria-label={t('slip.minus')} onClick={() => commit(value - 1)}>
        ◀
      </Chip>
      <Slider
        className="cmp-slip__slider"
        value={value}
        min={-30}
        max={30}
        step={1}
        ariaLabel={`${t('slip.label')} — ${rowMode ? fill(t('slip.target.row'), { id: selected! }) : t('slip.target.all')}`}
        hotpath
        onLive={(v) => slipBus.set({ slipDays: v, dragging: true, rowId: rowMode ? selected : null })}
        onCommit={commit}
      />
      <Chip aria-label={t('slip.plus')} onClick={() => commit(value + 1)}>
        ▶
      </Chip>
      <Chip onClick={() => commit(0)} disabled={value === 0}>
        {t('slip.reset')}
      </Chip>
      <span ref={chipRef} className="num cmp-slip__chip" data-hotpath="" aria-live="off" />
    </div>
  );
}
