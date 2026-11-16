# FRONTEND_BUILD_GUIDE.md — LUMEN `web/`
### Frontend execution & skill-orchestration plan · companion to PLAN_FINAL.md (R2) + PLAN_FINAL_R3_DELTA.md + WORK_DISTRIBUTION.md · NO APPLICATION CODE IN THIS DOCUMENT

**Owners (from WORK_DISTRIBUTION.md):** Abhinav = shell, layout, state, UI kit, sidebar shell, definitions, guidance, Quick Answer UI, scenarios, methodology · Ebin = Ribbon, analysis charts, barcode/slip, touchdown widget, compare visuals, sparkline · Nived = engine, loaders, mocks, Answer Strip, Metric Deck, Basemap, compare results, offline.

**Skill availability note:** `impeccable` and `emil-kowalski` were not found in the build session. Their rules are written out in §1 so the build never depends on the skill files. If a session has them installed, load them per the matrix; otherwise apply §1 directly (visual craft decisions may additionally use the available `frontend-design` skill).

---

## 0. Three conflicts found while planning (resolved here)

| # | Requirement | Conflict | Resolution |
|---|---|---|---|
| C-1 | True-scale Sun (0.53°) and Earth (1.9°) disks on the 360° Ribbon | At ~960 px for 360°, the Sun is **~1.4 px** and Earth **~5 px**, and the panorama's vertical axis (≈ −2°…+10° over ~300 px ≈ 25 px/°) is ~9× stretched vs horizontal, so circles can't be true-scale there | Ribbon gets two linked views: **Panorama** (full 360°, labelled vertical exaggeration "V ×9.4", body markers with a minimum symbol size and a "not to scale" tag) and a **Horizon Lens** (equal angular scale, ~12° × 6° window following the selected body at ~40 px/°): Sun ≈ 21 px, Earth ≈ 76 px, ratio 3.6:1, **true-scale and clipped by the ridge silhouette** |
| C-2 | Chandrayaan-3 dual pins on the South Pole Basemap | CY-3 is at 69.37°S, **~625 km from the pole, outside both basemap extents (80–90°S, 85–90°S)**. Even inside an extent, the ~350 m landing–target separation would be < 1 px at 320 px | Off-map **edge indicator** on the basemap ("CY-3 → 69.4°S, 32.3°E · 625 km") + a **Site Inset** (local map ~2 km wide from the CY-3 dedicated crop) that shows Landing and Target pins with a 100 m scale bar. The same inset pattern serves any site whose detail can't show at basemap scale |
| C-3 | Mock data location `src/mocks/` | WORK_DISTRIBUTION puts mock **files** in `public/data-mock/` (Nived) | Both, owned by Nived: `public/data-mock/` = contract-shaped data files read by the real loaders; `src/mocks/` = mock engine (scenario generator, forced states, Scan streaming simulator). CODEOWNERS gains `web/src/mocks/ → Nived` |

**Backend asks created by this guide (Shiva Shakthi, P11):** `layers/basemap_hillshade.png` (both extents, same projection as data layers) and `layers/insets/<site_id>_hillshade.png` (Tier-A sites, ~2 km, incl. CY-3). Until they land, the procedural fallback (§3.1) is shown.

---

## 1. Skill Orchestration Matrix

### 1.1 What each skill governs
| | `impeccable` — visual craft | `emil-kowalski` — motion & tactility |
|---|---|---|
| Owns | Tokens (colour, type, spacing, radii, elevation), surface hierarchy, panel chrome, density, optical alignment of numerals and ± values, iconography, colour-blind encodings, **viewport budgets**, chart styling, map styling, card imagery | Motion tokens (durations, easings), enter/exit choreography for popover / drawer / modal / toast / coachmark, segmented & tab indicator slides, accordion, press feedback, FLIP reorder for low-frequency list updates, swipe-to-dismiss |
| Never owns | Any animation | Any element on the Fast Lane (§1.3); any layout change; any colour/typography decision |

### 1.2 Global rules
**impeccable constraints (performance-safe craft)**
- No `backdrop-filter` / blur on any panel that sits over or next to a canvas redrawn per frame.
- No large or layered `box-shadow` on frequently repainted layers; elevation via surface colour + 1 px hairline.
- No animated gradients, no glow filters on data marks; glow only as a static pre-rendered sprite if needed.
- All numerals `tabular-nums` + monospace family so live values never jitter; ± and units on a fixed baseline grid.
- Fonts preloaded, `font-display: swap`, metrics-matched fallback to avoid layout shift.
- Every visual choice must fit the slot budgets in §4 at all four test viewports.

