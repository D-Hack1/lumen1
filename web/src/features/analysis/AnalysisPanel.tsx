// Owner: Ebin
// Tabbed Analysis Panel: [Power & Elevation | Windows Table | Pointing & Link]. Active tab is committed state
// (scenarioStore.analysisTab) so it survives the share URL (WORK_DISTRIBUTION §5, PLAN_FINAL §8.3).
import { useScenario } from '../../state/scenarioStore';
import { useCopyFn } from '../../state/copy';
import { Segmented } from '../../ui/Segmented';
import { PowerCurve } from './PowerCurve';
import { WindowsTable } from './WindowsTable';
import { PointingLink } from './PointingLink';

export function AnalysisPanel() {
  const tab = useScenario((s) => s.analysisTab);
  const setTab = useScenario((s) => s.setAnalysisTab);
  const t = useCopyFn();

  return (
    <div className="analysis-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Segmented
        as="tabs"
        size="sm"
        ariaLabel={t('analysis.tabs')}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'power', label: t('analysis.power') },
          { value: 'windows', label: t('analysis.windows') },
          { value: 'pointing', label: t('analysis.pointing') },
        ]}
      />
      <div style={{ flex: 1, minHeight: 0 }}>
        {tab === 'power' && <PowerCurve />}
        {tab === 'windows' && <WindowsTable />}
        {tab === 'pointing' && <PointingLink />}
      </div>
    </div>
  );
}
