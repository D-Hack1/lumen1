# frontend_state_api.md

_Owner: Abhinav_ · **Note: the scenario store described here backs the legacy shell, which is no longer mounted; the live pages use `LumenState` (`features/orbit/lumenState.ts`).** Status: **implemented (Phase 1; Phase 4 additions marked P4)**. Any change goes through `#lumen-changes` before the code changes.
Source of truth (if this file and the code disagree, the code wins and this file gets fixed):
`web/src/state/scenarioStore.ts`, `buses.ts`, `frameBus.ts`, `crosshairStore.ts`, `urlSync.ts`, `copy.ts`.

This contract covers the scenario store, the transient buses, the frame bus, the crosshair helpers and the URL
format. Copy keys and `quickstart.json` are in `frontend_content.md`.

## 1. Two state tiers (FRONTEND_BUILD_GUIDE §2)

| Tier | What | Rate | React? |
|---|---|---|---|
| **Committed** | `useScenario` (Zustand): everything in the share URL | human speed (click, release, key) | yes, components re-render via selectors |
| **Transient** | `crosshairBus`, `slipBus`, `padDragBus`, `siteHoverBus` | pointer / drag rate | **never**: subscribers draw imperatively |

Rule: a value that changes at pointer rate lives on a bus while it moves, and is committed to the store once, on
release. **Never call `setState` (React or the store) from a bus subscriber or a pointer-move handler.**

## 2. Conventions
- Times are epoch **milliseconds, UTC** (`number`). Angles are degrees. Heights are metres.
- Selectors must be narrow: `useScenario((s) => s.heightM)`, not `useScenario()`.
- Outside React (event handlers, the engine) use `getScenario()`, which is the same as `useScenario.getState()`.

## 3. Scenario fields (`Scenario`, PLAN_FINAL §6 + R3 D-11)

| Field | Type | Default | Notes |
|---|---|---|---|
| `view` | `'cockpit' \| 'compare' \| 'methodology'` | `'cockpit'` | |
| `persona` | `'planner' \| 'educator'` | `'planner'` | drives `useCopy` |
| `site` | `SiteRef` | `{ kind: 'site', id: 'im2_athena' }` | `SiteRef = { kind: 'site'; id } \| { kind: 'point'; lat; lon }` |
| `landingUtc` | `number` | `2025-03-06T17:28:50Z` (IM-2 touchdown, D-12) | |
| `durationDays` | `7 \| 14 \| 30 \| 60` | `14` | |
| `scrubUtc` | `number` | `= landingUtc` | **committed** scrub time; the live value is `crosshairBus.tScrub` |
| `slipDays` | `number`, integer −30…+30 | `0` | committed slip; the live value is `slipBus.slipDays`. Not in PLAN §6; added for the Slip Bar action |
| `heightM` | `1 \| 2 \| 5 \| 10` | `2` | observer / mast height |
| `panelPreset` | `'fourSide' \| 'singleHeading' \| 'horizontalDeck' \| 'trackingMast'` | `'fourSide'` | PLAN §5.6 generic presets |
| `yawDeg` | `number \| null` | `null` | `null` = best of the 15° sweep |
| `tilt` | `{ magnitudeDeg; directionDeg }` | `{ 0, 0 }` | off-nominal tilt (panels only, never the mask) |
| `definitions` | `Definitions` | see below | |
| `definitionsPreset` | `'default' \| 'isroVikramOps' \| 'custom'` | `'default'` | **D-11**; derived, see §4 |
| `profile` | `ProfileThresholds` | see below | Mission Profile |
| `weights` | `{ sunlit; link; night; slope }` | `0.4 / 0.3 / 0.2 / 0.1` | Viability Index weights |
| `compareRows` | `CompareRow[]` (≤ 4) | `[]` | see below |
| `layers` | `{ extent: '80S' \| '85S'; layer: MapLayerId \| null; opacity: 0…1 }` | `{ '85S', 'illumination', 0.8 }` | `MapLayerId = 'illumination' \| 'earth_visibility' \| 'slope_hazard' \| 'psr' \| 'psr_distance'` |
| `analysisTab` | `'power' \| 'windows' \| 'pointing'` | `'power'` | Cockpit centre tab |
| `compareTab` | `'aligned' \| 'season' \| 'calendar'` | `'aligned'` | Compare centre tab |

