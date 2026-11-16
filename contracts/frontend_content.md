# frontend_content.md

_Owner: Abhinav_ · Status: copy keys **implemented (Phase 2: D-14 states complete in both personas; Phase 3: Site Explorer, Definitions Bar, glossary tooltip and credit keys)**; `quickstart.json` shape **draft for Phase 5**.
Source of truth: `web/src/content/personaCopy.ts` (strings), `web/src/state/copy.ts` (lookup),
`web/src/engine/format.ts` → `fill()` (placeholders, Nived). If this file and the code disagree, the code wins and
this file gets fixed.

## 1. How copy works

- **Every visible label** in every component comes from `useCopy(key)` or `useCopyFn()` (WORK_DISTRIBUTION §5).
  The engine returns numbers and enums, never display strings (except `tierBadge`, `definitionsSummary` and `QuickAnswerResult.text`).
- **Two tables:** `planner` (complete) and `educator` (overrides only, for keys whose wording differs).
- **Lookup order:** Educator override (only when persona = educator) → Planner → **the key itself**. A missing
  string shows up as its key, never blank. This is how missing keys are spotted.
- **API** (`web/src/state/copy.ts`):

| Function | Use |
|---|---|
| `useCopy(key): string` | one label in a component |
| `useCopyFn(): (key) => string` | many labels in a component (`const t = useCopyFn()`) |
| `usePersona(): 'planner' \| 'educator'` | persona-specific rendering beyond wording (rounding, callouts) |
| `getCopy(key, persona): string` | outside React (exports, Copy as text) |

- **Placeholders:** `{name}` in a string is filled by the caller with `fill(template, vars)` from
  `web/src/engine/format.ts`. An unfilled placeholder stays visible as `{name}`. Placeholders used now:

| Placeholder | Meaning | Formatted by |
|---|---|---|
| `{t}` | a duration or countdown, already formatted with ± or a range (e.g. `41 h ± 5 h`, `~12–30 h`) | `fmtUntil` / `fmtSpan` (`engine/format.ts`) |
| `{n}` | integer days (window length) or a percentage | caller |
| `{deg}` | degrees (ops elevation) | caller |
| `{name}`, `{lat}`, `{lon}`, `{km}` | off-map indicator (site name, coordinates, distance) | caller |
| `{label}`, `{time}`, `{pm}`, `{key}` | Mission Bar jump tooltip (`mb.jump.tip*`): the `.long` jump label, target UTC to the minute, ± half-width, shortcut key | `jumpTooltip` (`app/jumps.ts`) |

- **Uncertainty is never in the copy string:** ±, `[lo–hi]` and "grazing" ranges are built by the formatter and
  passed in through `{t}`. Copy owns the words around them.

## 2. Rules for keys

1. **Namespace = component group** (`mb.*`, `answer.*`, `metric.*` …). The namespace's user (listed in §4) asks for keys; Abhinav owns the file and adds them.
2. **Adding or renaming a key:** post in `#lumen-changes` with `key · Planner text · Educator text (optional) · where used`. Abhinav adds it to
   `personaCopy.ts` and to this file. **Don't edit `personaCopy.ts` from another branch**; it's a single-owner file (CODEOWNERS).
3. **State enums map to keys by name:** the D-14 Answer Strip states use the engine enum as the last key segment
   (`answer.label.<SunCellState|EarthCellState>`, `answer.sun.<state>`, `answer.earth.<state>`), and so do panel
   presets (`touchdown.preset.<PanelPreset>`), map layers (`map.layer.<MapLayerId>`), verdicts
   (`verdict.<Verdict>`), views (`view.<ViewId>`) and slots (`slot.<SlotId>`). A new enum value needs a new key.
4. **`.long` suffix** = the full name used for the tooltip, `aria-label` or wide layouts. The plain key is the short label
   shown when space is tight (Mission Bar at c2–c4).
5. **Educator copy:** plain language, rounded, no jargon, no symbols without words. It must still carry the
   uncertainty ("give or take", "hard to pin down"). It never drops the ± that `{t}` carries.
6. **Length budget:** strings must fit their slot at V4 (1280×720, type ×0.9). The worst case is checked by
   `npm run e2e` with `?fixture=worst-case` (guide §5.1).

## 3. Current Educator overrides

181 keys (full wording in §4): `mb.*` (16), `verdict.*` (10), `profile.*` (10), `answer.*` (31), `metric.*` (4),
`sb.*` (21), `def.*` (32), `gloss.*` (4).

Phase 4 added the Compare left column and the battery check: `rows.*` (scenario rows A–D: baseline, duplicate,
remove, load into Cockpit, attitude summary), `battery.*` (Profile & Battery accordion + battery line: "Survives
longest night ✓ with {h} h margin"), the Mission Profile form fields + validation messages (`profile.*`, incl.
`profile.usableDodPct` and `profile.err.*`), the requirement list in the verdict popover (`profile.req.*`,
`profile.provisional.scan`), the Compare slip target (`slip.target.*`, `slip.chip`) and the Windows caption
(`compare.windows.*`). Educator wording is included for all of them except the `*.long` field tooltips.

