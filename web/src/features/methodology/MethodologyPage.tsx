// Owner: Ebin (written for the live pages; route "methodology")
// Methodology & Validation (PLAN_FINAL §8.7): what LUMEN does and does not compute, how a number is produced, where the data comes
// from, the definitions and the uncertainty method, and the glossary. (The validation gates, known limitations and AI-use disclosure
// sections were removed from this page on request; the validation report itself is still published in the data folder.)
// Honesty rule: the scope statement is the plan's own wording.
import { useEffect, useState } from 'react';
import { CREDITS } from '../../content/credits';
import './methodology.css';

interface GlossaryEntry {
  id: string;
  term: string;
  definition: string;
  units?: string;
  formula?: string;
  impact?: string;
  uncertainty?: string;
  source?: string;
  learn_more_anchor?: string;
}

const SECTIONS = [
  ['scope', 'What LUMEN does and does not compute'],
  ['how', 'How a number is produced'],
  ['data', 'Data sources'],
  ['definitions', 'Definitions and frames'],
  ['uncertainty', 'Uncertainty (±)'],
  ['glossary', 'Glossary'],
] as const;

export function MethodologyPage() {
  const [glossary, setGlossary] = useState<GlossaryEntry[]>([]);

  useEffect(() => {
    let live = true;
    const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    fetch(`${base.replace(/\/$/, '')}/content/glossary.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { entries?: GlossaryEntry[] }) => live && setGlossary(j.entries ?? []))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return (
    <main className="lm-wrap lm-meth">
      <div>
        <h1 className="lm-h1">Methodology &amp; validation</h1>
        <p className="lm-lede">
          How LUMEN works, what it rests on, and where it stops. Written to be read, not skimmed: every claim here is the project plan’s own wording.
        </p>
      </div>

      <nav aria-label="On this page" className="lm-meth__toc">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#methodology`} onClick={(e) => (e.preventDefault(), document.getElementById(`m-${id}`)?.scrollIntoView({ block: 'start' }))}>
            {label}
          </a>
        ))}
      </nav>

      <section id="m-scope" className="lm-box lm-meth__sec">
        <h2>What LUMEN does and does not compute</h2>
        <p>
          <strong>LUMEN computes</strong> geometric Sun and Earth availability, Deep Space Network coverage, and a generic power estimate.
        </p>
        <p>
          <strong>It does not compute</strong> link budgets, data rates, thermal survival or vehicle-specific array performance.
        </p>
        <p>
          Limits that follow from the data: DEM resolution bounds the near-field horizon and pad slope; LOLA elevation errors propagate into horizons
          (quantified through σ); lander-scale rocks are not modelled; “Tier C” sites assume a smooth Moon; DSN visibility is simplified to a single
          elevation threshold; and Tier-B terrain snaps to a coarse grid, with a snap error of up to about 2.8 km in the 4 km band.
        </p>
      </section>

      <section id="m-how" className="lm-box lm-meth__sec">
        <h2>How a number is produced</h2>
        <ol>
          <li>
            <strong>Ahead of time</strong> (Python): Sun and Earth positions are computed from NASA SPICE ephemeris kernels, and LOLA elevation maps are
            turned into <em>horizon masks</em> — the height of the skyline in every compass direction, at four array heights — for each site.
          </li>
          <li>
            <strong>In your browser</strong> (TypeScript, offline): for a site and a time, the Sun and Earth positions are interpolated (cubic Hermite),
            rotated into the site’s frame, and compared with the horizon mask. Each body is a disk, not a point, so its visible fraction is computed by
            chord quadrature against the skyline.
          </li>
          <li>
            Moments when something changes (a sunset, an Earthset) are found by bisection to about 10 s. Windows, percentages, the longest night and a
            ± from the horizon uncertainty follow, and the verdict is last.
          </li>
          <li>
            Every browser calculation has a Python twin; the two are checked against each other on shared test cases (“golden vectors”). The app makes
            no network calls after the first load.
          </li>
        </ol>
      </section>

      <section id="m-data" className="lm-box lm-meth__sec">
        <h2>Data sources</h2>
        <ul>
          <li>
            Ephemeris: <a href="https://naif.jpl.nasa.gov/naif/data.html">NASA NAIF SPICE kernels</a> (planetary and lunar kernels, DSN station kernels),
            evaluated in a Moon-fixed frame consistent with the LOLA terrain data.
          </li>
          <li>
            Terrain: <a href="https://pgda.gsfc.nasa.gov/">LRO LOLA digital elevation models from the Planetary Geodesy Data Archive</a> (polar products
            at 5, 10, 20, 60 and 240 m per pixel).
          </li>
          <li>
            Average illumination and Earth visibility maps: Mazarico, E., et al. (2011), <em>Icarus</em> 211, 1066–1081,{' '}
            <a href="https://doi.org/10.1016/j.icarus.2010.10.030">doi:10.1016/j.icarus.2010.10.030</a>.
          </li>
          <li>
            Site coordinates: agency and peer-reviewed sources named per site in the catalogue (for example ISRO’s{' '}
            <a href="https://www.isro.gov.in/Chandrayaan3.html">Chandrayaan-3</a> page; the{' '}
            <a href="https://astrogeology.usgs.gov/search/map/Moon/Lunar_Polar_Maps">USGS lunar polar maps</a>).
          </li>
          <li>
            Cross-checks and context: <a href="https://ssd.jpl.nasa.gov/horizons/">JPL Horizons</a>,{' '}
            <a href="https://quickmap.lroc.im-ldi.com/">LROC QuickMap</a>, <a href="https://trek.nasa.gov/moon/">NASA Moon Trek</a>.
          </li>
          <li>
            Images: Sun — {CREDITS.sun_sdo.credit} (<a href="https://sdo.gsfc.nasa.gov/data/">SDO data</a>); Earth — {CREDITS.earth_epic.credit} (
            <a href="https://epic.gsfc.nasa.gov/">EPIC</a>); Moon globe — LROC colour map (NASA SVS CGI Moon Kit); Earth globe — NASA Blue Marble; polar
            terrain picture — NASA LRO LOLA 80 m DEM; south-pole photo base — NASA/GSFC/Arizona State University (LROC). No NASA logo or insignia is used.
          </li>
        </ul>
      </section>

      <section id="m-definitions" className="lm-box lm-meth__sec">
        <h2>Definitions and frames</h2>
        <ul>
          <li>
            <strong>Sun available</strong> when at least 50% of the Sun’s disk is above the terrain horizon in its direction (editable in the full design).
          </li>
          <li>
            <strong>Earth visible</strong> when at least 50% of Earth’s disk clears the horizon and the DTE margin is at least 1°.{' '}
            <strong>Link up</strong> additionally requires at least one Deep Space Network complex (Goldstone, Canberra, Madrid) to see the Moon above 10°.
          </li>
          <li>
            <strong>Azimuth near the pole</strong> is measured from a fixed reference (toward 0°E, the mean direction to Earth) because “east” is undefined at the
            pole; elsewhere it is true azimuth.
          </li>
          <li>
            <strong>Verdict</strong>: GO if every hard requirement passes even at the conservative bound; MARGINAL if one passes only at its nominal value or is
            within 10% of its limit; NO-GO otherwise.
          </li>
          <li>
            <strong>Tiers</strong>: A = dedicated high-resolution terrain; B = snapped to a coarse 80–90°S grid; C = smooth sphere, no terrain.
          </li>
        </ul>
      </section>

      <section id="m-uncertainty" className="lm-box lm-meth__sec">
        <h2>Uncertainty (±)</h2>
        <p>
          Near the pole the Sun’s elevation changes very slowly (about 0.044° per hour at 85°S), so a small horizon error moves a sunset by hours. Each event
          time therefore carries a ± of about <em>σ ÷ |rate of change of clearance|</em>, and each percentage is computed three times (horizon lowered by σ,
          nominal, raised by σ) to give a [low, high] range. When the rate is very small or the ± exceeds about 12 h, the event is marked “grazing — timing
          poorly constrained” and a range is shown instead.
        </p>
        <p>
          <strong>Where σ comes from today:</strong> IM-2, Chandrayaan-3 and the Shackleton ridge have a <em>preliminary Monte-Carlo σ</em> (30 perturbed copies
          of the elevation model). It rests on two unverified modelling assumptions — that the published error raster is a one-σ magnitude, and a 50 m
          correlation length that has not been physically calibrated — and is marked preliminary in its own file. Sites without a σ file show no ± and say why.
          Nothing is invented to fill the gap.
        </p>
      </section>

      <section id="m-glossary" className="lm-box lm-meth__sec">
        <h2>Glossary</h2>
        {glossary.length === 0 && <p className="lm-hint">Loading…</p>}
        <dl className="lm-meth__gloss">
          {glossary.map((g) => (
            <div key={g.id} id={g.learn_more_anchor ?? `gloss-${g.id}`}>
              <dt>
                {g.term}
                {g.units ? <span className="lm-meth__unit"> · {g.units}</span> : null}
              </dt>
              <dd>
                {g.definition}
                {g.formula ? (
                  <>
                    {' '}
                    <span className="lm-meth__formula">{g.formula}</span>
                  </>
                ) : null}
                {g.uncertainty ? <span className="lm-meth__caveat"> {g.uncertainty}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