**`Definitions`**

| Field | Default | Meaning |
|---|---|---|
| `sunDiskThresholdPct` | `50` | Sun is available when at least this % of the disk clears the effective mask |
| `earthMarginDeg` | `1` | Earth is visible when the DTE margin is at least this |
| `dteDiskThresholdPct` | `50` | Earth disk fraction required for DTE |
| `dsnMode` | `'dsnAware'` | `'off' \| 'dsnAware'` |
| `dsnMaskDeg` | `10` | a DSN complex must see the Moon above this |
| `minSunElevationOps` | `0` (off) | **D-10**: when > 0, Sun available also requires Sun elevation ≥ this |

**`ProfileThresholds`:** `surfaceDurationDays 14`, `minSunlitPct 50`, `minLinkHours 100`, `maxLongestNightH 72`,
`maxPadSlopeDeg 10`, `batteryWh 2000`, `usableDodPct 80` **(P4)**, `loadW 60`. Battery endurance (advisory, not in the
engine verdict yet) = `batteryWh × usableDodPct/100 ÷ loadW` hours, checked against the longest night's upper bound.

**`CompareRow`:** `{ id: 'A'|'B'|'C'|'D'; site: SiteRef; landingUtc; slipDays?; panelPreset; yawDeg; tilt; heightM; baseline: boolean }`.
Rows inherit `definitions`, `durationDays` and `profile` from the scenario. Exactly one row is the baseline whenever any rows
exist (enforced by every action and by `hydrate`). **P4:** `slipDays` (integer −30…+30, optional = 0) is the row's own slip
on top of the global `slipDays`: **effective landing = `landingUtc + (scenario.slipDays + row.slipDays) × 1 d`**
(`rowLandingUtc(row, globalSlip)`).

| `compareSelected` **P4** | `'A' \| 'B' \| 'C' \| 'D' \| null` | `null` | selected Compare row (Windows Table, "selected row" slip). Always a valid row id, or null with no rows |
| `compareSlipTarget` **P4** | `'all' \| 'selected'` | `'all'` | what the Compare Slip slider moves: every row (global `slipDays`) or only the selected row (`row.slipDays`) |

Exported constants: `DEFAULT_SCENARIO`, `DEFAULT_DEFINITIONS`, `DEFINITIONS_PRESETS`, `DEFAULT_LANDING_UTC`,
`SCENARIO_KEYS`, `MAX_COMPARE_ROWS (4)`, and `pickScenario(state)` (data fields only, no actions).

## 4. Actions (on the store; call via `useScenario((s) => s.action)` or `getScenario().action`)

| Action | Effect |
|---|---|
| `setView(v)`, `setPersona(p)` | |
| `selectSite(id)` | `site = { kind: 'site', id }` |
| `setCustomPoint(lat, lon)` | `site = { kind: 'point', lat, lon }` |
| `setLandingUtc(t)` | sets `landingUtc`, **resets `scrubUtc` to `t`**, moves `crosshairBus.tScrub` |
| `setDuration(d)` | |
| `commitScrub(t)` | sets `scrubUtc` and `crosshairBus.tScrub`. Use on click, release, jump or key — never while dragging |
| `setSlip(days)` | clamps to an integer in −30…+30, sets `slipDays`, writes `slipBus { slipDays, dragging: false }` |
| `setHeight(h)`, `setPanelPreset(p)`, `setYaw(deg \| null)` | |
| `setTilt(tilt)` | sets `tilt` and writes `padDragBus { tiltMagDeg, tiltDirDeg, dragging: false }` |
| `setDefinitions(patch)` | merges the patch. `definitionsPreset` becomes the matching preset id if the result equals one, else `'custom'` |
| `applyDefinitionsPreset('default' \| 'isroVikramOps')` | replaces `definitions` with the preset (ISRO: `minSunElevationOps = 6`) |
| `setProfile(patch)`, `setWeights(patch)` | merges |
| `addCompareRow(partial?) → id \| null` | next free id A–D, copying the current site, landing and attitude unless overridden. The first row becomes the baseline; `{ baseline: true }` moves the baseline to the new row. The first row added is selected. Returns `null` when 4 rows exist |
| `duplicateCompareRow(id) → id \| null` | copy as a non-baseline row |
| `updateCompareRow(id, patch)` | |
| `removeCompareRow(id)` | if the baseline is removed, the first remaining row becomes the baseline; if the selected row is removed, the first remaining row is selected |
| `setBaseline(id)` | that row becomes the only baseline (an unknown id is ignored; the baseline cannot be unset) |
| `selectCompareRow(id)` **P4** | sets `compareSelected` (ignored if no such row) |
| `setCompareSlipTarget('all' \| 'selected')` **P4** | |
| `setRowSlip(id, days)` **P4** | commit one row's own slip (clamped integer); resets `slipBus` to the global slip, `rowId: null` |
| `loadRowIntoCockpit(id)` **P4** | copies the row's site, **effective** landing (scrub = landing), panel preset, yaw, tilt and height into the scenario, sets `slipDays = 0`, switches to the Cockpit and resyncs the buses |
| `setLayers(patch)` | merges into `layers` |
| `setAnalysisTab(t)`, `setCompareTab(t)` | |
| `hydrate(partial)` | `DEFAULT_SCENARIO` + partial (URL decode, Quick-Start load). Recomputes `definitionsPreset` and resyncs all three buses |
| `reset()` | back to `DEFAULT_SCENARIO` and resyncs the buses |

