# WORK_DISTRIBUTION.md — LUMEN team work split
### Companion to PLAN_FINAL.md (Revision 2) · 5 people · conflict-free by file ownership · ZERO CODE IN THIS DOCUMENT

| Person | Side | Role in one line |
|---|---|---|
| **Abhinav** | Frontend | App shell, layout, navigation, state & URL, UI kit, sidebar, guidance, Quick Answer UI, Compare left column, Methodology view, submission lead |
| **Ebin** | Frontend | All charts and visual widgets: SKYLINE Ribbon (+ Dome, Earth Twin overlay), Power & Elevation, Windows Table, Pointing & Link, Barcode + Slip bar, Touchdown Pad widget, Compare visuals, Sparkline |
| **Nived** | Frontend | Browser engine (Web Worker) and data layer: loaders, all calculations, uncertainty, windows, verdict, scan, export, Answer Strip, Metric Deck, Basemap, offline caching, Python↔TS parity tests |
| **Gowri** | Backend | Ephemeris, frames, DSN, site catalog, Python reference evaluator, golden vectors, validation (Horizons/PGDA), glossary content |
| **Shiva Shakthi** | Backend | Terrain: DEM access, horizon raycaster, site masks (incl. Chandrayaan-3 crop), touchdown slope, dispersion grid, Tier-B regional grid, Monte-Carlo σ, PSR distance, map layers |

**How to use this file:** read §1–§4 once (everyone), then **only your own section**. Your section lists every file you own, what goes in it, what you wait for, what you hand over, and the order to work in.

---

## 1. Golden rules (no merge conflicts)

1. **Every file has exactly one owner.** Ownership is listed in §3 and enforced by `CODEOWNERS`. You never edit a file you don't own. If you need a change in someone else's file, post a **Change Request** in the team chat channel `#lumen-changes` ("@owner — need X in file Y because Z") and the owner makes it.
2. **Shared project files are owned by one person each:** `web/package.json` + lockfile (Abhinav), `pipeline/pyproject.toml` + requirements (Gowri). **All dependencies are installed in the first hour** from the lists in §2.4 so nobody needs to touch these files later.
3. **Contracts first.** Every data file and every frontend hook/API is described in `contracts/` and frozen at **H2**. After H2 a contract changes only if both the producer and the consumer agree in chat, and only the contract owner edits it.
4. **Stub-first.** By **H1:30** every frontend owner pushes empty components/hooks with their **final file names and export names** (listed in their section). Abhinav's layout imports them immediately; owners then fill them in without anyone else touching the files.
5. **Generated data is written only by its producer, only into the producer's own folder** under `web/public/data/`. No two pipelines ever write the same file. The single merged file `sites.json` is assembled by one step owned by Gowri.
6. **Per-person logs.** AI-usage logs and notes are per person (`docs/ai_usage/<name>.md`), never a shared file.
7. **Git flow:** short branches named `<name>/<topic>` (e.g. `ebin/ribbon`), rebase on `main` before pushing, small PRs, merge as soon as CI is green. Because files don't overlap, rebases are trivial.
8. **Formatting is fixed at H0** (Prettier for web, Black + Ruff for pipeline) so nobody's formatter rewrites someone else's file.
9. **Large binaries** go through Git LFS (patterns set in `.gitattributes` by Gowri at H0).

---

## 2. Shared foundations (everyone reads)

### 2.1 Repository file structure (owner in brackets)

```
lumen/
├─ README.md                                   [Abhinav]
├─ CODEOWNERS                                  [Abhinav]  maps every path below to its owner
├─ .gitignore                                  [Abhinav]
├─ .gitattributes                              [Gowri]    Git LFS patterns for *.bin, *.png under web/public/data
├─ .github/workflows/
│   ├─ ci-backend.yml                          [Gowri]    pytest + ruff on pipeline/
│   └─ ci-frontend.yml                         [Nived]    typecheck + vitest + build on web/
│
├─ contracts/                                  frozen at H2 (see §2.2 for per-file owner)
│   ├─ README.md                               [Gowri]
│   ├─ data_ephemeris.md                       [Gowri]
│   ├─ data_dsn.md                             [Gowri]
│   ├─ data_catalog.md                         [Gowri]    sites.json + sparklines
│   ├─ data_golden.md                          [Gowri]
│   ├─ data_validation.md                      [Gowri]
│   ├─ data_glossary.md                        [Gowri]
│   ├─ data_masks.md                           [Shiva Shakthi]
│   ├─ data_tierb.md                           [Shiva Shakthi]
│   ├─ data_terrain_misc.md                    [Shiva Shakthi]  pad, dispersion, sigma, psr, layers, regions, site summaries
│   ├─ frontend_engine_api.md                  [Nived]    hooks + engine functions the UI may call
│   ├─ frontend_state_api.md                   [Abhinav]  scenario store, crosshair store, actions, URL format
│   └─ frontend_content.md                     [Abhinav]  quickstart.json + copy keys
│
├─ pipeline/                                   BACKEND (Python 3.12)
│   ├─ pyproject.toml / requirements.txt       [Gowri]
│   ├─ README_ephem.md                         [Gowri]    how to run Gowri's stages
│   ├─ README_terrain.md                       [Shiva Shakthi]
│   ├─ config/
│   │   ├─ kernels.tm                          [Gowri]    SPICE meta-kernel
│   │   ├─ ephem.yaml                          [Gowri]    time range, steps, DSN mask, defaults
│   │   ├─ sites.yaml                          [Gowri]    master site list (coordinates + sources)
│   │   ├─ dem_sources.yaml                    [Shiva Shakthi]  DEM URLs, products, bounding boxes
│   │   └─ terrain.yaml                        [Shiva Shakthi]  bins, heights, ranges, grid spacings
│   ├─ lumen_pipeline/
│   │   ├─ __init__.py                         [Gowri]
│   │   ├─ common/                             [Gowri]
│   │   │   ├─ constants.py
│   │   │   ├─ frames.py
│   │   │   ├─ timeutil.py
│   │   │   └─ binio.py
│   │   ├─ ephem/                              [Gowri]
│   │   │   ├─ kernels.py
│   │   │   ├─ ephemeris.py
│   │   │   └─ dsn.py
│   │   ├─ reference/                          [Gowri]    Python twin of the browser engine
│   │   │   ├─ interp.py
│   │   │   ├─ visibility.py
│   │   │   ├─ events.py
│   │   │   ├─ uncertainty.py
│   │   │   ├─ power.py
│   │   │   ├─ windows.py
│   │   │   └─ metrics.py
│   │   ├─ catalog/                            [Gowri]
│   │   │   ├─ build_catalog.py
│   │   │   └─ sparklines.py
│   │   ├─ validation/                         [Gowri]
│   │   │   ├─ horizons_client.py
│   │   │   ├─ frame_check.py
│   │   │   ├─ golden.py
│   │   │   ├─ sigma_calibration.py
│   │   │   ├─ pgda_compare.py
│   │   │   └─ report.py
│   │   └─ terrain/                            [Shiva Shakthi]
│   │       ├─ dem_io.py
│   │       ├─ crops.py
│   │       ├─ horizon.py
│   │       ├─ masks.py
│   │       ├─ pad.py
│   │       ├─ dispersion.py
│   │       ├─ tierb.py
│   │       ├─ mc_sigma.py
│   │       ├─ psr.py
│   │       ├─ layers.py
│   │       ├─ regions.py
│   │       └─ summaries.py
│   ├─ scripts/                                one entry-point file per stage
│   │   ├─ run_frame_check.py  run_ephem.py  run_dsn.py  run_catalog.py  run_sparklines.py
│   │   ├─ run_golden.py  run_validation.py  run_sigma_calibration.py          [Gowri]
│   │   └─ run_crops.py  run_masks.py  run_pad.py  run_dispersion.py  run_tierb.py
│   │      run_mc_sigma.py  run_psr.py  run_layers.py  run_regions.py         [Shiva Shakthi]
│   ├─ tests/
│   │   ├─ gowri/       test_frames.py test_ephem.py test_horizons.py test_reference.py test_catalog.py   [Gowri]
│   │   └─ terrain/     test_horizon_synthetic.py test_pad.py test_tierb.py test_layers.py              [Shiva Shakthi]
│   ├─ kernels/        (gitignored downloads)
│   └─ cache/          (gitignored DEM windows)
│
├─ web/                                        FRONTEND (React + Vite + TypeScript)
│   ├─ package.json, lockfile, tsconfig.json, vite.config.ts, index.html, .prettierrc   [Abhinav]
│   ├─ pwa.config.ts                           [Nived]    imported by vite.config.ts
│   ├─ public/
│   │   ├─ data/
│   │   │   ├─ ephem/        ephem.bin ephem.json                         [Gowri]
│   │   │   ├─ dsn/          dsn.bin dsn.json                             [Gowri]
│   │   │   ├─ catalog/      sites.json sparklines.bin sparklines.json    [Gowri]
│   │   │   ├─ golden/       *.json                                       [Gowri]
│   │   │   ├─ validation/   report.json charts/*.png                     [Gowri]
│   │   │   └─ terrain/                                                   [Shiva Shakthi]
│   │   │       ├─ masks/ <site_id>.bin <site_id>.json
│   │   │       ├─ sigma/ <site_id>.bin
│   │   │       ├─ pad/ <site_id>.json
│   │   │       ├─ dispersion/ <site_id>.bin <site_id>.json
│   │   │       ├─ tierb/ index.json tiles/<tile_id>.bin
│   │   │       ├─ psr/ psr_distance.bin psr_distance.json
│   │   │       ├─ layers/ *.png layers.json
│   │   │       ├─ regions/ artemis_regions.svg regions.json
│   │   │       ├─ summaries/ <site_id>.json
│   │   │       └─ manifest.json
│   │   ├─ data-mock/      same folder structure as data/, fake values    [Nived]
│   │   └─ content/
│   │       ├─ glossary.json                                              [Gowri]
│   │       └─ quickstart.json                                            [Abhinav]
│   └─ src/
│       ├─ main.tsx, App.tsx                   [Abhinav]
│       ├─ app/                                [Abhinav]  shell, MissionBar, views, layouts
│       ├─ state/                              [Abhinav]  scenarioStore, crosshairStore, urlSync, copy
│       ├─ ui/                                 [Abhinav]  tokens + component kit
│       ├─ content/                            [Abhinav]  persona copy
│       ├─ engine/                             [Nived]    worker, math, data loaders, hooks, export
│       ├─ features/
│       │   ├─ sidebar/        [Abhinav]   ├─ ribbon/            [Ebin]
│       │   ├─ definitions/    [Abhinav]   ├─ analysis/          [Ebin]  PowerCurve, WindowsTable, PointingLink
│       │   ├─ quickAnswer/    [Abhinav]   ├─ barcode/           [Ebin]  Barcode, SlipBar
│       │   ├─ guidance/       [Abhinav]   ├─ touchdown/         [Ebin]
│       │   ├─ scenarios/      [Abhinav]   ├─ compareVisuals/    [Ebin]  AlignedBarcodes, SeasonStrip, Calendar
│       │   ├─ methodology/    [Abhinav]   ├─ sparkline/         [Ebin]
│       │   ├─ answer/         [Nived]     AnswerStrip
│       │   ├─ metrics/        [Nived]     MetricDeck
│       │   ├─ map/            [Nived]     Basemap
│       │   └─ compareResults/ [Nived]     DeltaTable, ScanPanel
│       └─ e2e/                                [Abhinav]  smoke tests
│
└─ docs/
    ├─ validation.md, data_sources_ephem.md, limitations.md        [Gowri]
    ├─ terrain.md, data_sources_terrain.md                         [Shiva Shakthi]
    ├─ frontend_architecture.md                                    [Nived]
    ├─ ui_guide.md, credits_frontend.md                            [Abhinav]
    ├─ visuals.md                                                  [Ebin]
    └─ ai_usage/ abhinav.md ebin.md nived.md gowri.md shiva.md     [each person their own]
```