Phase 3 added plain-language Educator wording for the Definitions Bar line and every ✎ popover field (PLAN §8.3
"Educator persona shows a plain-language version"), the site cards, and the tooltip headings.

Phase 2 completed Educator wording for **all 9 D-14 Answer Strip states** (labels, value templates, grazing,
"dark for", below-ops and the shared now/window cells), the Mission Bar jump labels and tooltips, the verdict
chip and the Mission Profile popover. Which keys make up each D-14 state is indexed in
`web/src/content/answerStates.ts` (`ANSWER_STATE_COPY`); `web/src/app/missionBar.test.tsx` checks every
state has a Planner string and a different Educator string, and that Educator keeps every `{placeholder}`.

**To do (Phase 5, A-12):** Educator wording for the remaining Metric Deck, map and Scan keys, plus the
"What am I seeing?" callouts.

## 4. Key reference (365 keys, generated from `personaCopy.ts`)

### `app.*` · App · used by Abhinav

| Key | Planner | Educator override |
|---|---|---|
| `app.name` | LUMEN |  |
| `app.tagline` | Lunar Mission ENvironment Navigator |  |

### `view.*` · View tabs · used by Abhinav

| Key | Planner | Educator override |
|---|---|---|
| `view.cockpit` | Cockpit |  |
| `view.cockpit.long` | Mission Cockpit |  |
| `view.compare` | Compare |  |
| `view.compare.long` | Scenario Compare & Slip |  |
| `view.methodology` | Methodology |  |
| `view.methodology.long` | Methodology & Validation |  |

### `mb.*` · Mission Bar · used by Abhinav

| Key | Planner | Educator override |
|---|---|---|
| `mb.landing` | Landing |  |
| `mb.landing.long` | Landing date & time (UTC) |  |
| `mb.duration` | Mission duration |  |
| `mb.met` | MET | Time since landing |
| `mb.jump.sunset` | Sunset |  |
| `mb.jump.sunset.long` | Next Sunset | Jump to the next sunset |
| `mb.jump.earthset` | Earthset |  |
| `mb.jump.earthset.long` | Next Earthset | Jump to when Earth next sets |
| `mb.jump.earthrise` | Earthrise |  |
| `mb.jump.earthrise.long` | Next Earthrise | Jump to when Earth next rises |
| `mb.jump.shadowExit` | Shadow exit | Sun returns |
| `mb.jump.shadowExit.long` | Next Shadow Exit | Jump to when the Sun comes back |
| `mb.jump.touchdown` | T0 | Landing |
| `mb.jump.touchdown.long` | Touchdown (T0) | Jump back to the landing moment |
| `mb.jump.none` | No such event in this window | That does not happen in this window |
| `mb.jump.group` | Jump to event | Jump to a moment |
| `mb.jump.tip` | {label} · {time} UTC ± {pm} · key {key} | {label} — {time} UTC, give or take {pm} (press {key}) |
| `mb.jump.tipExact` | {label} · {time} UTC · key {key} | {label} — {time} UTC (press {key}) |
| `mb.jump.tipGrazing` | {label} · {time} UTC ± {pm} (grazing) · key {key} | {label} — around {time} UTC, hard to pin down (give or take {pm}) (press {key}) |
| `mb.jump.tipNone` | {label} · none before window end · key {key} | {label} — does not happen before the window ends (press {key}) |
| `mb.verdict` | Verdict |  |
| `mb.verdict.long` | Verdict against the Mission Profile — click for details | How this plan does against the mission’s must-haves — click for details |
| `mb.persona` | Persona |  |
| `mb.share` | Share |  |
| `mb.share.long` | Share Scenario URL |  |
| `mb.share.toast` | Scenario link copied — opens this exact site, date, attitude and view. | Link copied — anyone who opens it sees exactly this view. |
| `mb.share.failed` | Could not copy automatically — the link is in the address bar. |  |

### `persona.*` · Persona switch · used by Abhinav

| Key | Planner | Educator override |
|---|---|---|
| `persona.planner` | Planner |  |
| `persona.planner.long` | Mission Planner |  |
| `persona.educator` | Educator |  |
| `persona.educator.long` | Educator / Explorer |  |

### `verdict.*` · Verdict chip · used by Abhinav

| Key | Planner | Educator override |
|---|---|---|
| `verdict.GO` | GO | Looks good |
| `verdict.MARGINAL` | MARGINAL | Borderline |
| `verdict.NO-GO` | NO-GO | Not viable |
| `verdict.PENDING` | PENDING | Not sure yet |
| `verdict.provisional` | provisional | first guess |
| `verdict.GO.long` | GO — every hard threshold passes on the conservative bound | Looks good — passes every must-have, even in the cautious case |
| `verdict.MARGINAL.long` | MARGINAL — passes on the nominal value but not on the conservative bound | Borderline — passes on the best guess, but not in the cautious case |
| `verdict.NO-GO.long` | NO-GO — at least one hard threshold fails | Not viable — at least one must-have fails |
| `verdict.PENDING.long` | PENDING — cannot be judged yet (missing data or insufficient terrain evidence); see reasons | Not sure yet — some data is still missing, so this cannot be judged |
| `verdict.provisional.long` | Provisional — uncertainty bounds still computing; GO needs the conservative bound | First guess — the give-or-take is still being worked out |
| `verdict.headline.GO` | Meets the profile | Looks promising |
| `verdict.headline.MARGINAL` | Borderline | Close call |
| `verdict.headline.NO-GO` | Does not meet the profile | Not a good fit |
| `verdict.headline.PENDING` | Needs terrain data | We can’t be sure yet |

