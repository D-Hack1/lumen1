# ui_guide.md

> **Legacy shell.** The live app now mounts the four Lumen pages (`web/src/features/pages`, entry `web/src/main.tsx`). The cockpit/compare shell described in §§1–8 (`web/src/App.tsx`, `app/views/*`, `features/scenarios/*`) is still in the tree but **not mounted**, and its Playwright specs (`web/e2e/*.spec.ts`) do not run against the live app. Kept for reference and possible porting.


_Owner: Abhinav_ · Phases 1–4. Read this before building any component that goes into a bento slot.

## 1. Shell and views
- The app root is locked to the viewport (`100dvh`, `overflow: hidden`). **The page never scrolls.**
- Mission Bar on top, then one view: **Cockpit**, **Compare** or **Methodology**. Switching views is a ≤ 150 ms opacity crossfade.
- Every bento cell is a `<Slot id="…">` (`web/src/app/layout/Slot.tsx`). The grid sets the slot's size, never its content. Your component should fill its slot (`height: 100%`) and must not overflow it.
- Internal scrolling is allowed **only** in: the site-card list, the Windows Table body, the Scan list and Methodology (`data-scroll="allowed"`).

## 2. Density modes (chosen from viewport size only)
| Test viewport | `data-density` | `data-cols` | Right column |
|---|---|---|---|
| V1 1920×960 | d1 | c1 (400 / flex / 520) | Metric Deck + Touchdown |
| V2 1536×754 | d2 | c2 (340 / flex / 396) | same |
| V3 1440×810 | d2 | c3 (340 / flex / 360) | same |
| V4 1280×720 | d4 (type ×0.9) | c4 (300 / flex / 320) | tabs [Metrics \| Touchdown] |
| V4b 1280×640 | d4 | c4 | tabs |

The attributes are set on `<html>`. Budgets are defined once in `web/src/ui/tokens.ts` (`slotBudget`, `sideBudget`, `colBudget`) and are available as CSS variables (`--slot-answer`, `--slot-ribbon-min`, `--col-left`, …).

## 3. Slot ids (Cockpit)
| Slot id | Owner · component | d1 / d2 / d4 height (px) |
|---|---|---|
| `search` | Abhinav · Search + FilterChips | 92 / 92 / 84 |
| `map` | Nived · Basemap (square) | 320 / 290 / 240 |
| `siteList` | Abhinav · SiteCard list (scrolls) | flex |
| `answer` | Nived · AnswerStrip | 92 / 80 / 72 |
| `definitions` | Abhinav · DefinitionsBar | 28 / 26 / 24 |
| `ribbon` | Ebin · Ribbon | ≥ 330 / 280 / 220 (takes the remaining height) |
| `analysis` | Ebin · AnalysisPanel | 170 / 150 / 130 |
| `barcode` | Ebin · Barcode | 64 / 56 / 48 |
| `slip` | Ebin · SlipBar | 40 / 38 / 36 |
| `metricDeck` | Nived · MetricDeck | 300 / 262 / 230 |
| `touchdown` | Ebin · TouchdownPad | flex |
| `profileBattery` | Abhinav · ProfileBatteryAccordion (header; opens as an overlay) | 48 / 40 / 36 |

**Compare (Phase 4):** `scenarioRows`, `missionProfile` (left) · `compareSlip`, `compareTabs`, `compareVisual`, `deltaTable` (centre) · `scan` (scrolls), `compareWindows` (scrolls) (right). The Delta Table moved under the barcodes; `compareWindows` grew to 300 / 250 / 200 px. **Methodology:** `methodology` (scrolls).

The Mission Bar is 56 / 52 / 48 px.

## 4. UI kit and tokens
Import from `web/src/ui` (barrel): `Panel, Card, Chip, Badge, InfoBadge, Segmented, Slider, toast/ToastViewport`, plus `color`, `font`, `type`, `motion` and patterns.
- **Colours:** use `color.*` in Canvas/SVG and `var(--c-*)` in CSS. Never hard-code a hex value.
- **Data encodings, always paired with a pattern or shape:** Sun = amber `color.sun` (solid) · Earth only = blue **dots** (`createDotPattern`) · Sun + Earth = teal `color.both` (solid) · blocked = grey **hatch** (`createHatchPattern`). In CSS, use `cssStateFill(state)`.
- **Numbers:** add the `num` class (tabular monospace) to every live value, ± and unit.
- **Motion:** use the tokens in `motion.*` and animate only `transform` and `opacity`. Containers only (popover, drawer, toast, tabs, segmented). **Never on data.**
- **Token names:** `color.surface2` → `var(--c-surface2)`, `color.textOnAccent` → `var(--c-text-on-accent)` (digits stay attached). `src/ui/tokens.test.ts` fails if any stylesheet in `src/` uses a `var(--…)` that is not defined, so a typo can't silently render transparent.

