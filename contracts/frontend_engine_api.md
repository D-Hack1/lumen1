# frontend_engine_api.md

_Owner: Nived_ · Status: **draft for H2 freeze** · Types: `web/src/engine/types.ts` (the source of truth for field names)

Hooks + engine functions the UI may call. UI code **never** reads `public/data/` and never computes physics; it
uses only what is listed here.

## Conventions
- Times: epoch **milliseconds, UTC** (`number`). Angles: degrees. Distances: km unless the name ends `M` (metres). Durations: hours unless `Ms`.
- Uncertainty: `Bounded = { value, lo, hi }` (any may be `null`). For Tier C `lo === hi === value` (no terrain uncertainty: label as a smooth-sphere estimate, not a terrain bound).
- Event/window `±` is `dtMs` / `startPmMs` / `endPmMs` (half-width, ms). `null` = not applicable (Tier C).
- Every visible label comes from Abhinav's `useCopy`; the engine returns **numbers and enums, never display strings**
  (exceptions: `meta.tierBadge`, `meta.definitionsSummary`, `QuickAnswerResult.text`).
- Mock/real switch: env `VITE_LUMEN_DATA=mock|real` (default `mock`). Same hooks, same shapes — no component changes.
- Hooks are safe to call before data arrives: they return an empty typed object with `loading`/`status` set.

## Hooks (`web/src/engine/hooks.ts`)