### 2.2 Contracts (written H0:30–H2, frozen at H2)
- **Session:** H0:30–H1:30 everyone in one call. Gowri drives the data contracts, Shiva Shakthi writes the terrain ones, Nived writes the engine API, Abhinav writes the state API and content. H1:30–H2: each owner pushes their contract file(s); others review in the PR.
- Each data contract states: path, producer, consumer(s), header fields, binary layout (field order, type, units), value ranges, example values, and versioning (a `version` field in every JSON header).
- **Frontend reads backend data only through Nived's loaders.** Ebin and Abhinav never parse files in `public/data/` directly.

### 2.3 Hours and checkpoints (from PLAN_FINAL)
| Checkpoint | Hour | Everyone must have |
|---|---|---|
| **CP0** | H2 | Repo + contracts frozen + stubs pushed + mocks started + G1 frame check run |
| **CP1 "First Light"** | H8 | Real IM-2 data visible in the Cockpit bento with crosshair sync; first golden parity pass |
| **CP2 "MVP"** | H16 | MVP features (PLAN_FINAL §9) working in Planner persona; backup video recorded |
| Sleep | H16–H22 | Shift A sleeps H16–H19: **Abhinav, Ebin, Gowri**. Shift B sleeps H19–H22: **Nived, Shiva Shakthi**. Gowri watches Shiva's batch jobs during H19–H22. |
| **CP3 "Feature freeze"** | H30 | Tier 1 done or cut |
| URL freeze | H38 | Deployed, tested |
| Submit | H44–H46 | Submitted |

### 2.4 Dependencies installed at H0 (so nobody edits package files later)
- **Pipeline (Gowri adds all at H0:30):** spiceypy, skyfield, numpy, scipy, numba, rasterio, pyproj, shapely, fiona (or pyogrio), pyyaml, requests, matplotlib, pillow, pytest, ruff, black.
- **Web (Abhinav adds all at H0:30):** react, react-dom, typescript, vite, zustand, d3, three, @react-three/fiber (optional; Ebin decides by H1 and tells Abhinav), comlink (worker messaging), vite-plugin-pwa (Workbox), vitest, @playwright/test, prettier, eslint, a date utility (date-fns), and a font package for monospace numerals.

### 2.5 Handoff board (who needs what from whom, and when)
| # | From → To | What | Needed by |
|---|---|---|---|
| H-1 | Abhinav → all | Repo scaffold, CODEOWNERS, web skeleton | H0:30 |
| H-2 | Gowri → all backend | Pipeline scaffold, `pyproject`, `.gitattributes` | H0:45 |
| H-3 | Everyone | Contracts pushed | H2 |
| H-4 | Ebin, Nived → Abhinav | Component and hook stubs with final names | H1:30 |
| H-5 | Gowri → Shiva Shakthi | `common/frames.py`, `constants.py`, `binio.py`; `sites.yaml` with first 4 sites | H1:30 |
| H-6 | Nived → Ebin, Abhinav | Full mock dataset in `data-mock/` + hooks returning mock results | H3 |
| H-7 | Abhinav → Ebin, Nived | UI kit basics (tokens, Panel, Card, Badge, InfoBadge, Segmented, Slider) | H3 |
| H-8 | Gowri → Nived, Shiva Shakthi | `ephem.bin` (G2 passed) | H4 |
| H-9 | Shiva Shakthi → Gowri, Nived | First real mask: IM-2 (`masks/im2_athena.*`) | H5 |
| H-10 | Gowri → Nived | First golden vectors (IM-2) | H7:30 |
| H-11 | Shiva Shakthi → Gowri | Masks for Shackleton ridge, 1 Artemis region, CY-3 | H8 |
| H-12 | Gowri → Nived | `dsn.bin` | H8 |
| H-13 | Shiva Shakthi → Gowri, Nived | Pad stats for all MVP sites | H10 |
| H-14 | Shiva Shakthi → Nived | Map layers PNG + `layers.json`; regions SVG | H12 |
| H-15 | Gowri → Nived | Golden vectors incl. power, slope-plane, uncertainty, windows | H12 |
| H-16 | Gowri → Nived, Ebin | `sparklines.bin` + final MVP `sites.json` | H14 |
| H-17 | Shiva Shakthi → Gowri, Nived | Tier-B tiles 84–90°S | H22 |
| H-18 | Shiva Shakthi → Gowri, Nived | MC σ for Tier-A sites; PSR distance | H26 |
| H-19 | Gowri → Nived | Tier-B σ calibration values | H26 |
| H-20 | Gowri → Abhinav | `validation/report.json` + charts | H28 |

