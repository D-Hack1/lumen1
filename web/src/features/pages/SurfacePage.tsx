// Owner: Abhinav
// "Stand here": the horizon panorama from one site — terrain skyline, the Sun and Earth, and the dashed paths they trace over a
// lunar month. Converted from the design. Additions: hover the panorama for a bearing / horizon readout, Sun / Earth labels and a
// legend, and rise / set countdowns on the cards.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MASTS,
  SITES,
  T_MAX,
  MONTH_HOURS,
  fmtCoords,
  fmtHours,
  horizon,
  model,
  until,
  type Site,
} from '../orbit/orbitModel';
import { useLumenContext } from './usePages';
import { PANO_H, PANO_W, azToX, compassPoint, horizonPath, skyTrack, skyY, xToAz } from './pagesModel';
import { go } from './nav';
import { getBaseUtc, longDate } from '../orbit/windowStart';
import { usePolarShadowNote } from '../orbit/polarPin';
import { standHereView, useEngineResult, useSkyline } from './engineBindings';
import { StandHereNumbers } from './StandHereNumbers';
import { StandHereDetails } from '../analysis/StandHereDetails';

const SHORT: Record<string, string> = { im2: 'IM-2', shack: 'Ridge', malapert: 'Malapert', haworth: 'Haworth' };
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'];