| Hook | Returns | Notes |
|---|---|---|
| `useCatalog()` | `CatalogResult` `{ sites: SiteRecord[], sparklines: Record<siteId, {startUtc, sunlitPct: Uint8Array, linkPct: Uint8Array}>, loading, error }` | Sparklines: one value per day from `startUtc`. |
| `useResult()` | `ScenarioResult` | Reads the active scenario from Abhinav's store (`useScenario`) and recomputes in the worker (debounced, stale jobs cancelled). |
| `useCompareResults()` | `CompareResults` `{ status, rows: {scenarioId, result, deltaVsBaseline}[], baselineId }` | One row per compare scenario (≤4). |
| `useSiteVerdict(siteId)` / `useSiteVerdicts()` | `{ verdict, viabilityIndex, provisional }` / `{ status, bySite }` | Verdict dot for site cards and Compare rows. One shared stage-1 pass over every catalog site, re-run when landing date, window, height, definitions, profile or weights change. The selected site returns the Cockpit's exact verdict; others are provisional (PENDING until terrain masks exist). |
| `useQuickAnswer(input \| null)` | `QuickAnswerResult` | `null` input → idle. |
| `useLayers()` | `LayersResult` `{ layers, extents, sizePx, regions, loading, error }` | Layer `url`s are ready for `<img>`. `extents` keys are `'80S'`/`'85S'` (same ids as the store; the contract's `80_90S`/`85_90S` are mapped in the loader). `regions[].svgPath` is in km, y flipped (same frame as the layers). |

### `ScenarioResult`
| Field | Type | Meaning |
|---|---|---|
| `status` | `'idle'\|'loading'\|'ready'\|'error'` | `error` string set when `'error'`. |
| `meta` | `ResultMeta` | `siteId`, `tier`, `tierBadge`, `sigmaSource`, `snapDistanceKm` (Tier B), `definitionsSummary`, `dataVersions`, `mock`. |
| `verdict` | `'GO'\|'MARGINAL'\|'NO-GO'\|'PENDING'` | + `verdictReasons: string[]` (copy keys later). |
| `answer` | `AnswerState` | Answer Strip at `tScrub`. State enums per R3 D-14: Sun `sunsetIn \| sunriseIn \| noSunriseBeforeEnd \| staysUpPastEnd \| belowOpsElevation`; Earth `earthsetIn \| earthriseIn \| linkResumesDsn`. Includes `nextEventT`, `nextEventPmMs`, `grazing`, `darkForMs`, `windowSunlitPct`, `windowLinkPct`. |
| `events` | `EventRecord[]` | `{type: sunset\|shadowExit\|earthset\|earthrise, t, dtMs, grazing, grazingReason: rate\|dt_limit\|vanishes\|null, dtMethod: fast\|exact}` |
| `windows` | `WindowRecord[]` | `{type: sun\|earth\|link\|ops, start, end, startPmMs, endPmMs, durationH: Bounded, peakElevDeg, flags:{grazing, partialStart, partialEnd}}` |
| `series` | `Series` | Uniform grid `t0 + i*stepMs`: `sunElevDeg, sunAzDeg, sunClearanceDeg, sunDiskPct, earthElevDeg, earthAzDeg, earthClearanceDeg, earthDiskPct, earthRangeKm, powerW, flatPowerW, sunUp, earthUp, linkUp, sigmaBandDeg` (Float32Array / Uint8Array). Azimuth is Earth-referenced at polar sites. |
| `metrics` | `MetricSet` | `sunElevationDeg` (hero), `sunClearanceDeg`, `sunDiskPct`, `earthElevationDeg`, `dteMarginDeg`, `sunlitPct`, `linkPct`, `longestNightH`, `longestCommGapH`, `opsHours`, `energyPerDayWh`, `sunElevationAtTouchdownDeg`, `padSlopeDeg`, `psrDistanceKm {km, bearingDeg, areaKm2, source}`. Each is `Bounded`. |

## Functions

| Function | Signature | Notes |
|---|---|---|
| `jumpTo` | `(eventType: 'sunset'\|'shadowExit'\|'earthset'\|'earthrise') => number \| null` | Next event after current scrub time; caller sets `t_scrub`. The Mission Bar E button should show Earthrise when `answer.earth.visible` is false, Earthset otherwise. |
| `quickAnswer` | `(input: {lat, lon, utc, durationDays, heightM}) => Promise<QuickAnswerResult>` | Tier A if a curated site matches, else Tier B snap, else Tier C. `text` is pre-formatted for "Copy as text". |
| `exportCsv` | `(result: ScenarioResult, kind?: 'windows'\|'metrics') => string` | `#`-prefixed header block (site, tier, σ source, definitions, data versions) then CSV. |
| `exportJson` | `(result: ScenarioResult, kind?: 'windows'\|'metrics') => string` | `{ header, windows \| metrics }`. |
| `runScan` | `(params: ScanParams, onUpdate?: (r: ScanResult) => void) => Promise<ScanResult>` | Two-stage (R3 D-15): `onUpdate` fires with stage 1 (`provisional`, `boundsStatus:'nominal'`), then stage 2 (`'bounded'`). `ScanResult.candidates` is ranked best-first. |

`ScanParams = { mode: 'dates'|'sites', baseLandingUtc, plusMinusDays, siteIds: string[]|null, durationDays }`.

## Open points (resolve at the H2 session)
1. `useResult()` takes no args and reads the store — confirm the store field names with `frontend_state_api.md`.
2. Whether `series` should be downsampled by the engine per viewport (proposal: engine returns a fixed 10-min grid for the render window).
3. R3 additions already in the types: `grazingReason`, `dtMethod`, `boundsStatus`, `minSunElevationOps` state (`belowOpsElevation`), site `landingCoords/targetCoords/touchdownPrecision/lastContactUtc`.

## Status (what is real, what is still mock)
| Piece | Status |
|---|---|
| `useCatalog`, `useLayers` | Real loaders; work in mock and real mode (sparklines optional in real mode). |
| **`useResult`, `jumpTo`** | **Real in real mode** (`VITE_LUMEN_DATA=real`): the scenario from the store is evaluated in a Web Worker against the real `ephem.bin`. One shared evaluation per scenario change (`engine/resultStore.ts`), 30 ms debounce, latest-wins. Mock mode returns a fake result. |
| `useCompareResults`, `useQuickAnswer`, `runScan` | Still mock-backed (Phase 4). |
| `exportCsv`, `exportJson` | Real and **lossless** (round-trip tested, gate G11). |

### What real-mode results contain today (geometry only)
Sun/Earth azimuth, elevation, range, disk fraction and clearance on a 2-minute grid; events (sunset, shadow exit, earthset, earthrise) refined to ~10 s; windows; sunlit %, Earth-visible %, longest night, longest comm gap, ops hours; the Answer Strip state (D-14) including the ops-elevation state.
**Not available yet and therefore `null` / labelled, never invented:** terrain mask (every site uses the smooth-Moon horizon, labelled "terrain pending"), ± bounds and δt (need σ), DSN link (link = Earth visible, stated in `meta.definitionsSummary`), power and energy, pad statistics, the verdict (always `PENDING` with a reason).

### Parity with the Python reference (gate G4, first pass)
`core/*.ts` are ports of `pipeline/lumen_pipeline/reference/*.py`. Against the real golden set 1 (IM-2, 30 days): worst azimuth error 5e-6°, elevation 1e-6°, events within 0.25 s, windows and metrics identical. CI requires these tests to run (`LUMEN_REQUIRE_PARITY=1`).

## Power (G-10, R3)

`series.powerW` is the generation of the configured panel preset on the actual pad (ground slope from the pad file, off-nominal tilt, yaw; yaw `null` = best of the 15 degree sweep per sample); `series.flatPowerW` is the same panels and controls on flat ground. `metrics.energyPerDayWh` is the mean generation scaled to 24 h.
Panel physics are NOT defined by R3: the engine uses a declared placeholder (`ASSUMED_PANEL` in `core/padPower.ts`: 1 m2, efficiency 1), so power is **W per m2 of panel aperture**. singleHeading faces reference-north before yaw; trackingMast turns to the Sun azimuth each sample. No battery/SOC is shown (no capacity/load/DoD defaults exist). Replace `ASSUMED_PANEL` when the team fixes real values.

## DSN-aware link (default ON)

When `definitions.dsnMode === 'dsnAware'` (default) and `dsn.bin` loads, **link = Earth visible AND at least one DSN complex (Goldstone, Canberra, Madrid) sees the Moon at or above `dsnMaskDeg` (default 10 deg)**. The 10-minute Moon-elevation nodes are linearly interpolated; outside the series the link is "not up". This changes `series.linkUp`, `metrics.linkPct`, `metrics.longestCommGapH`, `metrics.opsHours` (Sun and link), the Scan and Calendar link %, the Quick Answer link %, and adds `windows` of type `link`. Earth rise/set events and `earth` windows stay geometric (Earth above the horizon). With DSN off, or if `dsn.bin` cannot be loaded, link = Earth visible and `meta.definitionsSummary` says "DSN not applied".
When Earth is visible but the link is down the Answer Strip state is `linkResumesDsn` with `nextEventT` = the first instant the link is up again (10 s bisection). Known gap: while the link is UP the strip still shows the next *Earth* set; a DSN hand-off that ends the link earlier is not announced (needs a copy string for a "link ends (DSN)" state).

## Exact span extrema and event-driven scenario bounds (engine modules, not yet wired into `useResult`)

- `Horizon.extrema(centre, halfWidth)` is now the exact, conservative span extrema of the reference (`reference/visibility.py`): terrain min/max over the mask bins the span touches (NaN/Infinity bins ignored), the near-zone plane maximised continuously. It feeds the disk-fraction short-circuits.
- `core/windowBounds.ts` `evaluateScenarioBounds(...)` is the TS twin of `reference/bounds.py`: refined, event-driven windows for sun/earth/link/ops, metrics taken from those windows, and independent `[lo, nominal, hi]` ranges for every window start, end and duration (a vanished shifted event gives a nominal window with no range). Pairing of shifted-pass events is a caller policy (`pairNearest`). It is NOT yet used for the numbers the app shows: the app still reports sample-based percentages until the team decides which method is canonical, and until terrain masks and sigma exist there is nothing to bound.

## Canonical demo metrics: refined windows (decision: Gowri, G-10 final)

`metrics.sunlitPct`, `linkPct`, `longestNightH`, `longestCommGapH`, `opsHours` and the answer's `windowSunlitPct` / `windowLinkPct` are computed from **refined windows**: every Sun / Earth / link / ops state change is found on the 2-minute grid and bisected to ~10 s, windows are built from those transitions (half-open; a window touching either end of the scenario is flagged partial), and each metric is taken from the window durations. They are no longer 2-minute sample counts. IM-2, 30 days from touchdown: sunlit 49.2931 % (refined) vs 49.2963 % (sample counts, what Golden Set 1 was generated with). `Evaluation.metrics` (sample-based) is kept only for Golden Set 1 parity until Gowri versions that set.
`windows` now also contains `ops` windows (Sun available AND link) and, when the DSN rule applies, `link` windows. Window peaks are the body's maximum elevation over the refined start, refined end and the 2-minute samples between them. Oracle: `engine/__tests__/refined.parity.test.ts` against Gowri's Python on the real ephemeris and dsn.bin (6 scenarios).