### `profile.*` · Mission Profile form + verdict popover (requirement list) · used by Abhinav

| Key | Planner | Educator override |
|---|---|---|
| `profile.title` | Mission Profile | Mission must-haves |
| `profile.reasons` | Why |  |
| `profile.thresholds` | Hard thresholds | Must-haves |
| `profile.surfaceDurationDays` | Surface duration | Time on the surface |
| `profile.minSunlitPct` | Min sunlit | Sunlight needed |
| `profile.minLinkHours` | Min link | Radio contact needed |
| `profile.maxLongestNightH` | Max longest night | Longest dark spell allowed |
| `profile.maxPadSlopeDeg` | Max pad slope | Steepest ground allowed |
| `profile.batteryWh` | Battery | Battery size |
| `profile.loadW` | Load | Power used |
| `profile.edit` | Edit in Compare | Change in Compare |
| `profile.placeholder` | The editable profile form arrives with the Compare view. | You will be able to change these in the Compare view. |
| `profile.noReasons` | No reasons reported yet. | No explanation yet. |
| `profile.close` | Close |  |
| `profile.usableDodPct` | Usable DoD | Battery you can use |
| `profile.surfaceDurationDays.long` | Surface duration (days) — the evaluated mission length for the profile |  |
| `profile.minSunlitPct.long` | Hard minimum: share of the window with the Sun available |  |
| `profile.minLinkHours.long` | Hard minimum: hours of Earth link over the window |  |
| `profile.maxLongestNightH.long` | Hard maximum: longest continuous run without Sun |  |
| `profile.maxPadSlopeDeg.long` | Hard maximum: pad slope |  |
| `profile.batteryWh.long` | Battery capacity (Wh) |  |
| `profile.usableDodPct.long` | Usable depth of discharge (%) — share of the battery the mission may draw |  |
| `profile.loadW.long` | Average load during the night (W) |  |
| `profile.form.hint` | Applies to every row and the Cockpit · recomputes as you type | Used for every plan · updates as you type |
| `profile.err.number` | enter a number | type a number |
| `profile.err.range` | must be {min}–{max} {unit} | pick {min}–{max} {unit} |
| `profile.err.int` | whole days only | whole days only |
| `profile.err.linkExceeds` | more than the {h} h on the surface | longer than the {h} h on the surface |
| `profile.short.sunlit` | sunlit | sun |
| `profile.short.link` | link | radio |
| `profile.short.night` | night | dark |
| `profile.short.slope` | slope | slope |
| `profile.req.title` | Hard requirements · conservative bound | Must-haves · cautious case |
| `profile.req.pass` | pass | ok |
| `profile.req.marginal` | marginal | borderline |
| `profile.req.fail` | fail | no |
| `profile.req.unknown` | no data | unknown |
| `profile.req.battery` | Battery vs longest night | Battery lasts the night |
| `profile.req.valueHint` | Conservative bound (nominal in brackets) |  |
| `profile.req.legend` | Limit · conservative bound (nominal). GO needs every requirement to pass on the conservative bound. | Limit · cautious value (best guess). “Looks good” needs every must-have to pass even in the cautious case. |
| `profile.provisional.scan` | Scan results are stage 1 only — verdicts stay provisional until bounded rows arrive. | The search has only first guesses so far — answers firm up when the careful results arrive. |

### `slot.*` · Slot labels (placeholders, accessible names) · used by Abhinav

| Key | Planner | Educator override |
|---|---|---|
| `slot.search` | Site search & filters |  |
| `slot.map` | South Pole Basemap |  |
| `slot.siteList` | Site cards |  |
| `slot.answer` | Answer Strip |  |
| `slot.definitions` | Definitions Bar |  |
| `slot.ribbon` | SKYLINE Ribbon |  |
| `slot.analysis` | Analysis tabs |  |
| `slot.barcode` | Survival Barcode |  |
| `slot.slip` | Slip Bar |  |
| `slot.metricDeck` | Metric Deck |  |
| `slot.touchdown` | Touchdown Pad |  |
| `slot.profileBattery` | Profile & Battery |  |
| `slot.scenarioRows` | Scenario rows A–D |  |
| `slot.missionProfile` | Mission Profile |  |
| `slot.compareSlip` | Global slip |  |
| `slot.compareTabs` | Centre view |  |
| `slot.compareVisual` | Compare visual |  |
| `slot.scan` | Scan |  |
| `slot.deltaTable` | Delta vs baseline |  |
| `slot.compareWindows` | Windows Table (selected row) |  |
| `slot.methodology` | Methodology & Validation |  |