### 4.1 InfoBadge — one badge for everyone (Phase 3)
- `import { InfoBadge } from 'src/ui'` and pass **only** `term`: `<InfoBadge term="sun_elevation" />` or the visible label `<InfoBadge term={t('metric.sunlit')} />`. Ids, labels and aliases all resolve.
- The glossary binding is installed once at boot (`features/guidance/InfoBadgeBinding.tsx`). It reads `public/content/glossary.json` (Gowri) and falls back to the PLAN §8.10 text (`content/glossaryFallback.ts`, tagged "draft") until the file lands. You never fetch or map glossary data yourself.
- Tooltip: Formula · Impact · Source & σ · **Learn more →** (opens Methodology at `#gloss-<id>`). 300 ms open delay, 0 ms when moving between badges, 100 ms fade, click pins it open, one tip at a time. Headings follow the persona.
- Unknown term → the term is the title, marked "draft". Ask in `#lumen-changes` for a glossary id, or for an alias in `glossaryFallback.ts`.

### 4.2 CreditLine — image and map-layer credits (Phase 3)
- Ebin (Lens body images): `<CreditLine ids={['sun_sdo', 'earth_epic']} overlay corner="br" />` inside the positioned Lens container.
- Nived (Basemap layer): `<CreditLine entry={layerCredit(layer.source, layer.derived)} overlay />` (`layerCredit` from `src/content/credits.ts`); for the procedural relief use `id="basemap_procedural"`.
- Entries live in `src/content/credits.ts` (credit, what, license, sourceUrl) and are mirrored in `docs/credits_frontend.md`. Add a new image → ask Abhinav for an entry. Static text, no motion, no blur: safe next to live canvases.

### 4.3 Popover
- `<Popover open anchor={ref} label="…" align="start|end" insideRefs={[otherTriggerRef]}>`. Enter 150 ms (`motion.durPopover`), exit 120 ms, scale 0.96 → 1 from the anchor point (also when clamped to the viewport), interruptible, Esc / outside pointer-down closes. `insideRefs` lists other buttons that toggle the same popover so they don't count as "outside".

## 5. Hot path (Fast Lane, guide §1.3) — mandatory for charts and maps
- Tag hot elements with `data-hotpath`. A global CSS rule disables transitions and animations on them.
- **Do not set React state at pointer rate.** Write the latest value to a transient bus, and draw from a subscriber.
  - `crosshairBus` (`web/src/state/buses.ts`): `{ tHover, tScrub, source }`. Use `crosshair.setHover(t, 'barcode')`, `crosshair.setScrubLive(t)`, then `crosshair.commitScrub(t)` on release.
  - `slipBus`: `{ slipDays, dragging }`. Commit on release with `useScenario.getState().setSlip(d)`.
  - `padDragBus`: `{ tiltMagDeg, tiltDirDeg, yawDeg, dragging }`. Commit with `setTilt` / `setYaw`.
  - `siteHoverBus`: `{ siteId }` — Site Explorer card hover. **Nived:** the Basemap may subscribe to pulse its own pins; today `features/sidebar/pinPulse.ts` toggles `.is-card-hover` on the pin (matched by `<title>` until pins carry `data-site`) or on `[data-offmap="<id>"]`.
- `bus.subscribe(fn)` calls `fn` **once per frame at most**, inside the shared frame bus (`web/src/state/frameBus.ts`). Draw imperatively from it: canvas calls, or ref `textContent` / attribute writes.
- For continuous animation (playback), use `frameBus.loop((now, dt) => …)`. Never start your own `requestAnimationFrame` loop.
- Committed (human-speed) state is `useScenario(selector)` (`web/src/state/scenarioStore.ts`). Labels come from `useCopy(key)` (`web/src/state/copy.ts`).

## 6. Worst-case fixture
Open `/?fixture=worst-case` to fill every slot with worst-case content: Educator copy, "No sunrise before window end (+60 d)", grazing ranges, 4 Compare rows, 30 Scan rows, a 9-row Windows Table, long site names and all badges. Phase 3: the Site Explorer gets 30 site cards (`fixture.sites`, every category / agency / tier, CY-3 landing + target, minute and second touchdowns, "as published" with and without a date) and the Definitions Bar shows the ISRO preset chip with Educator wording. `npm run e2e` checks zero scroll and per-slot overflow at V1–V4b, and saves screenshots to `web/e2e/screens/phase-N/`. When your real component lands, its slot entry in the fixture is removed and the same content arrives through the mock engine's forced states.