---

## 3. Ownership summary (quick lookup)

| Area | Owner |
|---|---|
| Repo root files, `web/` config, `src/app`, `src/state`, `src/ui`, `src/content`, `features/{sidebar,definitions,quickAnswer,guidance,scenarios,methodology}`, `public/content/quickstart.json`, `e2e/` | **Abhinav** |
| `features/{ribbon,analysis,barcode,touchdown,compareVisuals,sparkline}` | **Ebin** |
| `src/engine/`, `features/{answer,metrics,map,compareResults}`, `public/data-mock/`, `pwa.config.ts`, `ci-frontend.yml` | **Nived** |
| `pipeline/` except `terrain/` and terrain scripts/tests/config; `public/data/{ephem,dsn,catalog,golden,validation}`; `public/content/glossary.json`; `.gitattributes`; `ci-backend.yml` | **Gowri** |
| `pipeline/lumen_pipeline/terrain/`, terrain scripts/tests/config; `public/data/terrain/` | **Shiva Shakthi** |

---

# 4. BACKEND

## 4.1 Gowri — Ephemeris, frames, DSN, catalog, reference evaluator, validation

### Your mission
Produce the Sun/Earth geometry the whole app is built on, prove it is right, and produce the reference numbers the browser engine must match. You also own the site list and the glossary text.

### You depend on
| From | What | When | If late |
|---|---|---|---|
| Shiva Shakthi | IM-2 mask | H5 | Build golden vectors on a smooth-sphere (zero) mask first, swap at H5 |
| Shiva Shakthi | Masks for Shackleton, Artemis region, CY-3 | H8 | Golden set covers IM-2 only at CP1 |
| Shiva Shakthi | Pad stats (`pad/<id>.json`) | H10 | Power golden cases use flat ground |
| Shiva Shakthi | Site summaries (`summaries/<id>.json`) | H8 onward | `build_catalog` marks site tier "pending" |
| Shiva Shakthi | Tier-B tiles | H22 | Delay σ calibration; Tier-B uses default σ 0.5° |

### You provide
`frames.py`/`constants.py`/`binio.py` + `sites.yaml` (H1:30) · `ephem.bin` (H4) · Horizons validation (H6) · `dsn.bin` (H8) · golden vectors (H7:30, full set H12) · `sites.json` (first version H3, MVP H14) · `sparklines.bin` (H14) · `glossary.json` (H10) · σ calibration (H26) · validation report (H28).

### Order of work
| Step | Hours | Task | Done when |
|---|---|---|---|
| G-1 | H0–H0:45 | Pipeline scaffold, `pyproject` with all deps, `.gitattributes`, `ci-backend.yml`, `README_ephem.md` skeleton | Shiva Shakthi can clone and run `pytest` (0 tests) |
| G-2 | H0:30–H2 | Contracts: write all `data_*.md` you own (see §2.1); review Shiva's | Pushed at H2 |
| G-3 | H0:45–H1:30 | `common/constants.py`, `common/frames.py`, `common/binio.py`, `common/timeutil.py`; `config/sites.yaml` with IM-2, Chandrayaan-3, Shackleton ridge, one Artemis region | Shiva Shakthi notified in chat |
| G-4 | H1–H2 | Download kernels, write `kernels.tm`; `ephem/kernels.py`; `validation/frame_check.py` → **G1** | G1 passes; PA↔ME offset recorded in `docs/validation.md` |
| G-5 | H2–H4 | `ephem/ephemeris.py` → `ephem.bin` + `ephem.json`; Hermite check → **G2** | File pushed via LFS; Nived notified |
| G-6 | H3 | First `catalog/build_catalog.py` → `sites.json` with tier "pending" for all 4 sites | Nived can load it |
| G-7 | H4–H6 | `validation/horizons_client.py` + `tests/gowri/test_horizons.py` → **G3** (5 sites × 20 epochs incl. Earth range) | Tests green in CI |
| G-8 | H5–H7:30 | `reference/interp.py`, `visibility.py`, `events.py`, `windows.py`, `metrics.py` (first pass); `validation/golden.py` → golden set 1 (IM-2) | Nived notified at H7:30 |
| G-9 | H6–H8 | `ephem/dsn.py` → `dsn.bin` | Pushed |
| G-10 | H8–H12 | `reference/uncertainty.py`, `reference/power.py` (incl. slope-plane rule and tilt), extend `windows.py`, `metrics.py`; golden set 2 (all MVP sites, edge cases) | Nived notified at H12 |
| G-11 | H8–H10 | `public/content/glossary.json` (all terms from PLAN_FINAL §8.10) | Abhinav notified |
| G-12 | H8–H14 | Complete `sites.yaml` (all verified rows from PLAN_FINAL §7 with sources); `catalog/sparklines.py`; `build_catalog` final MVP | `sites.json` + `sparklines.bin` pushed at H14 |
| G-13 | H14–H16 | `docs/data_sources_ephem.md`; help verify CP2 numbers | CP2 |
| G-14 | H22–H26 | `validation/sigma_calibration.py` (needs Tier-B tiles) → σ values into `sites.json` (Tier-B default) ; **G10** | Nived notified |
| G-15 | H22–H28 | `validation/pgda_compare.py` (**G5**); CY-3 and IM-2 timeline checks (**G7**); `validation/report.py` → `report.json` + charts | Abhinav notified at H28 |
| G-16 | H28–H38 | `docs/validation.md`, `docs/limitations.md`; sign off numbers shown in demo | Freeze |
| G-17 | H36–H44 | Validation slide numbers; data citations list for the project page | Submission |

### Your files and exactly what goes in them

**`config/kernels.tm`** — SPICE meta-kernel listing the exact kernel files (leapseconds, text PCK, planetary SPK, lunar binary PCK, lunar FK, Earth high-precision PCK, DSN station SPK and FK) with their relative paths under `pipeline/kernels/`. Add a comment line per kernel with source URL and checksum.

**`config/ephem.yaml`** — start date 2023-01-01, end date 2030-12-31, ephemeris node step 3600 s, DSN step 600 s, DSN stations (DSS-14, DSS-43, DSS-63), DSN quantisation 0.5°, default DSN mask 10°, aberration setting (light-time + stellar), frame name chosen in G1 (DE421-consistent MOON_ME), golden-vector scenario list file path.

**`config/sites.yaml`** — one entry per site: `id` (snake_case, permanent, e.g. `im2_athena`), display name, category (`historical_landing`, `published_target`, `artemis_candidate_region`, `contrast_site`), agency/program, latitude, longitude (MOON_ME, degrees, east positive), landing date + UTC (historical) or `as_published_date` (targets), `source_url`, `source_type`, `verification_status`, `verified_by`, notes, desired tier (A/B/C). Only verified rows are marked `verification_status: verified`. Shiva Shakthi reads this file to know which sites to compute; she never edits it.

**`lumen_pipeline/common/constants.py`** — lunar radius 1737.4 km, Earth radius 6378 km, AU in km, solar constant 1361 W/m², speed of light, Sun angular radius at 1 AU (0.2666°), polar-domain latitude threshold (60°), default Sun-available disk threshold (50%), default Earth margin (1°), default DTE disk threshold (50%), default DSN mask (10°).

**`lumen_pipeline/common/frames.py`** — the single source of truth for site geometry (PLAN_FINAL §5.1):
- `site_up_vector(lat, lon)`: unit radial vector in MOON_ME.
- `site_position_km(lat, lon, height_m, surface_elev_m)`: site position vector.
- `reference_axis(lat)`: +X_ME if |lat| ≥ 60°, else +Z_ME.
- `site_rotation_matrix(lat, lon)`: 3×3 matrix with rows (east, n_ref, up) built from the reference axis as in §5.1. **Shiva Shakthi's raycaster and your reference evaluator must both call this function**, and the matrix is stored in `sites.json` and Tier-B tiles.
- `direction_to_az_el(vector_in_site_frame)`: azimuth (atan2 of east and n_ref components, 0–360°) and elevation.
- `earth_ref_to_true_azimuth(...)`: conversion for display where true north is defined.
- Unit tests in `tests/gowri/test_frames.py`: no NaN anywhere 60–90°S including exactly 90°S; rotation is orthonormal; round-trip vector → az/el → vector.

