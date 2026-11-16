// Owner: Abhinav
// Mission Cockpit — 3-column zero-scroll bento (PLAN_FINAL §8.3, guide §4).
//
// Teammate imports (agreed paths, WORK_DISTRIBUTION §5):
//   Nived: AnswerStrip, MetricDeck, Basemap (embedded by my Sidebar) · Ebin: Ribbon, AnalysisPanel, Barcode,
//   SlipBar, TouchdownPad. Mine: Sidebar (search + map + site list slots), DefinitionsBar.
import { useState } from 'react';
import { AnswerStrip } from '../../features/answer/AnswerStrip';
import { DefinitionsBar } from '../../features/definitions/DefinitionsBar';
import { MetricDeck } from '../../features/metrics/MetricDeck';
import { Ribbon } from '../../features/ribbon/Ribbon';
import { AnalysisPanel } from '../../features/analysis/AnalysisPanel';
import { Barcode } from '../../features/barcode/Barcode';
import { SlipBar } from '../../features/barcode/SlipBar';
import { TouchdownPad } from '../../features/touchdown/TouchdownPad';
import { Sidebar } from '../../features/sidebar/Sidebar';
import { ProfileBatteryAccordion } from '../../features/scenarios/ProfileBatteryAccordion';
import { useCopyFn } from '../../state/copy';
import { Segmented } from '../../ui/Segmented';
import { BentoColumn, BentoGrid } from '../layout/BentoGrid';
import { Slot } from '../layout/Slot';
import { useViewport } from '../layout/viewport';

type RightTab = 'metrics' | 'touchdown';

export function CockpitView() {
  const { rightTabs } = useViewport();
  const [rightTab, setRightTab] = useState<RightTab>('metrics');
  const t = useCopyFn();

  return (
    <BentoGrid view="cockpit">
      <BentoColumn side="left">
        <Sidebar />
      </BentoColumn>

      <BentoColumn side="centre">
        <Slot id="answer">
          <AnswerStrip />
        </Slot>
        <Slot id="definitions">
          <DefinitionsBar />
        </Slot>
        <Slot id="ribbon">
          <Ribbon />
        </Slot>
        <Slot id="analysis">
          <AnalysisPanel />
        </Slot>
        <Slot id="barcode">
          <Barcode />
        </Slot>
        <Slot id="slip">
          <SlipBar />
        </Slot>
      </BentoColumn>

      <BentoColumn side="right" className={rightTabs ? 'is-tabs' : undefined}>
        {rightTabs && (
          <div className="right-tabs">
            <Segmented<RightTab>
              as="tabs"
              size="sm"
              ariaLabel="Right column"
              value={rightTab}
              onChange={setRightTab}
              options={[
                { value: 'metrics', label: t('right.metrics') },
                { value: 'touchdown', label: t('right.touchdown') },
              ]}
            />
          </div>
        )}
        {(!rightTabs || rightTab === 'metrics') && (
          <Slot id="metricDeck">
            <MetricDeck />
          </Slot>
        )}
        {(!rightTabs || rightTab === 'touchdown') && (
          <Slot id="touchdown">
            <TouchdownPad />
          </Slot>
        )}
        <Slot id="profileBattery">
          <ProfileBatteryAccordion />
        </Slot>
      </BentoColumn>
    </BentoGrid>
  );
}
