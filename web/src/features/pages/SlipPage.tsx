// Owner: Abhinav
// Slip explorer: how a later landing changes sunlight and the link home. One bar per slip day (a 14-day window each).
// Converted from the design. Additions: bars are clickable and keyboard-reachable, a dashed line marks the on-time level, the
// best window is flagged with a "jump to it" button, and the array height follows the shared setting.
import { useMemo } from 'react';
import { showsSampleValues } from '../orbit/realModel';
import { SITES, type Site } from '../orbit/orbitModel';
import { useLumenContext } from './usePages';
import { useEngineResult } from './engineBindings';
import { getBaseUtc, longDate } from '../orbit/windowStart';
import { StandHereNumbers } from './StandHereNumbers';
import { SLIP_DAYS, bestSlip, fmtDuration, fmtPoints, slipWindows, type WindowStats } from './pagesModel';

const SHORT: Record<string, string> = { im2: 'IM-2', shack: 'Ridge', malapert: 'Malapert', haworth: 'Haworth' };
const dateOf = (slip: number): string => new Date(getBaseUtc() + slip * 86_400_000).toISOString().slice(0, 10);

function Bars({
  wins,
  field,
  color,
  height,
  slip,
  base,
  onPick,
  what,
}: {
  wins: readonly WindowStats[];
  field: 'sun' | 'dsn';
  color: string;
  height: number;
  slip: number;
  base: number;
  onPick: (i: number) => void;
  what: string;
}) {
  return (
    <div className="lm-bars" style={{ height }}>
      <span
        aria-hidden="true"
        className="lm-bars__base"
        style={{ bottom: `${Math.max(3, (base / 100) * height)}px` }}
      />
      {wins.map((w, i) => (
        <button
          key={i}
          type="button"
          className="lm-bar-b"
          aria-label={`Slip ${i} days, ${what} ${Math.round(w[field])}%`}
          aria-pressed={i === slip}
          title={`+${i} d · ${Math.round(w[field])}%`}
          onClick={() => onPick(i)}
        >
          <span style={{ height: `${Math.max(3, (w[field] / 100) * height).toFixed(1)}px`, background: color }} />
        </button>
      ))}
    </div>
  );
}

export function SlipPage() {
  const L = useLumenContext();
  const { site, mast, slip, setSlip } = L;
  const wins = useMemo(() => slipWindows(site, mast), [site, mast]);
  const best = useMemo(() => bestSlip(wins), [wins]);
  const cur = wins[slip];
  const base = wins[0];
  const QUICK = SITES.slice(0, 4);
  // The engine's exact (refined-window) numbers, verdict and labels for the window the slider is on. The bars above are the page's hourly view-model; this is the
  // figure to quote. Null (and nothing shown) unless the data mode is real and the result has arrived.
  const eng = useEngineResult(site, mast, slip, 14);
  const options: Site[] = QUICK.some((s) => s.id === site.id) ? [...QUICK] : [...QUICK, site];

  return (
    <main className="lm-wrap">
      <div className="lm-pagehead">
        <div>
          <h1 className="lm-h1">What if we slip?</h1>
          <p className="lm-lede">
            Each bar is a 14-day window starting that many days after {longDate(getBaseUtc())}. Slide to see how a later landing
            changes power and the link home.{showsSampleValues() ? ' Sample values.' : ''}
          </p>
        </div>
        <div role="group" aria-label="Site" className="lm-segs">
          {options.map((s) => (
            <button key={s.id} type="button" aria-pressed={s.id === site.id} onClick={() => L.selectSite(s.id)}>
              {SHORT[s.id] ?? s.short}
            </button>
          ))}
        </div>
      </div>

      <section aria-label="Slip chart" className="lm-box lm-box--chart">
        <div className="lm-chartblock">
          <div className="lm-legend-i">
            <span style={{ background: 'var(--amber)' }} />
            Time in sunlight
            <i className="lm-grow" />
            <i className="lm-legend-i__dash" />
            on time
          </div>
          <Bars
            wins={wins}
            field="sun"
            color="var(--amber)"
            height={120}
            slip={slip}
            base={base.sun}
            onPick={setSlip}
            what="sunlight"
          />
        </div>
        <div className="lm-chartblock">
          <div className="lm-legend-i">
            <span style={{ background: 'var(--clay)' }} />
            DSN contact time
          </div>
          <Bars
            wins={wins}
            field="dsn"
            color="var(--clay)"
            height={80}
            slip={slip}
            base={base.dsn}
            onPick={setSlip}
            what="DSN contact"
          />
        </div>
        <div className="lm-chartblock lm-chartblock--tight">
          <label htmlFor="lm-slip" className="lm-slipl">
            Slip by <strong>{slip} days</strong>
          </label>
          <input
            id="lm-slip"
            className="lm-range"
            type="range"
            min={0}
            max={SLIP_DAYS - 1}
            step={1}
            value={slip}
            onChange={(e) => setSlip(Number(e.target.value))}
          />
          <div className="lm-ticks">
            <span>on time</span>
            <span>+14 d</span>
            <span>+27 d</span>
          </div>
        </div>
        <div className="lm-bestrow">
          <span>
            Best window: <strong>+{best} d</strong> ({dateOf(best)}) with {Math.round(wins[best].sun)}% sunlight
            {best === 0 ? ' — landing on time is already the best.' : ''}
          </span>
          {best !== slip && (
            <button type="button" className="lm-textlink" onClick={() => setSlip(best)}>
              Jump to it
            </button>
          )}
        </div>
      </section>

      {eng && <StandHereNumbers result={eng} terrain={eng.meta?.tierBadge.startsWith('Terrain mask') ?? false} windowLabel={`14 days from ${dateOf(slip)}`} />}

      <div className="lm-statgrid">
        <div className="lm-stat">
          <div className="lm-stat__k">LANDING DATE</div>
          <div className="lm-stat__v">{dateOf(slip)}</div>
        </div>
        <div className="lm-stat">
          <div className="lm-stat__k">SUNLIGHT</div>
          <div className="lm-stat__v lm-tone-amber">{Math.round(cur.sun)}%</div>
          <div className="lm-stat__d">{fmtPoints(cur.sun, base.sun)}</div>
        </div>
        <div className="lm-stat">
          <div className="lm-stat__k">DSN CONTACT</div>
          <div className="lm-stat__v lm-tone-clay">{Math.round(cur.dsn)}%</div>
          <div className="lm-stat__d">{fmtPoints(cur.dsn, base.dsn)}</div>
        </div>
        <div className="lm-stat">
          <div className="lm-stat__k">LONGEST DARK STRETCH</div>
          <div className="lm-stat__v">{fmtDuration(cur.dark)}</div>
        </div>
      </div>

      <div className="lm-actions">
        <a href="#orbit" className="lm-linkbtn">
          Back to orbit
        </a>
        <a href="#compare" className="lm-linkbtn lm-linkbtn--ghost">
          Compare sites
        </a>
      </div>
    </main>
  );
}
