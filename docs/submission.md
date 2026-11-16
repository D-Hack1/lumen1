# LUMEN — submission write-up

_Prepared by Ebin from what the repository actually contains on 15 Nov 2026. Where the plan promised something the build does not yet do,
this document says so (see §6 and `docs/limitations.md`); the judges' criteria are mapped to evidence that exists, not to intentions._

**Challenge title:** _(confirm the exact title on the submission portal — PLAN_FINAL §13)_
**Live app:** https://d-hack1.github.io/Lumen/ _(works once GitHub Pages is enabled: Settings → Pages → Source "GitHub Actions"; the `Deploy` workflow publishes `main`)_
**Repository:** https://github.com/D-Hack1/Lumen

## 1. Summary (short form)

LUMEN — the Lunar Mission ENvironment Navigator — answers the question that decides whether a lander at the Moon's south pole survives:
*when is the Sun up, when is Earth in view, and how sure are we?* At the pole the Sun skims the horizon, so a ridge a fraction of a degree
too tall can hide it for days. LUMEN computes the Sun and Earth positions from NASA SPICE ephemeris data, compares them with horizon masks
built from LRO LOLA elevation models, and shows the result as a panorama, a Windows Table planners can export, Deep Space Network
visibility, a slip explorer ("what if we launch nine days late?") and a side-by-side comparison of sites. Every time carries an uncertainty
where one exists, and says plainly where it does not. It runs entirely in the browser, offline after the first load, and has an
offline "Ask LUMEN" helper that explains any number from the project's own written material, with no language model.

## 2. How it works (long form)

1. **Ahead of time (Python):** SPICE kernels → Sun and Earth positions in a Moon-fixed frame; LOLA DEMs → per-site horizon masks (0.1° bins,
   four array heights, 250 km range) and a Monte-Carlo uncertainty (σ); DSN station kernels → Moon elevation at Goldstone, Canberra and Madrid.
2. **In the browser (TypeScript, in a Web Worker):** cubic-Hermite interpolation, a rotation into the site frame, mask look-up, disk visibility
   by chord quadrature, bisection to ~10 s for events, run-length windows and three-pass uncertainty bounds.
3. **Parity:** every browser calculation has a Python twin, compared on shared "golden" test cases.
4. **Offline:** the app shell and data files are cached by a service worker; no network call is made after the first load.

## 3. Judging criteria → evidence

| Criterion | Evidence that exists today |
|---|---|
| **Impact** | A Windows Table of every Sun / Earth / link / operating window with start and end times, duration and peak elevation, exportable as CSV or JSON for a mission plan; a Slip explorer and a Compare table for re-planning; ± on event times and ranges on percentages where σ is available. |
| **Creativity** | A real-terrain 360° panorama with the Sun and Earth paths; an Orbit globe driven by the real ephemeris; a Survival Barcode with a shared crosshair; **Ask LUMEN** — an offline assistant with commands, plain-language answers and a "Why this number?" explanation filled from the live result so it cannot invent anything; guided Quick-Start scenarios. |
| **Validity** | Validation gates published in the app (Methodology page, read live from the validation report): **G1, G2, G3 and G3b pass** (frame transformations; Hermite interpolation to < 0.001°; smooth-sphere geometry and DSN elevation against NASA/JPL Horizons). The other gates are pending or blocked and are shown as such — the overall status is *not ready*, and the page says so. σ is preliminary Monte-Carlo with stated, unverified assumptions. |
| **Relevance** | Sun and Earth against the horizon for south-polar sites; sunset / Earthset countdowns; DSN coverage and pointing (Earth range, one-way light time); power and sunlight windows; 2D panorama, 3D globe and timelines; animation (play / scrub a lunar month); a Start date picker (any UTC day 2023–2030); site comparison; custom coordinates (as smooth-Moon estimates, labelled). *Not covered yet:* Apollo / SLIM / Chang'e-6 and the Artemis regions in the catalogue, the Educator persona in the live pages. |
| **Presentation** | Four pages and a Methodology page in one consistent interface; Quick-Start with credited imagery; every image credited; accessible keyboard handling in the dialogs; works offline. |

**Category fit:** Best Use of Data (NASA SPICE, LOLA, PGDA illumination maps, SDO, EPIC, LROC), Best Use of Science (horizon-mask visibility and
uncertainty propagation near the pole), Best Use of Technology (offline PWA, Web-Worker evaluator, Python-twin parity).

## 4. Scope statement

LUMEN computes geometric Sun and Earth availability, DSN coverage and a generic power estimate. It does **not** compute link budgets, data
rates, thermal survival or vehicle-specific array performance. DEM resolution bounds the near-field horizon and pad slope; LOLA errors
propagate into horizons (quantified through σ); lander-scale rocks are not modelled; Tier C assumes a smooth Moon; DSN masks are simplified
to one elevation threshold; Tier-B snap error is up to about 2.8 km in the 4 km band. No claim is made about any mission's status or schedule.