**`lumen_pipeline/common/binio.py`** — writing helpers used by both backend people: write a binary file of little-endian Float32 / Int16 / UInt8 arrays plus a sidecar JSON header containing `version`, producer, created UTC, git commit, field order, dtype, shape, scale/offset (for quantised data) and units. Also the matching reader (used in tests). Contract in `contracts/README.md`.

**`lumen_pipeline/common/timeutil.py`** — UTC ⇄ ET (TDB) conversions via SPICE, ISO formatting, hour-index ⇄ UTC for the ephemeris grid.

**`lumen_pipeline/ephem/kernels.py`** — loads/unloads the meta-kernel once; asserts all kernel files exist with matching checksums; exposes the chosen frame name.

**`lumen_pipeline/ephem/ephemeris.py`** — for every hour in the range: Sun and Earth position (km) and velocity (km/s) relative to the Moon centre in MOON_ME with the configured aberration correction. Writes `public/data/ephem/ephem.bin` (per node 12 Float32: Sun pos 3, Sun vel 3, Earth pos 3, Earth vel 3) and `ephem.json` (start epoch UTC + TDB, step, count, frame, units, aberration flag, kernel list + checksums, body order). Includes the **G2 check**: 10,000 random epochs, Hermite-interpolated direction vs direct SPICE, max error < 0.001°; result written into `docs/validation.md`.

**`lumen_pipeline/ephem/dsn.py`** — for each DSN station and every 10 minutes 2023–2030: elevation of the Moon centre in the station's topocentric frame (Earth high-precision PCK). Quantise to 0.5° as little-endian signed Int16 with `round(elevation_deg * 2)` (store −180…+180; decode ÷2). Writes `dsn/dsn.bin` + `dsn.json`. Spot-check one station against Horizons.

**`lumen_pipeline/reference/`** — the Python twin of the browser engine. Must implement PLAN_FINAL §5.2–§5.8 exactly, slowly and clearly (speed is not important here, correctness is):
- `interp.py` — cubic Hermite interpolation of body position from `ephem.bin`; topocentric direction for a site; rotation into the site frame (uses `frames.py`).
- `visibility.py` — reading a mask (`masks/<id>`), mask interpolation per azimuth, **slope-plane occluder with the exact clamp-and-apply rule (§5.6)**, chord-quadrature disk fraction for Sun (24 chords) and Earth (32 chords).
- `events.py` — adaptive sampling (60 min / 2 min inside ±3° band), detection of clearance sign changes and disk-fraction thresholds 0/50/100%, bisection to 10 s.
- `uncertainty.py` — δt = σ ÷ |d(clearance)/dt| at each event; grazing floor 0.005°/h and 12 h cap → grazing flag; three-run bounds (mask − σ, nominal, mask + σ) for percentages and longest night.
- `power.py` — lander attitude (tilt onto ground normal, yaw sweep, optional off-nominal tilt), four generic panel presets, power per panel and total, flat-ground baseline, battery endurance.
- `windows.py` — run-length encoding into Window records (type sun / earth / link / ops, start, end, duration, bounds, peak elevation, flags), DSN-aware link logic.
- `metrics.py` — every metric of PLAN_FINAL §5.7 and the verdict rule.

**`lumen_pipeline/validation/frame_check.py`** — **G1**: PA→ME rotation from SpiceyPy vs Skyfield `MOON_ME_DE421` at several epochs; Sun/Earth direction agreement; measured PA↔ME surface offset in metres. Prints and writes into `docs/validation.md`.

**`lumen_pipeline/validation/horizons_client.py`** — builds JPL Horizons API queries for an observer on the lunar surface (`coord@301`, geodetic site coordinates, az/el and range quantities), caches responses as JSON fixtures in `tests/gowri/fixtures/` so CI runs offline.

**`tests/gowri/test_horizons.py`** — **G3**: for 5 sites × 20 epochs (incl. IM-2 and CY-3) our smooth-sphere elevation/azimuth/range vs Horizons fixtures: angles < 0.01°, range < 1 km. Azimuth compared at non-polar points after conversion; polar points compared as vectors.

**`lumen_pipeline/validation/golden.py`** — runs the reference evaluator on a fixed scenario list (~60) and writes `public/data/golden/<scenario_id>.json`: scenario inputs, per-step elevations/disk fractions (subsampled), events with δt, windows, metrics with bounds, power. Must include edge cases: θ = 0 slope; pure downhill; uphill θ = 10°; cross-slope; negative terrain horizon preserved; grazing event; Tier-C site; event exactly at window start; DSN on/off.

**`lumen_pipeline/validation/sigma_calibration.py`** — for each curated Tier-A site, take the nearest Tier-B node's mask, compute RMS mask difference by distance-to-node, and the fraction of Tier-B event times inside Tier-A time ± δt (**G10**). Output: Tier-B σ values by distance band → written into `sites.json` defaults and `report.json`.

**`lumen_pipeline/validation/pgda_compare.py`** — **G5**: long-run sunlit and Earth-visible fractions at Tier-A sites vs PGDA average illumination / Earth visibility map pixels. **G7**: CY-3 sunrise/sunset times around landing; IM-2 conditions at touchdown.

**`lumen_pipeline/validation/report.py`** — collects G0–G11 results into `public/data/validation/report.json` (per gate: id, description, metric, threshold, value, pass, chart file) and renders PNG charts into `validation/charts/` (Horizons residual histogram, PGDA scatter, CY-3 timeline). Abhinav's Methodology view displays these; no extra frontend charting needed.

**`lumen_pipeline/catalog/build_catalog.py`** — the **only** writer of `public/data/catalog/sites.json`. Reads `sites.yaml`, your frames (rotation matrix per site), Shiva Shakthi's `terrain/summaries/<id>.json` (tier, near-field resolution, mask/sigma/pad/dispersion file paths, PSR distance + bearing), your sparkline index, and σ defaults. Missing terrain summary → tier "pending" (Tier C if outside coverage). Field list = `contracts/data_catalog.md`.

**`lumen_pipeline/catalog/sparklines.py`** — per curated site: daily sunlit % and DTE % 2023–2030 at 2 m with default definitions (uses the reference evaluator, daily aggregation). Writes `sparklines.bin` (UInt8 per day per metric) + `sparklines.json` (site order, start date, day count).

**`public/content/glossary.json`** — one entry per term in PLAN_FINAL §8.10: key, label, formula (plain text), impact (plain English, one sentence), source, uncertainty note, related metric ids, "learn more" anchor.

**`docs/validation.md`, `docs/limitations.md`, `docs/data_sources_ephem.md`** — human-readable gate results, scope statement and limitations, kernel and data citations with links.

### Don'ts
Don't edit anything in `terrain/`; don't write into `public/data/terrain/`; don't change a frozen contract alone; don't quote published statistics you haven't confirmed in the paper text.

---

## 4.2 Shiva Shakthi — Terrain

### Your mission
Turn LOLA elevation data into everything the app knows about the ground: 360° horizon masks for every site, the slope under the lander, the regional grid for custom points, uncertainty, PSR distances and the map images.

### You depend on
| From | What | When | If late |
|---|---|---|---|
| Gowri | `frames.py` (site rotation matrix), `constants.py`, `binio.py` | H1:30 | Start with DEM access (`dem_io.py`) and the synthetic test; do not invent your own frame function |
| Gowri | `sites.yaml` first 4 sites | H1:30 | Use IM-2 coordinates from PLAN_FINAL §7 to test, but compute outputs only from `sites.yaml` |
| Gowri | Full `sites.yaml` | H12 | Compute what's listed; rerun when updated |

### You provide
IM-2 mask (H5) · masks for Shackleton, Artemis region, CY-3 (H8) · pad stats (H10) · layers + regions (H12) · remaining MVP masks + dispersion (H14) · Tier-B tiles 84–90°S (H22), 80–84°S (H28) · MC σ + PSR distance (H26) · site summaries after every run.

