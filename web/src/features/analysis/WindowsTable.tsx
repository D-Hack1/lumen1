// Owner: Ebin
// Windows Table (PLAN_FINAL §8.3, gate G11): one row per window — type, start ±, end ±, duration [lo–hi], peak
// elevation, flags. Sort + type filter are human-rate React state. Row hover/click write `crosshairBus`
// only (Fast Lane — no React state), and export goes through Nived's `engine/export` so the CSV/JSON header
// block (site, tier, σ source, definitions, data versions) is identical everywhere.
import { useMemo, useState } from 'react';
import { useScenarioResult } from '../shared/scenarioResultContext';
import { crosshairBus } from '../../state/buses';
import { exportCsv } from '../../engine/export/csv';
import { exportJson } from '../../engine/export/json';
import { fmtBounded, fmtSpan } from '../../engine/format';
import { formatUtc } from '../../app/time';
import { Chip } from '../../ui/Chip';
import { color } from '../../ui/tokens';
import type { ScenarioResult, WindowRecord, WindowType } from '../../engine/types';

const TYPE_ICON: Record<WindowType, string> = { sun: '☀', earth: '⊕', link: '◉', ops: '⚙' };
const TYPE_COLOR: Record<WindowType, string> = { sun: color.sun, earth: color.earth, link: color.both, ops: color.accent };
const FILTERS = ['all', 'sun', 'earth', 'link', 'ops'] as const;

type SortKey = 'type' | 'start' | 'end' | 'duration' | 'peak';
const SORTERS: Record<SortKey, (a: WindowRecord, b: WindowRecord) => number> = {
  type: (a, b) => a.type.localeCompare(b.type) || a.start - b.start,
  start: (a, b) => a.start - b.start,
  end: (a, b) => a.end - b.end,
  duration: (a, b) => (a.durationH.value ?? -1) - (b.durationH.value ?? -1),
  peak: (a, b) => a.peakElevDeg - b.peakElevDeg,
};
const COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'type', label: 'Type' },
  { key: 'start', label: 'Start (UTC) ±' },
  { key: 'end', label: 'End (UTC) ±' },
  { key: 'duration', label: 'Duration [h]', align: 'right' },
  { key: 'peak', label: 'Peak el.', align: 'right' },
];

function download(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** "2026-03-04 12:10:00 ± 14 min" — ± omitted when the engine gives none (Tier C). */
function fmtTimePm(t: number, pmMs: number | null): string {
  return pmMs == null ? formatUtc(t) : `${formatUtc(t)} ± ${fmtSpan(pmMs)}`;
}

function flagsOf(r: WindowRecord): string {
  const f: string[] = [];
  if (r.flags.grazing) f.push('grazing');
  if (r.flags.partialStart) f.push('◀ clipped');
  if (r.flags.partialEnd) f.push('clipped ▶');
  return f.join(' · ');
}

export interface WindowsTableProps {
  /**
   * Show this scenario result instead of the Cockpit's (Compare view: the selected row —
   * `useCompareResults().rows.find(r => r.scenarioId === selected)?.result`). Omit to follow the Cockpit result.
   */
  result?: ScenarioResult;
}

export function WindowsTable({ result: given }: WindowsTableProps = {}) {
  const cockpit = useScenarioResult();
  const result = given ?? cockpit;
  const [filter, setFilter] = useState<WindowType | 'all'>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'start', dir: 1 });

  const all = result.windows;
  const rows = useMemo(() => {
    const f = filter === 'all' ? all : all.filter((r) => r.type === filter);
    return [...f].sort((a, b) => SORTERS[sort.key](a, b) * sort.dir);
  }, [all, filter, sort]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length };
    for (const r of all) c[r.type] = (c[r.type] ?? 0) + 1;
    return c;
  }, [all]);

  const onSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  // Export what the user is looking at (filter applied), with the engine's header block.
  const exportable = { ...result, windows: rows };
  const disabled = rows.length === 0;

  return (
    <div className="windows-table" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', paddingBottom: 'var(--sp-2)', flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <Chip key={f} selected={filter === f} onChange={() => setFilter(f)} count={counts[f] ?? 0}>
            {f === 'all' ? 'All' : `${TYPE_ICON[f]} ${f}`}
          </Chip>
        ))}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--sp-3)' }}>
          <Chip disabled={disabled} onClick={() => download('lumen_windows.csv', exportCsv(exportable, 'windows'), 'text/csv')}>
            Export CSV
          </Chip>
          <Chip disabled={disabled} onClick={() => download('lumen_windows.json', exportJson(exportable, 'windows'), 'application/json')}>
            JSON
          </Chip>
        </span>
      </div>

      <div data-scroll="allowed" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {rows.length === 0 ? (
          <div style={{ color: color.textFaint, fontSize: 'var(--fs-sm)', padding: 'var(--sp-4)' }}>
            {result.status === 'loading' ? 'Computing windows…' : 'No windows of this type in the scenario span.'}
          </div>
        ) : (
          <table className="num" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
            <thead style={{ position: 'sticky', top: 0, background: color.surface1 }}>
              <tr>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                    style={{ textAlign: c.align ?? 'left', fontWeight: 500, color: color.textMuted, padding: '2px var(--sp-3)', borderBottom: `1px solid ${color.hairlineStrong}` }}
                  >
                    <button
                      type="button"
                      onClick={() => onSort(c.key)}
                      style={{ all: 'unset', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      {c.label}
                      {sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                    </button>
                  </th>
                ))}
                <th scope="col" style={{ textAlign: 'left', fontWeight: 500, color: color.textMuted, padding: '2px var(--sp-3)', borderBottom: `1px solid ${color.hairlineStrong}` }}>
                  Flags
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.type}:${r.start}`}
                  className="windows-table__row"
                  tabIndex={0}
                  onMouseEnter={() => crosshairBus.set({ tHover: r.start, source: 'windowsTable' })}
                  onMouseLeave={() => crosshairBus.set({ tHover: null, source: 'windowsTable' })}
                  onFocus={() => crosshairBus.set({ tHover: r.start, source: 'windowsTable' })}
                  onBlur={() => crosshairBus.set({ tHover: null, source: 'windowsTable' })}
                  onClick={() => crosshairBus.set({ tScrub: r.start, source: 'windowsTable' })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      crosshairBus.set({ tScrub: r.start, source: 'windowsTable' });
                    }
                  }}
                  style={{ cursor: 'pointer', borderBottom: `1px solid ${color.hairline}` }}
                >
                  <td style={{ padding: '2px var(--sp-3)', whiteSpace: 'nowrap' }}>
                    <span style={{ color: TYPE_COLOR[r.type] }} aria-hidden>{TYPE_ICON[r.type]}</span> {r.type}
                  </td>
                  <td style={{ padding: '2px var(--sp-3)', whiteSpace: 'nowrap' }}>{fmtTimePm(r.start, r.startPmMs)}</td>
                  <td style={{ padding: '2px var(--sp-3)', whiteSpace: 'nowrap' }}>{fmtTimePm(r.end, r.endPmMs)}</td>
                  <td style={{ padding: '2px var(--sp-3)', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtBounded(r.durationH, 1)}</td>
                  <td style={{ padding: '2px var(--sp-3)', textAlign: 'right', whiteSpace: 'nowrap' }}>{r.peakElevDeg.toFixed(1)}°</td>
                  <td style={{ padding: '2px var(--sp-3)', color: color.marginal, whiteSpace: 'nowrap' }}>{flagsOf(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