## 5. Data and software cited

- **Ephemeris and frames:** NASA NAIF SPICE kernels (<https://naif.jpl.nasa.gov/naif/data.html>); cross-checks against JPL Horizons (<https://ssd.jpl.nasa.gov/horizons/>) and Skyfield.
- **Terrain:** LRO LOLA elevation models from the Planetary Geodesy Data Archive (<https://pgda.gsfc.nasa.gov/>); full product list in `docs/data_sources_terrain.md`.
- **Illumination and Earth-visibility maps:** Mazarico, E., et al. (2011), *Icarus* 211, 1066–1081, doi:10.1016/j.icarus.2010.10.030.
- **Site coordinates:** per-site agency and peer-reviewed sources in `pipeline/config/sites.yaml` (e.g. ISRO Chandrayaan-3, NASA IM-2 mission updates, USGS lunar polar maps).
- **Images:** Sun — NASA/SDO and the HMI science team; Earth — NASA EPIC team / DSCOVR; Moon globe — LROC colour map (NASA SVS CGI Moon Kit);
  Earth globe — NASA Blue Marble; polar terrain picture — NASA LRO LOLA 80 m DEM; south-pole photo base — NASA/GSFC/Arizona State University (LROC).
  Details and licences in `docs/credits_frontend.md` and `web/public/content/bodies/bodies.json`. No NASA logo or insignia is used.
- **Software:** React, Vite, TypeScript, Vitest, Playwright, Workbox (offline); Python with NumPy, SciPy, Numba, rasterio, pyproj, SpiceyPy, Skyfield.

## 6. What is not done (stated plainly)

- Validation: 4 of 14 gates pass; G0, G4, G6, G8, G9, G11 are pending; G5, G7, G10 are blocked (`web/public/data/validation/report.json`).
- Terrain masks exist for IM-2, Chandrayaan-3 and the Shackleton ridge only; other sites and custom points are smooth-Moon estimates; the Tier-B
  grid and dispersion grids are not produced.
- **Shackleton ridge coordinates are under review:** at the catalogue's coordinates NASA's illumination map reads 0 %, so the app shows it as
  permanently dark; do not present it as a near-perpetual-light site until the coordinates are re-verified.
- The earlier cockpit (Answer Strip, Definitions Bar, Scan, Touchdown Pad, Quick Answer card, Educator persona) is built but not mounted in the live app.

## 7. AI-use disclosure

Parts of the code, tests and documentation were written with the help of an AI assistant (Anthropic's Claude), in Claude Code sessions.
Each team member's log is in `docs/ai_usage/`. The assistant did not generate data: every number the app shows comes from the ephemeris and terrain
files through the calculations described above. The in-app explainer ("Ask LUMEN") uses no language model.

## 8. Suggested 90-second demo (verified features only)

1. **Quick start → "Is the Sun up at IM-2, and for how long?"** — the real skyline, the Sun and Earth paths, "Numbers for this window"; press **Why?** on Sunlit %.
2. **Details → Windows** — every window, click one to jump the clock, **Export CSV** ("this is what a planner takes away").
3. **Details → Pointing & link** — Earth range, one-way light time, Goldstone / Canberra / Madrid lanes.
4. **Slip explorer** — slip nine days, compare with "on time".
5. **Compare** — IM-2, Chandrayaan-3 and a smooth-Moon equatorial site side by side.
6. **Ask LUMEN** (press `/`) — "why is this ± so big?" → an explanation computed from the number on screen.
7. **Methodology** — scope statement and the validation gates, with their honest status.
8. Turn the network off and reload: it still works.

## 9. Submission checklist (PLAN_FINAL §13)

| Item | Status |
|---|---|
| Exact challenge title from the portal | **To do (human)** |
| Demo ≤ 30 s video or ≤ 7 slides, public link | **To do (human)** — script in §8 |
| Public deployed app, works offline after first load | Build, deploy workflow and offline behaviour verified; **Pages must be enabled (human)** |
| Public repository | Yes |
| Summary within limits; details mapped to the five criteria; scope statement | This document (§1–§4) |
| All data, kernels, libraries and images cited with links | §5 and `docs/` |
| AI usage disclosed | §7 and `docs/ai_usage/` (**each teammate must complete their own log**) |
| English throughout | Yes |
| Team registration and size | **To do (human)** |
| No NASA logo / insignia | Verified for the imagery used |
| No unverified mission-status claims | Site rows carry their sources; unverified rows are not shown as verified |
