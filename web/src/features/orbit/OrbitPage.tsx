// Owner: Abhinav
// The Orbit page, converted from the approved design: coordinates + curated sites on the left, the stage (whole Moon / south
// pole) with its overlays and the month timeline in the middle, and the selected-site details on the right.
// Values in the side panels come from orbitModel.ts (the design's sample model) until the page is wired to the engine.
// Reads theme / site / array height / clock from the shared Lumen state (lumenState.ts) when a provider exists, else keeps its own.
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { LumenContext, useLumenState } from './lumenState';
import { OrbitGlobe, type OrbitGlobeHandle } from './OrbitGlobe';
import {
  MASTS,
  MONTH_HOURS,
  SITES,
  SUN_PHASE_OFFSET_H,
  T_MAX,
  bands,
  fmtCoords,
  fmtHours,
  horizon,
  model,
  parseCoord,
  timelineTicks,
  until,
  type Site,
  type Tone,
} from './orbitModel';
import { PolarStage, type PolarStats } from './PolarStage';
import { usePolarTerrain } from './polarAssets';
import { polarPinAt, polarUntil } from './polarPin';
import { keyRows, layerDescription, lightDirection, LAYER_LABELS } from './polarCopy';
import { realSiteTag, showsSampleValues, terrainResolutionM, useEngineTagVersion, usesTerrain } from './realModel';
import { phaseAt, polarSunAzimuthDeg } from './ephemeris';
import type { PolarLayer } from './polarTerrain';
import './orbit.css';

type View = 'whole' | 'pole';

/** Deterministic star field, identical to the design's. */
const STARS = (() => {
  const out: { left: number; top: number; size: number; alpha: number }[] = [];
  let seed = 7;
  const next = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < 70; i++) {
    const left = next() * 100;
    const top = next() * 100;
    const size = 1 + Math.round(next() * 1.5);
    out.push({ left, top, size, alpha: 0.3 + (i % 5) * 0.12 });
  }
  return out;
})();

const TONES: Record<Tone, string> = { good: 'good', warn: 'warn', bad: 'bad' };

export interface OrbitPageProps {
  onStandHere?: (site: Site) => void;
  onAddToCompare?: (site: Site) => void;
}