### `right.*` · Right-column tabs (V4/V4b) · used by Abhinav

| Key | Planner | Educator override |
|---|---|---|
| `right.metrics` | Metrics |  |
| `right.touchdown` | Touchdown |  |

### `compare.*` · Compare centre toggle + Windows caption · used by Abhinav

| Key | Planner | Educator override |
|---|---|---|
| `compare.windows.cockpit` | Windows — Cockpit scenario | Time windows — Cockpit plan |
| `compare.windows.pending` | row {id} view pending | plan {id} coming soon |
| `compare.windows.pending.long` | The Windows Table shows the Cockpit result until it accepts a per-row result. Load the row into the Cockpit (↗) to see its windows. |  |
| `compare.aligned` | Aligned Barcodes |  |
| `compare.season` | Season Strip |  |
| `compare.calendar` | Calendar |  |

### `answer.*` · Answer Strip (D-14 states) · used by Nived

| Key | Planner | Educator override |
|---|---|---|
| `answer.sunNow` | Sun now | The Sun right now |
| `answer.earthNow` | Earth now | Earth right now |
| `answer.up` | UP | in the sky |
| `answer.down` | DOWN | below the horizon |
| `answer.disk` | {n}% disk | {n}% of the Sun showing |
| `answer.linkOk` | link ✓ | radio contact ✓ |
| `answer.linkDown` | link ✗ | no radio contact ✗ |
| `answer.windowSunlit` | Window sunlit | Sunlight over the mission |
| `answer.windowLink` | Window link | Radio contact over the mission |
| `answer.label.sunsetIn` | Sunset | Next sunset |
| `answer.label.sunriseIn` | Sunrise (Shadow Exit) | Sun comes back |
| `answer.label.noSunriseBeforeEnd` | Sunrise | Sun comes back |
| `answer.label.staysUpPastEnd` | Sunset | Next sunset |
| `answer.label.belowOpsElevation` | Ops elevation | Sun too low |
| `answer.label.earthsetIn` | Earthset | Earth sets |
| `answer.label.earthriseIn` | Earthrise | Earth rises |
| `answer.label.linkResumesDsn` | Link | Radio contact |
| `answer.sun.sunsetIn` | Sunset in {t} | The Sun sets in {t} |
| `answer.sun.sunriseIn` | Sunrise (Shadow Exit) in {t} | The Sun comes back in {t} |
| `answer.sun.darkFor` | dark for {t} so far | dark for {t} already |
| `answer.sun.noSunriseBeforeEnd` | No sunrise before window end (+{n} d) | The Sun does not come back in this window (+{n} days) |
| `answer.sun.staysUpPastEnd` | Stays up past window end | The Sun stays up for the whole window |
| `answer.sun.belowOps` | Below ops elevation ({deg}°) — ops resume in {t} | Too low for the lander ({deg}°) — usable again in {t} |
| `answer.sun.belowOpsNoResume` | Below ops elevation ({deg}°) | Too low for the lander ({deg}°) |
| `answer.earth.earthsetIn` | Earthset in {t} | Earth sets in {t} |
| `answer.earth.earthriseIn` | Earthrise in {t} | Earth rises in {t} |
| `answer.earth.linkResumes` | Link resumes in {t} (DSN) | Radio contact returns in {t} |
| `answer.earth.noChange` | No change before window end | No change before the window ends |
| `answer.grazing` | {t} (grazing) | {t} (skims the horizon) |
| `answer.grazingFull` | grazing — timing poorly constrained | skims the horizon — timing is hard to pin down |
| `answer.smoothMoon` | smooth-sphere estimate · terrain unavailable | flat-Moon estimate |

### `metric.*` · Metric Deck · used by Nived

| Key | Planner | Educator override |
|---|---|---|
| `metric.sunElevation` | Sun elevation |  |
| `metric.clearance` | Clearance / disk |  |
| `metric.earthEl` | Earth el / margin |  |
| `metric.sunlit` | Sunlit % | Time in sunlight |
| `metric.link` | Link % | Time in radio contact |
| `metric.longestNight` | Longest night | Longest dark spell |
| `metric.commGap` | Comm gap | Longest radio silence |
| `metric.ops` | Ops hours |  |
| `metric.psr` | PSR distance |  |
| `metric.psrDerived` | derived |  |
| `metric.psrWording` | permanently shadowed region (a cold trap that may host ice) |  |
| `metric.empty` | No result yet |  |
| `metric.more` | +{n} more |  |

### `map.*` · Basemap · used by Nived

