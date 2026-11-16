// Owner: Nived
// South Pole Basemap. Honest by construction (UI critique M4): a labelled graticule, the real region outlines, and site pins -
// no invented terrain. Layer controls appear only once a layer raster exists. Layer stack, bottom to top:
//   graticule (labelled rings, 0 deg E "toward Earth") - raster layer (when loaded) - Artemis region outlines - site pins -
//   selected-site label - Site Inset (Landing vs Target, 100 m scale bar).
// Fast Lane: the pointer readout is written to a ref (no React state, no transitions). Clicks use store actions.
import { useEffect, useMemo, useRef } from 'react';
import { fill } from '../../engine/format';
import { useCatalog, useLayers } from '../../engine/hooks';
import { colatKm, halfExtentKm, MOON_RADIUS_KM, project, unproject } from '../../engine/projection';
import type { MapExtent, SiteRecord } from '../../engine/types';
import { loadPsr, type PsrRaster } from '../../engine/data/psr';
import { useCopyFn } from '../../state/copy';
import { getScenario, useScenario, type MapLayerId } from '../../state/scenarioStore';
import { Segmented } from '../../ui/Segmented';
import { Slider } from '../../ui/Slider';
import { extentContains, EXTENT_LIMIT_DEG, smallestExtentContaining } from './extent';
import { hillshadeFor, selectableLayers } from './hillshade';
import { insetOffsetsM } from './inset';
import { baseImageStyle, MOON_BASE_CREDIT, MOON_BASE_URL } from './moonBase';
import './map.css';

const RINGS: Record<MapExtent, number[]> = { '80S': [80, 82, 84, 86, 88], '85S': [85, 86, 87, 88, 89] };
const LAYER_IDS: MapLayerId[] = ['illumination', 'earth_visibility', 'slope_hazard', 'psr', 'psr_distance'];
const ringRadiusKm = (latS: number) => 2 * MOON_RADIUS_KM * Math.tan(((90 - latS) * Math.PI) / 360);
const fmtLat = (lat: number) => `${Math.abs(lat).toFixed(1)}°${lat < 0 ? 'S' : 'N'}`;

export interface BasemapProps {
  /** Override the catalog / scenario store (tests, forced states). */
  sites?: SiteRecord[];
  selectedId?: string | null;
  extent?: MapExtent;
}