## 5. Transient buses (`web/src/state/buses.ts`)

```ts
interface TransientBus<T> {
  get(): Readonly<T>;               // latest value; the same object every call (read fields, don't hold it)
  set(patch: Partial<T>): void;     // cheap: copies fields; if anything changed, schedules ONE notify next frame
  subscribe(fn: (v: Readonly<T>) => void): () => void;   // returns unsubscribe
  reset(): void;
}
```
- Subscribers run **inside the frame bus, at most once per frame**, with the latest value. 600 `set`s in one frame produce one notify.
- `set` with no changed fields does not notify.
- Subscribers must draw imperatively: Canvas, or ref `textContent` / attribute writes.

| Bus | Value | Writers | Committed by |
|---|---|---|---|
| `crosshairBus` | `{ tHover: number \| null; tScrub: number; source: string \| null }` | charts, Windows Table rows, Ribbon tracks, scrub bar | `commitScrub(t)` |
| `slipBus` | `{ slipDays: number; dragging: boolean; rowId: 'A'\|'B'\|'C'\|'D'\|null }` | Slip Bar / Compare Slip during a drag | `setSlip(d)` on release (`rowId: null`), or `setRowSlip(id, d)` when the Compare slip targets one row (`rowId` = that row) |
| `padDragBus` | `{ tiltMagDeg; tiltDirDeg; yawDeg; dragging: boolean }` | Touchdown Pad tilt and yaw drags | `setTilt(t)` / `setYaw(d)` on release |
| `siteHoverBus` | `{ siteId: string \| null }` | Site Explorer cards (pointer enter/leave) — Phase 3 | never (hover only). The Basemap pin pulse reads it; until Nived's pins carry `data-site`, `features/sidebar/pinPulse.ts` toggles `.is-card-hover` on the matching pin |

`source` is the id of the last writer (for example `'barcode'`), so a chart can skip redrawing its own echo.
`'store'` means the value came from a commit.

### Crosshair helpers (`web/src/state/crosshairStore.ts`)
`useCrosshair()` returns the **stable** object `crosshair`. It never re-renders the caller.

| Method | Rate |
|---|---|
| `crosshair.get()`, `crosshair.subscribe(fn)` | the same as `crosshairBus` |
| `crosshair.setHover(t \| null, source?)` | pointer rate |
| `crosshair.setScrubLive(t, source?)` | pointer rate (dragging the scrub bar) |
| `crosshair.commitScrub(t)` | human rate. Equals `getScenario().commitScrub(t)` |
| `crosshair.clear()` | Esc: clears the hover |

Writing `crosshairBus.set({...})` directly is allowed. Include `source` when you do.

**Who follows what:** the Answer Strip and Metric Deck follow the committed `scrubUtc` (or `tScrub` via a ref
subscriber). Hover (`tHover`) only drives overlays: guides, ghost disks, readout chip.

## 6. Frame bus (`web/src/state/frameBus.ts`), the one shared rAF loop

