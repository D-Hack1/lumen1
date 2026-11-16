// Owner: Abhinav
// Site Explorer sidebar (PLAN §8.4, guide §6 Phase 3). Fills the Cockpit left column's three slots:
//   search   — Search ("name" or "lat, lon") + agency sub-filter + category chips   (fixed 92 / 92 / 84 px)
//   map      — Nived's Basemap (square)                                              (fixed 320 / 290 / 240 px)
//   siteList — site cards: the ONLY scrolling element in the column (data-scroll="allowed" on the slot)
// Filter state is local UI state (not part of the share URL — PLAN §6 Scenario has no filter fields).
// Verdict dots come from results the engine already computed (selected site + Compare rows); others stay pending.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Slot } from '../../app/layout/Slot';
import { useFixture } from '../../app/layout/fixture';
import { fill } from '../../engine/format';
import { useCatalog, useCompareResults, useResult } from '../../engine/hooks';
import type { SiteRecord, Verdict } from '../../engine/types';
import { Basemap } from '../map/Basemap';
import { useCopyFn } from '../../state/copy';
import { getScenario, useScenario } from '../../state/scenarioStore';
import { toast } from '../../ui/Toast';
import { AgencySelect, FilterChips } from './FilterChips';
import { setPulseNames, startPinPulse } from './pinPulse';
import { Search } from './Search';
import { SiteCard } from './SiteCard';
import { categoryCounts, customPointRecord, filterSites, type AgencyFilter, type CategoryFilter } from './siteModel';
import './sidebar.css';

const DAY = 86_400_000;

export function Sidebar() {
  const t = useCopyFn();
  const catalog = useCatalog();
  const fixture = useFixture();
  const sites = fixture?.sites ?? catalog.sites;
  const siteRef = useScenario((s) => s.site);
  const windowStart = useScenario((s) => s.landingUtc + s.slipDays * DAY);
  const durationDays = useScenario((s) => s.durationDays);
  const result = useResult();
  const compare = useCompareResults();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [agency, setAgency] = useState<AgencyFilter>('all');

  useEffect(() => startPinPulse(), []);
  useEffect(() => setPulseNames(new Map(sites.map((s) => [s.id, s.name]))), [sites]);

  const custom = siteRef.kind === 'point' ? customPointRecord(siteRef) : null;
  const all = useMemo(() => (custom ? [custom, ...sites] : sites), [custom?.id, sites]); // eslint-disable-line react-hooks/exhaustive-deps
  const filter = { query, category, agency };
  const list = useMemo(() => filterSites(all, filter), [all, query, category, agency]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => categoryCounts(all, filter), [all, query, agency]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedId = siteRef.kind === 'site' ? siteRef.id : custom?.id;
  const verdicts = useMemo(() => {
    const m = new Map<string, Verdict>();
    for (const r of compare.rows) if (r.result.meta?.siteId) m.set(r.result.meta.siteId, r.result.verdict);
    if (result.meta?.siteId && result.status === 'ready') m.set(result.meta.siteId, result.verdict);
    return m;
  }, [compare.rows, result]);

  const onSelect = useCallback((s: SiteRecord) => {
    if (s.category === 'custom' && s.id.startsWith('custom:')) getScenario().setCustomPoint(s.lat, s.lon);
    else getScenario().selectSite(s.id);
  }, []);
  const onCompare = useCallback(
    (s: SiteRecord) => {
      const site = s.id.startsWith('custom:')
        ? ({ kind: 'point', lat: s.lat, lon: s.lon } as const)
        : ({ kind: 'site', id: s.id } as const);
      const id = getScenario().addCompareRow({ site });
      if (id) toast(fill(t('sb.compare.added'), { id }), { tone: 'success' });
      else toast(t('sb.compare.full'), { tone: 'error' });
    },
    [t],
  );

  return (
    <>
      <Slot id="search">
        <div className="sb-search-block">
          <div className="sb-search-row">
            <Search value={query} onChange={setQuery} />
            <AgencySelect value={agency} onChange={setAgency} t={t} />
          </div>
          <FilterChips value={category} onChange={setCategory} counts={counts} t={t} />
        </div>
      </Slot>
      <Slot id="map">
        <div className="map-square">
          <Basemap />
        </div>
      </Slot>
      <Slot id="siteList">
        <div className="sb-list" role="list" aria-label={t('slot.siteList')} data-count={list.length}>
          <div className="sb-list__count num" aria-live="polite">
            {fill(t('sb.count'), { n: list.length, total: all.length })}
          </div>
          {list.map((s) => (
            <div role="listitem" key={s.id}>
              <SiteCard
                site={s}
                selected={s.id === selectedId}
                verdict={verdicts.get(s.id) ?? null}
                sparkline={
                  catalog.sparklines[s.id] ?? catalog.sparklines[s.id.replace(/~\d+$/, '')] /* fixture ids: <id>~<n> */
                }
                windowStartUtc={windowStart}
                durationDays={durationDays}
                t={t}
                onSelect={onSelect}
                onCompare={onCompare}
              />
            </div>
          ))}
          {list.length === 0 && (
            <p
              className="sb-list__empty"
              data-state={catalog.error ? 'error' : catalog.loading && !fixture?.sites ? 'loading' : 'empty'}
            >
              {catalog.error
                ? fill(t('sb.error'), { e: catalog.error })
                : catalog.loading && !fixture?.sites
                  ? t('sb.loading')
                  : t('sb.empty')}
            </p>
          )}
        </div>
      </Slot>
    </>
  );
}
