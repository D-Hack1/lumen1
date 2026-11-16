// Owner: Abhinav
// The Lumen page shell from the design: logo, the four-view nav, the clock (Orbit / Stand here) and the theme toggle.
// Routes are hash links so the preview needs no router; the real app would swap these for its own navigation.
import type { ReactNode } from 'react';
import { timeLabel } from '../orbit/orbitModel';
import { OPEN_EVENT } from '../ask/askWhy';
import { openQuickStart } from '../guidance/quickstart';
import type { LumenState } from '../orbit/lumenState';
import { dataMode } from '../../engine/data/source';
import { MAX_START_UTC, MIN_START_UTC, isoDate, parseIsoDate, setWindowStart, useWindowStart } from '../orbit/windowStart';

export type Route = 'orbit' | 'stand-here' | 'compare' | 'slip' | 'methodology';

const NAV: { route: Route; label: string }[] = [
  { route: 'orbit', label: 'Orbit' },
  { route: 'stand-here', label: 'Stand here' },
  { route: 'compare', label: 'Compare' },
  { route: 'slip', label: 'Slip explorer' },
  { route: 'methodology', label: 'Methodology' },
];

export function Shell({ route, lumen, children }: { route: Route; lumen: LumenState; children: ReactNode }) {
  const showClock = route === 'orbit' || route === 'stand-here';
  const startUtc = useWindowStart();
  const showDate = dataMode() === 'real' && route !== 'methodology';
  return (
    <div className={`lm-page lm-shell ${lumen.light ? 'lm-theme-light' : 'lm-theme-dark'}`}>
      <header className="lm-header">
        <a href="#orbit" className="lm-brand" aria-label="Lumen, home">
          <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
            <circle cx="15" cy="15" r="12" style={{ fill: 'var(--fg)' }} />
            <circle cx="20" cy="12" r="10" style={{ fill: 'var(--panel)' }} />
            <circle cx="25" cy="5" r="2.4" style={{ fill: 'var(--amber)' }} />
          </svg>
          <span className="lm-brand__name">Lumen</span>
          {route === 'orbit' && <span className="lm-brand__sub">Lunar landing site navigator</span>}
        </a>
        <nav aria-label="Views" className="lm-nav">
          {NAV.map((n) => (
            <a
              key={n.route}
              href={`#${n.route}`}
              aria-current={route === n.route ? 'page' : undefined}
              className={route === n.route ? 'lm-nav__on' : undefined}
            >
              {n.label}
            </a>
          ))}
        </nav>
        <span className="lm-grow" />
        {showDate && (
          <label className="lm-datepick" title="First day of every window (UTC). The ephemeris covers 2023–2030.">
            <span>Start date</span>
            <input
              type="date"
              aria-label="Window start date (UTC)"
              min={isoDate(MIN_START_UTC)}
              max={isoDate(MAX_START_UTC)}
              value={isoDate(startUtc)}
              onChange={(e) => setWindowStart(parseIsoDate(e.target.value))}
            />
          </label>
        )}
        {showClock && <div className="lm-clock">{timeLabel(lumen.t)}</div>}
        <button type="button" className="lm-btn lm-btn--ghost" onClick={openQuickStart} title="Four guided ways to start">
          Quick start
        </button>
        <button
          type="button"
          className="lm-btn lm-btn--ghost"
          aria-keyshortcuts="/"
          title="Ask LUMEN (press /)"
          onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EVENT))}
        >
          Ask <kbd>/</kbd>
        </button>
        <button type="button" className="lm-btn lm-btn--ghost" onClick={lumen.toggleTheme} aria-pressed={lumen.light}>
          {lumen.light ? 'Dark mode' : 'Light mode'}
        </button>
      </header>
      {children}
    </div>
  );
}