| Key | Planner | Educator override |
|---|---|---|
| `map.extent.80S` | 80–90°S |  |
| `map.extent.85S` | 85–90°S |  |
| `map.layer.none` | No layer |  |
| `map.layer.illumination` | Average illumination |  |
| `map.layer.earth_visibility` | Earth visibility |  |
| `map.layer.slope_hazard` | Slope hazard |  |
| `map.layer.psr` | PSR (derived) |  |
| `map.layer.psr_distance` | Distance to PSR |  |
| `map.opacity` | Layer opacity |  |
| `map.towardEarth` | toward Earth |  |
| `map.outside` | {name} is outside this view |  |
| `map.show` | Show {extent} |  |
| `map.notOnMap` | {name} is not on the south-pole maps ({lat}, {lon} · {km} km from the pole) |  |
| `map.inset.landing` | Landing |  |
| `map.inset.target` | Target |  |
| `map.inset.scale` | 100 m |  |

### `scan.*` · Scan Panel · used by Nived

| Key | Planner | Educator override |
|---|---|---|
| `scan.mode.dates` | This site ± days |  |
| `scan.mode.sites` | All sites |  |
| `scan.provisional` | provisional |  |
| `scan.bounded` | bounded |  |
| `scan.load` | Load |  |
| `scan.stage1` | Stage 1 · nominal |  |
| `scan.stage2` | Stage 2 · exact |  |
| `scan.running` | Scanning… |  |
| `scan.col.rank` | # |  |
| `scan.col.site` | Site · landing |  |
| `scan.col.verdict` | Verdict |  |
| `scan.col.sunlit` | Sun % |  |
| `scan.col.link` | Link % |  |
| `scan.col.night` | Night |  |

### `delta.*` · Delta Table · used by Nived

| Key | Planner | Educator override |
|---|---|---|
| `delta.metric` | Row |  |
| `delta.sunlit` | Δ sunlit |  |
| `delta.link` | Δ link |  |
| `delta.night` | Δ night |  |
| `delta.baseline` | baseline |  |
| `delta.empty` | Add a second scenario row to compare. |  |

### `ribbon.*` · Ribbon · used by Ebin

| Key | Planner | Educator override |
|---|---|---|
| `ribbon.title` | SKYLINE Ribbon |  |

### `analysis.*` · Analysis tabs · used by Ebin

| Key | Planner | Educator override |
|---|---|---|
| `analysis.tabs` | Analysis |  |
| `analysis.power` | Power & Elevation |  |
| `analysis.windows` | Windows Table |  |
| `analysis.pointing` | Pointing & Link |  |

### `slip.*` · Slip Bar (Ebin) + Compare slip (Abhinav)

| Key | Planner | Educator override |
|---|---|---|
| `slip.target.label` | Slip applies to | Move landing for |
| `slip.target.all` | All rows | All plans |
| `slip.target.row` | Row {id} | Plan {id} |
| `slip.target.selected` | Selected row | Picked plan |
| `slip.target.noRows` | Add a row first |  |
| `slip.minus` | −1 day |  |
| `slip.plus` | +1 day |  |
| `slip.reset` | reset |  |
| `slip.chip` | slipped {d} d | moved {d} d |
| `slip.none` | no slip | on time |
| `slip.label` | Landing slip (days) |  |

### `touchdown.*` · Touchdown Pad · used by Ebin

| Key | Planner | Educator override |
|---|---|---|
| `touchdown.preset` | Panel preset |  |
| `touchdown.preset.fourSide` | 4 sides |  |
| `touchdown.preset.singleHeading` | 1 panel |  |
| `touchdown.preset.horizontalDeck` | Deck |  |
| `touchdown.preset.trackingMast` | Tracking mast |  |
| `touchdown.height` | Mast height |  |

### `sb.*` · Site Explorer sidebar · used by Abhinav