### Order of work
| Step | Hours | Task | Done when |
|---|---|---|---|
| S-1 | H0:30–H2 | Write `data_masks.md`, `data_tierb.md`, `data_terrain_misc.md` contracts; `config/dem_sources.yaml`, `config/terrain.yaml` | Pushed at H2 |
| S-2 | H0:45–H2 | `terrain/dem_io.py`: windowed COG reads over HTTP with a local cache; confirm product names and coverage (PLAN_FINAL §15) | A 5 km window around IM-2 reads in seconds |
| S-3 | H2–H4 | `terrain/horizon.py` (Numba raycaster) + `tests/terrain/test_horizon_synthetic.py` (**G0**: cone and crater DEMs with known horizon) | G0 < 0.01° |
| S-4 | H3–H5 | `terrain/crops.py` (multi-resolution crops), `terrain/masks.py`, `terrain/summaries.py` → IM-2 mask at 4 heights | `masks/im2_athena.*` + summary pushed at H5 |
| S-5 | H5–H8 | Masks for Shackleton ridge, one Artemis region; **Chandrayaan-3 dedicated crop** (source ladder, PLAN_FINAL §4.1) | Pushed at H8; source used recorded in summary |
| S-6 | H8–H10 | `terrain/pad.py` → pad stats for all MVP sites (**G6** check vs PGDA slope) | Pushed at H10 |
| S-7 | H9–H12 | `terrain/layers.py`, `terrain/regions.py` → PNG layers (Illumination, Earth Visibility, Slope Hazard, PSR) + `layers.json`; Artemis outlines SVG | Pushed at H12 |
| S-8 | H10 (start) | `terrain/tierb.py` batch on spare laptop: **84–90°S first** | Running by H10 |
| S-9 | H10–H14 | Masks for remaining MVP sites; `terrain/dispersion.py` → 11×11 grids | Pushed at H14 |
| S-10 | H14–H16 | `docs/terrain.md`, `docs/data_sources_terrain.md`; check CP2 | CP2 |
| S-11 | H18 | Check Tier-B batch progress (Gowri watches H19–H22) | — |
| S-12 | H22–H24 | Publish Tier-B 84–90°S tiles + `index.json`; start 80–84°S | Pushed at H22 |
| S-13 | H22–H26 | `terrain/mc_sigma.py` (20–30 clones, Tier-A centres); `terrain/psr.py` (distance raster + per-site values) | Pushed at H26 |
| S-14 | H26–H28 | Publish 80–84°S tiles (or 4 km fallback) | Pushed at H28 |
| S-15 | H28–H38 | Re-runs requested by validation; final `manifest.json` | Freeze |

### Your files and exactly what goes in them

**`config/dem_sources.yaml`** — for each DEM product: name, URL (COG), resolution, coverage (lat range), frame/datum note (MOON_ME/DE421), error-raster URL, slope-raster URL. The Chandrayaan-3 source ladder (3 options in order) with status field filled in when decided.

**`config/terrain.yaml`** — Tier-A bin width 0.1°, Tier-B/dispersion bin width 0.5°, heights [1, 2, 5, 10] m, ray range 250 km, multi-resolution radii (5 m within 5 km, 20 m within 80 km, 240 m beyond), geometric step growth factor, Tier-B spacing (2 km inside 85°S, 4 km 80–85°S), tile size ~20 km, quantisation (0.05° per UInt8 step, offset), MC clone count, dispersion grid (11×11 at 50 m), footprint baseline for slope (~5–6 m), slope tolerance default, dispersion radius default.

**`lumen_pipeline/terrain/dem_io.py`** — open each product once; read a window by lat/lon bounding box (convert via polar stereographic projection with pyproj); local cache in `pipeline/cache/`; return elevation array + transform + metadata. Also returns the matching `_ERR` window when asked.

**`lumen_pipeline/terrain/crops.py`** — for one site: build the three nested crops (near/mid/far) from the best covering products; for CY-3 apply the dedicated ladder (finest source within ±10 km, ±80 km mid, 240 m far, rays to 250 km fully inside the 60–90°S product). Records achieved near-field resolution and source.

