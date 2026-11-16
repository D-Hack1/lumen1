// Owner: Nived
// Perf HUD (dev only, toggle with the backtick key). Shows the G8 hot-path numbers and the counters that prove the hot path is
// clean: p50 / p95 per metric against its budget, React commits, long tasks. Renders NOTHING while closed.
// Text is refreshed at 4 Hz from the recorder; it never touches the hot path (it only reads).
import { useEffect, useState } from 'react';
import { perf, type PerfSnapshot, type Stat } from '../engine/perf';
import { G8_BUDGETS_MS, type BudgetedMetric } from './budgets';
import { fmtBudget, fmtMs } from './format';
import './perfHud.css';

const ROWS: Array<{ key: string; label: string }> = [
  { key: 'hover', label: 'hover (input → drawn)' },
  { key: 'slipFrame', label: 'slip frame' },
  { key: 'siteSwitch', label: 'site switch' },
  { key: 'quickAnswer', label: 'quick answer' },
  { key: 'scanStage1', label: 'scan stage 1' },
  { key: 'scanFirstStage2', label: 'scan first stage 2' },
  { key: 'workerJob', label: 'worker job' },
];

const EMPTY: Stat = { n: 0, mean: null, max: null, p50: null, p95: null };

export function PerfHud({ open, snapshot }: { open?: boolean; snapshot?: PerfSnapshot }) {
  const [live, setLive] = useState<PerfSnapshot | null>(null);
  const [toggled, setToggled] = useState(false);
  const isOpen = open ?? toggled;

  useEffect(() => {
    if (open !== undefined) return; // controlled (tests): no keyboard, no timer
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '`' && !e.ctrlKey && !e.metaKey && !e.altKey) setToggled((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open !== undefined || !toggled) return;
    window.__lumenPerf?.start();
    const id = window.setInterval(() => setLive(perf.snapshot()), 250);
    return () => {
      window.clearInterval(id);
      window.__lumenPerf?.stop();
    };
  }, [open, toggled]);

  if (!isOpen) return null;
  const snap = snapshot ?? live ?? perf.snapshot();
  return (
    <aside className="perf-hud" aria-label="Performance HUD">
      <table>
        <thead>
          <tr>
            <th>metric</th>
            <th>n</th>
            <th>p50</th>
            <th>p95</th>
            <th>budget</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(({ key, label }) => {
            const s = snap.series[key] ?? EMPTY;
            const budget = key in G8_BUDGETS_MS ? G8_BUDGETS_MS[key as BudgetedMetric] : null;
            const status = s.n === 0 || s.p95 == null ? 'none' : budget == null ? 'info' : s.p95 > budget ? 'over' : 'ok';
            return (
              <tr key={key} data-metric={key} data-status={status}>
                <td>{label}</td>
                <td>{s.n}</td>
                <td>{fmtMs(s.p50)}</td>
                <td>{fmtMs(s.p95)}</td>
                <td>{budget == null ? '' : fmtBudget(budget)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="perf-hud__counters">
        <span>React commits {snap.counters.reactCommits ?? 0}</span>
        <span>Long tasks {snap.counters.longTasks ?? 0}</span>
      </div>
    </aside>
  );
}