## 7. Site Explorer and Definitions Bar (Phase 3)
- **Left column = 3 slots** rendered by `features/sidebar/Sidebar.tsx`: `search` (search, agency filter, 6 category chips — always 2 rows), `map` (Nived's `Basemap`, unchanged), `siteList` (the column's only scroller).
- Card: click = `selectSite(id)`, Shift-click or **+ Compare** = `addCompareRow({ site })` + toast, hover = `siteHoverBus`. Verdict dot = the engine's verdict for the selected site or a Compare row; other sites stay ○ pending (no per-site verdict API yet).
- Search: a typed `lat, lon` (`−84.79, 29.20`, `84.79S 29.2E`) offers **Analyse custom point** (Enter → `setCustomPoint`) and **Quick Answer** (Nived's `useQuickAnswer`, shown in a popover with "Open in Cockpit"). `focusSiteSearch()` focuses the field (for the Mission Bar).
- Definitions Bar: one line built from the store (`features/definitions/definitionsText.ts`); ✎ opens the editor (Sun disk threshold, observer height 1/2/5/10 m, Earth margin, DTE disk threshold, DSN mode + mask, min Sun elevation for ops) and the one-click **ISRO Vikram ops (min Sun elevation 6°)** preset. Sliders commit on release (one recompute). A non-default preset shows a chip (`Preset: ISRO ops` / `Custom rules`) with × reset.

## 8. Compare, Mission Profile and battery (Phase 4) — legacy shell
> **Legacy shell.** The live app now mounts the four Lumen pages (`web/src/features/pages`, entry `web/src/main.tsx`). The cockpit/compare shell described in this section (`web/src/App.tsx`, `app/views/*`, `features/scenarios/*`) is still in the tree but **not mounted**, and its Playwright specs (`web/e2e/*.spec.ts`) do not run against the live app. Kept for reference and possible porting.

- **Scenario rows A–D** (`features/scenarios/ScenarioRows.tsx`): rows are `compareRows` in the store (≤ 4; `+ Add`, `+ Compare` on cards, Shift-click on a card or map pin all call `addCompareRow`). Each row: colour tag + letter (`--c-row-a…d`, never colour alone), ★ baseline (exactly one; the store repairs it on every action and on `hydrate`), site + tier, effective landing UTC, attitude summary, verdict, ⧉ duplicate, ↗ load into Cockpit, × remove. The 5th row is refused with a tooltip. Add/remove = 160 ms transition (`useListTransition`: opacity + FLIP `translateY`, interruptible, reduced-motion aware).
- **Slip** (`CompareSlip.tsx`): `[All rows | Row X]`. All → global `slipDays` (shared with the Cockpit); Row → that row's `slipDays`. Effective landing = `landingUtc + (slipDays + row.slipDays) × 1 d` (`rowLandingUtc`). Drag writes `slipBus { slipDays, dragging, rowId }` only; row landing text and the chip are rewritten from the bus by ref (Fast Lane). Release / key → one store commit. HUD: slip frame p95 16.7–16.8 ms, 0 dropped.
- **Mission Profile** (`MissionProfileForm.tsx`): 8 fields with units, validated in place (range, integer days, link hours ≤ duration × 24); invalid input never reaches the store; valid edits commit debounced 150 ms (Enter / blur commit at once). Below the form: the battery line and the requirement list for the selected row.
- **Profile & Battery accordion** (`ProfileBatteryAccordion.tsx`, kit `Accordion`): header shows "Survives longest night ✓ with X h margin" (endurance = Wh × DoD ÷ W vs the night's **upper** bound). Opens as a portalled overlay that rises over the Touchdown Pad (180 ms, transform + opacity); never moves a slot. The battery check is **advisory** — not in the engine verdict yet.
- **Verdict popover** (`MissionProfileSummary.tsx` + `RequirementList.tsx`): every hard requirement with limit · conservative bound (nominal) · pass / marginal / fail / no data, statuses from the engine's own `evaluateVerdict`. Shows "provisional" when the chip is provisional **or** the Scan list is stage 1 only (`state/scanStatus.ts`, D-15; ScanPanel reports its own stage). Statuses use the engine's `verdictRequirements` when present.
- **View switch** (`App.tsx`): the outgoing view stays mounted, inert, and fades out over 120 ms while the incoming view fades in over 150 ms (opacity only).
- **URL**: `compareRows` (incl. `slipDays`), `compareSelected`, `compareSlipTarget`, `profile` (incl. `usableDodPct`) and `compareTab` all round-trip; see `contracts/frontend_state_api.md` §7.
- Pure helpers (unit-tested): `profileModel.ts` (validation, battery, requirement rows, summary line), `rowModel.ts` (labels).

## 9. Keyboard map
Phase 1 provides arrow-key navigation inside segmented controls and tabs. The full map (1/2/3, S/E/X/T, Q, ←/→, Space, Esc) arrives in Phase 5.

**Ask LUMEN** (`features/ask`, mounted in `PagesApp`): `/` opens the box; ignored while typing in an input, textarea, select or editable field, and with Ctrl/Cmd/Alt held. `Esc` closes it. Avoid `/` and the backtick (Perf HUD) for other shortcuts.