**emil-kowalski constraints (no lag on data)**
- Animate **only** `transform` and `opacity`. Never width/height/top/left, never layout.
- Durations: fast 120 ms · base 180 ms · drawer 260 ms · exit always ≤ enter. No overshoot/bounce (mission console): critically-damped feel, ease-out curves (e.g., a strong ease-out for popovers, a drawer-style curve for the Quick-Start drawer).
- Every animation interruptible; re-opening mid-exit reverses from the current state.
- `prefers-reduced-motion`: all motion collapses to ≤ 80 ms opacity or none.
- Motion never changes a slot's size → can never introduce page scroll.

### 1.3 The Fast Lane (both skills restricted)
Elements tagged **`data-hotpath`**. Rules (enforced by checks in §5):
1. **No CSS transitions or animations** (computed `transition-duration` must be `0s`).
2. **No React state updates at pointer/drag rate.** Hover and drag values go into a vanilla external store (`crosshairBus`, `slipBus`) read by subscribers that draw **imperatively** (Canvas draw or direct attribute/`textContent` writes via refs).
3. **One shared rAF loop ("frame bus")**: pointer events only record the latest value; drawing happens once per frame; coalesced events.
4. **Static vs overlay layers:** every chart has a static layer (terrain, tracks, bars) redrawn only on data change, and an overlay layer (crosshair line, ghost disks, highlight band, readout chip) redrawn per frame.
5. **Slip drag never waits on the worker:** barcode/power/ribbon tracks for a new landing date are a different window into the **cached yearly series** → redraw immediately; metrics/Answer Strip refresh when the worker answers (latest-wins, stale jobs cancelled).
6. React commits during hover: **zero** outside the readout chip (which itself updates via ref).

### 1.4 Matrix by component group
| Component group | Owner | `impeccable` | `emil-kowalski` | Fast Lane |
|---|---|---|---|---|
| Tokens, type scale, surfaces, icons | Abhinav | **ON** (defines) | Motion tokens only | — |
| App root, bento grids, slot budgets, presenter density | Abhinav | **ON** (strict budgets) | **OFF** (no layout motion) | — |
| Mission Bar (tabs, date/duration, jumps, verdict, persona, share) | Abhinav | ON | ON: tab indicator slide, persona segmented thumb, press feedback, verdict chip 120 ms crossfade on change | Jump buttons: instant scrub (no tween of `t_scrub`) |
| View switching (Cockpit ↔ Compare ↔ Methodology) | Abhinav | ON | ON: ≤ 150 ms opacity crossfade, no slide | — |
| Site Explorer cards, search, chips | Abhinav | ON | ON: chip toggle, card press; **OFF** for list scroll | Card hover → pin pulse is CSS opacity only |
| Sparkline | Ebin | ON | **OFF** | Static |
| **South Pole Basemap** (layers, pins, regions, inset) | Nived | **ON** (cartographic styling) | Layer toggle opacity 120 ms; inset open 180 ms | **Hover readout & pin hover: Fast Lane** |
| **SKYLINE Ribbon** (Panorama + Lens + Dome later) | Ebin | **ON** (silhouette, σ band, disks, axes) | **OFF** (except Panorama/Lens/Dome toggle crossfade) | **Scrub, hover, play, ghost disks: Fast Lane** |
| Play/scrub transport | Ebin | ON | Button press only | Playback = linear time advance per frame, no easing |
| Power & Elevation curve | Ebin | ON | **OFF** | **Fast Lane** |
| Windows Table | Ebin | ON | **OFF** (row highlight instant) | Row hover → crosshair bus |
| Pointing & Link + DSN lanes | Ebin | ON | **OFF** | Fast Lane |
| **Survival Barcode + Slip Bar** | Ebin | ON | **OFF** (slider thumb native, no spring) | **Fast Lane** (G8 < 16 ms) |
| Touchdown Pad widget | Ebin | ON | Segmented (panel preset, mast height) thumb slide; **OFF** for sliders/dial drag | Tilt/yaw drag → slipBus-style transient bus |
| Answer Strip | Nived | ON (hero numerals) | State change: 120 ms opacity swap of the label only; **never animate the number** | Values update via ref while scrubbing |
| Metric Deck | Nived | ON | **OFF** (no count-up) | Ref updates |
| Definitions Bar + ✎ popover + ISRO preset | Abhinav | ON | **ON**: popover enter/exit, origin-aware scale 0.96→1 | — |
| Compare rows, Mission Profile form | Abhinav | ON | Row add/remove 160 ms; accordion | — |
| Aligned Barcodes, Season Strip, Calendar | Ebin | ON | **OFF** | Fast Lane (shared crosshair) |
| Scan Panel (two-stage) + Delta Table | Nived | ON | **ON only for stage-2 arrival**: 150 ms FLIP reorder, badge swap "provisional → bounded"; OFF during stage 1 | — |
| Quick Answer modal | Abhinav | ON | **ON**: modal enter/exit, focus-trap transitions | — |
| Quick-Start drawer + cards + thumbnails | Abhinav | **ON** (imagery, credits) | **ON**: drawer, card stagger ≤ 40 ms/card | — |
| Coachmark tours | Abhinav | ON | **ON**: spotlight move 220 ms | Tour pauses Fast Lane listeners? **No** — tour overlays are pointer-transparent except buttons |
| Tooltips / InfoBadge | Abhinav | ON | 100 ms fade, 300 ms open delay, 0 ms when moving between badges | — |
| Toasts (Share URL, export) | Abhinav | ON | **ON**: slide+fade, swipe dismiss | — |
| Methodology view | Abhinav | ON (reading typography) | Section reveal OFF (reading view) | — |
| 3D Horizon Dome (Tier 1) | Ebin | ON | Camera damping allowed **only** on orbit drag (user-driven), never on time scrub | Time scrub: Fast Lane |

