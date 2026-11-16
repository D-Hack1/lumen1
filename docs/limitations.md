# limitations.md

_Owner: Gowri_ (consolidated by Ebin from the plan, the validation report and checks run on the running app)

Known limitations. Anything not listed here is not claimed to work.

## Scope (from PLAN_FINAL §10 — the in-app scope statement)
LUMEN computes geometric Sun and Earth availability, DSN coverage and a generic power estimate. It does **not** compute link budgets, data
rates, thermal survival or vehicle-specific array performance. DEM resolution bounds the near-field horizon and pad slope; LOLA errors
propagate into horizons (quantified through σ); lander-scale rocks are not modelled; Tier C assumes a smooth Moon; DSN masks are simplified
to one elevation threshold; Tier-B snap error is up to about 2.8 km in the 4 km band.

## Validation
- The validation report (`web/public/data/validation/report.json`, shown on the Methodology page) is **NOT_READY**: 4 of 14 gates pass
  (G1, G2, G3, G3b); G0, G4, G6, G8, G9 and G11 are pending; G5, G7 and G10 are blocked. A gate is PASS only when a recorded check meets its
  criterion.
- **G7** (Chandrayaan-3 Sun elevation): the 8.75° ± 0.25° reference value has no primary source in the repository, so agreement with it is not
  independent validation.
- **G8** (performance on the demo laptop) has not been measured on the demo machine. Per-frame costs measured during development (tilt drag
  p95 0.9 ms; slip-drag preview p95 3.5 ms; hover/scrub below 1 ms) are well inside the budgets, but are not the gate evidence.

## Uncertainty (σ, ±)
- σ exists only for IM-2, Chandrayaan-3 and the Shackleton ridge, and is **preliminary** Monte-Carlo (30 clones). It assumes the published
  error raster is a one-σ magnitude and uses a 50 m correlation length; neither is verified or physically calibrated (`MC_SIGMA_REPORT.md`).
- Sites without σ show no ± and say why; Tier-B calibration (G10) has not been done.

## Data coverage
- **Terrain masks** exist for IM-2, Chandrayaan-3 and the Shackleton ridge only. Every other site or custom point uses a smooth-Moon
  estimate and is labelled as one. The Tier-B regional grid (80–90°S) is not produced, so custom points near the pole have no terrain.
- **Dispersion grids** (landing-ellipse slope statistics) and **pad-slope validation against PGDA slope rasters (G6)** are not produced.
- **Catalogue:** four sites. The plan's wider list (Apollo, SLIM, Chang'e-6, the Artemis regions) is not in the catalogue yet; unverified rows
  are deliberately not shown as verified.
- **Shackleton connecting ridge:** the catalogue coordinates (−89.54°, 129.0°E; source: USGS navigation grid and NASA CLPS material) read
  **0 % average illumination** on NASA's illumination map, so the engine correctly reports 0 % sunlit there. The mask itself is a faithful
  reading of the DEM at that point (see `TERRAIN_DEPENDENCY_REPORT.md`), so the open question is the **coordinates**, not the terrain. The
  brightest ground nearby is around −89.45°, 223°E (≈ 55 %), close to the published connecting-ridge location. These coordinates need
  re-verification against a primary source before the site is presented as "near-perpetual light".
- The vertical datum of the adjusted LOLA elevation models relative to the 1,737.4 km sphere is not formally confirmed.

## Interface
- The Windows Table, Pointing & Link and the Power/Barcode charts are on the Stand here page only. The earlier cockpit (Answer Strip,
  Definitions Bar, Scan, Mission Profile, Touchdown Pad, Quick Answer card) is in the repository but not mounted in the live app.
- The live pages show one 30-day window (14 days on Compare / Slip) that starts on the **Start date** in the header (default 8 Feb 2027). Any whole UTC day from 2 Jan 2023 to 31 Oct 2030 can be chosen — the published ephemeris and DSN files end on 31 Dec 2030. The date applies to every page and resets to the default on reload; there is no time-of-day or end-date control.
- Persona (Planner / Educator) switching is not in the live pages; Educator wording exists in the unmounted cockpit.
- Ask LUMEN answers only from the project's own written material (glossary, plan rationale, validation report, `docs/ask_help.md`); it is
  search and templates, not a language model, and says so when it has no answer.