export function SurfacePage() {
  const L = useLumenContext();
  const { site, mast, t, setT } = L;
  const [playing, setPlaying] = useState(false);
  const cross = useRef<SVGLineElement>(null);
  const readout = useRef<HTMLDivElement>(null);

  // Real engine values when the data mode is real and the result has arrived; otherwise the design's sample model (the fallback).
  const eng = useEngineResult(site, mast);
  const sky = useSkyline(site, mast);
  const shadowNote = usePolarShadowNote(site.lat, site.lon, sky?.terrain ?? false);
  const v = useMemo(() => (eng ? standHereView(eng, sky, t) : null), [eng, sky, t]);
  const sample = useMemo(() => model(t, site, mast), [t, site, mast]);
  const m = v
    ? { ...sample, sunAz: v.sunAz, sunEl: v.sunEl, earthAz: v.earthAz, earthEl: v.earthEl, earthUp: v.earthUp }
    : sample;
  const path = useMemo(() => v?.path ?? horizonPath(site, mast), [v, site, mast]);
  const sunTrack = useMemo(() => v?.sunTrack ?? skyTrack('sun', site, mast), [v, site, mast]);
  const earthTrack = useMemo(() => v?.earthTrack ?? skyTrack('earth', site, mast), [v, site, mast]);
  const yOf = v?.y ?? skyY;
  const hAt = (az: number) => (sky ? sky.elevationAt(az) : horizon(az, site, mast));
  const lit = v ? v.lit : sample.frac > 0.5;
  const sunChange = v ? v.sunChangeH : until(t, site, mast, (q) => (lit ? q.frac <= 0.5 : q.frac > 0.5));
  const earthChange = v ? v.earthChangeH : until(t, site, mast, (q) => (m.earthUp ? !q.earthUp : q.earthUp));

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setT((v) => (v + 1) % MONTH_HOURS), 70);
    return () => clearInterval(id);
  }, [playing, setT]);

  const QUICK = SITES.slice(0, 4);
  const options: Site[] = QUICK.some((s) => s.id === site.id) ? [...QUICK] : [...QUICK, site];
  const sunX = azToX(m.sunAz);
  const sunY = yOf(m.sunEl);
  const earthX = azToX(m.earthAz);
  const earthY = yOf(m.earthEl);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(PANO_W, ((e.clientX - r.left) / r.width) * PANO_W));
    const az = xToAz(x);
    const line = cross.current;
    const box = readout.current;
    if (!line || !box) return;
    line.setAttribute('x1', String(x));
    line.setAttribute('x2', String(x));
    line.style.display = 'block';
    box.style.display = 'block';
    box.style.left = `${Math.min(Math.max(x / PANO_W, 0.1), 0.9) * 100}%`;
    box.textContent = `Bearing ${Math.round(az)}° ${compassPoint(az)} · skyline ${hAt(az).toFixed(1)}° high`;
  };
  const onLeave = () => {
    if (cross.current) cross.current.style.display = 'none';
    if (readout.current) readout.current.style.display = 'none';
  };

  return (
    <main className="lm-wrap">
      <div className="lm-pagehead">
        <div>
          <div className="lm-eyebrow">Standing at</div>
          <h1 className="lm-h1 lm-h1--tight">{site.name}</h1>
          <div className="lm-coords lm-coords--lg">{fmtCoords(site.lat, site.lon)} · looking all the way around</div>
        </div>
        <div role="group" aria-label="Site" className="lm-segs">
          {options.map((s) => (
            <button key={s.id} type="button" aria-pressed={s.id === site.id} onClick={() => L.selectSite(s.id)}>
              {SHORT[s.id] ?? s.short}
            </button>
          ))}
        </div>
      </div>

      <section className="lm-pano lm-dark" aria-label="Horizon panorama">
        <svg
          viewBox={`0 0 ${PANO_W} ${PANO_H}`}
          className="lm-pano__svg"
          role="img"
          aria-label="Terrain horizon profile with Sun and Earth positions"
          onPointerMove={onMove}
          onPointerLeave={onLeave}
        >
          <defs>
            <linearGradient id="lm-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#000000" />
              <stop offset="1" stopColor="#1A1A1A" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width={PANO_W} height={PANO_H} fill="url(#lm-sky)" />
          <path d={sunTrack} fill="none" stroke="#F2B04A" strokeWidth="1.5" strokeDasharray="5 5" opacity="0.75" />
          <path d={earthTrack} fill="none" stroke="#7FB5A3" strokeWidth="1.5" strokeDasharray="5 5" opacity="0.85" />
          <path d={path} fill="#111111" stroke="#6A6A6A" strokeWidth="1.5" />
          <line
            ref={cross}
            x1="0"
            x2="0"
            y1="0"
            y2={PANO_H}
            stroke="rgba(237,231,219,0.45)"
            strokeWidth="1"
            style={{ display: 'none' }}
          />
          <circle cx={sunX} cy={sunY} r="26" fill="#F2B04A" opacity={lit ? 0.35 : 0.08} />
          <circle cx={sunX} cy={sunY} r="11" fill="#FFE7B0" />
          <text x={sunX} y={sunY + 30} textAnchor="middle" className="lm-pano__lbl" fill="#F2B04A">
            SUN
          </text>
          <circle cx={earthX} cy={earthY} r="9" fill="#7FB5A3" />
          <text x={earthX} y={earthY - 15} textAnchor="middle" className="lm-pano__lbl" fill="#9ACDBB">
            EARTH
          </text>
        </svg>
        <div className="lm-overlay lm-overlay--tl lm-overlay--soft">
          {v
            ? v.source === 'terrain'
              ? eng?.meta?.tierBadge.startsWith('Coarse')
                ? 'Real engine · coarse terrain mask (NASA global elevation model)'
                : 'Real engine · terrain mask'
              : 'Real engine · smooth Moon, no terrain data for this site / array height'
            : 'Design preview · sample values'}
        </div>
        <div ref={readout} className="lm-pano__read" role="status" />
        <div className="lm-pano__axis" aria-hidden="true">
          {COMPASS.map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </div>
        <div className="lm-pano__legend">
          <span>
            <i style={{ borderColor: '#F2B04A' }} />
            Sun&apos;s path this month
          </span>
          <span>
            <i style={{ borderColor: '#7FB5A3' }} />
            Earth&apos;s path
          </span>
          <span className="lm-grow" />
          <span>Hover for bearing and skyline height</span>
        </div>
      </section>

      <section aria-label="Time" className="lm-box lm-box--row">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? 'Pause' : 'Play'}
          className="lm-play lm-play--text"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <div className="lm-grow lm-grow--col">
          <label htmlFor="lm-t" className="lm-hint">
            Scrub a full lunar month. Dashed lines trace the Sun (amber) and Earth (sage) paths.
          </label>
          <input
            id="lm-t"
            className="lm-range"
            type="range"
            min={0}
            max={T_MAX}
            step={1}
            value={Math.round(t)}
            onChange={(e) => setT(Number(e.target.value))}
          />
        </div>
        <button
          type="button"
          className="lm-linkbtn lm-linkbtn--ghost"
          onClick={() => {
            L.addPick(site.id);
            go('compare');
          }}
        >
          Compare this site
        </button>
        <a href="#orbit" className="lm-linkbtn lm-linkbtn--ghost">
          Back to orbit
        </a>
      </section>

      <div className="lm-split">
        <div className="lm-cards2">
          <div className={`lm-bigcard ${lit ? 'lm-bigcard--amber' : ''}`}>
            <div className="lm-bigcard__k">SUN</div>
            <div className="lm-bigcard__v">{lit ? 'Above the ridge' : 'Behind terrain'}</div>
            <div className="lm-bigcard__m">
              Elevation {m.sunEl.toFixed(2)}° · horizon {hAt(m.sunAz).toFixed(2)}°
            </div>
            <div className="lm-bigcard__n">
              {lit ? 'Sets' : 'Rises'} in {fmtHours(sunChange)}
              {v && sunChange === null ? ' (not within this month)' : ''}
            </div>
          </div>
          <div className={`lm-bigcard ${m.earthUp ? 'lm-bigcard--sage' : ''}`}>
            <div className="lm-bigcard__k">EARTH</div>
            <div className="lm-bigcard__v">{m.earthUp ? 'In view' : 'Hidden'}</div>
            <div className="lm-bigcard__m">
              Elevation {m.earthEl.toFixed(2)}° · azimuth {Math.round(m.earthAz)}°
            </div>
            <div className="lm-bigcard__n">
              {m.earthUp ? 'Sets' : 'Rises'} in {fmtHours(earthChange)}
              {v && earthChange === null ? ' (not within this month)' : ''}
            </div>
          </div>
        </div>
        <div className="lm-box">
          <div id="lm-mast-s" className="lm-mastlabel lm-mastlabel--flush">
            Solar array height above ground
          </div>
          <div role="group" aria-labelledby="lm-mast-s" className="lm-masts">
            {MASTS.map((v) => (
              <button key={v} type="button" aria-pressed={mast === v} onClick={() => L.setMast(v)}>
                {v} m
              </button>
            ))}
          </div>
          <div className="lm-hint">Taller masts see over nearby terrain. Watch the horizon line drop.</div>
        </div>
      </div>

      {eng && v && v.source !== 'terrain' && shadowNote && (
        <p className="lm-hint lm-hint--warn" role="note" data-testid="polar-shadow-note">
          {shadowNote}
        </p>
      )}
      {eng && v && (
        <StandHereNumbers
          result={eng}
          terrain={v.source === 'terrain'}
          windowLabel={`30 days from ${longDate(getBaseUtc())}`}
        />
      )}

      {/* Windows Table, Pointing & Link (DSN lanes), Power curve and Barcode — drawn from the same result as the numbers above. */}
      {eng && <StandHereDetails result={eng} t={t} onSeek={(h) => setT(Math.max(0, Math.min(T_MAX, Math.round(h))))} />}
    </main>
  );
}