---

## 2. Architecture decisions that make the matrix enforceable
| Decision | Detail | Owner |
|---|---|---|
| Two state tiers | **Committed state** (Zustand scenario store: site, dates, definitions, rows, persona…) changes at human speed and may re-render React. **Transient state** (`crosshairBus`, `slipBus`, `padDragBus`) is a vanilla subscribe/notify store with no React binding | Abhinav (stores), all subscribe |
| Frame bus | Single rAF scheduler; subscribers register draw callbacks; pointer handlers only write latest values | Abhinav (bus), Ebin/Nived (subscribers) |
| Layered canvases | Each chart = static canvas + overlay canvas (or SVG static + overlay via refs); DPR-aware sizing set once per resize | Ebin, Nived |
| Cached series | Engine returns, per scenario, the full-window series + a yearly nominal series per site; slip/scrub index into them | Nived |
| Worker latest-wins | Each job tagged; stale results dropped; results applied in one batch per frame | Nived |
| Answer state function | Pure engine function → `{stateId, payload}`; UI maps `stateId` to copy keys (Planner/Educator) | Nived (function), Abhinav (copy) |
| Perf HUD (dev only) | Toggle with `` ` ``: shows hover p50/p95 ms, slip frame p95, React commits/s, worker job ms, long tasks; exposes `window.__lumenPerf` for automated tests | Nived |
| Mock switch | One env setting selects `data-mock/` + `src/mocks/` engine, or real data + real engine | Nived |

---

## 3. Visual & lunar imagery specification

### 3.1 South Pole Basemap (~320 × 320 px, Sidebar)
**Layer stack (bottom → top):**
| L | Layer | Source | Notes |
|---|---|---|---|
| L0 | **Procedural fallback** (always rendered first, hidden when L1 loads) | Generated at load: polar-stereographic graticule — latitude rings 80/82/84/86/88°S (overview) or 85/86/87/88/89°S (detail), meridians every 30° with 0°E (Earth-facing) emphasised; seeded procedural crater relief (rim highlights + floor shading, light from a fixed low azimuth) drawn once to an offscreen canvas | Labelled "schematic relief" in the legend; looks like a console map at H0 |
| L1 | `basemap_hillshade.png` | Shiva P11 (new ask) | Same projection/extent as data layers |
| L2 | Data layers (toggle, single active + opacity): Average Illumination · Earth Visibility · Slope Hazard · **Derived PSR ≥ 0.1 km²** (D-5) | P11 / P15 | Legends from `layers.json`; "derived" tag when fallback PSR |
| L3 | 9 Artemis III region outlines | `regions/artemis_regions.svg` | Hairline strokes, hover → name |
| L4 | Pins | `sites.json` + forward stereographic projection | Category glyphs (historical ●, published target ◆, Artemis region ▢ centroid, custom +); selected pin ring |
| L5 | Off-map indicators | Computed | Sites outside the extent (e.g., CY-3, Apollo, Blue Ghost) shown as edge arrows with distance; click → selects site |
| L6 | **Site Inset** (opens over the map, 180 ms) | `insets/<site>_hillshade.png` or procedural relief | CY-3: **Landing 69.373°S, 32.319°E** (solid pin) vs **Target 69.3676°S, 32.3481°E** (hollow pin), dashed connector, "~350 m" label, 100 m scale bar, source line |
Controls: extent toggle (80–90°S / 85–90°S), layer segmented control, opacity slider, value-at-cursor readout (Fast Lane), legend.

### 3.2 SKYLINE Ribbon — true-scale disks
- **Silhouette composition:** m_dem fill (terrain grey) · near-zone occluder N⁺(az) (D-9) as a hatched overlay only where active · ±σ band as translucent envelope · horizon line at 0°.
- **Panorama:** x = Earth-referenced azimuth (polar sites) or true azimuth; y = elevation with auto range; **"V ×N" exaggeration tag** (computed from px/° ratio); Sun track (amber) and Earth loop (blue) over the window, solid where visible, dashed where blocked; current-body markers with minimum size + "not to scale" tag; ghost markers at `t_hover`.
- **Horizon Lens (true scale):** equal px per degree on both axes (x scaled by cos(el) so angles are true), window ~12° × 6° centred on the selected body (toggle Sun/Earth); Sun disk 0.53° and Earth disk 1.9° drawn as true circles (**≈ 3.6 : 1**) and **clipped by the silhouette polygon** (terrain painted over the disk, σ band drawn semi-transparent over both); limb shading on the Sun, terminator-less flat Earth disk with subtle blue; readout of engine disk fraction next to the disk — **the visible clipped area must match the engine's fraction** (visual check V-6).
- Lens placement: inside the Ribbon panel's right ~30% (Panorama keeps ≥ 70% width), collapsible; in presenter density it becomes a hover-summoned overlay.

### 3.3 Quick-Start card thumbnails
- Each card: 16:9 header image (≈ 320 × 180 display, WebP ≤ 60 KB, stored locally under `public/content/thumbs/` — no hotlinking, works offline), credit line on the image foot, title, one-line promise, "~60 s tour" chip.
- `quickstart.json` per card: `image`, `alt`, `credit` (e.g., "NASA/GSFC/Arizona State University" for LROC), `sourceUrl`, `license`, `fallback: procedural`.
- **Sourcing rule:** prefer NASA/LROC imagery (public-domain with credit). ISRO imagery only if its terms are checked and recorded in `license`; otherwise use an LROC image of the CY-3 site. Never the NASA logo/insignia; never AI-generated images presented as real.
- **Procedural fallback thumbnail:** a mini Lens render from mock data (Sun skimming a ridge) so cards never show an empty box.

---

## 4. Viewport budgets (strict, `impeccable` owns)

Root: viewport-height app shell, `overflow: hidden` at root; every grid cell `min-height: 0`; only whitelisted containers scroll internally: **site-card list, Windows Table body, Scan list, Methodology view**.

**Test viewports (CSS px):** V1 1920×960 (1080p minus chrome) · V2 1536×754 (1080p laptop at 125% OS scaling, minus chrome) · V3 1440×810 · V4 1280×720 (projector, fullscreen) · V4b 1280×640 (projector, windowed — allowed to switch the right column to tabs).

| Slot (Cockpit centre column) | V1 | V2 / V3 | V4 presenter |
|---|---|---|---|
| Mission Bar | 56 | 52 | 48 |
| Answer Strip | 92 | 80 | 72 |
| Definitions Bar | 28 | 26 | 24 |
| SKYLINE Ribbon (flex) | ≥ 330 | ≥ 280 | ≥ 220 |
| Analysis tabs | 170 | 150 | 130 |
| Barcode | 64 | 56 | 48 |
| Slip Bar | 40 | 38 | 36 |
| Gutters/padding | ≈ 60 | ≈ 54 | ≈ 48 |

| Column widths | V1 | V2 | V3 | V4 |
|---|---|---|---|---|
| Left (Sidebar) | 400 | 340 | 340 | 300 (map 240×240) |
| Centre | 960 | 800 | 740 | 660 |
| Right | 520 | 396 | 360 | 320, tabs [Metrics \| Touchdown] |

Density mode is chosen by viewport height/width breakpoints; never by user agent.

---

## 5. Viewport & Performance Verification Checklist (run after every phase)

### 5.1 Zero-scroll (automated, Playwright, owner Abhinav)
- [ ] For V1, V2, V3, V4 (and V4b): page `scrollHeight ≤ innerHeight` and `scrollWidth ≤ innerWidth` after fonts load.
- [ ] Every bento cell: content does not overflow its box, except whitelisted scroll containers.
- [ ] **Worst-case content fixture** passes: longest Educator copy, "No sunrise before window end (+60 d)", grazing labels with ranges, 4 Compare rows, 30 Scan rows, 9-row Windows Table, long site names, all badges visible.
- [ ] Screenshots saved per viewport per phase (`e2e/screens/phase-N/`) and eyeballed for clipping and optical alignment (numbers, ±, units).
- [ ] Browser zoom 100%; repeat V1 at 110% zoom as a stress check (may switch density, must not scroll).

### 5.2 Hot path (automated with Perf HUD + manual Chrome trace)
- [ ] **Crosshair:** script moves the pointer across the barcode in 600 steps; `window.__lumenPerf.hover` p95 **< 4 ms** (pointer event → overlay draws complete) on the demo laptop; at 4× CPU throttle p95 < 8 ms (soft).
- [ ] **Zero React commits** during the hover run (React Profiler or commit counter in HUD) except the readout chip ref writes (not commits).
- [ ] **Slip drag:** 60-step drag; rAF frame-time p95 **≤ 16.7 ms**, dropped frames < 5%, no forced-reflow warnings; barcode/tracks move every frame; metrics settle ≤ 150 ms after release.
- [ ] Touchdown tilt/yaw drag: same frame budget as slip.
- [ ] Computed `transition-duration = 0s` and no running animations on every `data-hotpath` element.
- [ ] No long tasks (> 50 ms) on the main thread during hover/slip runs.
- [ ] Site switch < 100 ms; Quick Answer < 150 ms; Scan stage 1 ≤ 100 ms, first stage-2 rows ≤ 300 ms (G8, G13; mocks simulate realistic timings until the real engine lands).

### 5.3 Motion & accessibility
- [ ] `prefers-reduced-motion` run: drawers/popovers/toasts reduce to ≤ 80 ms opacity.
- [ ] Every popover/modal/drawer interruptible (open-close-open spam test).
- [ ] Keyboard map works (1/2/3, S/E/X/T, Q, arrows, Space, Esc); focus visible; modal focus trap.
- [ ] Colour-blind simulation (deuteranopia, protanopia) on barcode, ribbon, map: states still distinguishable by pattern/shape.
- [ ] Contrast ≥ 4.5:1 on text; Answer Strip state icons distinguish without colour.

### 5.4 Data honesty checks (visual)
- [ ] V-6: Lens clipped-disk area visually matches engine disk fraction (25%, 50%, 75% fixtures).
- [ ] Panorama shows "V ×N" and "not to scale" tags.
- [ ] Every number with uncertainty shows ± or [low–high]; grazing shows a range; Tier badge visible next to the site name.
- [ ] Off-map indicator appears for CY-3, Apollo 11, Blue Ghost; CY-3 inset shows both pins and a scale bar.
- [ ] Quick-Start thumbnails show credit lines; no logo/insignia.

---

## 6. Phased Build Sequence

Each phase lists owners, what is built, skill usage, exit criteria, and **one prompt** to send. The prompt has a `SCOPE` line: each owner sends the same prompt with their own name, and the output touches **only that owner's folders** (WORK_DISTRIBUTION §3), so three people can run a phase in parallel without conflicts. Send `SCOPE: ALL` only if one person is building everything.

To execute, the build session needs the repo: either attach it (GitHub repo name) or say "scaffold in workspace" to receive files as an archive.

---

### Phase 1 — Foundations: tokens, shell, stores, frame bus, mocks (H0 → H3, gate CP0)
**Abhinav:** design tokens + type/surfaces/icons (`impeccable` ON), motion tokens (`emil` tokens only), app root with viewport lock, Cockpit & Compare bento grids with **all slots as labelled placeholders** sized per §4 and density modes, Mission Bar skeleton, committed store (scenario incl. `minSunElevationOps`, `definitionsPreset`), transient buses (`crosshairBus`, `slipBus`, `padDragBus`), frame bus, URL sync skeleton, Playwright zero-scroll test + worst-case fixture.
**Ebin:** stub components with final names (Ribbon, RibbonPanorama, RibbonLens, AnalysisPanel, PowerCurve, WindowsTable, PointingLink, Barcode, SlipBar, TouchdownPad, AlignedBarcodes, SeasonStrip, FeasibilityCalendar, Sparkline); layered-canvas base component (static + overlay, DPR-aware).
**Nived:** `public/data-mock/` (every §6 + D-11 contract file shape), `src/mocks/` engine (physically plausible analytic Sun path and Earth libration loop, seeded terrain masks with ridges and a narrow spike, σ bands, near-zone N⁺ case), **forced-state fixtures for all 9 Answer Strip states**, Scan streaming simulator (stage 1 at ~60 ms, stage 2 trickling to ~280 ms), hook stubs returning mock results, Perf HUD + `window.__lumenPerf`.
**Exit:** CP0; §5.1 passes on placeholders at V1–V4; HUD visible; mocks load through the real loader path.

**Prompt — Phase 1**
> Execute **Frontend Phase 1** from FRONTEND_BUILD_GUIDE.md. SCOPE: `<Abhinav | Ebin | Nived | ALL>`.
> Inputs: PLAN_FINAL.md (R2), PLAN_FINAL_R3_DELTA.md, WORK_DISTRIBUTION.md, FRONTEND_BUILD_GUIDE.md (§0–§6). Repo: `<repo name or "scaffold in workspace">`.
> Build only the files owned by SCOPE (WORK_DISTRIBUTION §3 + guide §0 C-3). Follow the Skill Orchestration Matrix (§1.4): visual craft per `impeccable` rules (§1.2), motion tokens only per `emil-kowalski` rules; Fast Lane rules §1.3 apply to every hot-path element even as a stub. Respect the slot budgets and density modes in §4 exactly.
> Abhinav: tokens, type scale (tabular monospace numerals), surfaces, icons, motion tokens, viewport-locked app root, Cockpit and Compare bento grids with labelled placeholder slots for every component, Mission Bar skeleton, committed scenario store (incl. `minSunElevationOps`, `definitionsPreset`), transient buses (crosshair, slip, pad drag), shared rAF frame bus, URL sync skeleton, Playwright zero-scroll test with the worst-case fixture at V1/V2/V3/V4/V4b.
> Ebin: stub components with the final names in §6 Phase 1, plus a reusable layered canvas (static + overlay, DPR-aware) with no transitions.
> Nived: contract-shaped mock files in `public/data-mock/`, mock engine in `src/mocks/` (analytic Sun path, Earth libration loop, seeded masks incl. a narrow spike and a near-zone occluder case, σ bands), forced fixtures for all 9 Answer Strip states (D-14), Scan streaming simulator (D-15 timings), hook stubs, Perf HUD exposing `window.__lumenPerf`, mock/real switch.
> Deliver: files, a short note of what each does, the commands to run, and the results of the §5.1 checklist (screenshots per viewport). Do not build any later-phase feature.

---

### Phase 2 — Cockpit core: Ribbon, Barcode, Slip, Power curve, crosshair, Answer Strip (H3 → H8, gate CP1)
**Ebin:** SKYLINE Ribbon Panorama (silhouette m_dem + N⁺ hatch + ±σ band, Sun track & Earth loop, V ×N tag, ghost markers) and **Horizon Lens** (true-scale disks, 3.6:1, clipped by silhouette, disk-fraction readout); transport (scrub + play, linear); Barcode (days since landing, 4 patterned states); Slip Bar (native slider, ±30 d, −1/+1 d, reset, "slipped +N d" chip) drawing from cached series; Power & Elevation curve with σ shading; all wired to crosshair and slip buses.
**Nived:** Answer Strip with the **D-14 state machine** (all 9 states, ± and grazing ranges, "dark for X h so far", ops-elevation state), engine-side answer-state function; cached yearly series API; latest-wins worker path (still mock engine behind the same interface).
**Abhinav:** Mission Bar jumps S/E/X/T with **dynamic E label** (Next Earthrise / Next Earthset), instant scrub on jump, verdict chip, copy keys for all states (Planner + Educator).
**Skills:** `impeccable` ON for all visuals; `emil` **OFF** for every Phase 2 data component (only press feedback on transport buttons, label crossfade on Answer Strip state change).
**Exit:** CP1 with mock data; switch to real IM-2 data the moment ephem + mask land; §5.2 crosshair and slip checks pass; V-6 passes.

**Prompt — Phase 2**
> Execute **Frontend Phase 2** from FRONTEND_BUILD_GUIDE.md. SCOPE: `<Abhinav | Ebin | Nived | ALL>`. Phase 1 is merged.
> Build only SCOPE-owned files. Ebin: SKYLINE Ribbon Panorama + Horizon Lens per guide §3.2 (true-scale Sun 0.53° and Earth 1.9° disks, ~3.6:1, clipped by m_eff = m_dem with the D-9 near-zone occluder N⁺ shown as hatch, ±σ band, "V ×N" and "not to scale" tags), scrub/play transport (linear time advance), Survival Barcode, Slip Bar drawing from the cached yearly series, Power & Elevation curve — all as layered canvases on the Fast Lane (§1.3): no CSS transitions, no React state at pointer rate, crosshair via `crosshairBus`, slip via `slipBus`, draw in the shared frame bus.
> Nived: Answer Strip implementing all 9 D-14 states via a pure answer-state function, ref-based value updates during scrub, cached yearly series + latest-wins job handling behind the existing hook interface (mock engine still active).
> Abhinav: Mission Bar jump buttons S/E/X/T with the dynamic E label (Next Earthrise vs Next Earthset), instant scrub on jump, verdict chip, Planner + Educator copy keys for every Answer Strip state.
> `emil-kowalski` is OFF for all Phase 2 data components (only transport button press feedback and the Answer Strip label crossfade). `impeccable` ON for all visuals within the §4 budgets.
> Deliver: files, run commands, Perf HUD numbers for the §5.2 hover (600 steps) and slip (60 steps) runs, V-6 disk-fraction screenshots, and §5.1 results at all viewports.

---

### Phase 3 — Context panels: Sidebar, Basemap, Definitions, Metric Deck, Analysis tabs (H8 → H12)
**Nived:** South Pole Basemap per §3.1 (procedural L0 relief + graticule, L1 hillshade slot, L2 data layers incl. Derived PSR ≥ 0.1 km², L3 Artemis outlines, L4 pins, L5 off-map indicators, L6 Site Inset with CY-3 Landing vs Target pins and scale bar), value-at-cursor (Fast Lane); Metric Deck (Sun elevation hero, ± tiles, PSR distance + area).
**Abhinav:** Site Explorer sidebar (search incl. "lat, lon", chips All / Artemis III / Historical Landings / Published Targets / Contrast Sites / Custom, agency sub-filter, site cards with landing vs target coords and touchdown precision per D-12), Definitions Bar + ✎ popover with `minSunElevationOps` and the one-click **"ISRO Vikram ops (min Sun elevation 6°)"** preset (D-10), InfoBadge tooltips bound to `glossary.json`.
**Ebin:** Analysis tabs — Windows Table (start/end ±, duration [lo–hi], flags, sort/filter, row hover → crosshair, export buttons calling Nived), Pointing & Link with DSN lanes; Sparkline for site cards.
**Skills:** `impeccable` ON (cartography, tables, cards); `emil` ON for popover, chips, segmented controls, tab indicator, inset open, layer opacity; OFF for map hover, table hover, sparkline.
**Exit:** §5.1 with worst-case content; definitions edits recompute; ISRO preset changes Answer Strip to the ops-elevation state in the CY-3 fixture; map fallback looks finished without P11 rasters.

**Prompt — Phase 3**
> Execute **Frontend Phase 3** from FRONTEND_BUILD_GUIDE.md. SCOPE: `<Abhinav | Ebin | Nived | ALL>`. Phases 1–2 are merged.
> Build only SCOPE-owned files. Nived: South Pole Basemap per §3.1 — procedural polar-stereographic graticule and crater relief fallback (both extents), hillshade slot, toggleable layers (Average Illumination, Earth Visibility, Slope Hazard, Derived PSR ≥ 0.1 km² with "derived" tag), 9 Artemis region outlines, category pins, off-map edge indicators (CY-3, Apollo 11, Blue Ghost), Site Inset with CY-3 Landing 69.373°S 32.319°E vs Target 69.3676°S 32.3481°E, ~350 m connector, 100 m scale bar; value-at-cursor on the Fast Lane. Metric Deck with Sun elevation hero tile and ± values incl. PSR distance + area.
> Abhinav: Site Explorer sidebar (search names and "lat, lon", chips incl. Published Targets and Custom, agency filter, site cards showing landing vs target coordinates and touchdown precision per D-12), Definitions Bar with ✎ popover including `minSunElevationOps` and the one-click "ISRO Vikram ops (min Sun elevation 6°)" preset (D-10), InfoBadge tooltips from `glossary.json`.
> Ebin: Windows Table (± times, [lo–hi] durations, flags, sort/filter, row hover drives `crosshairBus`, export via engine functions), Pointing & Link with DSN lanes, Sparkline.
> Apply the §1.4 matrix: `emil-kowalski` ON for popover, chips, segmented controls, tab indicator, inset and layer-opacity transitions; OFF for map hover, table hover and sparklines. `impeccable` ON within §4 budgets.
> Deliver: files, run commands, §5.1 worst-case results, a screenshot of the procedural basemap at both extents and the CY-3 inset, and a short clip/GIF of the ISRO preset changing the Answer Strip state.

---

### Phase 4 — Decisions: Touchdown Pad, Compare & Slip, two-stage Scan (H12 → H15)
**Ebin:** Touchdown Pad widget (slope/aspect compass with downhill + uphill arrows and Sun/Earth azimuth ticks, near-zone occluder badge, panel preset + mast height segmented, yaw dial, off-nominal tilt magnitude/direction, per-panel power bars vs flat baseline, pad risk flag, 30 m baseline badge) on `padDragBus`; Aligned Barcodes (≤ 4 rows, shared crosshair), Season Strip, 60-day Feasibility Calendar (stage-1 "provisional" legend).
**Nived:** Scan Panel with **two-stage UI** (D-15): stage-1 ranked list ≤ 100 ms with "provisional" badges; stage-2 bounded rows streaming in ≤ 300 ms with [low–high], badge swap and 150 ms FLIP reorder only on stage-2 arrival; "Load into row"; Delta Table with ± and colour + sign.
**Abhinav:** Compare view assembly, scenario rows A–D (baseline ★, colour tags, duplicate/remove), Mission Profile form, Profile & Battery accordion in Cockpit.
**Skills:** `emil` ON for segmented controls, accordion, row add/remove, stage-2 FLIP; OFF for pad drags, barcodes, calendar. `impeccable` ON.
**Exit:** pad tilt drag updates Ribbon/Answer/Barcode live within budget; Scan timings shown in HUD meet G13 with the simulator; §5.1 with 4 rows + 30 scan rows.

**Prompt — Phase 4**
> Execute **Frontend Phase 4** from FRONTEND_BUILD_GUIDE.md. SCOPE: `<Abhinav | Ebin | Nived | ALL>`. Phases 1–3 are merged.
> Build only SCOPE-owned files. Ebin: Touchdown Pad widget (slope/aspect compass with downhill and uphill_az = downhill + 180° arrows, Sun/Earth azimuth ticks, near-zone occluder badge, panel preset and mast height 1/2/5/10 m segmented controls, yaw dial, off-nominal tilt magnitude + direction, per-panel power bars vs flat baseline, pad risk flag, "slope at 30 m baseline" badge) driving `padDragBus` on the Fast Lane; Aligned Barcodes with shared crosshair, Season Strip, 60-day Feasibility Calendar with a "provisional" legend.
> Nived: two-stage Scan Panel per D-15 — stage 1 nominal ranked list ≤ 100 ms with "provisional" badges, stage 2 bounded rows streaming ≤ 300 ms with [low–high] values, badge swap to "bounded", 150 ms FLIP reorder only when stage-2 rows arrive, "Load into row"; Delta Table with ± and sign + colour encoding.
> Abhinav: Compare view assembly, scenario rows A–D (baseline, colour tags, duplicate/remove), Mission Profile form, Profile & Battery accordion in the Cockpit right column.
> Matrix: `emil-kowalski` ON for segmented thumbs, accordion, row add/remove, stage-2 FLIP; OFF for pad drags, barcodes and calendar. Fast Lane rules for all drags.
> Deliver: files, run commands, HUD numbers for tilt drag and Scan stages (G8/G13), and §5.1 results with 4 Compare rows and 30 Scan rows.

---

### Phase 5 — Guidance & sharing: Quick-Start, coachmarks, Quick Answer, share, persona (H15 → H16, gate CP2)
**Abhinav:** Quick-Start drawer with 4 cards and credited thumbnails per §3.3 (`quickstart.json` with image, alt, credit, sourceUrl, license, procedural fallback); coachmark tour engine (every tour starts on the Ribbon + Answer Strip; tour 4 applies the ISRO preset); Quick Answer modal (inputs, outputs, Copy as text / Export CSV / Open in Cockpit); Share Scenario URL + toast; persona switch wiring (Planner ↔ Educator copy across all components); reduced-motion handling; keyboard map.
**Nived:** Quick Answer engine path and timing; procedural thumbnail renderer (mini Lens from mock data).
**Ebin:** Educator-persona visual variants for Ribbon/Barcode labels (rounded values, callout anchors for coachmarks).
**Skills:** `emil` ON for drawer, card stagger, coachmark spotlight, modal, toast; `impeccable` ON for card imagery, credit typography, modal layout.
**Exit:** **CP2** in Planner persona with full §5 checklist; backup video recorded from the mock-or-real build.

**Prompt — Phase 5**
> Execute **Frontend Phase 5** from FRONTEND_BUILD_GUIDE.md. SCOPE: `<Abhinav | Ebin | Nived | ALL>`. Phases 1–4 are merged.
> Build only SCOPE-owned files. Abhinav: Quick-Start drawer with the 4 scenarios of PLAN_FINAL §8.9 as cards with credited 16:9 thumbnails per guide §3.3 (`quickstart.json` fields image, alt, credit, sourceUrl, license, fallback; local WebP files; NASA/LROC imagery preferred; no logos/insignia; ISRO images only with recorded license), coachmark tour engine (each tour starts on the Ribbon and Answer Strip; tour 4 applies the ISRO ops preset), Quick Answer modal (lat, lon, UTC, duration, height → card; Copy as text, Export CSV, Open in Cockpit), Share Scenario URL with toast, persona switch wiring, reduced-motion handling, full keyboard map.
> Nived: Quick Answer engine path meeting < 150 ms; procedural thumbnail renderer (mini Horizon Lens from mock data).
> Ebin: Educator-persona label variants and coachmark anchor points on Ribbon and Barcode.
> Matrix: `emil-kowalski` ON for drawer, card stagger (≤ 40 ms per card), coachmark spotlight, modal, toast; `impeccable` ON for imagery, credits and modal layout. No motion on Fast Lane elements.
> Deliver: files, run commands, and the complete §5 checklist (5.1–5.4) with screenshots at all viewports and HUD numbers — this is CP2.

---

## 7. After CP2 (Tier 1, H22 → H30; prompts on request)
Methodology view (Abhinav) · Horizon Dome + Earth Twin overlay + 12-month calendar + dispersion histogram + SOC overlay (Ebin) · Tier-B custom points, real-engine switch-over, PWA offline, real Scan timings (Nived). Each follows the same matrix and checklist; the Dome's camera damping is the only new spring, and only on user orbit drags.

## 8. One-page cheat sheet (pin in the team channel)
- **Hot path = no motion, no React state, draw in rAF.** Crosshair p95 < 4 ms, slip p95 ≤ 16.7 ms.
- **`impeccable` = how it looks** (tokens, budgets, charts, map, cards). Never adds expensive effects next to live canvases.
- **`emil-kowalski` = how containers move** (popover, drawer, modal, toast, tabs, segmented, accordion, stage-2 reorder). Transform/opacity only, ≤ 260 ms, no bounce, interruptible, reduced-motion aware.
- **Zero scroll at V1–V4** checked by Playwright with the worst-case fixture after every phase.
- **Mocks first:** every component works against `public/data-mock/` + `src/mocks/` before real data.
- **Honesty:** ± everywhere, V ×N on Panorama, true-scale disks in the Lens, credits on thumbnails, off-map indicator for CY-3.