export function OrbitPage({ onStandHere, onAddToCompare }: OrbitPageProps) {
  const [view, setView] = useState<View>('whole');
  const [layer, setLayer] = useState<PolarLayer>('live');
  const [psrOn, setPsrOn] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [latStr, setLatStr] = useState('');
  const [lonStr, setLonStr] = useState('');
  const [err, setErr] = useState('');
  const [pstat, setPstat] = useState<PolarStats | null>(null);
  const own = useLumenState();
  const shared = useContext(LumenContext);
  const { light, site, mast, setMast, t, setT, selectSite, dropCustom: dropSite } = shared ?? own;
  const terrain = usePolarTerrain();
  useEngineTagVersion(); // the site list's verdict tags arrive from the engine a moment after the list is drawn
  const globe = useRef<OrbitGlobeHandle>(null);
  const lastLit = useRef(0);
  const statKey = useRef('');

  // Keep the coordinate fields in step with the selected site, wherever the selection came from.
  useEffect(() => {
    setLatStr(site.lat.toFixed(4));
    setLonStr(site.lon.toFixed(4));
    setErr('');
  }, [site]);
  const m = useMemo(() => model(t, site, mast), [t, site, mast]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setT((v) => (v + 1) % MONTH_HOURS), 70);
    return () => clearInterval(id);
  }, [playing, setT]);

  const pickSite = (picked: Site) => selectSite(picked.id);
  const dropCustom = useCallback((lat: number, lon: number) => dropSite(lat, lon), [dropSite]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const la = parseCoord(latStr, 'N', 'S');
    let lo = parseCoord(lonStr, 'E', 'W');
    if (la === null || lo === null) return setErr('Enter numbers like -84.79 and 29.20, or 84.79 S and 29.20 E.');
    if (la < -90 || la > 90) return setErr('Latitude must be between 90°S and 90°N.');
    if (lo < -180 || lo > 360) return setErr('Longitude must be between 180°W and 360°E.');
    if (lo > 180) lo -= 360;
    dropSite(la, lo);
    setErr('');
  };

  const onStats = useCallback((s: PolarStats) => {
    if (s.litPct !== null) lastLit.current = s.litPct;
    const next: PolarStats = { ...s, litPct: s.litPct ?? lastLit.current };
    const key = [
      Math.round(next.litPct ?? 0),
      next.inView
        ? `${Math.round(next.sunElDeg * 10)}|${Math.round(next.horizonDeg * 10)}|${next.lit}|${next.alwaysDark}|${Math.round(next.monthPct)}`
        : 'x',
    ].join('|');
    if (key !== statKey.current) {
      statKey.current = key;
      setPstat(next);
    }
  }, []);

  const sunBands = useMemo(() => bands('sun', site, mast), [site, mast]);
  const earthBands = useMemo(() => bands('earth', site, mast), [site, mast]);
  const dsnBands = useMemo(() => bands('dsn', site, mast), [site, mast]);

  // A pin with no terrain mask is evaluated on the smooth Moon, which cannot see the terrain around it. Inside the south-polar map the map can, so for such
  // a pin the lit / shadow state, the horizon and Earth's visibility come from the map (coarse, labelled) and the smooth-Moon values are not shown as fact.
  const mapPin =
    !showsSampleValues() && terrain.status === 'ready' && !usesTerrain(site, mast) ? terrain.terrain : null;
  const pm = mapPin ? polarPinAt(mapPin, site.lat, site.lon, t) : null;
  const lit = pm ? pm.sunlit : m.frac > 0.5;
  const earthUp = pm ? pm.earthVisible : m.earthUp;
  const dsnUp = pm ? m.dsn && pm.earthVisible : m.dsn;
  const sunset = pm
    ? polarUntil(mapPin!, site.lat, site.lon, t, (q) => (lit ? !q.sunlit : q.sunlit))
    : until(t, site, mast, (q) => (lit ? q.frac <= 0.5 : q.frac > 0.5));
  const earthset = pm
    ? polarUntil(mapPin!, site.lat, site.lon, t, (q) => (earthUp ? !q.earthVisible : q.earthVisible))
    : until(t, site, mast, (q) => (m.earthUp ? !q.earthUp : q.earthUp));
  const nextDsn = dsnUp
    ? 0
    : pm
      ? polarUntil(mapPin!, site.lat, site.lon, t, (q) => q.earthVisible)
      : until(t, site, mast, (q) => q.dsn);
  const sunFrac = pm && !pm.sunlit ? 0 : m.frac;
  const watts = Math.round(1361 * sunFrac * Math.cos((m.sunEl * Math.PI) / 180));
  const phase = phaseAt(t + SUN_PHASE_OFFSET_H);
  const whole = view === 'whole';
  const poleVisible = site.lat <= -80;
  const az = polarSunAzimuthDeg(t + SUN_PHASE_OFFSET_H);
  const mastsId = 'lm-mast-label';

  const legend = whole
    ? `Phase seen from Earth: ${phase.name}, ${Math.round(phase.illuminated * 100)}% lit. Drag to rotate, scroll or use +/− to zoom. The Sun orbits the Moon once a month and passes behind it. Earth sits fixed over the near side because the Moon is tidally locked. Arrows at the edge point to the Sun or Earth when they leave the frame. Map: LROC color, NASA SVS.`
    : `NASA LOLA terrain, 80°S to 90°S, with real cast shadows. Light from ${lightDirection(az)}. Layer: ${layerDescription(layer)}. Dashed rings: 85°S and 88°S.`;

  const poleRows: { label: string; value: string; tone: string }[] = [];
  if (terrain.status !== 'ready') {
    poleRows.push({
      label: terrain.status === 'loading' ? 'Loading terrain data' : 'Terrain data unavailable',
      value: '...',
      tone: 'mut',
    });
  } else {
    if (layer === 'live' && pstat) {
      poleRows.push({ label: 'Sunlit now (whole view)', value: `${Math.round(pstat.litPct ?? 0)}%`, tone: 'amber' });
      poleRows.push({ label: 'In shadow now', value: `${100 - Math.round(pstat.litPct ?? 0)}%`, tone: '' });
    }
    poleRows.push({
      label: 'Always dark (cold traps)',
      value: `${terrain.terrain.alwaysDarkPct.toFixed(0)}% of view`,
      tone: 'sage',
    });
    if (pstat?.inView) {
      poleRows.push({
        label: 'Pin status',
        value: pstat.alwaysDark ? 'Permanently shadowed' : pstat.lit ? 'Lit now' : 'In shadow now',
        tone: pstat.lit ? 'amber' : '',
      });
      poleRows.push({ label: 'Pin sunlight this month', value: `${pstat.monthPct.toFixed(0)}%`, tone: 'amber' });
      poleRows.push({ label: 'Sun elevation at pin', value: `${pstat.sunElDeg.toFixed(1)}°`, tone: '' });
      poleRows.push({ label: 'Terrain horizon toward Sun', value: `${pstat.horizonDeg.toFixed(1)}°`, tone: '' });
      poleRows.push({ label: 'Ground height at pin', value: `${pstat.heightKm.toFixed(1)} km`, tone: '' });
    } else poleRows.push({ label: 'Pin', value: 'Outside this view', tone: 'mut' });
  }

  const metrics: { label: string; value: string; tone: string }[] = [
    { label: 'Sun elevation', value: `${m.sunEl.toFixed(2)}°`, tone: 'amber' },
    {
      label: 'Terrain horizon at Sun azimuth',
      value: `${(pm ? pm.sunHorizonDeg : horizon(m.sunAz, site, mast)).toFixed(2)}°`,
      tone: '',
    },
    { label: 'Solar disk visible', value: `${Math.round(sunFrac * 100)}%`, tone: 'amber' },
    { label: lit ? 'Sunset in' : 'Sunrise in', value: fmtHours(sunset), tone: '' },
    { label: 'Array output (vertical, tracking)', value: `${watts} W/m²`, tone: '' },
    { label: 'Earth elevation', value: `${m.earthEl.toFixed(2)}°`, tone: 'sage' },
    { label: earthUp ? 'Earthset in' : 'Earthrise in', value: fmtHours(earthset), tone: '' },
    { label: 'Next DSN contact', value: nextDsn === 0 ? 'now' : fmtHours(nextDsn), tone: 'clay' },
  ];

  const cursor: CSSProperties = { left: `calc(108px + (100% - 108px) * ${(t / T_MAX).toFixed(4)})` };

  return (
    <div className={`lm-page ${light ? 'lm-theme-light' : 'lm-theme-dark'}`}>
      <div className="lm-body">
        <aside aria-label="Sites and coordinates" className="lm-side lm-side--left">
          <section aria-labelledby="coord-h" className="lm-stack">
            <h2 id="coord-h" className="lm-h2">
              Go to coordinates
            </h2>
            <form onSubmit={submit} className="lm-stack">
              <div className="lm-grid2">
                <div className="lm-field">
                  <label htmlFor="lm-lat">Latitude</label>
                  <input
                    id="lm-lat"
                    className="lm-in"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="-84.79 or 84.79 S"
                    value={latStr}
                    onChange={(e) => setLatStr(e.target.value)}
                  />
                </div>
                <div className="lm-field">
                  <label htmlFor="lm-lon">Longitude</label>
                  <input
                    id="lm-lon"
                    className="lm-in"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="29.20 or 29.20 E"
                    value={lonStr}
                    onChange={(e) => setLonStr(e.target.value)}
                  />
                </div>
              </div>
              <button type="submit" className="lm-btn lm-btn--primary">
                Drop pin here
              </button>
            </form>
            <div role="status" className="lm-err">
              {err}
            </div>
            <div className="lm-hint">Decimal degrees, or add S / N / E / W. The photo covers 80°S to 90°S.</div>
          </section>

          <section aria-labelledby="sites-h" className="lm-sites">
            <h2 id="sites-h" className="lm-eyebrow lm-eyebrow--inset">
              Curated sites
            </h2>
            {SITES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => pickSite(s)}
                aria-pressed={s.id === site.id}
                className="lm-site"
              >
                <span className="lm-site__text">
                  <span className="lm-site__name">{s.name}</span>
                  <span className="lm-site__group">{s.group}</span>
                </span>
                {showsSampleValues()
                  ? s.tone && <span className={`lm-tag lm-tag--${TONES[s.tone]}`}>{s.tag}</span>
                  : (() => {
                      const g = realSiteTag(s, mast);
                      return (
                        <span className={`lm-tag lm-tag--${g.tone}`} title={g.reason}>
                          {g.label}
                        </span>
                      );
                    })()}
              </button>
            ))}
          </section>

          <div className="lm-note">
            You can also click anywhere on the Moon to drop a pin.
            {showsSampleValues() ? ' Values are sample data in this preview.' : ''}
          </div>
        </aside>

        <main className="lm-main">
          <div className="lm-stage lm-dark">
            {STARS.map((s, i) => (
              <span
                key={i}
                aria-hidden="true"
                className="lm-star"
                style={{
                  left: `${s.left.toFixed(2)}%`,
                  top: `${s.top.toFixed(2)}%`,
                  width: s.size,
                  height: s.size,
                  background: `rgba(255,244,225,${s.alpha.toFixed(2)})`,
                }}
              />
            ))}

            <div className="lm-globebox" style={{ display: whole ? 'flex' : 'none' }}>
              <OrbitGlobe
                ref={globe}
                t={t}
                pin={{ lat: site.lat, lon: site.lon }}
                focusKey={`${site.id}|${site.lat}|${site.lon}`}
                onPick={dropCustom}
                hidden={!whole}
              />
            </div>

            {!whole && terrain.status === 'ready' && (
              <PolarStage
                terrain={terrain.terrain}
                t={t}
                layer={layer}
                showAlwaysDark={psrOn}
                pin={{ lat: site.lat, lon: site.lon }}
                onPick={dropCustom}
                onStats={onStats}
              />
            )}
            {!whole && terrain.status !== 'ready' && (
              <div className="lm-loading" role="status">
                {terrain.status === 'loading'
                  ? 'Loading south-pole terrain…'
                  : 'South-pole terrain is unavailable right now.'}
              </div>
            )}

            <div className="lm-overlay lm-overlay--tl">
              <div role="group" aria-label="View" className="lm-seg">
                {(['whole', 'pole'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className="lm-seg__b"
                  >
                    {v === 'whole' ? 'Whole Moon' : 'South pole'}
                  </button>
                ))}
              </div>
              {!whole && (
                <div role="group" aria-label="Layer" className="lm-seg">
                  {(Object.keys(LAYER_LABELS) as PolarLayer[]).map((l) => (
                    <button
                      key={l}
                      type="button"
                      aria-pressed={layer === l}
                      onClick={() => setLayer(l)}
                      className="lm-seg__b lm-seg__b--sm"
                    >
                      {LAYER_LABELS[l]}
                    </button>
                  ))}
                </div>
              )}
              {!whole && (
                <button type="button" aria-pressed={psrOn} onClick={() => setPsrOn((v) => !v)} className="lm-psr">
                  <span aria-hidden="true" className="lm-psr__dot" style={{ opacity: psrOn ? 1 : 0.35 }} />
                  {psrOn ? 'Always-dark areas: On' : 'Always-dark areas: Off'}
                </button>
              )}
              <div className="lm-card">
                <div className="lm-card__t">{site.short}</div>
                <div className="lm-card__m">{fmtCoords(site.lat, site.lon)}</div>
              </div>
              {!whole && !poleVisible && <div className="lm-warn">Outside the polar view</div>}
              {whole && (
                <button
                  type="button"
                  className="lm-btn lm-btn--ghost lm-btn--sm"
                  onClick={() => globe.current?.focusOn(site.lat, site.lon, 2.2)}
                >
                  Face this site
                </button>
              )}
            </div>

            {showsSampleValues() && <div className="lm-overlay lm-overlay--tr">Design preview · sample values</div>}

            {!whole && (
              <div className="lm-keybox">
                {keyRows(layer, psrOn).map((k) => (
                  <div key={k.label} className="lm-key">
                    <span className="lm-key__sw" style={{ background: k.swatch }} />
                    {k.label}
                  </div>
                ))}
              </div>
            )}

            <div className="lm-legend">{legend}</div>

            {whole && (
              <div role="group" aria-label="Zoom" className="lm-zoom">
                <button type="button" aria-label="Zoom in" onClick={() => globe.current?.zoomBy(1.5)}>
                  +
                </button>
                <button type="button" aria-label="Zoom out" onClick={() => globe.current?.zoomBy(1 / 1.5)}>
                  −
                </button>
                <button
                  type="button"
                  aria-label="Reset zoom"
                  className="lm-zoom__reset"
                  onClick={() => globe.current?.resetZoom()}
                >
                  1×
                </button>
              </div>
            )}
          </div>

          <section aria-label="Timeline" className="lm-timeline">
            <div className="lm-timeline__top">
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                aria-label={playing ? 'Pause' : 'Play'}
                className="lm-play"
              >
                {playing ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                    <rect x="2" y="1" width="3.5" height="12" style={{ fill: 'var(--bg)' }} />
                    <rect x="8.5" y="1" width="3.5" height="12" style={{ fill: 'var(--bg)' }} />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                    <path d="M3 1l10 6-10 6z" style={{ fill: 'var(--bg)' }} />
                  </svg>
                )}
              </button>
              <div className="lm-h3">Lunar month</div>
              <div className="lm-hint">Drag to scrub a full lunar month. The Sun loops around.</div>
              <span className="lm-grow" />
              <span className="lm-legend-i">
                <span style={{ background: 'var(--amber)' }} />
                Sunlight
              </span>
              <span className="lm-legend-i">
                <span style={{ background: 'var(--sage)' }} />
                Earth in view
              </span>
              <span className="lm-legend-i">
                <span style={{ background: 'var(--clay)' }} />
                DSN contact
              </span>
            </div>
            <div className="lm-bands">
              {(
                [
                  ['Sunlight', sunBands, 'var(--amber)'],
                  ['Earth in view', earthBands, 'var(--sage)'],
                  ['DSN contact', dsnBands, 'var(--clay)'],
                ] as const
              ).map(([label, list, color]) => (
                <div key={label} className="lm-bandrow">
                  <span>{label}</span>
                  <div className="lm-band">
                    {list.map((b, i) => (
                      <span
                        key={i}
                        style={{ left: `${b.left.toFixed(2)}%`, width: `${b.width.toFixed(2)}%`, background: color }}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <div className="lm-bandrow">
                <label htmlFor="lm-time">Time</label>
                <input
                  id="lm-time"
                  className="lm-range"
                  type="range"
                  min={0}
                  max={T_MAX}
                  step={1}
                  value={t}
                  onChange={(e) => setT(Number(e.target.value))}
                />
              </div>
              <span aria-hidden="true" className="lm-cursor" style={cursor} />
            </div>
            <div className="lm-bandrow lm-bandrow--ticks">
              <span />
              <div className="lm-ticks">
                {timelineTicks().map((tk, i) => (
                  <span key={i}>{tk}</span>
                ))}
              </div>
            </div>
          </section>
        </main>

        <aside aria-label="Site details" className="lm-side lm-side--right">
          <div>
            <div className="lm-eyebrow">Selected site</div>
            <h1 className="lm-title">{site.name}</h1>
            <div className="lm-coords">{fmtCoords(site.lat, site.lon)}</div>
            <div className="lm-hint lm-hint--tight">
              {showsSampleValues()
                ? site.custom
                  ? 'Estimated from a simplified terrain model. Sample values.'
                  : 'Sample values for design preview.'
                : usesTerrain(site, mast)
                  ? (terrainResolutionM(site) ?? 0) >= 100
                    ? 'Real ephemeris and a coarse terrain mask from NASA’s global elevation model (about 237 m per pixel), so sunrise and sunset are approximate.'
                    : 'Real ephemeris and published terrain mask.'
                  : pm
                    ? 'Real ephemeris. No terrain mask here, so lit or shadow, the horizon and Earth’s visibility come from NASA’s 80 m polar map (coarse, about 0.8 km per pixel).'
                    : 'Real ephemeris. No terrain mask for this site or array height, so results use a smooth-sphere estimate (terrain unavailable).'}
            </div>
          </div>

          <div className="lm-grid2 lm-grid2--tight">
            <div className={`lm-status ${lit ? 'lm-status--amber' : ''}`}>
              <div className="lm-status__k">POWER</div>
              <div className="lm-status__v">{lit ? 'Sunlit' : 'In shadow'}</div>
            </div>
            <div className={`lm-status ${dsnUp ? 'lm-status--sage' : ''}`}>
              <div className="lm-status__k">DIRECT-TO-EARTH</div>
              <div className="lm-status__v">{dsnUp ? 'Link up' : earthUp ? 'No DSN' : 'Earth hidden'}</div>
            </div>
          </div>

          {!whole && (
            <div className="lm-panel">
              <div className="lm-eyebrow lm-eyebrow--tight">SOUTH POLE LIGHT AND SHADOW</div>
              {poleRows.map((r) => (
                <div key={r.label} className="lm-row lm-row--plain">
                  <span>{r.label}</span>
                  <span className={`lm-val lm-val--sm ${r.tone ? `lm-tone-${r.tone}` : ''}`}>{r.value}</span>
                </div>
              ))}
            </div>
          )}

          <div className="lm-table">
            {metrics.map((r) => (
              <div key={r.label} className="lm-row">
                <span>{r.label}</span>
                <span className={`lm-val ${r.tone ? `lm-tone-${r.tone}` : ''}`}>{r.value}</span>
              </div>
            ))}
          </div>

          <div>
            <div id={mastsId} className="lm-mastlabel">
              Solar array height above ground
            </div>
            <div role="group" aria-labelledby={mastsId} className="lm-masts">
              {MASTS.map((v) => (
                <button key={v} type="button" aria-pressed={mast === v} onClick={() => setMast(v)}>
                  {v} m
                </button>
              ))}
            </div>
            <div className="lm-hint lm-hint--tight">
              Raising the array lowers the effective horizon (Mazarico et al. 2011).
            </div>
          </div>

          <div className="lm-cta">
            <button type="button" className="lm-cta__a" onClick={() => onStandHere?.(site)}>
              Stand here
            </button>
            <button type="button" className="lm-cta__b" onClick={() => onAddToCompare?.(site)}>
              Add to compare
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