| Key | Planner | Educator override |
|---|---|---|
| `sb.search` | Search sites or “lat, lon” | Find a place, or type “lat, lon” |
| `sb.search.long` | Search sites by name, or type coordinates as “lat, lon” (e.g. −84.79, 29.20) | Find a landing site by name, or type a position as “latitude, longitude” |
| `sb.search.clear` | Clear search |  |
| `sb.coord.hint` | {lat} {lon} · not a catalog site | {lat} {lon} · your own spot |
| `sb.coord.analyse` | Analyse custom point | Explore this spot |
| `sb.coord.quick` | Quick Answer | Quick look |
| `sb.filter.group` | Site category |  |
| `sb.cat.all` | All |  |
| `sb.cat.all.long` | All |  |
| `sb.cat.artemis` | Artemis III |  |
| `sb.cat.artemis.long` | Artemis III |  |
| `sb.cat.historical` | Historical |  |
| `sb.cat.historical.long` | Historical Landings |  |
| `sb.cat.published` | Targets |  |
| `sb.cat.published.long` | Published Targets |  |
| `sb.cat.contrast` | Contrast |  |
| `sb.cat.contrast.long` | Contrast Sites |  |
| `sb.cat.custom` | Custom |  |
| `sb.cat.custom.long` | Custom |  |
| `sb.agency` | Agency |  |
| `sb.agency.all` | All agencies |  |
| `sb.agency.nasa_clps` | NASA/CLPS |  |
| `sb.agency.isro` | ISRO |  |
| `sb.agency.cnsa` | CNSA |  |
| `sb.agency.jaxa` | JAXA |  |
| `sb.agency.commercial` | Commercial |  |
| `sb.category.historical_landing` | Historical landing |  |
| `sb.category.published_target` | Published target |  |
| `sb.category.artemis_candidate_region` | Artemis III region |  |
| `sb.category.contrast_site` | Contrast site |  |
| `sb.category.custom` | Custom point |  |
| `sb.touchdown` | Touchdown {time} UTC | Landed {time} UTC |
| `sb.precision.minute` | to the minute | time known to the minute |
| `sb.precision.second` | to the second | time known to the second |
| `sb.asPublished` | as published {date} | as announced {date} |
| `sb.asPublished.pending` | as published · date pending | as announced |
| `sb.landing` | Landing | Where it landed |
| `sb.target` | Target | Where it aimed |
| `sb.coords` | Coordinates |  |
| `sb.compare` | + Compare |  |
| `sb.compare.long` | Add to Compare (or Shift-click the card) | Put this site side by side with others (or Shift-click the card) |
| `sb.compare.added` | Added to Compare as row {id}. |  |
| `sb.compare.full` | Compare already has 4 rows — remove one first. |  |
| `sb.spark.sun` | Sun | Sunlight |
| `sb.spark.link` | Link | Contact |
| `sb.spark.none` | no daily series |  |
| `sb.spark.summary` | {label} {n}% mean over the window | {label}: about {n}% of the time |
| `sb.verdict.pending` | Verdict pending — select the site to evaluate it | Click the site to see how it does |
| `sb.verdict.of` | Verdict {v} |  |
| `sb.tier` | Tier {tier} |  |
| `sb.tier.pending` | Tier – |  |
| `sb.tier.pending.long` | Fidelity tier not assigned yet | How much to trust the shadow timings here is not known yet |
| `sb.mock` | mock |  |
| `sb.empty` | No sites match. Clear the search or choose “All”. | Nothing matches. Clear the search or choose “All”. |
| `sb.loading` | Loading the site catalog… |  |
| `sb.error` | Could not load the site catalog: {e} |  |
| `sb.count` | {n} of {total} sites |  |
| `sb.card.hint` | Click to select · Shift-click to add to Compare | Click to explore · Shift-click to compare |
| `sb.quick.title` | Quick Answer | Quick look |
| `sb.quick.loading` | Computing… |  |
| `sb.quick.error` | Quick Answer failed: {e} |  |
| `sb.quick.open` | Open in Cockpit |  |
| `sb.quick.close` | Close |  |

### `def.*` · Definitions Bar + ✎ popover (R3 D-10) · used by Abhinav

| Key | Planner | Educator override |
|---|---|---|
| `def.label` | Definitions | Rules |
| `def.sun` | Sun available = ≥{disk}% disk above terrain{ops} @{h} m | The Sun counts as “up” when at least {disk}% of it clears the terrain{ops}, seen from {h} m |
| `def.sun.ops` |  + elevation ≥{deg}° |  and it is at least {deg}° high |
| `def.link` | Link = Earth ≥{margin}° above terrain{disk}{dsn} | Radio contact needs Earth at least {margin}° above the terrain{disk}{dsn} |
| `def.link.disk` |  (≥{n}% disk) |  with {n}% of it showing |
| `def.link.dsn` |  + DSN ≥{deg}° |  and a big dish on Earth seeing the Moon above {deg}° |
| `def.link.noDsn` |  (DSN not applied) |  (Earth’s dishes not checked) |
| `def.edit` | Edit definitions | Change the rules |
| `def.chip.isroVikramOps` | Preset: ISRO ops | Using ISRO’s rules |
| `def.chip.custom` | Custom rules | Your own rules |
| `def.chip.reset` | Reset to default definitions | Go back to the standard rules |
| `def.title` | Definitions | The rules |
| `def.intro` | These rules decide when the Sun and the Earth link count as available. Every panel recomputes when you change them. | These rules decide when the lander counts as having sunlight and radio contact. Change one and everything updates. |
| `def.f.sunDisk` | Sun disk threshold | How much of the Sun must show |
| `def.f.sunDisk.help` | Share of the solar disk that must clear the terrain. | A Sun half-hidden behind a ridge gives about half the power. |
| `def.f.height` | Observer height | How high the panels sit |
| `def.f.height.help` | Height of the panels and antenna above the ground. | Raising panels a few metres lets them see over nearby bumps. |
| `def.f.earthMargin` | Earth margin | Clear sky needed above Earth |
| `def.f.earthMargin.help` | DTE margin: Earth centre elevation above the terrain at Earth’s azimuth. | How far above the hills Earth must be for the radio to work. |
| `def.f.dteDisk` | DTE disk threshold | How much of Earth must show |
| `def.f.dteDisk.help` | Share of the Earth disk that must clear the terrain for direct-to-Earth. | A radio needs a clear view of Earth, not just a sliver of it. |
| `def.f.dsnMode` | DSN mode | Check Earth’s big dishes |
| `def.f.dsnMode.help` | DSN-aware: link also needs a Goldstone, Canberra or Madrid dish to see the Moon. | Someone on Earth must be facing the Moon to listen. |
| `def.dsn.off` | Off | No |
| `def.dsn.dsnAware` | DSN-aware | Yes |
| `def.f.dsnMask` | DSN mask | Lowest Moon the dishes can track |
| `def.f.dsnMask.help` | Minimum Moon elevation at the DSN complex. | Dishes can’t listen when the Moon is too close to their horizon. |
| `def.f.minSunElev` | Min Sun elevation (ops) | Lowest usable Sun |
| `def.f.minSunElev.help` | When above 0°, the Sun also has to be at least this high. 0 = off. | Some landers need the Sun a little higher before they can work. 0 means no limit. |
| `def.off` | off |  |
| `def.preset.isroVikramOps` | ISRO Vikram ops (min Sun elevation 6°) | Use ISRO’s Vikram rule (Sun at least 6° high) |
| `def.preset.isroVikramOps.source` | Source: mission team statement as reported. | As the mission team described it. |
| `def.preset.active` | active |  |
| `def.preset.default` | Reset to defaults | Back to the standard rules |
| `def.close` | Close |  |

