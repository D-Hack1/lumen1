// Owner: Nived
// Scan Panel (D-15 two-stage): stage 1 = ranked nominal list (rows badged "provisional"); stage 2 = bounded rows arrive
// and swap their badge. Latest-wins: changing the inputs cancels the running scan. "Load into row" adds a Compare row.
// `?fixture=worst-case` shows 30 long rows. Only the list body scrolls (whitelisted).
import { useEffect, useRef, useState } from 'react';
import { useFixture } from '../../app/layout/fixture';
import { startScan, type ScanHandle } from '../../engine/compare/scan';
import { fmtBounded } from '../../engine/format';
import { useCatalog } from '../../engine/hooks';
import type { ScanCandidate, ScanResult } from '../../engine/types';
import { WORST_CASE_SCAN } from '../../mocks/forced';
import { useCopyFn } from '../../state/copy';
import { reportScanStage, type ScanStage } from '../../state/scanStatus';
import { getScenario, useScenario } from '../../state/scenarioStore';
import { Badge, type BadgeTone } from '../../ui/Badge';
import { Segmented } from '../../ui/Segmented';
import { useFlipReorder } from './flip';
import './compareResults.css';

const TONE: Record<ScanCandidate['verdict'], BadgeTone> = { GO: 'go', MARGINAL: 'marginal', 'NO-GO': 'nogo', PENDING: 'pending' };
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function ScanPanel() {
  const t = useCopyFn();
  const { sites } = useCatalog();
  const worst = useFixture()?.name === 'worst-case';
  const siteRef = useScenario((s) => s.site);
  const landingUtc = useScenario((s) => s.landingUtc);
  const durationDays = useScenario((s) => s.durationDays);
  const [mode, setMode] = useState<'dates' | 'sites'>('dates');
  const [res, setRes] = useState<ScanResult | null>(null);
  const handle = useRef<ScanHandle | null>(null);
  const siteId = siteRef.kind === 'site' ? siteRef.id : null;

  useEffect(() => {
    if (worst) return;
    handle.current?.cancel(); // stale scans never update the list
    setRes(null);
    handle.current = startScan(
      { mode, baseLandingUtc: landingUtc, plusMinusDays: 15, siteIds: mode === 'sites' ? sites.map((s) => s.id) : siteId ? [siteId] : null, durationDays },
      setRes,
    );
    return () => handle.current?.cancel();
  }, [mode, landingUtc, siteId, durationDays, sites, worst]);

  const rows = worst ? WORST_CASE_SCAN : (res?.candidates ?? []);
  const stage = worst ? 2 : (res?.stage ?? 0);
  // Report the stage (and done) at stage-boundary rate for the verdict popover (state/scanStatus). Reset when the panel goes away.
  const done = worst || res?.done === true;
  useEffect(() => {
    reportScanStage(stage as ScanStage, done);
  }, [stage, done]);
  useEffect(() => () => reportScanStage(0), []);
  const tbody = useRef<HTMLTableSectionElement>(null);
  useFlipReorder(tbody, rows.map((c) => `${c.siteId}-${c.landingUtc}`), stage as 0 | 1 | 2);
  const nameOf = (id: string) => sites.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="scan" data-stage={stage || undefined} aria-busy={!worst && !res?.done}>
      <div className="scan__bar">
        <Segmented
          size="sm"
          ariaLabel="Scan mode"
          value={mode}
          onChange={setMode}
          options={[{ value: 'dates', label: t('scan.mode.dates') }, { value: 'sites', label: t('scan.mode.sites') }]}
        />
        <span className="scan__stage">{stage === 0 ? t('scan.running') : stage === 1 ? t('scan.stage1') : t('scan.stage2')}</span>
      </div>
      <div className="scan__body" data-scroll="allowed">
        <table className="rt">
          <thead>
            <tr>
              <th className="rt__rank">{t('scan.col.rank')}</th>
              <th className="rt__site">{t('scan.col.site')}</th>
              <th className="rt__verdict">{t('scan.col.verdict')}</th>
              <th className="rt__num">{t('scan.col.sunlit')}</th>
              <th className="rt__num">{t('scan.col.link')}</th>
              <th className="rt__num">{t('scan.col.night')}</th>
              <th className="rt__act" />
            </tr>
          </thead>
          <tbody ref={tbody}>
            {rows.map((c, i) => (
              <tr key={`${c.siteId}-${c.landingUtc}`} data-flip-key={`${c.siteId}-${c.landingUtc}`} data-provisional={c.provisional} data-bounds={c.boundsStatus}>
                <td className="rt__rank">{i + 1}</td>
                <td className="rt__site" title={`${day(c.landingUtc)} · ${nameOf(c.siteId)}`}>
                  {day(c.landingUtc)} {'·'} {nameOf(c.siteId)}
                </td>
                <td className="rt__verdict" title={c.provisional ? t('scan.provisional') : t('scan.stage2')}>
                  <Badge tone={c.provisional ? 'provisional' : TONE[c.verdict]}>{t('verdict.' + c.verdict)}</Badge>
                </td>
                <td className="rt__num">{fmtBounded(c.sunlitPct, 0, '%')}</td>
                <td className="rt__num">{fmtBounded(c.linkPct, 0, '%')}</td>
                <td className="rt__num">{fmtBounded(c.longestNightH, 0, ' h')}</td>
                <td className="rt__act">
                  <button
                    type="button"
                    className="scan__load"
                    onClick={() => getScenario().addCompareRow({ site: { kind: 'site', id: c.siteId }, landingUtc: c.landingUtc })}
                  >
                    {t('scan.load')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