| API | Use |
|---|---|
| `frameBus.schedule(fn)` | one-shot on the next frame, de-duplicated by function identity (the buses use this) |
| `frameBus.loop((now, dtMs) => …) → stop` | runs every frame while registered (playback, continuous overlays). **Call `stop` on unmount** |
| `frameBus.stats()` / `resetStats()` | `{ frames, lastWorkMs, maxWorkMs }` for the Perf HUD |
| `frameBus.flushNow()` | runs pending work synchronously (tests, pre-screenshot) |

Order inside a frame: one-shot tasks (bus notifies, then the draws they trigger), then loops. Work scheduled during a
frame runs on the next frame. The loop idles when nothing is scheduled. **Never start your own
`requestAnimationFrame`.** Prefer `subscribe` + `schedule` over a permanent `loop` when you only redraw on change.

## 7. URL format (`web/src/state/urlSync.ts`)

```
https://<host>/<path>?s=<version>.<base64url(JSON of pickScenario(state))>
```
- `version` = `URL_VERSION` = **1**. Other versions decode to `null`, so the app falls back to defaults.
- The payload is the full `Scenario` (all fields in §3). Base64url is UTF-8 safe, with no padding.
- Decode rules:
  - unknown fields are ignored;
  - fields with the wrong type or shape fall back to their default (checked recursively for objects);
  - enum fields must be one of the listed values;
  - `site` must be a valid `SiteRef`;
  - compare rows need an id in A–D and are capped at 4;
  - `slipDays` is clamped to an integer in −30…+30.
  - **P4:** compare rows: duplicate ids keep the first; `slipDays` clamped (missing = 0); invalid `panelPreset` /
    `heightM` fall back to defaults. `compareSelected` must be A–D or null; `compareSlipTarget` must be `all|selected`.
    `profile.usableDodPct` missing (old links) = 80. `hydrate` then guarantees one baseline and a valid selection.
- Other query parameters are preserved (for example `fixture=worst-case`, used by e2e only).
- **Read on boot:** `hydrate({ ...readScenarioFromUrl() })`.
- **Write:** `startUrlSync()` calls `history.replaceState` 250 ms after the last committed-store change. Buses never touch the URL.
- **Share:** `scenarioUrl()` builds the link from the current store. The Mission Bar copies it and shows a toast.
- Helpers: `encodeScenario(s)`, `decodeScenario(token) → Partial<Scenario> | null`, `readScenarioFromUrl(search?)`, `scenarioUrl(s?, base?)`, `startUrlSync(debounceMs?) → stop`.
- Planned (still version 1): shorter key names and leaving out default values to shorten links. A future version 2 gets a migration step from version 1.

## 8. Persona and copy access (`web/src/state/copy.ts`)
`usePersona()`, `useCopy(key)`, `useCopyFn() → (key) => string`, `getCopy(key, persona)`. Keys and the placeholder
syntax are in `frontend_content.md`.

## 9. Open points

**Phase 4: all raised items are resolved.**
- Per-row slip is applied by `compareStore` (`rowLandingUtc(r, 0)` as landing, `rowLandingUtc(r, global)` as scrub). `mockCompare` follows the rows and the baseline.
- `ScanPanel` reports its stage through `reportScanStage` (`state/scanStatus.ts`); the verdict popover reads it for "provisional" (D-15).
- `ScenarioResult.verdictRequirements` carries the engine's per-requirement statuses (absent on mock results; the popover recomputes then). The battery check stays UI-side and advisory: a pure function of the profile and `longestNightH`.
- `WindowsTable` takes `result`; the Compare view passes the selected row's result once it is `ready` (otherwise the Cockpit's, labelled). `AlignedBarcodes` follows `slipBus` during a drag.
- `LumenState` (the four live pages) has `slip` / `setSlip` (0…27) shared by the Slip explorer.


1. **`useResult()` input:** Nived's engine should read `site`, `landingUtc + slipDays × 1 day` (effective landing), `durationDays`, `heightM`,
   `panelPreset`, `yawDeg`, `tilt` and `definitions` from this store. `scrubUtc` drives `answer`. Confirm that
   slip is applied engine-side as an offset (proposal), not by rewriting `landingUtc`.
2. **Live slip** must window the cached yearly series from `slipBus.slipDays` (guide §1.3 rule 5); `slipDays` is committed only on release.
3. **Compare rows** have no per-row definitions or duration (they inherit the scenario's). Raise it now if Scan or Delta needs them per row.