### `gloss.*` · InfoBadge tooltip headings · used by the kit InfoBadge (everyone)

| Key | Planner | Educator override |
|---|---|---|
| `gloss.about` | About | What is |
| `gloss.formula` | Formula | How it’s worked out |
| `gloss.impact` | Impact | Why it matters |
| `gloss.source` | Source & σ | Where it comes from |
| `gloss.learnMore` | Learn more → |  |

### `credit.*` · CreditLine · used by the kit CreditLine (Ebin, Nived)

| Key | Planner | Educator override |
|---|---|---|
| `credit.prefix` | Credit |  |

### `battery.*` · Battery verdict + Profile & Battery accordion (Phase 4) · used by Abhinav

| Key | Planner | Educator override |
|---|---|---|
| `battery.title` | Profile & Battery | Plan & Battery |
| `battery.survives` | Survives longest night ✓ with {h} h margin | Battery lasts the longest night ✓ with {h} h to spare |
| `battery.short` | Short of the longest night ✗ by {h} h | Battery runs out ✗ {h} h before sunrise |
| `battery.unknown` | Battery check waits for longest-night data | Battery check waits for the night length |
| `battery.endurance` | endurance {h} h | lasts {h} h |
| `battery.night` | night {h} h ({bound}) |  |
| `battery.bound.conservative` | upper bound | cautious case |
| `battery.bound.nominal` | nominal | best guess |
| `battery.advisory` | advisory | guide |
| `battery.advisory.long` | Advisory: battery endurance (Wh × DoD ÷ load) vs the longest night — not part of the engine verdict yet |  |
| `battery.source.cockpit` | Cockpit scenario |  |
| `battery.source.row` | row {id} |  |

### `rows.*` · Compare scenario rows A–D (Phase 4) · used by Abhinav

| Key | Planner | Educator override |
|---|---|---|
| `rows.title` | Scenarios | Plans |
| `rows.add` | + Add |  |
| `rows.add.long` | Add the Cockpit scenario as a new row | Add the plan from the Cockpit |
| `rows.full` | Compare holds up to 4 rows — remove one first. | You can compare up to 4 plans — remove one first. |
| `rows.empty` | No scenarios yet. Add the Cockpit scenario, use “+ Compare” on a site card, or Shift-click a map pin. | No plans yet. Add the Cockpit plan, press “+ Compare” on a site, or Shift-click a pin on the map. |
| `rows.makeBaseline` | Make row {id} the baseline | Compare everything against plan {id} |
| `rows.isBaseline` | Row {id} is the baseline | Plan {id} is the one others are compared with |
| `rows.select` | Select row {id} | Pick plan {id} |
| `rows.duplicate` | Duplicate row {id} | Copy plan {id} |
| `rows.duplicated` | Row {id} duplicated as row {n}. | Plan {id} copied as plan {n}. |
| `rows.remove` | Remove row {id} | Remove plan {id} |
| `rows.load` | Load row {id} into the Cockpit | Open plan {id} in the Cockpit |
| `rows.loaded` | Row {id} loaded into the Cockpit. | Plan {id} opened in the Cockpit. |
| `rows.custom` | Custom point {coords} |  |
| `rows.slip` | slip {d} d | moved {d} d |
| `rows.tilt` | tilt {m}° @ {d}° |  |
| `rows.noTilt` | no tilt |  |
| `rows.preset.fourSide` | 4 side panels |  |
| `rows.preset.singleHeading` | 1 panel |  |
| `rows.preset.horizontalDeck` | deck |  |
| `rows.preset.trackingMast` | tracking mast |  |

### `state.*` · used by Abhinav

| Key | Planner | Educator override |
|---|---|---|
| `state.loading` | Calculating… |  |
| `state.error` | Can’t compute this scenario |  |
| `state.errorUnknown` | Something went wrong. Try changing the date or the site. |  |

