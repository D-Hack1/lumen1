# PLAN_FINAL.md — LUMEN · Lunar Mission ENvironment Navigator
### Locked master plan · Revision 2 · NASA Space Apps 2026 (Nov 14–15) · 48-hour scope · ZERO CODE IN THIS DOCUMENT

> **Challenge title:** `<<COPY VERBATIM FROM OUR EVENT PORTAL — owner: R6, due H0+30 min>>`
> Never paraphrase, shorten or guess it (slides, video, README, project page).

**Product name:** **LUMEN**. **Hero widget:** the **SKYLINE Ribbon**.
**What it is:** a calculator and visual planner for **geometric Sun availability and Earth-communication windows** at lunar landing sites, with a generic power estimate. **What it is not:** a link-budget, thermal or vehicle-specific design tool (stated in-app and in the pitch).
**One-line pitch:** *"Our launch slipped. Which site and date still give us sunlight and Earth contact — and how sure are we?" — answered in under a second, offline, with every number validated and every time carrying an error bar.*

---

## Revision 2 changelog (what changed since Revision 1)

| # | Change | Why | Where |
|---|---|---|---|
| R2-1 | **Published Targets** category restored (CLPS, commercial, international) with "as published on [date]" and no status/schedule text; more historical sites (Apollo 15/17, Blue Ghost M1, SLIM, Chang'e-6) | PS asks for Apollo, CLPS, commercial and other countries' sites | §7, §8.4 |
| R2-2 | **Tier B extended to 80–90°S** (2 km inside 85°S, 4 km for 80–85°S) | Artemis regions lie within ~6° of the pole; Malapert/IM-1 at ~80°S | §4, §4.2 |
| R2-3 | **Seasons:** Season Strip (MVP) + 12-month Feasibility Calendar (Tier 1) | PS: "across different lunar days or seasons" | §8.6, §9 |
| R2-4 | **Earth Twin** overlay + lunar-vs-terrestrial contrast strip (Educator) | PS: make lunar vs terrestrial differences apparent | §8.8, §5.9 |
| R2-5 | **Science context:** distance to nearest permanently shadowed region (PSR) next to engineering metrics | PS: balance science and engineering needs | §4 P15, §5.7 |
| R2-6 | **Sun elevation** is the hero tile; 3D Horizon Dome promoted to Tier 1; deep-links to QuickMap / Moon Trek / Horizons | PS: display solar elevation prominently; multiple visualisations; complement existing tools | §8.3, §8.10, §9 |
| R2-7 | **Event-time uncertainty in MVP** ("Sunset in 41 h ± 5 h") via horizon-σ ÷ clearance rate, plus ± bounds on percentages | Near the pole a 0.2° horizon error can shift sunrise/sunset by hours | §5.8 |
| R2-8 | **Windows Table** (every Sun / Earth / link / overlap window with start, end, duration, ±) + CSV in MVP | Planners need numbers they can paste into a plan | §8.3, §9 |
| R2-9 | **Pointing & Link** readout: Earth az/el/range/light-time, Sun az/el, per-station DSN lanes | Comms needs where to point and when a station listens | §8.3 |
| R2-10 | **Quick Answer** card: lat/lon + UTC → one compact answer | Single-point "calculator" use | §8.5 |
| R2-11 | **Definitions Bar** under the Answer Strip: availability definitions visible and editable in place | Results are meaningless without their definitions | §8.3 |
| R2-12 | **Emphasis:** first thing every user sees is Sun/Earth vs horizon; slope/tilt is the second layer | Relevance to the PS core | §8.9, §12 |

---

## 0. How to read this document

| Section | What it locks |
|---|---|
| §1 | Strategy, positioning, differentiators |
| §2 | Physics constants |
| §3 | Architecture (static, offline, zero live API in the demo path) |
| §4 | Data pipeline incl. Chandrayaan-3 dedicated crop, extended Tier B, PSR distance |
| §5 | Geometry & math incl. slope-plane rule, uncertainty propagation, Earth Twin |
| §6 | Data contracts |
| §7 | Site catalog & verification policy |
| §8 | UI/UX architecture |
| §9 | Feature tiers |
| §10 | Validation plan & gates |
| §11 | Roles, 48-hour schedule, checkpoints |
| §12 | Demo, video, slides |
| §13 | Submission checklist & AI rules |
| §14 | Risks · §15 Verify-at-H0 · §16 Open questions · §17 Provenance |

---

## 1. Strategy

### 1.1 Judging context (verify exact wording on the portal at H0)
- Judges score **Impact, Creativity, Validity, Relevance, Presentation**. Global-round judges may see only the **30-second video or ≤7 slides**.
- Category targets: **Best Use of Data, Best Use of Science, Best Use of Technology**.
- Teammate reports a strong pre-published competitor tool: verify before referencing; never name competitors.

### 1.2 Differentiators
1. **Proven correctness, with honest error bars** — Horizons and PGDA cross-checks, Python↔browser parity, and **every event time carries a ± derived from horizon uncertainty**.
2. **A calculator *and* a decision tool** — exact windows tables and pointing data for planners; slip, scan, compare and GO/MARGINAL/NO-GO verdicts for decisions.
3. **Context beyond the horizon** — science (distance to PSR) next to engineering (power, comms, touchdown slope/tilt).

### 1.3 The user questions (each answerable in <10 s)
| User | Question | Where |
|---|---|---|
| Planner | "Is the Sun up here at T, how much of it, and for how long?" | **Answer Strip** + **Windows Table** |
| Comms engineer | "When can we talk to Earth, where do we point, and is a DSN station listening?" | **Pointing & Link** tab + Windows Table (link windows) |
| Planner after a slip | "We slipped N days. Which sites/dates still meet our profile?" | **Scenario Compare & Slip** |
| Anyone with a coordinate | "Just give me the numbers for lat/lon X at time T." | **Quick Answer** card |
| Educator / public / judge | "Why is the south pole so different from Apollo — and from Earth?" | **Quick-Start** + **Educator / Explorer** persona + **Earth Twin** |

---

## 2. Physics constants & reference values

| Quantity | Value | Use |
|---|---|---|
| Mean lunar radius R | 1737.4 km | Site vectors, curvature |
| Lunar equator tilt to ecliptic | ~1.54° | Max Sun elevation ≈ (90° − \|lat\|) + 1.54° |
| Synodic month | 29.53 d | Sun circles the polar horizon ~monthly |
| Sun angular rate across the sky | ~0.508°/h | Step-size rule (§5.3) |
| Sun elevation swing at colatitude c | ≈ ±c per month → near-horizon rate ≈ 2π·c / 29.53 d (85°S ≈ 0.044°/h; 89°S ≈ 0.009°/h) | Why timing uncertainty is in hours (§5.8) |
| Optical libration lat / lon | ±6.7° / ±7.9° | Earth bobs ~±7° near the polar horizon |
| Sun angular radius | 0.2666° × (1 AU / d) | Disk quadrature |
| Earth angular radius | asin(6378 km / d) (~0.95°) | Disk quadrature |
| Earth–Moon light time | ~1.28 s (range ÷ c) | Pointing & Link readout |
| Solar constant | 1361 W/m² × (1 AU / d)² | Power |
| Horizon dip at height h | √(2h/R): 1 m 0.06°, 10 m 0.19° | Mast-height control |
| Curvature drop at distance d | d²/2R: 250 km → ~18 km | 250 km ray range |
| 10 m object shadow at 1.5° Sun | ~380 m | Educator stat |
| Atmosphere | none | No refraction, no twilight |
| MOON_ME vs MOON_PA surface offset | ~0.9 km class (G1 records exact value) | Frame trap |

---

## 3. Architecture

```
BUILD TIME (Python 3.12, laptops)                          RUNTIME (static site, offline PWA)
─────────────────────────────────────────                  ─────────────────────────────────────────
SpiceyPy (primary) ─► ephemeris nodes, hourly pos+vel ─┐   ephem.bin            (~3–4 MB, cached)
Skyfield (cross-check only, gate G1)                   │   dsn.bin              (~1.3 MB, cached)
SpiceyPy + DSN station kernels ─► DSN Moon-elev series ┤   masks/<site>.bin     (KB each, 4 heights, σ)
rasterio windowed COG reads ─► DEM crops (per site,    │   tierB/<tile>.bin     (80–90°S, on demand)
   incl. dedicated Chandrayaan-3 crop)                 ├─► sparklines.bin, psr_dist.bin
Numba ─► horizon masks, slope/aspect, dispersion grid, │   layers/*.png, regions.svg
   Tier-B regional grid, Monte-Carlo σ, PSR distance   │   sites.json, glossary.json, quickstart.json
Python ─► golden vectors, Tier-B-vs-A σ calibration,   │   validation/report.json
   validation report ──────────────────────────────────┘
                                                           TS evaluator in a Web Worker (vector math only)
(Tier 2, never in the demo path) FastAPI wrapper            React UI: Mission Bar + 3 views + persona layer
around the same Numba raycaster for exact custom points
```

**Design rules**
1. The browser never parses a GeoTIFF and never raycasts terrain.
2. **Zero network calls in the demo path after first load.** Deep-links to external tools open in new tabs and are never needed for the demo.
3. The TS evaluator only does: Hermite interpolation, 3×3 rotations, mask interpolation, chord quadrature, bisection, run-length/prefix sums, uncertainty propagation. Every function has a Python twin; parity enforced by golden vectors (G4).
4. One geometric truth per quantity: SpiceyPy for ephemeris; Numba for masks; the same per-site rotation matrix is used by both.
5. Deploy from H2 on every merge to a public, no-login URL.

**Stack:** Python — `spiceypy`, `skyfield` (check only), `numpy`, `numba`, `rasterio`, `pyproj`, `scipy` (distance transform), `pytest`. Front end — React + Vite + TypeScript, D3 (Ribbon, curves), Canvas (barcodes, calendar), Zustand, URL-encoded state, Workbox (offline), three.js (Horizon Dome, Tier 1).

**Repo layout:** `pipeline/` (ephem, dsn, dem_crops, horizon, pad, tierb, mc_sigma, sigma_calibration, psr_distance, sparklines, layers, validate, golden, kernels meta-kernel, sites source table) · `web/` · `data/` · `tests/` · `docs/` (validation.md, data_sources.md, ai_usage.md, glossary source, limitations.md).

---

## 4. Build-time data pipeline

| Stage | Owner | Input | Output | Gate |
|---|---|---|---|---|
| **P1 Kernels** | R1 | NAIF generic kernels: `naif0012.tls`, `pck00011.tpc`, planetary SPK, lunar PCK + FK, Earth high-precision PCK, DSN station SPK + FK | Meta-kernel with filenames + checksums | Names confirmed at H0 |
| **P2 Frame decision & check** | R1 | P1 | **Primary: DE421-consistent `MOON_ME`** (matches LOLA/PGDA DEMs). DE440 only if its FK provides a DE421-compatible ME frame. Report PA→ME matrix (SpiceyPy vs Skyfield `MOON_ME_DE421`) + measured offset | **G1 (H2)** |
| **P3 Ephemeris nodes** | R1 | P1 | Moon-centred Sun & Earth pos+vel in `MOON_ME`, hourly, **2023-01-01 → 2030-12-31**, light-time + aberration. Float32 + header | **G2 (H4)** |
| **P3b DSN visibility** | R1 | P1 | Moon elevation at DSS-14 / DSS-43 / DSS-63, 10-min, 2023–2030, quantised 0.5° (threshold adjustable, default 10°) | Spot check vs Horizons |
| **P4 DEM crops** | R2 | PGDA LOLA COGs via **rasterio windowed reads**: 5 m site DEMs; 20 m (80–90°S); 240 m (60–90°S); `_ERR`; slope | Multi-res crops: **5 m within 5 km** (where covered), **20 m within 80 km**, **240 m to 250 km** | Reads by H2 |
| **P4-CY3 Chandrayaan-3 crop** | R2 | Same + optional site DTM | §4.1 | H8 |
| **P5 Tier-A masks** | R2 | P4 | 0.1° bins, heights 1/2/5/10 m, 250 km range, exact 3-D vectors, horizon distance per bin, site tangent frame | **G0**; QuickMap visual |
| **P6 Touchdown Pad** | R2 | P4 | Slope, downhill aspect, dispersion slope stats, slope-plane params | **G6** |
| **P7 Dispersion micro-grid** | R2 | P4 | 11×11 nodes at 50 m per Tier-A site | — |
| **P8 Tier-B regional grid** | R2 (spare laptop from ~H10) | P4 | **80–90°S:** 2 km nodes inside 85°S (~18k nodes), 4 km nodes 80–85°S (~13.5k nodes); 0.5° bins, 1 m height, uint8 (0.05°), ~20 km tiles. **Run 84–90°S first** (Artemis regions), then 80–84°S | 84–90°S by H22, 80–84°S by H28; fallback 4 km everywhere |
| **P9 Monte-Carlo σ** | R2 | P4 + `_ERR` | 20–30 clones for Tier-A centres → per-bin σ | Tier 1 (MVP uses default σ, §5.8) |
| **P9b Tier-B σ calibration** | R1 | P5 + P8 | RMS difference between snapped Tier-B masks and Tier-A masks at curated sites, by distance-to-node → empirical Tier-B σ | H26 |
| **P10 Golden vectors** | R1 | P3, P5, P6 | ~60 scenarios incl. slope-plane and uncertainty edge cases | **G4** |
| **P11 Map layers** | R5 | PGDA illumination & Earth-visibility maps; slope raster; USGS Artemis shapefiles | Polar-stereographic PNGs at 80–90°S and 85–90°S: Average Illumination, Earth Visibility, Slope Hazard (<5/5–10/10–15/>15°), PSR (derived: 0% average-illumination pixels); region outlines SVG | — |
| **P12 Sparklines & seasons** | R1 | P3 + P5 | Per curated site: daily sunlit % and DTE % 2023–2030 at 2 m with default definitions → feeds cards and Season Strip | — |
| **P13 Catalog** | R6 | Primary sources (§7) | `sites.json` | Unverified rows excluded |
| **P14 Validation report** | R1 | All | `report.json` + `docs/validation.md` | Methodology view |
| **P15 PSR distance** | R2 | P11 PSR raster | Distance-to-nearest-PSR raster (80–90°S) + per-site value + bearing | Tier 1 |

### 4.1 Chandrayaan-3 dedicated crop
- Statio Shiv Shakti (≈69.37°S, 32.32°E) is outside the polar crops and is our primary historical benchmark, so it gets a **dedicated bounding-box crop job**.
- Near field ±10 km box (finest source available), mid field ±80 km, rays to **250 km**. 250 km north reaches ≈61.1°S, inside the 60–90°S 240 m product, so no edge fill is needed.
- **Source ladder (best obtained by H6, recorded in provenance):** (1) a published high-resolution DTM of the landing area, only if publicly downloadable without delay and tied to MOON_ME; (2) the finest LOLA gridded product covering 69.37°S; (3) the 60–90°S 240 m product (guaranteed).
- **Tier A** with badge showing achieved near-field resolution.
- At 69°S the Sun reaches ~22°, so sunrise/sunset timing is governed by the mid/far horizon; G7 compares sunrise/sunset timing to the published mission timeline.

### 4.2 Fidelity tiers
| Tier | Method | Default σ (until P9/P9b) | Badge example |
|---|---|---|---|
| **A** | Dedicated multi-res crop, 0.1° bins, 4 heights, pad slope, dispersion grid | 0.1° (replaced by MC σ per bin when P9 lands) | "Tier A · near-field 5 m" |
| **B** | Snap to nearest 80–90°S grid node (2 km / 4 km), 0.5° bins, 1 m; slope-plane occluder active | 0.5° (replaced by P9b calibration) | "Tier B · snapped 0.8 km" |
| **C** | Smooth sphere, no terrain (outside coverage, e.g., Apollo, SLIM) | n/a — times labelled "smooth-sphere estimate; terrain unavailable" | "Tier C · no terrain" |

---

## 5. Geometry & math specification

### 5.1 Site frames & azimuth (singularity-free)
- Up `u` = unit radial vector in `MOON_ME`.
- Reference axis `a`: **+X_ME** for \|lat\| ≥ 60° (toward 0°E, mean sub-Earth direction); **+Z_ME** otherwise.
- `n_ref = normalize(a − (a·u)u)`, `e = n_ref × u`; stored as one 3×3 matrix per site/node; azimuth = atan2(component on `e`, component on `n_ref`).
- Display "Earth-referenced azimuth" for polar sites, "true azimuth" elsewhere. Pointing & Link also shows true azimuth wherever defined.
- Not used: East = ẑ × up (singular at the pole).
- G3 compares elevations directly; azimuths after conversion to true north at non-polar test points; full vectors at polar points.

### 5.2 Ephemeris interpolation
Cubic Hermite on position with stored velocity → subtract site position (Earth parallax ≤ ~0.26°) → normalise → rotate. Keep distances for flux, angular radius, range and light time.

### 5.3 Adaptive time sampling
Δt ≤ (bin / 2) ÷ angular rate → **2 min** near the horizon (±3° clearance band), 60 min elsewhere. Events bisected to ~10 s at every clearance sign change and disk-fraction thresholds 0/50/100%.

### 5.4 Disk visibility
Chord quadrature (Sun 24, Earth 32), chord width scaled by 1/cos(el), against the effective mask per chord azimuth → disk fraction 0–1.

### 5.5 Communication
- **Earth-visible:** Earth disk ≥ 50% and DTE margin ≥ threshold (default 1°).
- **DSN-aware link (default ON when P3b ships):** Earth-visible AND ≥1 DSN complex sees the Moon above its mask (default 10°).
- **Pointing outputs:** Earth azimuth/elevation (site frame + true where defined), range (km), one-way light time (s), Earth disk fraction, DTE margin; Sun azimuth/elevation.
- Tier 2: directional antenna limits relative to the tilted deck.
- **Out of scope (stated):** link budget, data rate, signal margin.

### 5.6 Touchdown Pad: slope, aspect, tilt, power
- Ground normal `g` by least-squares plane over a ~5–6 m footprint; coarser DEMs badge "slope under-resolved".
- Slope θ = angle(`g`, `u`). **downhill_aspect** = azimuth of the horizontal projection of `g`. **uphill_az = (downhill_aspect + 180°) mod 360°.**
- Slope-plane term: s(az) = atan(tan θ · cos(az − uphill_az)); **clamped s⁺(az) = max(0°, s(az))**.
- **Application rule:** m_eff(az) = m_terrain(az) wherever s⁺(az) = 0; otherwise max(m_terrain(az), s⁺(az)). The clamp is never applied to the terrain mask itself (sphere dip and legitimately negative horizons must survive; at the pole the Sun lives within ±1.5° of the horizon).
- Active for Tier B or near-field coarser than ~2× footprint; badge shows state. Off-nominal tilt affects panels/antenna only, never the terrain mask.
- Golden cases: θ = 0 → identical; pure downhill → unchanged; uphill θ = 10° over lower terrain → 10°; cross-slope → unchanged; negative downhill terrain value → preserved.
- Attitude = tilt onto `g` ∘ yaw (default best of a 15° sweep) ∘ optional off-nominal tilt.
- Panel presets (generic): 4 vertical side panels; 1 vertical at heading; horizontal deck; vertical sun-tracking mast (upper bound).
- Power(t) = S(t) · Σ_panels [A · η · max(0, n_panel · ŝ)] · f_disk(t).
- Battery (Tier 1): endurance = battery Wh × usable DoD ÷ load W vs longest night; SOC overlay.

### 5.7 Metrics & verdict
**Hero:** Sun elevation (°). Then: Sun clearance & disk %, Earth elevation & DTE margin, sunlit %, DTE/link %, longest night, longest comm gap, Sun+Earth ops hours, energy/day, Sun elevation at touchdown, pad slope stats, mast-height sensitivity, **distance to nearest PSR (km, bearing)** (science context). Every time and percentage carries ± (§5.8).
**Verdict:** GO if all hard profile requirements pass at the conservative bound; MARGINAL if any passes only at the nominal value or is within 10% of its limit; NO-GO otherwise. Viability Index = weighted components shown side by side.

### 5.8 Uncertainty propagation (MVP)
- **Why:** near the pole, the Sun's elevation changes slowly (≈0.044°/h at 85°S, ≈0.009°/h at 89°S near the horizon), so a 0.2° horizon error can shift a sunrise/sunset by ~4–5 h at 85°S and close to a day near 89°S. Where the Sun slides sideways behind a steep ridge edge, the error is much smaller.
- **Event times:** δt = σ_h(az_event) ÷ |d(clearance)/dt| at the refined event, where σ_h is the mask uncertainty in that azimuth bin (tier default → P9 MC σ → P9b calibration). Display "Sunset in 41 h ± 5 h".
- **Grazing events:** if |d(clearance)/dt| is below a floor (default 0.005°/h) or δt exceeds 12 h, label the event **"grazing — timing poorly constrained"** and show the range instead of ±.
- **Percentages and durations:** evaluate the window three times (mask − σ, nominal, mask + σ) → sunlit %, DTE %, longest night reported as nominal with [low, high] bounds. Cost is ~3× a cheap computation.
- **Tier C:** no terrain ± is shown; label "smooth-sphere estimate; terrain unavailable" instead. It is not a terrain bound.
- σ source is shown in every tooltip ("default", "Monte-Carlo, 30 clones", "calibrated vs Tier A").

### 5.9 Earth Twin (Educator, Tier 1)
- For the site latitude, show a dashed Sun path for an Earth location at the same latitude (southern hemisphere; at 85°S this is Antarctica) over 24 h on the scrub date, computed with a standard terrestrial solar-position formula (labelled "educational approximation").
- Contrast strip: day length (24 h vs ~29.5 d), twilight (yes vs none), shadow appearance (soft vs pitch-black), sky (blue vs black), longest night at the site (hours vs days).

---

## 6. Data contracts (frozen at CP0)

| Artifact | Fields |
|---|---|
| Ephemeris header / body | epoch (UTC+TDB), step, count, frame, units, aberration flag, kernel list + checksums · Sun pos/vel, Earth pos/vel (Float32) |
| DSN series | epoch, step, station ids, quantised Moon elevation per station |
| Site record | id, name, category (`historical_landing` / `published_target` / `artemis_candidate_region` / `contrast_site` / `custom`), agency/program, date (historical) or `as_published_date` (targets), lat, lon, elevation, reference axis, rotation matrix, tier, near-field resolution, mask file + heights, σ source, pad stats, dispersion file, sparkline index, PSR distance + bearing, `source_url`, `source_type`, `verification_status`, `verified_by`, provenance notes |
| Mask file | bin width, heights, elevation per height, distance, σ per bin (optional), range |
| Tier-B tile | tile id, node spacing, node lat/lon, quantised masks, scale/offset |
| Scenario (URL) | view, persona, site id or lat/lon, landing UTC, duration, scrub time, height, panel preset, yaw, off-nominal tilt, **definitions** (Sun-available threshold, Earth margin, DTE disk threshold, DSN mode + mask), profile thresholds, weights, compare rows (≤4), active layers, active centre tab |
| Window record | type (`sun` / `earth` / `link` / `ops`), start UTC ± , end UTC ±, duration [low, high], peak elevation, flags (grazing, partial-disk start/end) |
| Result | events (type, refined UTC, δt, grazing flag), windows, render-window series, metrics with bounds, tier badge, σ source, verdict |
| Glossary entry | key, label, formula, plain-English impact, source/uncertainty, related ids |
| Quick-start scenario | id, title, persona, state, coachmark steps |

---

## 7. Site catalog & verification policy

**Policy:** a row ships only if `verification_status = verified` from a primary/authoritative source (agency/company release, peer-reviewed paper, PDS/PGDA, USGS, LROC coordinate tables).
- **Historical landings:** shown with landing date.
- **Published targets:** shown with coordinates, source and **"as published on [date]"** only. **No launch dates, schedules, delays, accidents or status text anywhere in the UI or pitch.**
- **Artemis III candidate regions:** NASA-published regions, centroid + outline, "approximate centre" badge.
- **Contrast sites:** chosen to teach (equator, far side).

| Site | Category | Notes / coordinate source (R6 verifies) | Tier |
|---|---|---|---|
| IM-2 Athena (Mons Mouton) | historical_landing (USA, CLPS) | 84.7906°S, 29.1957°E; 6 Mar 2025; official touchdown UTC from NASA/IM; LROC landing-site release | A |
| Chandrayaan-3 Statio Shiv Shakti | historical_landing (India) | ≈69.37°S, 32.32°E; 23 Aug 2023; exact UTC from ISRO; LROC coordinate table | A (dedicated crop) |
| IM-1 Odysseus (Malapert A region) | historical_landing (USA, CLPS) | LROC coordinate table | A or B |
| Blue Ghost Mission 1 (Mare Crisium) | historical_landing (USA, CLPS) | LROC coordinate table; upright, nominal landing — contrast with IM-1/IM-2 | C |
| SLIM | historical_landing (Japan) | LROC/JAXA | C |
| Chang'e-6 (far side) | historical_landing (China) | LROC coordinate table | C |
| Chang'e-4 (far side) | contrast_site (China; Earth never visible) | LROC coordinate table | C |
| Apollo 11, 15, 17 | historical_landing / contrast | LROC coordinate table | C |
| Shackleton connecting ridge | published_target (NASA-stated CLPS target) + validation anchor | USGS navigational grids; NASA CLPS mission page | A |
| Chang'e-7 published target | published_target (China) | Coordinates from the peer-reviewed site paper (verify; secondary sources cite ~88.8°S, 123.4°E) | A or B |
| 9 Artemis III candidate regions | artemis_candidate_region | NASA announcement + USGS shapefiles | A (centroids) / B (rest) |

Anything not sourced within 15 minutes is dropped, not guessed.

---

## 8. UI/UX architecture

### 8.1 Design principles
1. **Horizon first:** the first thing any user sees is the Sun and Earth against the horizon with their countdowns.
2. **Answer first:** Answer Strip and verdict before charts.
3. **Zero page scroll** on working views; controls and consequences on one screen.
4. **Definitions are visible**, not hidden: every result sits next to the rule that produced it.
5. **Every number explains itself and states its uncertainty** (`?` badge: formula · impact · source · σ).
6. **Progressive disclosure:** Quick-Start → persona → tooltips → Methodology.
7. **Ops-console aesthetic:** dark theme, monospace numerals, UTC + MET (T+dd:hh:mm).
8. **Colour-blind safe with redundant encoding:** Sun amber, Earth blue, Sun+Earth teal, blocked grey hatch, Earth-only blue dots.
9. **Projector-proof** at 1280×720.

### 8.2 Persistent Top Mission Bar (56 px)
| Element | Behaviour |
|---|---|
| **LUMEN** + current site + tier badge | Click → focus Site Explorer search |
| **View tabs:** `Mission Cockpit` · `Scenario Compare & Slip` · `Methodology & Validation` | Keys 1/2/3; state preserved |
| **Landing Date & Time (UTC)** + **Mission Duration** (7 · 14 · 30 · 60 d) | Global; shows MET of scrub time |
| **Jump buttons:** `Next Sunset` · `Next Earthset` · `Next Shadow Exit` · `Touchdown (T0)` | Keys S / E / X / T; tooltip shows target time ± |
| **Quick Answer** (calculator icon) | Opens the Quick Answer card (§8.5); key Q |
| **Verdict chip** GO / MARGINAL / NO-GO | Click → mission-profile popover |
| **Persona switcher:** `Mission Planner` ↔ `Educator / Explorer` | Same layouts, different density/copy |
| **Share Scenario URL** | Copies full state → toast *"Scenario link copied — opens this exact site, date, attitude and view."* |
| **Quick-Start** + **Help** | Re-open guided scenarios; shortcut sheet |

### 8.3 View 1 — Mission Cockpit (zero-scroll 3-column bento)
**Target:** 1920×1080 display, must fit a **1920×960 viewport**; body = viewport − 56 px. Only the site-card list and the Windows Table scroll internally. Extra height goes to the Ribbon.

```
┌──────────────────────────────── TOP MISSION BAR (56 px) ─────────────────────────────────────────┐
├──────────── LEFT ~400 px ───────┬──────────────── CENTER ~960 px ───────────────┬── RIGHT ~520 px ─┤
│ SITE EXPLORER SIDEBAR           │ ANSWER STRIP (~92 px)                          │ METRIC DECK      │
│  search (names or "lat, lon")   │  Sun now: el · disk% · UP/DOWN │ Earth now: el │  HERO TILE:      │
│  filter chips (~92 px)          │  · link ✓/✗ │ Sunset in ±  │ Earthset in ±   │  SUN ELEVATION   │
│ ┌─────────────────────────────┐ │  │ Sunlit % [lo–hi] · Link % [lo–hi] (window)  │  (large, ±)      │
│ │ SOUTH POLE BASEMAP (~320 px)│ ├───────────────────────────────────────────────┤  + 2×4 tiles:    │
│ │ pins · region outlines ·    │ │ DEFINITIONS BAR (~28 px) ✎                     │  clearance/disk ·│
│ │ layer toggles · legend      │ │ "Sun available = ≥50% disk above terrain @2 m │  Earth el/margin │
│ └─────────────────────────────┘ │  · Link = Earth ≥1° above terrain + DSN ≥10°" │  · sunlit% · link│
│ SITE CARDS (internal scroll)    ├───────────────────────────────────────────────┤  % · longest     │
│  name · category · tier ·       │ SKYLINE RIBBON (hero, ~330 px, grows)          │  night · comm gap│
│  lat/lon · sunlit & link        │  [Panorama | Dome] toggle · silhouette ±σ band │  · ops hours ·   │
│  sparklines · verdict dot ·     │  · Sun track · Earth libration loop · ghost    │  PSR distance    │
│  "+ Compare"                    │  markers at hover · Earth Twin overlay (Edu)   │  (~300 px)       │
│                                 │  scrub bar + play/speed (32 px inside)         ├──────────────────┤
│                                 ├───────────────────────────────────────────────┤ TOUCHDOWN PAD    │
│                                 │ TABBED ANALYSIS PANEL (~170 px)                │ (~440 px)        │
│                                 │ [Power & Elevation | Windows Table |           │  slope/aspect    │
│                                 │  Pointing & Link]                              │  compass · disp. │
│                                 ├───────────────────────────────────────────────┤  histogram ·     │
│                                 │ SURVIVAL BARCODE (~64 px) days since landing   │  panel · mast    │
│                                 │ SLIP BAR (~40 px) ◀ −1 d · ±30 d · +1 d ▶      │  1/2/5/10 m · yaw│
│                                 │  reset · "slipped +9 d" chip                   │  · tilt · power  │
│                                 │                                               │  bars vs baseline│
│                                 │                                               │ PROFILE & BATTERY│
│                                 │                                               │ (accordion overlay)│
└─────────────────────────────────┴───────────────────────────────────────────────┴──────────────────┘
```
**Height budget (centre):** 92 + 28 + 330 + 170 + 64 + 40 + gutters ≈ 790 px of ~904 px; remainder flexes into the Ribbon. **Right:** 300 + 440 + 48 accordion header + gutters ≈ 820 px.

**Answer Strip** (the calculator line, always visible): Sun now (elevation °, disk %, UP/DOWN), Earth now (elevation °, link ✓/✗), Sunset in (± or "grazing"), Earthset in (±), window sunlit % [low–high], window link % [low–high]. Updates with scrub time and every control.

**Definitions Bar:** one line stating the current availability rules; ✎ opens an inline popover (Sun-available disk threshold, observer height, Earth margin, DTE disk threshold, DSN mode + mask). Educator persona shows a plain-language version.

**Tabbed Analysis Panel**
- **Power & Elevation:** power (W), Sun/Earth clearance curves with ±σ shading, SOC overlay (Tier 1).
- **Windows Table:** one row per window — type icon (Sun / Earth / Link / Ops), start UTC ±, end UTC ±, duration [low–high], peak elevation, flags (grazing, partial disk). Sort/filter by type; hover row highlights the interval on barcode, curve and Ribbon; click jumps scrub time; **Export CSV / JSON** (MVP) with a header block recording site, tier, σ source, definitions and data versions.
- **Pointing & Link:** at scrub time — Earth az (site frame + true), el, range (km), light time (s), disk %, DTE margin; Sun az, el; **DSN lanes** (Goldstone / Canberra / Madrid visibility timeline across the window) with the combined link lane.

**Live coupling:** any Touchdown Pad control, definition edit, mast height or Slip change recomputes in the worker and updates Answer Strip, Ribbon, active analysis tab, barcode, metric deck and verdict together (<100 ms; slip drag <16 ms/frame).

**Responsive:** ≥1440×810 full bento; 1280×720 presenter density (type ×0.9; right column becomes tabs Metrics | Touchdown); <1280 shows a laptop/projector notice.

### 8.4 Site Explorer Sidebar
- **Search** by name or "lat, lon" (coordinates offer "Analyse custom point" or "Quick Answer").
- **Filter chips:** `All` · `Artemis III` · `Historical Landings` · `Published Targets` · `Contrast Sites` · `Custom`; secondary agency filter (NASA/CLPS, ISRO, CNSA, JAXA, commercial).
- **Site cards:** name, category chip, agency, tier badge, lat/lon, sparklines (daily sunlit % and link % for the selected window), verdict dot, "+ Compare". Published targets show "as published [date]"; historical sites show the landing date.
- **South Pole Basemap:** layers Average Illumination · Earth Visibility · Slope Hazard · PSR (derived) · Distance-to-PSR (Tier 1); Artemis outlines; pins; 80–90°S overview and 85–90°S detail; opacity, legend, value-at-cursor readout. Click pin = select; Shift-click = add to Compare; click terrain = custom point (Tier B snap, shows snap distance). Out-of-map custom coordinates go to Tier C.
- **Deep-links (Tier 1, new tab, never in demo path):** "Open in QuickMap", "Open in Moon Trek", "Check flat-horizon geometry in JPL Horizons" (prefilled site coordinates).

### 8.5 Quick Answer card (MVP)
Modal card from the Mission Bar or search box: inputs lat, lon, UTC time, duration, observer height (defaults from Definitions Bar). Output in one card: tier badge; Sun elevation/azimuth, disk %, UP/DOWN; Earth elevation/azimuth, range, link ✓/✗; next sunset, next Earthset, next shadow exit (each ±); sunlit % and link % over the duration [low–high]; distance to PSR. Buttons: **Copy as text**, **Export CSV**, **Open in Cockpit**.

### 8.6 View 2 — Scenario Compare & Slip (zero-scroll bento)
- **Left (~400 px):** scenario rows A–D (site, landing date, attitude, colour, baseline ★); **Mission Profile** (surface duration, min sunlit %, min link hours, max longest night, max pad slope, battery & load); definitions inherited from the Definitions Bar.
- **Centre (~960 px):** global Slip slider (±30 d, all rows or selected); centre toggle **[Aligned Barcodes | Season Strip | 12-Month Calendar]**:
  - **Aligned Barcodes:** stacked rows aligned to days since landing, shared power strip, synchronized crosshair, **delta table** vs baseline (Δ with ± and colour).
  - **Season Strip (MVP):** per site, 12 monthly cells of sunlit % and link % (from P12) for the chosen year — shows the annual lighting cycle at a glance.
  - **12-Month Calendar (Tier 1):** sites × 365 landing dates (~2 px per day), GO/MARGINAL/NO-GO vs profile, computed in the background with a progress bar; click a cell → loads into a row. MVP shows the next 60 days.
- **Right (~520 px):** **Scan** — "Find alternatives within ±N days / across filtered sites" → ranked list (verdict, sunlit %, link %, longest night, all with bounds) → "Load into row"; Windows Table for the selected row.

### 8.7 View 3 — Methodology & Validation (reading view; internal scroll allowed)
Pipeline diagram; data sources with versions and links; frames, time scales and definitions; validation results G0–G11 with charts; uncertainty method (§5.8) incl. σ sources; **scope statement (what LUMEN does and does not compute)**; known limitations; AI-usage disclosure; citations. Every `?` tooltip deep-links here.

### 8.8 Persona layer
| | Mission Planner | Educator / Explorer |
|---|---|---|
| Numbers | Full precision, UTC, all tiles, ± and bounds | Rounded, plain language ("about 3 days of night, give or take half a day") |
| Controls | All controls, definitions, weights, DSN mode, export | Presets (Upright / Tipped 30° / Mast 10 m), simplified slip |
| Guidance | Tooltips on demand | Inline "What am I seeing?" callouts; **Earth Twin overlay** and lunar-vs-Earth contrast strip on the Ribbon; analogies |
| On load | Last scenario | Quick-Start drawer open |

### 8.9 Quick-Start Guided Scenarios (first-load drawer)
Each card loads a full state + a 3–4 step coachmark tour. **Every tour starts on the Ribbon and Answer Strip.**
1. **Test a 9-Day Launch Delay at Shackleton** — Shackleton connecting ridge, hypothetical baseline date (chosen at H8 from a GO window). Tour: Sun skimming the ridge + Earthset countdown ± → slip +9 d → aligned barcodes → Scan → alternative.
2. **Replay IM-2 Athena's Crater Tilt** — IM-2 at official touchdown UTC. Tour: Ribbon at touchdown (low Sun, crater horizon) → Windows Table (first sunset ±) → Touchdown Pad slope → 30° tilt on a generic panel → power drop. Label: *"Illustrative; not Athena's actual array geometry."*
3. **Compare Apollo 11, the South Pole and Earth** — Educator persona; Apollo 11 vs a polar ridge site; Earth Twin overlay on.
4. **Validate a Real Landing: Chandrayaan-3** — CY-3 at its landing date; Windows Table sunrise/sunset ±; ends on Methodology G7.

### 8.10 Tooltip & glossary (`?` on every technical metric and control)
Format: **Formula** · **Impact** · **Source & σ** · "Learn more →".
| Term | Formula | Plain-English impact |
|---|---|---|
| **Sun elevation** | angle of Sun centre above the local horizontal plane | "How high the Sun is. At the pole it never gets more than a few degrees up." |
| **Sun clearance / disk %** | elevation − effective mask; chord-quadrature disk fraction | "How far above the ridge the Sun is, and how much of it you can see." |
| **Libration** | sub-Earth point oscillates ~±6.7° lat / ±7.9° lon | "Earth slowly rises and sets near the pole roughly every two weeks." |
| **Vertical Array Cosine Loss** | cos i = n_panel · ŝ; upright panel facing α: cos(el)·cos(az − α); loss = 1 − cos i | "A panel facing 40° away from the Sun loses about a quarter of its power." |
| **DTE Margin** | Earth centre elevation − effective horizon at Earth's azimuth | "How much clear sky the radio link has above the terrain." |
| **DSN visibility** | Moon elevation at Goldstone/Canberra/Madrid ≥ mask | "Someone on Earth must be facing the Moon to listen." |
| **Range & light time** | ‖Earth − site‖; range ÷ c | "How far the signal travels: about 1.3 seconds each way." |
| **Fidelity Tier A/B/C** | §4.2 | "How much to trust shadow timings here." |
| **Uncertainty (±)** | δt = σ_h ÷ \|d(clearance)/dt\|; bounds from mask ± σ | "Our best time and how far off it could plausibly be. Near the pole this can be hours." |
| **Grazing event** | clearance rate below floor or δt > 12 h | "The Sun is skimming the ridge; the exact moment is hard to pin down." |
| **Shadow exit** | next time disk ≥ 50% after being blocked | "When the lander comes back into sunlight." |
| **Longest night** | longest run of power below profile minimum | "How long the battery must keep you alive." |
| **Ops hours** | power-positive AND link | "Time you can both work and phone home." |
| **Earth-referenced azimuth** | §5.1 | "At the pole 'north' is everywhere, so we measure direction from Earth." |
| **Slope / aspect / uphill** | θ; downhill_aspect; uphill_az = (downhill_aspect + 180°) mod 360° | "How steep the ground is and which way it tilts the lander." |
| **Slope-plane occluder** | §5.6 rule | "Rising ground right beside the lander can hide a low Sun." |
| **Mast height** | horizon from raised observer; dip √(2h/R) | "Raising panels a few metres can buy hours of sunlight." |
| **Distance to PSR** | distance to nearest 0%-average-illumination pixel | "How far the science (ice in permanent shadow) is from the sunlight you need for power." |
| **Earth Twin** | terrestrial solar position at same latitude | "What the same Sun would do on Earth, with an atmosphere and a 24-hour day." |
| **Viability Index / Verdict** | §5.7 | "Go, borderline or no-go for your mission profile, judged conservatively." |

### 8.11 Accessibility & polish
Keys: 1/2/3 views, S/E/X/T jumps, Q Quick Answer, ←/→ 1 h, Shift+←/→ 1 day, Space play, Esc clear. Focus rings, ARIA labels with text summaries on charts, Windows Table fully keyboard-navigable, reduced-motion support, contrast ≥ 4.5:1, empty/loading/error states, skeletons during first cache fill.

### 8.12 Synchronized crosshair
Shared `t_hover` (transient) and `t_scrub` (pinned). Hover on curve, barcode or a Windows Table row → guides on all three, ghost Sun/Earth on the Ribbon at that instant, readout chip ("T+12d 04:00 · Sun el 1.2°, clearance +0.4° ± 0.1°, disk 100% · Earth el −0.8° · link ✗"). Hover along a track on the Ribbon → inverse lookup to time. Click pins `t_scrub`; Esc clears. Answer Strip and metric deck follow `t_scrub` only. Hover budget <4 ms/frame.

---

## 9. Feature tiers

| Tier | Features | Deadline |
|---|---|---|
| **MVP** | Mission Bar (tabs, date/duration, jumps, Quick Answer, verdict, persona, share + toast); Cockpit bento: **Answer Strip with ±**, **Definitions Bar**, Ribbon (panorama), tabbed panel with **Power & Elevation, Windows Table + CSV/JSON, Pointing & Link** (DSN lanes if P3b ready), barcode, slip bar, metric deck with **Sun elevation hero**, Touchdown Pad core; **uncertainty propagation (§5.8) with tier-default σ**; Site Explorer (search, chips incl. Published Targets, sparkline cards, Illumination + PSR layers); crosshair sync; **Quick Answer card**; Compare & Slip (rows, slip, delta, Scan, **Season Strip**, 60-day calendar); Methodology skeleton (G0–G4, scope statement); Quick-Start 1–2; Tier-A data for IM-2, CY-3, Shackleton ridge + ≥3 Artemis regions; extended catalog rows with verified coordinates; offline caching | **CP2 (H16)** |
| **Tier 1** | Tier-B custom points 80–90°S; MC σ (P9) and Tier-B σ calibration (P9b); DSN-aware link default; mast 1/2/5/10 m; battery + SOC; dispersion histogram; Earth Visibility + Slope + Distance-to-PSR layers and PSR metric; **3D Horizon Dome**; **Earth Twin** + contrast strip; Educator callouts; Quick-Start 3–4; **12-month calendar**; deep-links; G5–G11 | **CP3 (H30)** |
| **Tier 2** (each droppable, only if CP2 green) | LROC shadow-vs-photo; best-pixel heatmap inside an Artemis region; briefing PNG export; directional antenna; FastAPI exact custom compute (never in demo path) | **CP3 (H30)** |
| **Cut** | Mini-game; separate Learn screen; Cesium; live WMTS/Horizons/API calls in the demo path; in-browser terrain processing; link budget / thermal modelling | — |

---

## 10. Validation plan

| ID | Check | Pass criterion | When |
|---|---|---|---|
| G0 | Raycaster on synthetic cone/crater DEM | <0.01° | H6 |
| G1 | Frame: SpiceyPy vs Skyfield `MOON_ME_DE421`; record PA↔ME offset | matrices <1e-9; directions <1e-6 rad | H2 |
| G2 | Hermite vs direct SpiceyPy, 10k epochs | <0.001° | H4 |
| G3 | Smooth-sphere vs JPL Horizons (`coord@301`), 5 sites × 20 epochs incl. IM-2 & CY-3: elevation, azimuth, **Earth range** | <0.01°; range <1 km | H6 |
| G4 | TS vs Python golden vectors (incl. slope-plane and uncertainty cases) | elev <0.005°, events ±1 min, δt ±5%, metrics ±1% | CP1 + every merge |
| G5 | Multi-year averages vs PGDA illumination & Earth-visibility maps | within a few %; differences explained | H28 |
| G6 | Pad slope vs PGDA slope rasters | within a few degrees | H20 |
| G7 | CY-3 sunrise/sunset timing vs published mission timeline; IM-2 conditions at touchdown | consistent within our ±; no invented numbers | H28 |
| G8 | Performance on demo laptop | site switch <100 ms, slip <16 ms/frame, hover <4 ms, Scan <300 ms, Quick Answer <150 ms (Tier A/B cached) | H28 |
| G9 (Tier 2) | Predicted shadows vs LROC image | visual agreement | H30 |
| **G10** | **Uncertainty calibration:** at curated sites, Tier-B event times fall within Tier-A time ± reported δt for ≥ ~68% of events | pass or σ inflated until it does | H28 |
| **G11** | **Windows integrity:** Windows Table, barcode and CSV agree exactly; CSV round-trips | 100% match | H24 |

Published anchors (e.g., Mazarico et al. 2011 statistics) are quoted only after R1 confirms the numbers in the paper text.

**Scope statement & limitations (in-app + slide):** LUMEN computes geometric Sun and Earth availability, DSN coverage, and a generic power estimate. It does not compute link budgets, data rates, thermal survival or vehicle-specific array performance. DEM resolution bounds near-field horizon and pad slope; LOLA errors propagate into horizons (quantified via σ); lander-scale rocks are not modelled; Tier C assumes a smooth Moon; DSN masks are simplified to one elevation threshold; Tier-B snap error up to ~2.8 km in the 4 km band.

---

## 11. Team, schedule, checkpoints

### 11.1 Roles
| Role | Owns |
|---|---|
| **R1 Ephemeris & Validation (human verifier)** | P1–P3b, P9b, P10, P12, P14; G1–G3, G5, G7, G10; signs off every number; merge gate |
| **R2 Terrain** | P4, P4-CY3, P5–P9, P15; G0, G6; (Tier 2) FastAPI |
| **R3 Engine & Data Packaging** | TS evaluator incl. **uncertainty propagation**, **windows generation**, pointing outputs, Quick Answer engine path; golden harness (G4), perf (G8), G11; offline caching |
| **R4 App Shell & Interaction** | Mission Bar, views, bento grids, state + URL, crosshair bus, Definitions Bar popover, Quick Answer card shell, tooltip/coachmark system, Quick-Start drawer, toasts, keyboard, responsive |
| **R5 Visualization** | Ribbon (+ Dome, + Earth Twin overlay), Power & Elevation, **Windows Table**, **Pointing & Link + DSN lanes**, barcodes, Season Strip, calendar, Touchdown Pad widget, map layers (P11), sparklines |
| **R6 Story, Design & Catalog** | Exact title; design tokens & wireframes; catalog verification incl. published targets (P13); glossary, definitions and persona copy; Earth Twin contrast copy; Quick-Start scripts; video, slides, project page, citations, AI-use log |

**5 people:** R4 takes shell + Compare layout + Quick Answer; R5 takes all charts and tables. **4 people:** R1 + R2 split terrain/validation (R1 takes P9b, P12, P14, P15); R3 + R4 merged; R5 charts; R6 story/catalog.

### 11.2 Shared UI foundation
H0–H4: R4 + R6 freeze design tokens and the component kit (Panel, Card, Chip, Badge, Metric Tile, Tooltip, Coachmark, Toast, Segmented Control, Slider, Dial, **Table with sort/filter/export**, **± value display**). Layouts are built first on mock data.

### 11.3 Timeline (H0 = official kickoff)
| Window | Work | Checkpoint |
|---|---|---|
| **H0–H2** | Title verbatim (R6, H0:30). §15 checks. Contracts frozen (incl. Window record, definitions, uncertainty fields); mocks committed. COG reads + kernels. Repo, CI, deploy. Tokens + bento wireframes. AI-use log. | **CP0 (H2): contracts + mocks + G1** |
| **H2–H8** | R1: ephemeris, G2, G3 (incl. range), DSN series, P12. R2: crops (IM-2, Shackleton ridge, 1 Artemis region, **CY-3 dedicated**), masks, G0, slope prototype. R3: evaluator on mocks, **windows + δt propagation**, golden harness. R4: Mission Bar, tabs, Cockpit bento, state/URL, crosshair bus, tooltip system, Definitions Bar. R5: Ribbon, Power curve, barcode, **Windows Table** on mocks. R6: catalog (all rows incl. published targets), glossary + definitions copy, Quick-Start scripts, storyboard v1. | **CP1 (H8) "First Light": real IM-2 Ribbon + Answer Strip with ± + Windows Table + barcode in the bento, crosshair synced, G4 first pass** |
| **H8–H16** | Touchdown Pad end-to-end. Jumps + verdict. **Pointing & Link** tab. **Quick Answer** card. Site sidebar (sparklines, chips, Illumination + PSR layers). Compare & Slip (rows, slip, delta, Scan, **Season Strip**, 60-day calendar). CSV/JSON export. Remaining MVP masks. **P8 batch from H10 (84–90°S first).** Quick-Start 1–2. Methodology skeleton + scope statement. Shackleton baseline date chosen. | **CP2 (H16): MVP complete in Planner persona; backup video recorded** |
| **H16–H22** | Sleep in two staggered shifts; one person watches P8/P9 batches. | — |
| **H22–H30** | Tier 1: Tier-B custom points, P9 MC σ, P9b calibration + G10, DSN-aware default, mast heights, battery, dispersion histogram, extra layers + P15 PSR distance, **Horizon Dome**, **Earth Twin**, Educator callouts, Quick-Start 3–4, 12-month calendar, deep-links, G5–G8, G11. Tier 2 only if CP2 green. | **CP3 (H30): feature freeze** |
| **H30–H38** | Bug bash; a11y; 1280×720 projector test; incognito share-URL; airplane-mode offline; CSV opened in a spreadsheet by a non-team member; Methodology final; deploy. | Live URL frozen H38 |
| **H36–H42** | Video from the deployed app; 7 slides. | — |
| **H40–H44** | Project page, citations, AI disclosure, README, `validation.md`, `limitations.md`. | — |
| **H44–H46** | **Submit.** | **Submitted** |
| **H46–H48** | Buffer; fix only if broken. | — |

### 11.4 Go / no-go rules
- G1 fails → stop; no ephemeris export.
- CY-3 finer source not obtained by H6 → 240 m ladder step; badge shows it.
- CP1 missed by >2 h → Tier-A heights 1 m + 10 m only; dispersion 5×5; Quick-Start 1 only; Pointing tab without DSN lanes.
- CP2 missed → no Tier 2; calendar stays 60 days; Scan shows next/previous GO only.
- P8 84–90°S not done by H22 → 4 km everywhere; 80–84°S not done by H28 → custom points there fall back to Tier C with a clear badge.
- G10 fails → inflate Tier-B σ until it passes; never hide ±.

### 11.5 Cut order
Tier 2 → Educator callouts beyond Quick-Start → 12-month calendar (keep Season Strip) → dispersion histogram → Earth Twin (keep contrast facts in Methodology) → Horizon Dome → Tier-B 80–84°S band.
**Never cut:** Mission Bar; Cockpit bento with live coupling; Ribbon; **Answer Strip with ±**; **Definitions Bar**; **Windows Table + CSV**; **Pointing & Link (geometry)**; **Quick Answer**; Touchdown Pad core; barcode + slip; jumps; crosshair; Season Strip; Quick-Start 1; Methodology G1–G4, G7, scope statement.

---

## 12. Demo, video, slides

### 12.1 Live demo (≈90 s, verified facts only, horizon first)
1. Quick-Start **"9-Day Launch Delay at Shackleton"** → Sun skimming the ridge, Earthset countdown with ± → slip +9 d → barcodes darken → Scan → alternative → verdict GO.
2. **Windows Table** → export CSV ("this is what a planner takes away").
3. Quick-Start **"Replay IM-2 Athena's Crater Tilt"** → Ribbon at touchdown → Touchdown Pad 30° tilt → power drop (illustrative label).
4. Hover Day 12 on the barcode → Sun & Earth jump to that instant on the Ribbon.
5. **Quick Answer** for a typed coordinate.
6. Persona → Educator → Earth Twin overlay.
7. Methodology → Horizons residuals + CY-3 sunrise/sunset within our ±.
No launch-vehicle incidents, schedules, delays or future-status claims anywhere.

### 12.2 30-second video storyboard
| s | Visual | Caption / VO |
|---|---|---|
| 0–4 | IM-2 Athena landing-site imagery (credited) | "March 2025: a lander reaches the Moon's south pole on its side and can't make enough power to keep operating." |
| 4–10 | Ribbon: Sun skimming a jagged ridge; Answer Strip "Sunset in 41 h ± 5 h" | "At the pole the Sun barely clears the horizon. LUMEN shows exactly when it's up, when Earth is in view, and how sure we are." |
| 10–16 | Slip +9 d → barcodes darken → Scan → green alternative | "Launch slipped? See which sites and dates still have sunlight and Earth contact, in seconds." |
| 16–20 | Windows Table → CSV | "Every window, ready for the mission plan." |
| 20–24 | Touchdown Pad tilt → power drop | "It even checks the ground under the lander." |
| 24–27 | Methodology: Horizons residuals, PGDA comparison | "Checked against JPL Horizons and NASA illumination maps." |
| 27–30 | LUMEN + URL | "LUMEN. Plan the landing before the Moon plans it for you." |

### 12.3 Seven slides
1. Problem (Athena + south-pole lighting) · 2. Users & questions (incl. scope statement) · 3. How it works (pipeline, NASA data) · 4. Cockpit (Answer Strip, Ribbon, Windows Table) & Compare · 5. Science: horizons, uncertainty in hours, DSN, slope/tilt, PSR context · 6. Validation & calibration · 7. Impact & next steps.

### 12.4 Criterion mapping
| Criterion | Evidence |
|---|---|
| Impact | Exact windows + error bars planners can use; re-planning after slips; educators |
| Creativity | Ribbon + crosshair sync, Answer Strip with ±, Touchdown Pad, Earth Twin, Quick-Start replays |
| Validity | G0–G11, Horizons pytest, PGDA agreement, σ calibration, verified catalog, explicit scope |
| Relevance | Every PS objective: Apollo/CLPS/commercial/international + custom sites, dates and seasons, Sun/Earth vs horizon, prominent solar elevation, sunset/Earthset countdowns, power and comms, 2D + 3D + timelines, animation, all skill levels, lunar vs terrestrial, science vs engineering |
| Presentation | Story-led video, guided scenarios, polished ops-console UI |

---

## 13. Submission checklist & AI-use rules
- [ ] Exact challenge title from portal
- [ ] Demo: ≤30 s video or ≤7 slides (confirm format), public link, no login
- [ ] Public deployed app + public repo; works offline after first load
- [ ] Summary within limits; details mapped to the five criteria; scope statement included
- [ ] All data, kernels, libraries and images cited with links
- [ ] AI usage disclosed
- [ ] English throughout
- [ ] Team registration and size per rules
- [ ] Submitted well before local deadline
- [ ] No NASA logo/insignia; AI imagery watermarked
- [ ] No unverified mission-status claims; published targets carry "as published" dates

**AI-use rules:** paste the relevant §5 spec into prompts and request tests first; nothing merges unless pytest + TS parity are green (R1 enforces); log every AI use.

---

## 14. Risk register
| Risk | L | I | Mitigation |
|---|---|---|---|
| Frame mismatch / kernel mix | Low after G1 | High | P2 decision; G1 |
| Uncertainty misleading (too small) | Med | High | G10 calibration; inflate σ; grazing labels |
| CY-3 lacks fine near-field data | Med | Med | Source ladder; physics note; badge |
| Slope-plane term misapplied | Low | High | §5.6 rule + golden cases |
| Rich UI overruns | Med | High | Component kit at H0–H4; mocks-first; tiers; gates |
| Bento doesn't fit viewport | Med | Med | Test 1920×960 & 1280×720 at CP1 |
| Tier-B 80–90°S batch slow | Med | Med | 84–90°S first; spare laptop; 4 km fallback |
| Published-target data wrong | Med | High | Primary sources only; "as published" dates; 15-min rule |
| TS/Python drift | Med | High | Golden vectors every merge; G11 |
| Network failure at demo | Low | High | Zero live calls; offline PWA; backup video |
| Over-claiming scope | Med | High | Scope statement in app, slides, video |

---

## 15. Verify at H0 (owners)
- Exact challenge title and judging/submission format (R6).
- NAIF kernel filenames; DE440 FK DE421-compatible ME frame (R1).
- PGDA product filenames, coverage, COGs, `_ERR`, slope rasters (R2).
- Best DEM covering 69.37°S (R2, by H6).
- Official IM-2 touchdown UTC; Chandrayaan-3 landing UTC (R6).
- Coordinates and "as published" dates for every published target and added historical site (R6).
- Horizons deep-link parameter format (R4).
- Any published illumination statistics we plan to quote (R1).
- Competitor record in the teammate draft — verify or drop (R6).
- Local event rules on pre-staged data (R6).

## 16. Open questions (decide at kickoff)
1. Team size → role variant.
2. Demo defaults: slope tolerance, dispersion radius, panel preset, battery/load, Sun-available threshold, Earth margin.
3. Hosting (static).
4. Hypothetical Shackleton baseline date (H8).
5. Year shown by default in the Season Strip.

## 17. Provenance
Merged from **Plan A** (teammate draft, "LUMEN": strategy, judging/story framing, DSN-aware DTE, mast heights, Monte-Carlo σ, battery check, validation anchors and Horizons fixtures, data inventory, COG windowed reads, mission profile and calendar, answer-first UX, video/slides/checklists, AI rules) and **Plan B** (revised architecture, "SKYLINE": SpiceyPy-primary frames, singularity-free site frames, Hermite + adaptive sampling + chord quadrature, Touchdown Pad, static zero-API architecture with golden parity, verified catalog, gated schedule). Revision 1 added the Chandrayaan-3 dedicated crop, the corrected slope-plane rule and the UI/UX architecture. **Revision 2** added problem-statement alignment (published targets, extended Tier B, seasons, Earth Twin, PSR context, prominent Sun elevation, Dome, deep-links) and calculator fidelity (uncertainty in MVP, Windows Table, Pointing & Link, Quick Answer, Definitions Bar, scope statement, G10–G11).
