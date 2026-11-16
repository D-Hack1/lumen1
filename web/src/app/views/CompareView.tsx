// Owner: Abhinav
// Scenario Compare & Slip — zero-scroll 3-column bento (PLAN_FINAL §8.6, guide §4).
//   Left   : ScenarioRows (A–D) · MissionProfileForm                                      — mine
//   Centre : CompareSlip (all rows | selected row) · [Aligned Barcodes | Season Strip | 12-Month Calendar] (Ebin)
//            · DeltaTable (Nived) under the visual
//   Right  : ScanPanel (Nived, scrolls) · WindowsTable for the selected row (Ebin, scrolls)
// Teammate imports — all present:
//   Nived: ScanPanel, DeltaTable, useCompareResults · Ebin: AlignedBarcodes, SeasonStrip, FeasibilityCalendar, WindowsTable
import { DeltaTable } from '../../features/compareResults/DeltaTable';
import { ScanPanel } from '../../features/compareResults/ScanPanel';
import { AlignedBarcodes } from '../../features/compareVisuals/AlignedBarcodes';
import { SeasonStrip } from '../../features/compareVisuals/SeasonStrip';
import { FeasibilityCalendar } from '../../features/compareVisuals/FeasibilityCalendar';
import { WindowsTable } from '../../features/analysis/WindowsTable';
import { CompareSlip } from '../../features/scenarios/CompareSlip';
import { MissionProfileForm } from '../../features/scenarios/MissionProfileForm';
import { ScenarioRows } from '../../features/scenarios/ScenarioRows';
import { fill } from '../../engine/format';
import { useCompareResults } from '../../engine/hooks';
import { useCopyFn } from '../../state/copy';
import { useScenario, type CompareCentreTab } from '../../state/scenarioStore';
import { Segmented } from '../../ui/Segmented';
import { BentoColumn, BentoGrid } from '../layout/BentoGrid';
import { Slot } from '../layout/Slot';

export function CompareView() {
  const tab = useScenario((s) => s.compareTab);
  const setTab = useScenario((s) => s.setCompareTab);
  const selected = useScenario((s) => s.compareSelected);
  const compare = useCompareResults();
  const t = useCopyFn();

  const selResult = compare.rows.find((r) => r.scenarioId === selected)?.result ?? null;
  const night = selResult?.metrics?.longestNightH ?? null;
  /** Per-row Windows Table input: only a settled result (loading/idle rows fall back to the Cockpit's, labelled). */
  const rowResult = selResult?.status === 'ready' ? selResult : null;

  return (
    <BentoGrid view="compare">
      <BentoColumn side="left">
        <Slot id="scenarioRows">
          <ScenarioRows />
        </Slot>
        <Slot id="missionProfile">
          <MissionProfileForm
            variant="full"
            longestNightH={night}
            result={selResult}
            nightSource={selected ? fill(t('battery.source.row'), { id: selected }) : undefined}
          />
        </Slot>
      </BentoColumn>

      <BentoColumn side="centre">
        <Slot id="compareSlip">
          <CompareSlip />
        </Slot>
        <div className="compare-tabs" data-slot="compareTabs" data-budget="compareTabs">
          <Segmented<CompareCentreTab>
            size="sm"
            ariaLabel={t('slot.compareTabs')}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'aligned', label: t('compare.aligned') },
              { value: 'season', label: t('compare.season') },
              { value: 'calendar', label: t('compare.calendar') },
            ]}
          />
        </div>
        <Slot id="compareVisual">
          {tab === 'aligned' ? <AlignedBarcodes /> : tab === 'season' ? <SeasonStrip /> : <FeasibilityCalendar />}
        </Slot>
        <Slot id="deltaTable">
          <DeltaTable />
        </Slot>
      </BentoColumn>

      <BentoColumn side="right">
        <Slot id="scan">
          <ScanPanel />
        </Slot>
        <Slot id="compareWindows">
          <div className="cmp-win__cap" data-testid="compare-windows-caption">
            {/* The selected row's own result when it is ready; otherwise the Cockpit result, labelled as such. */}
            <span className="cmp-win__title">
              {rowResult ? fill(t('compare.windows.row'), { id: selected! }) : t('compare.windows.cockpit')}
            </span>
            {selected && !rowResult && (
              <span className="cmp-win__note truncate" title={t('compare.windows.pending.long')}>
                {fill(t('compare.windows.pending'), { id: selected })}
              </span>
            )}
          </div>
          <WindowsTable result={rowResult ?? undefined} />
        </Slot>
      </BentoColumn>
    </BentoGrid>
  );
}