## 5. `web/public/content/quickstart.json` (draft, built in Phase 5)

The file is currently `{}`. This is the shape `QuickStartDrawer` and `CoachmarkTour` will read. Sources: PLAN §6
"Quick-start scenario", §8.9, guide §3.3 and R3 D-10.

```jsonc
{
  "version": 1,
  "scenarios": [
    {
      "id": "cy3-validate",                       // stable id, kebab-case
      "order": 4,                                 // card position in the drawer (1–4)
      "title": "Validate a Real Landing: Chandrayaan-3",
      "promise": "Check our Sun elevation against the mission team's 8.75° at touchdown.", // one line on the card
      "persona": "planner",                       // persona the tour switches to: "planner" | "educator"
      "tourSeconds": 60,                          // shown as the "~60 s tour" chip
      // --- thumbnail (guide §3.3) ---
      "image": "thumbs/cy3-validate.webp",        // relative to /content/, local file only (no hotlinks), 16:9, WebP ≤ 60 KB
      "alt": "LROC view of the Chandrayaan-3 landing area near 69.4°S",
      "credit": "NASA/GSFC/Arizona State University",
      "sourceUrl": "https://…",                   // where the image came from
      "license": "Public domain (NASA); credit required",
      "fallback": "procedural",                   // shown if the image fails: a mini Horizon Lens render (Nived)
      // --- scenario to load (same shape as the share URL payload; frontend_state_api.md §3) ---
      "state": {                                  // Partial<Scenario>; missing fields = DEFAULT_SCENARIO
        "view": "cockpit",
        "site": { "kind": "site", "id": "cy3_shiv_shakti" },
        "landingUtc": 1692793980000,              // 2023-08-23T12:33:00Z (minute precision, D-12)
        "durationDays": 14,
        "definitionsPreset": "isroVikramOps",     // tour 4 applies the ISRO preset (D-10)
        "definitions": { "minSunElevationOps": 6 }
      },
      // --- coachmark tour ---
      "steps": [
        { "target": "ribbon", "text": "The Sun sits just above the ridge at touchdown…", "textEducator": "…" },
        { "target": "answer", "text": "…", "action": null },
        { "target": "definitions", "text": "…", "action": { "type": "applyDefinitionsPreset", "id": "isroVikramOps" } },
        { "target": "analysis", "text": "…", "action": { "type": "setAnalysisTab", "tab": "windows" } }
      ]
    }
  ]
}
```

**Field rules**

| Field | Rule |
|---|---|
| `version` | `1`. The loader rejects other versions |
| `scenarios` | exactly the 4 cards of PLAN §8.9, in `order` |
| `image` | local, under `web/public/content/thumbs/`. NASA/LROC preferred. ISRO imagery only with its terms recorded in `license`. **Never** a NASA logo or insignia, **never** an AI-generated image presented as real |
| `credit`, `license`, `sourceUrl` | required whenever `image` is set. The credit is shown on the image foot. Each image is also listed in `docs/credits_frontend.md` |
| `fallback` | always `"procedural"` (so cards never show an empty box) |
| `state` | decoded with the same rules as the URL (`decodeScenario`): unknown fields ignored, wrong shapes fall back to defaults. Loaded with `hydrate(state)` |
| `steps[].target` | a `SlotId` (`frontend_state_api.md` / `docs/ui_guide.md` §3) or `"missionBar"` |
| `steps[0..1]` | **every tour starts on the Ribbon and the Answer Strip**: the first two targets are `ribbon` and `answer` (either order) |
| `steps[].text` | Planner wording (plain string, not a copy key, so tour text stays editable in one file). `textEducator` is optional; it is used when persona = educator |
| `steps[].action` | optional store action run when the step opens: `{ type: <ScenarioActions name>, …args }`. Allowed: `applyDefinitionsPreset`, `setAnalysisTab`, `setCompareTab`, `setSlip`, `addCompareRow`, `setView`, `setPersona`, `commitScrub` |
| step count | 3–4 per tour (PLAN §8.9) |

**The four scenarios (ids fixed now; dates and text in Phase 5)**

| order | id | Title | persona | Notes |
|---|---|---|---|---|
| 1 | `shackleton-slip-9d` | Test a 9-Day Launch Delay at Shackleton | planner | baseline date chosen at H8 from a GO window; tour: slip +9 d → aligned barcodes → Scan |
| 2 | `im2-tilt` | Replay IM-2 Athena's Crater Tilt | planner | landing 2025-03-06T17:28:50Z; tilt 30°; label *"Illustrative; not Athena's actual array geometry."* |
| 3 | `apollo11-pole-earth` | Compare Apollo 11, the South Pole and Earth | educator | Apollo 11 vs a polar ridge row; Earth Twin overlay (Tier 1) |
| 4 | `cy3-validate` | Validate a Real Landing: Chandrayaan-3 | planner | ISRO ops preset; ends on Methodology G7 |

Open point: the Apollo 11 and Shackleton site ids must match Gowri's final `sites.json` ids.
