// Owner: Ebin
// 60-day Feasibility Calendar (MVP slice of the Tier-1 12-month view): one row per site (Compare-row sites, else
// the current site) × 60 landing dates starting at the scenario landing date. Cells show the verdict as glyph +
// colour (never colour alone). Stage-1 (nominal) cells are "provisional" — dashed outline — and swap to solid when
// Nived's stage-2 bounded result arrives (D-15). Latest-wins: changing inputs cancels running scans.
// Human-rate component: scans update React state at stage boundaries only, not at pointer rate.
import { useEffect, useMemo, useState } from 'react';
import { startScan, type ScanHandle } from '../../engine/compare/scan';
import { fmtBounded } from '../../engine/format';
import { useCatalog } from '../../engine/hooks';
import type { ScanCandidate, Verdict } from '../../engine/types';
import { useScenario } from '../../state/scenarioStore';
import { Badge } from '../../ui/Badge';
import { color } from '../../ui/tokens';

const DAYS = 60;
const DAY = 86_400_000;
const VERDICT: Record<Verdict, { glyph: string; bg: string }> = {
  GO: { glyph: '●', bg: color.go },
  MARGINAL: { glyph: '◐', bg: color.marginal },
  'NO-GO': { glyph: '✕', bg: color.nogo },
  PENDING: { glyph: '○', bg: color.pending },
};
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function FeasibilityCalendar() {
  const { sites } = useCatalog();
  const site = useScenario((s) => s.site);
  const rowsState = useScenario((s) => s.compareRows);
  const landingUtc = useScenario((s) => s.landingUtc);
  const durationDays = useScenario((s) => s.durationDays);
  const setLandingUtc = useScenario((s) => s.setLandingUtc);

  const siteIds = useMemo(() => {
    const ids = rowsState.flatMap((r) => (r.site.kind === 'site' ? [r.site.id] : []));
    const uniq = [...new Set(ids)].slice(0, 4);
    if (uniq.length) return uniq;
    return site.kind === 'site' ? [site.id] : [];
  }, [rowsState, site]);

  const [bySite, setBySite] = useState<Record<string, ScanCandidate[]>>({});
  const [done, setDone] = useState(false);

  useEffect(() => {
    setBySite({});
    setDone(siteIds.length === 0);
    // Scan window ±30 d around base+30 d  ⇒  landing dates [landingUtc, landingUtc + 60 d].
    const handles: ScanHandle[] = siteIds.map((id) =>
      startScan(
        { mode: 'dates', baseLandingUtc: landingUtc + (DAYS / 2) * DAY, plusMinusDays: DAYS / 2, siteIds: [id], durationDays },
        (r) => setBySite((prev) => ({ ...prev, [id]: r.candidates })),
      ),
    );
    let live = true;
    Promise.all(handles.map((h) => h.done)).then(() => live && setDone(true));
    return () => {
      live = false;
      handles.forEach((h) => h.cancel());
    };
  }, [siteIds, landingUtc, durationDays]);

  const nameOf = (id: string) => sites.find((s) => s.id === id)?.name ?? id;
  const anyProvisional = Object.values(bySite).some((c) => c.some((x) => x.provisional));

  if (siteIds.length === 0) {
    return <div style={{ color: color.textFaint, fontSize: 'var(--fs-sm)' }}>Pick a catalogue site (or add Compare rows) to scan feasibility.</div>;
  }

  return (
    <div className="feasibility-calendar" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', height: '100%', minHeight: 0 }} aria-busy={!done}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap', fontSize: 'var(--fs-2xs)', color: color.textMuted }}>
        {(['GO', 'MARGINAL', 'NO-GO'] as const).map((v) => (
          <span key={v}>
            <span style={{ color: VERDICT[v].bg }}>{VERDICT[v].glyph}</span> {v}
          </span>
        ))}
        <Badge tone="provisional">provisional = nominal only (stage 1)</Badge>
        {!done && <span>scanning…</span>}
        {done && anyProvisional && <span>rows beyond the top 10 stay provisional</span>}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
        {siteIds.map((id) => {
          const byDay = new Map<number, ScanCandidate>();
          for (const c of bySite[id] ?? []) {
            const d = Math.round((c.landingUtc - landingUtc) / DAY);
            if (d >= 0 && d < DAYS) byDay.set(d, c);
          }
          return (
            <div key={id} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch', gap: 'var(--sp-3)' }}>
              <span className="truncate" style={{ width: 84, fontSize: 'var(--fs-xs)', color: color.textMuted, alignSelf: 'center' }}>{nameOf(id)}</span>
              <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: `repeat(${DAYS}, minmax(0, 1fr))`, gap: 1 }}>
                {Array.from({ length: DAYS }, (_, d) => {
                  const c = byDay.get(d);
                  const date = ymd(landingUtc + d * DAY);
                  if (!c) return <div key={d} style={{ background: color.surface2 }} aria-hidden />;
                  const v = VERDICT[c.verdict];
                  const title = `${date} · ${c.verdict}${c.provisional ? ' (provisional)' : ' (bounded)'} · sunlit ${fmtBounded(c.sunlitPct, 0, '%')} · link ${fmtBounded(c.linkPct, 0, '%')}`;
                  return (
                    <button
                      key={d}
                      type="button"
                      title={title}
                      aria-label={title}
                      onClick={() => setLandingUtc(landingUtc + d * DAY)}
                      style={{
                        all: 'unset',
                        cursor: 'pointer',
                        background: v.bg,
                        opacity: c.provisional ? 0.45 : 1,
                        outline: c.provisional ? `1px dashed ${color.textFaint}` : 'none',
                        outlineOffset: -1,
                        minWidth: 0,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="num" style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 84 + 8, fontSize: 'var(--fs-2xs)', color: color.textFaint }}>
        <span>{ymd(landingUtc)}</span>
        <span>+30 d</span>
        <span>{ymd(landingUtc + (DAYS - 1) * DAY)}</span>
      </div>
    </div>
  );
}