**`lumen_pipeline/terrain/horizon.py`** — Numba-parallel raycaster. For each azimuth bin: march outward along the surface from the observer (site position + height, from Gowri's `frames.site_position_km`), step size growing geometrically from half the near-field pixel; at each step take the terrain point's 3-D position in MOON_ME and compute elevation angle in the **site frame from `frames.site_rotation_matrix`** (exact, includes curvature); keep the maximum and its distance. Inputs: crops, site, height list, bin width, range. Outputs: elevation and distance arrays per height.

**`lumen_pipeline/terrain/masks.py`** — runs the raycaster for each Tier-A site in `sites.yaml` and writes `terrain/masks/<site_id>.bin` (Float32 elevation per bin per height, Float32 distance per bin) + `<site_id>.json` (bin width, heights, range, near-field resolution, source).

**`lumen_pipeline/terrain/pad.py`** — ground-normal plane fit over the footprint baseline at the site; slope θ; **downhill_aspect** in the site frame; uphill_az = (downhill_aspect + 180°) mod 360°; dispersion-radius slope statistics (P50/P95/max, % below tolerance) from the slope raster/DEM; "under-resolved" flag when near-field resolution is coarser than the footprint. Writes `terrain/pad/<site_id>.json`. Test in `tests/terrain/test_pad.py` with a synthetic tilted plane (known slope and aspect).

**`lumen_pipeline/terrain/dispersion.py`** — 11×11 nodes at 50 m around each Tier-A site: 0.5° mask at 1 m + slope/aspect per node. Writes `terrain/dispersion/<site_id>.bin` + `.json` (node offsets, order).

**`lumen_pipeline/terrain/tierb.py`** — batch over 80–90°S grid nodes (2 km inside 85°S, 4 km 80–85°S), 0.5° bins, 1 m height, UInt8 quantised; groups nodes into ~20 km tiles; resumable (skips finished tiles) so it can run unattended; writes `terrain/tierb/tiles/<tile_id>.bin` and `tierb/index.json` (tile id, bounds, node spacing, node count, node lat/lon list or grid rule, scale/offset). Run order: 84–90°S first.

**`lumen_pipeline/terrain/mc_sigma.py`** — for Tier-A centre points: 20–30 DEM clones with spatially correlated noise scaled by the `_ERR` raster (or PGDA-provided clones where available); recompute mask per clone; per-bin standard deviation → `terrain/sigma/<site_id>.bin`.

**`lumen_pipeline/terrain/psr.py`** — PSR mask = pixels with 0% average illumination in the PGDA illumination map (labelled "derived"); Euclidean distance transform → `terrain/psr/psr_distance.bin` + `.json` (projection, resolution, units km); per-site distance and bearing to nearest PSR added to the site summary.

**`lumen_pipeline/terrain/layers.py`** — renders map layers into PNG in one polar-stereographic projection at two extents (80–90°S, 85–90°S): Average Illumination, Earth Visibility, Slope Hazard (classes <5/5–10/10–15/>15°), PSR (derived), Distance-to-PSR (Tier 1). Colour-blind-safe ramps. `layers.json`: per layer file name, extent, projection parameters (so Nived can place pins), legend stops, source citation.

**`lumen_pipeline/terrain/regions.py`** — USGS Artemis region shapefiles → simplified SVG paths in the same projection as the layers + `regions.json` (region id, name, centroid lat/lon).

**`lumen_pipeline/terrain/summaries.py`** — after any terrain run, writes `terrain/summaries/<site_id>.json`: tier, near-field resolution, DEM source, files present (mask, sigma, pad, dispersion), pad headline values, PSR distance + bearing, run timestamp. Also updates `terrain/manifest.json` (list of all terrain outputs + versions). Gowri's catalog step reads these.

**`tests/terrain/`** — synthetic horizon (**G0**), pad plane test, Tier-B tile round-trip (write → read → same values within quantisation), layers projection test (a known lat/lon lands on the expected pixel).

### Don'ts
Don't write `sites.json` or edit `sites.yaml` (request changes from Gowri); don't create your own site-frame or azimuth math (use `frames.py`); don't download whole fine mosaics; never write outside `public/data/terrain/`.

---

# 5. FRONTEND

## Frontend integration model (all three read)
- **Data flow:** files in `public/data/` → **Nived's loaders** → **Nived's Web Worker engine** → **Nived's hooks** (`useCatalog`, `useResult`, `useCompareResults`, `useQuickAnswer`, `useLayers`) → components.
- **State flow:** user input → **Abhinav's store actions** (`useScenario` + actions such as set site, set landing time, set slip, set tilt, set definitions) → Nived's engine recomputes → hooks update.
- **Hover/scrub:** **Abhinav's `useCrosshair`** (`t_hover`, `t_scrub`, setters) — Ebin's charts read and write it.
- **Copy & persona:** **Abhinav's `useCopy(key)` and `usePersona()`** — every visible label in Ebin's and Nived's components comes from here, so persona switching works everywhere.
- **Mock → real switch:** Nived's loader reads from `data-mock/` or `data/` by one environment setting; no component changes.
- **Exact names and signatures** of hooks/actions are in `contracts/frontend_engine_api.md` (Nived) and `contracts/frontend_state_api.md` (Abhinav), frozen at H2.

## 5.1 Abhinav — App shell, navigation, state, UI kit, sidebar, guidance

### Your mission
Build the frame everything lives in: the Mission Bar, the three views and their zero-scroll bento grids, global state and shareable URLs, the component kit, the Site Explorer sidebar, guidance (tooltips, Quick-Start, coachmarks), the Quick Answer card, the Compare left column and the Methodology view. You also lead the submission package.

### You depend on
| From | What | When | If late |
|---|---|---|---|
| Ebin, Nived | Component/hook stubs with final names | H1:30 | Wait to wire that slot; continue elsewhere |
| Nived | Mock data + mock hooks | H3 | Hard-coded placeholder text in your own files only |
| Gowri | `glossary.json` | H10 | Tooltip shows key name |
| Gowri | `validation/report.json` + charts | H28 | Methodology shows "pending" per gate |
| Ebin | `Sparkline` component | H8 | Cards render without sparkline |
| Nived | `Basemap` component | H10 | Sidebar shows map placeholder |

### You provide
Repo scaffold (H0:30) · `frontend_state_api.md` + `frontend_content.md` (H2) · UI kit basics (H3) · shell + bento + Mission Bar (H6) · store/URL/crosshair (H7) · sidebar (H10) · Definitions Bar (H11) · Quick Answer card (H12) · Compare left column (H14) · Quick-Start 1–2 + tooltips (H16) · Methodology view (H28).

### Order of work
| Step | Hours | Task | Done when |
|---|---|---|---|
| A-1 | H0–H0:30 | Repo root (README, CODEOWNERS, .gitignore), `web/` skeleton with **all** dependencies, Prettier/ESLint config, deploy pipeline (Vercel/Netlify) | Others clone at H0:30; deploy URL live |
| A-2 | H0:30–H2 | `contracts/frontend_state_api.md`, `contracts/frontend_content.md` | Pushed at H2 |
| A-3 | H1–H3 | `ui/` tokens + kit basics (Panel, Card, Chip, Badge, InfoBadge, Segmented, Slider, Toast) | Ebin & Nived notified at H3 |
| A-4 | H2–H6 | `app/` shell: Mission Bar (all elements, wired to store), view routing, **Cockpit bento** and **Compare bento** grids importing stubs, responsive rules (1920×960, 1280×720 presenter density) | All stubs visible in correct cells, no page scroll |
| A-5 | H4–H7 | `state/` scenario store + actions, crosshair store, URL sync (encode/decode full scenario), toast on share | Reload with URL restores state |
| A-6 | H6–H8 | CP1 integration: mock → real IM-2 path visible; check bento fits 1920×960 & 1280×720 | **CP1** |
| A-7 | H7–H10 | `features/sidebar/`: search (names + "lat, lon"), filter chips, site cards (uses Ebin's Sparkline), embeds Nived's Basemap, layer toggles UI | Selecting a site updates everything |
| A-8 | H10–H11 | `features/definitions/` Definitions Bar + edit popover | Edits recompute results |
| A-9 | H11–H12 | `features/quickAnswer/` card UI (inputs, output layout, copy/export/open buttons calling Nived's functions) | Q key opens it |
| A-10 | H12–H14 | `features/scenarios/`: Compare rows A–D, baseline, Mission Profile form | Compare view usable |
| A-11 | H14–H16 | `features/guidance/`: InfoBadge tooltip using glossary, Quick-Start drawer with scenarios 1–2 (`quickstart.json`), first-load behaviour | **CP2** |
| A-12 | H22–H26 | Coachmark tour engine; Quick-Start 3–4; persona copy (`content/`) for Educator mode | Tours run end-to-end |
| A-13 | H24–H28 | `features/methodology/` view (renders `report.json`, charts, scope statement, limitations, sources, AI disclosure) | Displays real report at H28 |
| A-14 | H28–H30 | Keyboard shortcuts, focus rings, ARIA, empty/loading/error states for your panels; `e2e/` smoke test (load, share URL, switch views) | **CP3** |
| A-15 | H30–H38 | Bug bash lead, projector test, incognito test, deploy freeze | URL frozen H38 |
| A-16 | H36–H46 | Lead video + 7 slides + project page; collect everyone's citations and AI logs; submit | Submitted |

### Your files and what goes in them
- **`web/package.json` etc.** — all dependencies from §2.4; scripts for dev, build, test, e2e.
- **`src/App.tsx`, `src/main.tsx`** — mounts the shell, theme, store provider, initial URL decode.
- **`src/app/MissionBar.tsx`** — logo + site + tier badge, view tabs (keys 1/2/3), landing date/time UTC picker, duration segmented (7/14/30/60 d), jump buttons (S/E/X/T; call Nived's `jumpTo(eventType)` and set `t_scrub`), Quick Answer button, verdict chip (from Nived's result), persona switch, Share URL + toast, Quick-Start + Help.
- **`src/app/views/CockpitView.tsx`** — the 3-column bento of PLAN_FINAL §8.3 with fixed slot sizes; imports: `Sidebar` (yours), `AnswerStrip` + `MetricDeck` (Nived), `DefinitionsBar` (yours), `Ribbon` (Ebin), `AnalysisPanel` (Ebin), `Barcode` + `SlipBar` (Ebin), `TouchdownPad` (Ebin), Profile & Battery accordion (yours, inside `features/scenarios/`).
- **`src/app/views/CompareView.tsx`** — bento of §8.6: left `ScenarioRows` + `MissionProfileForm` (yours), centre toggle [Aligned Barcodes | Season Strip | 12-Month Calendar] (Ebin's components) + global slip, right `ScanPanel` + `DeltaTable` (Nived) + Windows Table for selected row (Ebin).
- **`src/app/views/MethodologyView.tsx`** — page container for `features/methodology/`.
- **`src/app/layout/`** — bento grid primitives and responsive rules.
- **`src/state/scenarioStore.ts`** — scenario fields exactly as PLAN_FINAL §6 "Scenario (URL)": view, persona, site id or lat/lon, landing UTC, duration, scrub time, height, panel preset, yaw, off-nominal tilt, definitions, profile thresholds, weights, compare rows, active layers, active centre tab; plus actions (setters) listed in your contract.
- **`src/state/crosshairStore.ts`** — `t_hover`, `t_scrub`, setters, clear.
- **`src/state/urlSync.ts`** — compact encode/decode of the scenario into the URL; versioned; ignores unknown fields.
- **`src/state/copy.ts`, `src/content/`** — `useCopy(key)` and `usePersona()`; Planner and Educator strings for every label key used by all components (keys listed in `frontend_content.md`).
- **`src/ui/`** — tokens (colours incl. Sun amber / Earth blue / teal / grey hatch / blue dots, type scale with monospace numerals, spacing), and the kit: Panel, Card, Chip, Badge, InfoBadge (`?`), Tooltip, Coachmark, Toast, Segmented, Slider, Dial, Table shell, ± value display, Tabs, Accordion, Modal.
- **`features/sidebar/`** — Search, FilterChips (`All`, `Artemis III`, `Historical Landings`, `Published Targets`, `Contrast Sites`, `Custom`; agency sub-filter), SiteCard (name, category, agency, tier, lat/lon, sparklines, verdict dot, "+ Compare", "as published"/landing date), LayerToggles, deep-link buttons (Tier 1).
- **`features/definitions/`** — DefinitionsBar (one-line rules) + popover editor (Sun disk threshold, height, Earth margin, DTE disk threshold, DSN mode + mask).
- **`features/quickAnswer/`** — QuickAnswerCard: inputs (lat, lon, UTC, duration, height), output layout, buttons Copy as text / Export CSV / Open in Cockpit (calls Nived's `quickAnswer`, `exportCsv`).
- **`features/scenarios/`** — ScenarioRows (A–D, baseline ★, colour), MissionProfileForm, ProfileBatteryAccordion (Cockpit right column).
- **`features/guidance/`** — QuickStartDrawer (reads `quickstart.json`), CoachmarkTour, InfoBadge glossary binding, ShortcutSheet.
- **`features/methodology/`** — sections: pipeline diagram (static SVG), data sources, conventions, gate table from `report.json` with charts, uncertainty method, scope statement, limitations, AI disclosure, citations.
- **`public/content/quickstart.json`** — the four scenarios of PLAN_FINAL §8.9: id, title, persona, full scenario state, coachmark steps (target slot id, text). Every tour starts on the Ribbon and Answer Strip.
- **`e2e/`** — smoke tests: app loads offline, share URL round-trip, all three views render, no page scroll at 1920×960.
- **Docs:** `docs/ui_guide.md` (layout, slot ids, keyboard map), `docs/credits_frontend.md`.

### Don'ts
Don't compute physics or parse data files (ask Nived for a hook); don't style inside Ebin's/Nived's components (they use your kit and tokens); don't edit `features/` folders you don't own.

---

## 5.2 Ebin — Charts and visual widgets

### Your mission
Build every chart and visual instrument: the SKYLINE Ribbon (hero), Horizon Dome, Earth Twin overlay, Power & Elevation curve, Windows Table, Pointing & Link tab, Survival Barcode, Slip Bar, Touchdown Pad widget, Compare visuals and the Sparkline.

### You depend on
| From | What | When | If late |
|---|---|---|---|
| Abhinav | UI kit + tokens | H3 | Plain elements with temporary local styles inside your folders |
| Abhinav | `useScenario`, actions, `useCrosshair`, `useCopy` | H2 (stubs), H7 (real) | Use the stubs; behaviour arrives later |
| Nived | Mock data + `useResult` / `useCatalog` mock | H3 | Build against fixed fake arrays inside your component file until H3 |
| Nived | Real results | H8 | Keep mocks |
| Nived | Export functions | H12 | Hide export button |

### You provide
Stubs (H1:30) · Ribbon + Barcode on mocks (H8) · Power curve (H10) · Windows Table (H12) · Pointing & Link (H13) · Touchdown Pad widget (H15) · Compare visuals + Sparkline (H16) · Tier 1: Dome, Earth Twin overlay, 12-month calendar, dispersion histogram, SOC overlay (H30).

### Order of work
| Step | Hours | Task | Done when |
|---|---|---|---|
| E-1 | H0:45–H1:30 | Push stubs with final names (list below); decide on three.js plain vs react-three-fiber and tell Abhinav | Abhinav can import |
| E-2 | H1:30–H2 | Read `frontend_engine_api.md` & `frontend_state_api.md` drafts; ask for anything missing before freeze | Contracts cover your needs |
| E-3 | H2–H7 | **Ribbon (panorama):** terrain silhouette with ±σ band, Sun track coloured by time, Earth libration loop, current Sun/Earth disks, scrub bar + play/speed, Earth-referenced azimuth axis labels | Renders mock + real IM-2 |
| E-4 | H5–H8 | **Barcode** (days since landing, 4 states with patterns) + **SlipBar** (◀ −1 d, ±30 d slider, +1 d ▶, reset, "slipped +N d" chip → store action) | **CP1** with crosshair |
| E-5 | H7–H8 | Crosshair: read/write `t_hover`, `t_scrub` in Ribbon and Barcode; ghost Sun/Earth markers; inverse lookup from track hover to time | Hover on barcode moves ghost Sun on Ribbon |
| E-6 | H8–H10 | **AnalysisPanel** tab container + **PowerCurve** (power W, Sun/Earth clearance with ±σ shading, crosshair) | Synced with others |
| E-7 | H10–H12 | **WindowsTable** (type icon, start ±, end ±, duration [lo–hi], peak el, flags; sort/filter; row hover highlights interval everywhere; click jumps; Export CSV/JSON via Nived) | G11 check passes with Nived |
| E-8 | H12–H13 | **PointingLink** tab (Earth az/el/range/light time/disk/margin; Sun az/el; DSN lanes Goldstone/Canberra/Madrid + combined link lane) | Shows real DSN |
| E-9 | H8 | **Sparkline** component (for Abhinav's site cards) | Abhinav notified |
| E-10 | H13–H15 | **TouchdownPad** widget: slope/aspect compass (downhill arrow, uphill, Sun/Earth azimuth ticks), slope-plane occluder badge, panel preset segmented, mast height 1/2/5/10 m, yaw, off-nominal tilt magnitude + direction, per-panel power bars vs flat baseline, pad risk flag; all controls call store actions | Dragging tilt updates Ribbon/Answer/Barcode live |
| E-11 | H14–H16 | **Compare visuals:** AlignedBarcodes (≤4 rows, shared crosshair), SeasonStrip (12 months sunlit/link per site from sparklines), 60-day calendar (MVP version) | **CP2** |
| E-12 | H22–H26 | Tier 1: **Dome** (three.js ring extruded from the mask + sky hemisphere + Sun/Earth; toggle in Ribbon header), **Earth Twin** overlay (dashed terrestrial Sun path + contrast strip, Educator only) | Toggle works |
| E-13 | H26–H30 | Tier 1: 12-month calendar (progress state while Nived computes), dispersion histogram in Touchdown Pad, SOC overlay on PowerCurve | **CP3** |
| E-14 | H30–H38 | Visual polish, colour-blind check, ARIA text summaries for each chart, 1280×720 check | Freeze |
| E-15 | H36–H42 | Screen-record demo clips for the video (with Abhinav) | — |

### Your files (stub names are final) and what goes in them
- **`features/ribbon/Ribbon.tsx`** — panel with header toggle [Panorama | Dome]; uses `RibbonPanorama` or `RibbonDome`.
- **`features/ribbon/RibbonPanorama.tsx`** — D3/SVG (or Canvas) unrolled 360° view: x = azimuth (Earth-referenced for polar sites), y = elevation (auto-scaled to about −2°…+10° at the pole); terrain silhouette from `useResult().mask` with ±σ band; Sun track and Earth loop over the window (solid visible, dashed blocked); current disks at `t_scrub`; ghost disks at `t_hover`; slope-plane occluder overlay when active; scrub bar + play.
- **`features/ribbon/RibbonDome.tsx`** — three.js scene (Tier 1).
- **`features/ribbon/EarthTwinOverlay.tsx`** — dashed terrestrial Sun path from `useResult().earthTwin` + contrast strip (Educator persona only).
- **`features/analysis/AnalysisPanel.tsx`** — tabs [Power & Elevation | Windows Table | Pointing & Link]; active tab stored in scenario (Abhinav's action).
- **`features/analysis/PowerCurve.tsx`**, **`WindowsTable.tsx`**, **`PointingLink.tsx`** — as in steps E-6 to E-8; data from `useResult()` (`series`, `windows`, `pointing`, `dsnLanes`).
- **`features/barcode/Barcode.tsx`**, **`features/barcode/SlipBar.tsx`** — as in E-4.
- **`features/touchdown/TouchdownPad.tsx`** (+ `SlopeCompass.tsx`, `PanelPowerBars.tsx`, `DispersionHistogram.tsx`) — as in E-10/E-13; data from `useResult().pad`, `useResult().power`.
- **`features/compareVisuals/AlignedBarcodes.tsx`**, **`SeasonStrip.tsx`**, **`FeasibilityCalendar.tsx`** — data from `useCompareResults()`.
- **`features/sparkline/Sparkline.tsx`** — tiny line/area chart; props: values, highlight range.
- **`docs/visuals.md`** — colour/pattern encoding, axis conventions, chart interaction rules.

### Rules for your charts
All labels via `useCopy`; all colours via tokens; every chart has a text summary for screen readers; hover handlers throttled to animation frames (<4 ms); no data fetching or physics inside components — only what hooks return.

### Don'ts
Don't compute visibility, events or power (that's Nived's engine); don't edit layout files (ask Abhinav to resize a slot); don't add npm packages yourself.

---

## 5.3 Nived — Engine, data layer, results panels, map, offline

### Your mission
Make the numbers in the browser: load all backend data, run every calculation in a Web Worker exactly like Gowri's Python reference, expose results through hooks, and own the panels that are pure readouts of those results (Answer Strip, Metric Deck, Delta Table, Scan) plus the Basemap and offline caching.

### You depend on
| From | What | When | If late |
|---|---|---|---|
| Gowri, Shiva Shakthi | Data contracts | H2 | Draft mocks from PLAN_FINAL §6, adjust at H2 |
| Gowri | `ephem.bin` | H4 | Mock ephemeris (synthetic circular Sun path) |
| Shiva Shakthi | IM-2 mask | H5 | Flat mask |
| Gowri | Golden set 1 / set 2 | H7:30 / H12 | Parity tests skipped (never shipped untested at CP2) |
| Gowri | `dsn.bin`, `sites.json`, `sparklines.bin` | H8 / H3–H14 / H14 | Mocks |
| Shiva Shakthi | Layers, regions, Tier-B, σ, PSR | H12 / H22–H28 / H26 | Placeholders, default σ |
| Abhinav | Store + actions + kit | H2 stubs / H3 kit / H7 real | Stubs |

### You provide
`frontend_engine_api.md` (H2) · hook stubs (H1:30) · full mock dataset (H3) · real ephemeris + mask path (H8) · windows + uncertainty (H11) · power/pad/pointing (H13) · verdict + scan + export + Quick Answer (H16) · Basemap (H10–H12) · Tier 1: Tier-B, MC σ, Earth Twin, calendar compute, PWA (H30).

### Order of work
| Step | Hours | Task | Done when |
|---|---|---|---|
| N-1 | H0:45–H1:30 | Push stubs: hooks (`useCatalog`, `useResult`, `useCompareResults`, `useQuickAnswer`, `useLayers`) returning empty typed objects; components `AnswerStrip`, `MetricDeck`, `Basemap`, `DeltaTable`, `ScanPanel` | Abhinav can import |
| N-2 | H0:30–H2 | `contracts/frontend_engine_api.md`: every hook's returned fields (names, units, arrays), every callable function (`jumpTo`, `quickAnswer`, `exportCsv`, `exportJson`, `runScan`) | Frozen H2 |
| N-3 | H2–H3 | `public/data-mock/` — full fake dataset matching every data contract; mock/real switch | Ebin & Abhinav notified H3 |
| N-4 | H2–H5 | `engine/data/` loaders (ephem, dsn, catalog, masks, sigma, pad, dispersion, tierb, sparklines, layers, regions, golden) with validation of header `version` | Loads mocks and real ephem |
| N-5 | H3–H8 | `engine/worker.ts` + `engine/core/`: Hermite interpolation, topocentric directions, site rotation (from `sites.json` matrix), mask interpolation, slope-plane rule, chord disk fraction, adaptive stepping, event bisection; parity test vs golden set 1 (**G4**) | **CP1** parity pass |
| N-6 | H8–H11 | `engine/core/windows.ts`, `uncertainty.ts`; `AnswerStrip` (live) | ± shown on countdowns |
| N-7 | H9–H12 | `features/map/Basemap` (PNG layers, projection from `layers.json`, pins from `sites.json`, region SVG, click/shift-click/hover readout → store actions) | Abhinav embeds it |
| N-8 | H11–H13 | `engine/core/power.ts` (attitude, presets, per-panel, baseline), `pointing.ts` (Earth az/el/range/light time, DSN lanes, link logic); parity vs golden set 2 | Parity pass |
| N-9 | H12–H13 | `engine/export/` CSV/JSON with header block (site, tier, σ source, definitions, data versions); G11 with Ebin | Round-trip passes |
| N-10 | H13–H16 | `engine/core/metrics.ts` + verdict; `MetricDeck` (Sun elevation hero tile + 2×4 tiles with ± and InfoBadges); `engine/compare/` scan + delta; `DeltaTable`, `ScanPanel`; `quickAnswer`; `jumpTo` | **CP2** |
| N-11 | H22–H26 | Tier-B tile loading + snap-to-node (snap distance in result); MC σ and calibrated σ use; Earth Twin solar-position function | Custom click works |
| N-12 | H24–H28 | 12-month calendar computation in background with progress; `pwa.config.ts` offline caching of all data; PSR distance in metrics | Airplane-mode test passes |
| N-13 | H26–H30 | Performance pass (**G8** budgets); `ci-frontend.yml` runs parity tests | **CP3** |
| N-14 | H30–H38 | Bug fixes; `docs/frontend_architecture.md` | Freeze |

### Your files and what goes in them
- **`src/engine/data/*.ts`** — one loader per data type; each reads header JSON then binary; checks `version`; returns typed arrays; caches in memory.
- **`src/engine/core/interp.ts`, `geometry.ts`, `visibility.ts`, `events.ts`, `windows.ts`, `uncertainty.ts`, `power.ts`, `pointing.ts`, `metrics.ts`, `earthTwin.ts`** — the TS twins of Gowri's `reference/*.py`; same function names where possible; same constants (copied from `constants.py` into `engine/core/constants.ts`, with a parity test).
- **`src/engine/compare/scan.ts`, `delta.ts`, `calendar.ts`** — scan ±N days / filtered sites ranked by Viability Index with bounds; deltas vs baseline; calendar cells GO/MARGINAL/NO-GO.
- **`src/engine/quickAnswer.ts`** — single-point answer from lat/lon/UTC/duration/height (Tier A if a curated site matches, else Tier B snap, else Tier C).
- **`src/engine/export/csv.ts`, `json.ts`** — Windows and metrics export with header block.
- **`src/engine/worker.ts`** — worker entry; receives scenario, returns results; debounced; cancels stale jobs.
- **`src/engine/hooks.ts`** — `useCatalog`, `useResult`, `useCompareResults`, `useQuickAnswer`, `useLayers`, `jumpTo` (exact fields per your contract).
- **`src/engine/__tests__/`** — golden parity tests (G4), export round-trip (G11), constants parity.
- **`features/answer/AnswerStrip.tsx`** — Sun now (el, disk, UP/DOWN), Earth now (el, link), Sunset in ±/grazing, Earthset in ±, window sunlit % [lo–hi], link % [lo–hi].
- **`features/metrics/MetricDeck.tsx`** — Sun elevation hero tile + tiles (clearance/disk, Earth el/margin, sunlit %, link %, longest night, comm gap, ops hours, PSR distance), each with ± and InfoBadge.
- **`features/map/Basemap.tsx`** — layers, pins, regions, opacity, legend, value-at-cursor, two extents.
- **`features/compareResults/DeltaTable.tsx`, `ScanPanel.tsx`**.
- **`public/data-mock/`**, **`pwa.config.ts`**, **`.github/workflows/ci-frontend.yml`**, **`docs/frontend_architecture.md`**.

### Don'ts
Don't change formulas without Gowri changing the Python twin first (parity must stay green); don't edit layout/store files; don't fetch anything from the network at runtime except `public/` files.

---

## 6. Integration checklists per checkpoint

**CP0 (H2):** contracts merged · stubs merged · backend scaffold + G1 run · deploy URL live.
**CP1 (H8):** `ephem.bin` + IM-2 mask real · engine parity set 1 green · Ribbon + Barcode + Answer Strip on real data in the bento · crosshair synced · bento fits 1920×960 and 1280×720.
**CP2 (H16):** every MVP item of PLAN_FINAL §9 · parity set 2 green · `sites.json` + sparklines final MVP · Quick-Start 1–2 · backup video recorded (Abhinav + Ebin).
**CP3 (H30):** Tier 1 done or cut by the PLAN_FINAL cut order · G5–G11 results in `report.json` · offline test passes.

## 7. When something blocks you
1. Check the "If late" column in your section and use the fallback.
2. Post in `#lumen-changes`: what you need, from whom, which file, by when.
3. Never fix it in someone else's file. If the owner is asleep, write your workaround **in your own file** and remove it when the real piece lands.