export function Basemap(props: BasemapProps) {
  const t = useCopyFn();
  const catalog = useCatalog();
  const layersRes = useLayers();
  const layers = useScenario((s) => s.layers);
  const siteRef = useScenario((s) => s.site);
  const sites = props.sites ?? catalog.sites;
  const selectedId = props.selectedId !== undefined ? props.selectedId : siteRef.kind === 'site' ? siteRef.id : null;
  const extent: MapExtent = props.extent ?? layers.extent;
  const half = layersRes.extents?.[extent]?.halfExtentKm ?? halfExtentKm(EXTENT_LIMIT_DEG[extent]);
  const square = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const psr = useRef<PsrRaster | null>(null);
  const lastSelected = useRef<string | null>(null);

  const selected = sites.find((s) => s.id === selectedId) ?? null;
  const selectedExtent = selected ? smallestExtentContaining(selected.landingCoords.lat) : null;

  // When the user picks a site that this map does not show, switch to the map that does (once per selection).
  useEffect(() => {
    if (selected && selected.id !== lastSelected.current) {
      lastSelected.current = selected.id;
      if (!extentContains(extent, selected.landingCoords.lat) && selectedExtent) getScenario().setLayers({ extent: selectedExtent });
    }
  }, [selected, selectedExtent, extent]);
  useEffect(() => {
    let live = true;
    loadPsr().then((r) => live && (psr.current = r), () => undefined);
    return () => {
      live = false;
    };
  }, []);

  const layer = layersRes.layers.find((l) => l.id === layers.layer && l.extent === extent);
  const hasLayers = selectableLayers(layersRes.layers).length > 0;
  const hillshade = hillshadeFor(layersRes.layers, extent);
  const pins = useMemo(
    () =>
      sites.map((s) => {
        const p = project(s.landingCoords.lat, s.landingCoords.lon);
        return { s, x: p.x, y: -p.y, inside: Math.hypot(p.x, p.y) <= half };
      }),
    [sites, half],
  );
  const inset = selected ? insetOffsetsM(selected) : null;

  // Fast Lane readout: write textContent by ref on pointer move.
  const toKm = (e: React.PointerEvent | React.MouseEvent) => {
    const r = square.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width - 0.5) * 2 * half, y: -((e.clientY - r.top) / r.height - 0.5) * 2 * half };
  };
  const defaultReadout = selected ? `${selected.name} · ${fmtLat(selected.landingCoords.lat)} ${selected.landingCoords.lon.toFixed(1)}°E` : '';
  const onMove = (e: React.PointerEvent) => {
    const el = readout.current;
    if (!el) return;
    const { x, y } = toKm(e);
    if (Math.hypot(x, y) > half) return void (el.textContent = defaultReadout);
    const g = unproject(x, y);
    const d = psr.current?.distanceKm(x, y);
    el.textContent = `${Math.abs(g.lat).toFixed(2)}°S ${g.lon.toFixed(1)}°E` + (d != null && !Number.isNaN(d) ? ` · PSR ${d.toFixed(1)} km` : '');
  };
  const onTerrainClick = (e: React.MouseEvent) => {
    const { x, y } = toKm(e);
    if (Math.hypot(x, y) > half) return;
    const g = unproject(x, y);
    getScenario().setCustomPoint(Math.round(g.lat * 1000) / 1000, Math.round(g.lon * 1000) / 1000);
  };

  const pinR = half * 0.03;
  const fs = half * 0.09; // SVG text size in map units: ~11-12 px on screen at the smallest map (nothing under 11 px)
  const outside = selected && !extentContains(extent, selected.landingCoords.lat);
  return (
    <div className="basemap" data-extent={extent}>
      <div className="basemap__bar">
        <Segmented
          size="sm"
          ariaLabel="Map extent"
          value={extent}
          onChange={(v) => getScenario().setLayers({ extent: v })}
          options={[{ value: '80S', label: t('map.extent.80S') }, { value: '85S', label: t('map.extent.85S') }]}
        />
        {hasLayers && (
          <>
            <select
              className="basemap__layer"
              aria-label="Map layer"
              value={layers.layer ?? ''}
              onChange={(e) => getScenario().setLayers({ layer: (e.target.value || null) as MapLayerId | null })}
            >
              <option value="">{t('map.layer.none')}</option>
              {LAYER_IDS.map((id) => (
                <option key={id} value={id}>
                  {t(`map.layer.${id}`)}
                </option>
              ))}
            </select>
            <Slider
              className="basemap__opacity"
              ariaLabel={t('map.opacity')}
              min={0}
              max={1}
              step={0.05}
              value={layers.opacity}
              onLive={(v) => img.current && (img.current.style.opacity = String(v))}
              onCommit={(v) => getScenario().setLayers({ opacity: v })}
            />
          </>
        )}
      </div>
      <div className="basemap__stage">
        <div ref={square} className="basemap__square" onPointerMove={onMove} onClick={onTerrainClick} role="img" aria-label={t('slot.map')}>
          <div className="basemap__base" aria-hidden>
            <img src={MOON_BASE_URL} alt="" style={baseImageStyle(half)} data-testid="moon-base" draggable={false} />
          </div>
          {hillshade && <img src={hillshade.url} alt="" data-layer="hillshade" className="basemap__hillshade" />}
          {layer && <img ref={img} src={layer.url} alt="" style={{ opacity: layers.opacity }} data-layer={layer.id} />}
          <svg viewBox={`${-half} ${-half} ${2 * half} ${2 * half}`}>
            <circle className="basemap__disk" cx={0} cy={0} r={half} />
            {RINGS[extent].map((lat) => (
              <circle key={lat} className="basemap__ring" cx={0} cy={0} r={ringRadiusKm(lat)} />
            ))}
            {Array.from({ length: 12 }, (_, i) => {
              const a = (i * 30 * Math.PI) / 180;
              return <line key={i} className={i === 0 ? 'basemap__meridian basemap__meridian--zero' : 'basemap__meridian'} x1={0} y1={0} x2={Math.sin(a) * half} y2={-Math.cos(a) * half} />;
            })}
            {RINGS[extent].map((lat) => (
              <text key={`l${lat}`} className="basemap__tick" x={fs * 0.4} y={-ringRadiusKm(lat) + fs * 1.05} fontSize={fs}>
                {`${lat}°S`}
              </text>
            ))}
            <text className="basemap__earth" textAnchor="end" x={-fs * 0.5} y={-half * 0.78} fontSize={fs}>
              <tspan>{'0\u00b0E'}</tspan>
              <tspan x={-fs * 0.5} dy={fs * 1.1}>
                {t('map.towardEarth')}
              </tspan>
            </text>
            {layersRes.regions.map((g) => (
              <path key={g.id} className="basemap__region" d={g.svgPath}>
                <title>{g.name}</title>
              </path>
            ))}
            {pins.filter((p) => p.inside).map(({ s, x, y }) => (
              <circle
                key={s.id}
                data-site={s.id}
                className={s.id === selectedId ? 'basemap__pin is-selected' : 'basemap__pin'}
                cx={x}
                cy={y}
                r={pinR}
                onClick={(e) => {
                  e.stopPropagation();
                  if (e.shiftKey) getScenario().addCompareRow({ site: { kind: 'site', id: s.id } });
                  else getScenario().selectSite(s.id);
                }}
              >
                <title>{s.name}</title>
              </circle>
            ))}
            {pins.filter((p) => p.inside && p.s.id === selectedId).map(({ s, x, y }) => (
              <text key={`n${s.id}`} className="basemap__name" textAnchor={x > 0 ? 'end' : 'start'} x={x > 0 ? x - pinR * 1.6 : x + pinR * 1.6} y={y + fs * 0.35} fontSize={fs}>
                {s.name}
              </text>
            ))}
          </svg>
          {inset && selected && (
            <div className="basemap__inset" data-testid="site-inset">
              <svg viewBox="-1000 -1000 2000 2000" role="img" aria-label={selected.name}>
                <line x1={inset.landing[0]} y1={-inset.landing[1]} x2={inset.target[0]} y2={-inset.target[1]} stroke="currentColor" strokeWidth={6} opacity={0.6} />
                <circle cx={inset.landing[0]} cy={-inset.landing[1]} r={40} fill="var(--c-sun)" />
                <circle cx={inset.target[0]} cy={-inset.target[1]} r={40} fill="none" stroke="var(--c-earth)" strokeWidth={14} />
                <text x={60} y={-60} fontSize={90}>{t('map.inset.landing')}</text>
                <text x={inset.target[0] + 60} y={-inset.target[1] - 60} fontSize={90}>{t('map.inset.target')}</text>
                <line x1={-900} y1={900} x2={-800} y2={900} stroke="currentColor" strokeWidth={14} />
                <text x={-780} y={930} fontSize={90}>{t('map.inset.scale')}</text>
              </svg>
            </div>
          )}
        </div>
      </div>
      <div className="basemap__credit">LROC base image · {MOON_BASE_CREDIT}</div>
      <div ref={readout} className="basemap__readout" aria-live="off">
        {defaultReadout}
      </div>
      {outside && selected && (
        <div className="basemap__notice" role="status">
          {selectedExtent ? (
            <>
              <span className="truncate">{fill(t('map.outside'), { name: selected.name })}</span>
              <button type="button" className="basemap__show" onClick={() => getScenario().setLayers({ extent: selectedExtent })}>
                {fill(t('map.show'), { extent: t(`map.extent.${selectedExtent}`) })}
              </button>
            </>
          ) : (
            <span className="truncate">
              {fill(t('map.notOnMap'), { name: selected.name, lat: fmtLat(selected.landingCoords.lat), lon: `${selected.landingCoords.lon.toFixed(1)}°E`, km: Math.round(colatKm(selected.landingCoords.lat)) })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
