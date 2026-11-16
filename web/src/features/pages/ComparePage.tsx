// Owner: Abhinav
// Compare: up to four sites side by side over the same 14-day window. Converted from the design. Additions: the best value in
// each row is marked, the label column stays put while the table scrolls, each column links to its Stand-here view, and the
// picker says how many are selected and what happens at the limit.
import { useMemo } from 'react';
import { showsSampleValues } from '../orbit/realModel';
import { MASTS, type Site } from '../orbit/orbitModel';
import { MAX_COMPARE } from '../orbit/lumenState';
import { getBaseUtc, longDate } from '../orbit/windowStart';
import { useLumenContext } from './usePages';
import { fmtDuration, windowStats, type WindowStats } from './pagesModel';
import { go } from './nav';

const NAMES: Record<string, string> = {
  im2: 'IM-2 site',
  shack: 'Connecting ridge',
  malapert: 'Malapert Massif',
  haworth: 'Haworth',
  nobile1: 'Nobile Rim 1',
  degerlache: 'de Gerlache Rim 2',
};
const label = (s: Site): string => NAMES[s.id] ?? s.short;

interface Row {
  key: keyof WindowStats;
  label: string;
  color: string;
  max: number;
  fmt: (v: number) => string;
  /** Lower is better (e.g. the longest dark stretch). */
  lowerBetter?: boolean;
}

const pct = (v: number): string => `${Math.round(v)}%`;
const ROWS: Row[] = [
  { key: 'sun', label: 'Time in sunlight', color: 'var(--amber)', max: 100, fmt: pct },
  { key: 'dark', label: 'Longest dark stretch', color: 'var(--mut)', max: 336, fmt: fmtDuration, lowerBetter: true },
  { key: 'earth', label: 'Earth above horizon', color: 'var(--sage)', max: 100, fmt: pct },
  { key: 'dsn', label: 'DSN contact time', color: 'var(--clay)', max: 100, fmt: pct },
];

export function ComparePage() {
  const L = useLumenContext();
  const { mast, picked, allSites } = L;
  const sites = useMemo(
    () => picked.map((id) => allSites.find((s) => s.id === id)).filter((s): s is Site => !!s),
    [picked, allSites],
  );
  const data = useMemo(() => sites.map((s) => windowStats(s, mast)), [sites, mast]);
  const grid = { gridTemplateColumns: `180px repeat(${sites.length}, minmax(0, 1fr))` };

  /** Index of the best column for a row, or -1 when there is nothing to prefer (one site, or all equal). */
  const bestIndex = (r: Row): number => {
    if (data.length < 2) return -1;
    const vals = data.map((d) => Math.round(d[r.key]));
    const best = r.lowerBetter ? Math.min(...vals) : Math.max(...vals);
    if (vals.every((v) => v === best)) return -1;
    return vals.indexOf(best);
  };

  return (
    <main className="lm-wrap">
      <div>
        <h1 className="lm-h1">Compare sites</h1>
        <p className="lm-lede">
          Pick up to four. Every number is for the same 14-day window starting {longDate(getBaseUtc())}. {showsSampleValues() ? 'Design preview, sample values.' : ''}
        </p>
      </div>

      <div className="lm-controls">
        <div className="lm-ctl">
          <div className="lm-eyebrow">
            Sites{' '}
            <span className="lm-count">
              {picked.length} of {MAX_COMPARE}
            </span>
          </div>
          <div role="group" aria-label="Sites to compare" className="lm-chips">
            {allSites.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={picked.includes(s.id)}
                onClick={() => L.togglePick(s.id)}
                className="lm-chip"
              >
                {label(s)}
              </button>
            ))}
          </div>
          <div className="lm-hint">Picking a fifth site replaces the oldest. At least one stays selected.</div>
        </div>
        <div className="lm-ctl">
          <div id="lm-mast-c" className="lm-eyebrow">
            Array height
          </div>
          <div role="group" aria-labelledby="lm-mast-c" className="lm-segs">
            {MASTS.map((v) => (
              <button key={v} type="button" aria-pressed={mast === v} onClick={() => L.setMast(v)}>
                {v} m
              </button>
            ))}
          </div>
        </div>
      </div>

      <section aria-label="Comparison table" className="lm-tablewrap">
        <div className="lm-ctable">
          <div className="lm-crow lm-crow--head" style={grid}>
            <div className="lm-cell lm-cell--label lm-eyebrow lm-cell--end">Over 14 days</div>
            {sites.map((s) => (
              <div key={s.id} className="lm-cell lm-cell--head">
                <div className="lm-cell__name">{label(s)}</div>
                <div className="lm-cell__coords">
                  {Math.abs(s.lat).toFixed(2)}°{s.lat < 0 ? 'S' : 'N'} {Math.abs(s.lon).toFixed(2)}°
                  {s.lon < 0 ? 'W' : 'E'}
                </div>
                <button
                  type="button"
                  className="lm-textlink"
                  onClick={() => {
                    L.selectSite(s.id);
                    go('stand-here');
                  }}
                >
                  Stand here →
                </button>
              </div>
            ))}
          </div>
          {ROWS.map((r) => {
            const best = bestIndex(r);
            return (
              <div key={r.key} className="lm-crow" style={grid}>
                <div className="lm-cell lm-cell--label lm-cell--mid">{r.label}</div>
                {data.map((d, i) => (
                  <div key={sites[i].id} className={`lm-cell ${best === i ? 'lm-cell--best' : ''}`}>
                    <div className="lm-cell__val">
                      {r.fmt(d[r.key])}
                      {best === i && <span className="lm-bestTag">Best</span>}
                    </div>
                    <div className="lm-bar">
                      <div
                        style={{ width: `${Math.min(100, (d[r.key] / r.max) * 100).toFixed(1)}%`, background: r.color }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </section>

      <div className="lm-actions">
        <a href="#orbit" className="lm-linkbtn">
          Back to orbit
        </a>
        <a href="#slip" className="lm-linkbtn lm-linkbtn--ghost">
          See what a slip does
        </a>
      </div>
    </main>
  );
}
