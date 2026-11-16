// Owner: Ebin
// "Details" for the Stand here page: the Windows Table (with CSV/JSON export), Pointing & Link with the DSN lanes, and the Power
// curve + Survival Barcode — all drawn from the SAME engine result as the page's "Numbers for this window", so they agree with it.
// Wiring (kept in this file so the page needs only one line):
//   • result → <ScenarioResultProvider>, so the charts read this result instead of the global store.
//   • page clock → charts: `t` (hours since 8 Feb 2027 00:00 UTC) is written to crosshairBus (Fast Lane, no React state per tick).
//   • charts → page clock: clicking the Power curve / Barcode or a Windows Table row writes crosshairBus; we turn that into `onSeek`.
//     Hovering any chart writes tHover, so a dashed ghost line follows the pointer on all of them.
import { useEffect, useState } from 'react';
import type { ScenarioResult } from '../../engine/types';
import { crosshairBus } from '../../state/buses';
import { installTokens } from '../../ui/tokens';
import '../../ui/kit.css';
import { Barcode } from '../barcode/Barcode';
import { getBaseUtc } from '../orbit/windowStart';
import { ScenarioResultProvider } from '../shared/ScenarioResultProvider';
import { PointingLink } from './PointingLink';
import { PowerCurve } from './PowerCurve';
import { WindowsTable } from './WindowsTable';
import './standHereDetails.css';

installTokens(); // the charts and kit pieces read --c-*, --sp-*, --fs-* variables; the live pages do not define them

type Tab = 'windows' | 'pointing' | 'power';
const HOUR_MS = 3_600_000;

const TABS: readonly { id: Tab; label: string; hint: string }[] = [
  { id: 'windows', label: 'Windows', hint: 'Every Sun, Earth, link and operating window in the 30 days, with start and end ±, duration range and peak elevation. Click a row to jump the clock to its start; export the table as CSV or JSON.' },
  { id: 'pointing', label: 'Pointing & link', hint: 'Where the Sun and Earth are at the clock time, how far away Earth is, and which Deep Space Network stations can see the Moon across the window.' },
  { id: 'power', label: 'Power & barcode', hint: 'Panel power and Sun / Earth clearance over the window, and the survival barcode: Sun (amber), Earth only (dots), both (teal), blocked (hatch), by day.' },
];

export function StandHereDetails({ result, t, onSeek }: { result: ScenarioResult; t: number; onSeek?: (hours: number) => void }) {
  const [tab, setTab] = useState<Tab>('windows');

  // page clock → charts
  useEffect(() => {
    crosshairBus.set({ tScrub: getBaseUtc() + t * HOUR_MS, source: 'standHere' });
  }, [t]);

  // charts → page clock: a click on the Power curve / Barcode, or a Windows Table row, sets the shared tScrub. (Ignore the page's own writes.)
  useEffect(() => {
    let last = crosshairBus.get().tScrub;
    return crosshairBus.subscribe((v) => {
      if (v.tScrub === last) return; // hover moves, not a seek
      last = v.tScrub;
      if (v.source !== 'standHere' && onSeek) onSeek((v.tScrub - getBaseUtc()) / HOUR_MS);
    });
  }, [onSeek]);

  const current = TABS.find((x) => x.id === tab)!;
  return (
    <section className="lm-box lm-det" aria-label="Details: windows, pointing and power" data-testid="stand-here-details">
      <div className="lm-det__head">
        <h2 className="lm-det__title">Details</h2>
        <div role="group" aria-label="Detail view" className="lm-segs">
          {TABS.map((x) => (
            <button key={x.id} type="button" aria-pressed={tab === x.id} onClick={() => setTab(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
      </div>
      <div className="lm-hint">{current.hint}</div>
      <ScenarioResultProvider result={result}>
        <div className="lm-det__body" data-tab={tab}>
          {tab === 'windows' && <WindowsTable />}
          {tab === 'pointing' && <PointingLink />}
          {tab === 'power' && (
            <div className="lm-det__stack">
              <div className="lm-det__chart">
                <PowerCurve />
              </div>
              <div className="lm-det__bar">
                <Barcode />
              </div>
            </div>
          )}
        </div>
      </ScenarioResultProvider>
    </section>
  );
}
