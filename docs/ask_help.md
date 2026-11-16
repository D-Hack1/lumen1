# ask_help.md

_Owner: Ebin_ — the plain-language help that Ask LUMEN searches (built into `web/public/content/knowledge.json` by
`web/scripts/build-knowledge.mjs`). Every entry is: `## Question`, then `Kind:`, `Source:` and `Tags:` lines, then the answer.
**Facts come only from PLAN_FINAL and from what the live pages actually say** — do not add a claim you can't point to.
Kinds: `howto` (using the interface), `method` (how results are calculated), `decision` (why a choice was made and how it
changes results), `concept` (background), `status` (what is and isn't connected yet — update these when that changes).
`Tags:` are extra words people might use; they are searched too.

## Are the numbers on the pages real?
Kind: status
Source: live pages ("Design preview · sample values" labels)
Tags: real, sample, fake, mock, placeholder, accurate, trust, preview, data
It depends on the mode LUMEN is running in. With real data, the pages wait for the ephemeris, Deep Space Network series and terrain masks and show numbers from the real calculation engine; Stand here says where each view comes from ("Real engine · terrain mask", or "smooth Moon" when a site or array height has no terrain data). Without real data the pages show the design's sample values and say so ("Design preview · sample values"). Sites with a Monte-Carlo terrain uncertainty (preliminary; for the coarse-mask sites it assumes a constant 1 m elevation error) show ± values and [low, high] ranges. Any site without one shows "σ unavailable" or the smooth-Moon label and no ±. The engine itself is checked against reference data (see the validation report).

## What questions can LUMEN answer?
Kind: concept
Source: PLAN_FINAL §1.3
Tags: purpose, what is lumen, what does it do, who is it for, who, tool, audience, users, use cases, goal
LUMEN answers five kinds of question for the lunar south pole. A planner: is the Sun up here at a given time, how much of it, and for how long? A comms engineer: when can we talk to Earth, where do we point, and is a Deep Space Network station listening? A planner after a delay: we slipped N days, which sites and dates still meet our profile? Anyone with a coordinate: just give me the numbers for this latitude, longitude and time. An educator or visitor: why is the south pole so different from Apollo, and from Earth?

## How do I move between pages?
Kind: howto
Source: live pages (header navigation)
Tags: navigate, navigation, menu, pages, views, switch, go to, open, tabs
Use the links in the header: Orbit, Stand here, Compare and Slip explorer. You can also press / to open Ask LUMEN and type "go to compare", "go to orbit", "stand here" or "go to slip explorer".

## How do I use the Orbit page?
Kind: howto
Source: live pages (Orbit)
Tags: orbit, globe, moon, rotate, zoom, spin, drag, scroll, map, south pole, view
Orbit shows the Moon from space. Drag to rotate it, scroll or use the + and − buttons to zoom, and use the reset button to return. Switch between the whole Moon and the south pole with the view buttons. The Sun orbits the Moon once a month and passes behind it, and Earth sits fixed over the near side because the Moon is tidally locked. Arrows at the edge point to the Sun or Earth when they leave the frame.

## How do I choose a landing site?
Kind: howto
Source: live pages (Orbit, Stand here)
Tags: select, pick, choose, site, landing site, location, change site, switch site, go to site
Click a site in the Curated sites list on the Orbit page, or click one of the site buttons at the top of Stand here and Slip explorer. You can also press / and type the site's name, for example "show IM-2" or "malapert". The chosen site is shared by every page.

## How do I look up my own coordinates?
Kind: howto
Source: live pages (Orbit, "Go to coordinates")
Tags: coordinates, latitude, longitude, lat lon, pin, drop pin, custom, my own place, point
On the Orbit page, enter a latitude and longitude in "Go to coordinates" (decimal degrees, or add S, N, E or W) and choose "Drop pin here". You can also click anywhere on the Moon to drop a pin. The pin becomes a custom site you can stand on or compare. For a custom point the values are estimated from a simplified terrain model.

## What does the Stand here page show?
Kind: howto
Source: live pages (Stand here)
Tags: stand here, horizon, panorama, skyline, sun path, earth path, surface view, what you would see, sets in
Stand here is the view from the surface of the chosen site: the terrain skyline all the way around, with the Sun's path (amber) and the Earth's path (sage) over a lunar month as dashed lines. Hover over the panorama for the bearing and the skyline height at that point. The panels below give the Sun's and Earth's elevation and how long until each sets, at the time you have scrubbed to.

## How do I scrub or play through time?
Kind: howto
Source: live pages (Orbit timeline, Stand here)
Tags: time, scrub, play, timeline, slider, clock, date, animate, month, advance, pause
Use the Play button to advance time, and drag the slider to scrub a full lunar month. On Orbit the Sun loops around the Moon as you scrub; on Stand here the Sun and Earth move along their dashed paths.

## What does the array height (mast) control do?
Kind: howto
Source: live pages (Stand here, Orbit) and PLAN_FINAL §2
Tags: mast, array, height, solar array, panel height, raise, taller, 1 m, 2 m, 5 m, 10 m
It sets how high above the ground the solar array sits. A taller mast can see over nearby terrain, so the horizon line drops and more of the Sun and Earth can be visible. The page offers a few heights (0, 1, 2, 5 and 10 m).

## How do I compare sites?
Kind: howto
Source: live pages (Compare)
Tags: compare, comparison, versus, side by side, several sites, two sites, four sites, table, best
Open Compare and pick up to four sites with the chips. Every number is for the same 14-day window, shown side by side, and the best value in each row is marked. Picking a fifth site replaces the oldest, and at least one stays selected. Each site has a "Stand here" link to look at its horizon.

## What is the Slip explorer and how do I use it?
Kind: howto
Source: live pages (Slip explorer)
Tags: slip, delay, postpone, later, launch delay, what if, shift landing, push back, late
Slip explorer answers "what if we slip?". Each bar is a 14-day window that starts that many days after the base date, so you can see how a later landing changes sunlight and the link home. Slide or click a bar to pick a slip, compare it with landing on time (the dashed baseline), and use "Jump to it" for the best window. You can also press / and type "slip 9 days".

## How do I slip the landing with the keyboard?
Kind: howto
Source: Ask LUMEN
Tags: slip, keyboard, command, type, shortcut, delay days, move days, reset slip, back to on time, on time, undo slip, no delay, zero
Press / to open Ask LUMEN, then type for example "slip 9 days", "delay 3 days" or "slip 0" to go back to on time. The slip can be from 0 to 27 days; anything outside that is clamped and the box tells you.

## How do I use Ask LUMEN?
Kind: howto
Source: Ask LUMEN
Tags: ask, help, assistant, slash, search, commands, shortcut, keyboard, how to use
Press / anywhere (not while typing in a field) or use the Ask button in the header. Type a command ("go to compare", "show IM-2", "slip 9 days"), a term ("what is libration"), or a question ("how is the sunlight percentage calculated?", "why is this ± so big?"). It works offline. It is search and fixed explanations, not a chatbot: it only answers from LUMEN's own glossary, plan and validation notes, and it tells you when it has no answer. Esc closes it.

## How do I switch between light and dark mode?
Kind: howto
Source: live pages (header)
Tags: theme, light, dark, mode, colour, color, appearance, contrast
Use the theme button in the header ("Light mode" or "Dark mode"). Your choice is remembered on this device.

## What do the amber and sage colours mean?
Kind: howto
Source: live pages (Stand here legend)
Tags: colour, color, legend, amber, sage, green, orange, sun, earth, key
Amber is the Sun and sage (green) is the Earth: dashed lines trace their paths. On the timeline, the bars show Sunlight, Earth in view and DSN contact. Colour is paired with a label or pattern, so nothing relies on colour alone.

## What does "Sets in 9 d 6 h" mean?
Kind: howto
Source: live pages (Stand here)
Tags: sets in, countdown, rises, sunset, earthset, time until, how long
It is the time from the moment you have scrubbed to until the Sun (or Earth) next dips below the horizon at this site. Move the time slider and the countdown changes.

## What do the labels Good, Marginal and No DTE on a site mean?
Kind: howto
Source: live pages (site list) and glossary (DTE margin)
Tags: good, marginal, tag, badge, site rating, status, go no go
They are a quick rating shown on each site (sample values for now): Good, Marginal, or "No DTE", meaning no direct-to-Earth contact (for example on the far side). The full rule for LUMEN's GO / MARGINAL / NO-GO verdict is described under "How is the verdict decided?".

## What does LUMEN not calculate?
Kind: concept
Source: PLAN_FINAL §5.5 and §9 (Cut)
Tags: limits, scope, not included, limitations, out of scope, what it doesn't do, link budget, thermal, data rate
LUMEN is about geometry: where the Sun and Earth are, whether terrain blocks them, and what that means for light and contact. It does not compute a link budget, data rate or signal margin, and it does not model thermal behaviour. Its power numbers use a generic panel model, not any specific lander's array.

## How is Sun elevation calculated?
Kind: method
Source: PLAN_FINAL §5.2 and glossary (Sun elevation)
Tags: sun elevation, sun angle, how high, altitude, calculated, computed, how do you get, ephemeris, position
Sun elevation is the angle of the Sun's centre above the local horizontal plane. The Sun's position comes from a precomputed ephemeris, interpolated smoothly in time (cubic Hermite, using stored position and velocity). LUMEN subtracts the site's position, normalises the direction, and rotates it into the site's own frame to read off the elevation and azimuth.

## How is the direction (azimuth) defined at the pole?
Kind: method
Source: PLAN_FINAL §5.1
Tags: azimuth, direction, compass, north, bearing, earth-referenced, pole, frame, singular
Near the pole "east" is undefined (every direction is south), so LUMEN does not use East = ẑ × up. Instead each site has a reference axis: toward 0°E (the mean direction to Earth) for sites poleward of 60°, otherwise the lunar north axis. Azimuth is measured from that reference. At polar sites this is shown as "Earth-referenced azimuth"; elsewhere it is true azimuth.

## How often does LUMEN sample time, and how exact are the event times?
Kind: method
Source: PLAN_FINAL §5.3
Tags: sampling, time step, resolution, accuracy, precision, events, bisect, minutes, how often
Near the horizon (within about ±3° of clearance) it steps every 2 minutes; elsewhere every 60 minutes. The step is chosen from how fast the Sun or Earth is moving, so nothing is skipped. When something changes (a sunset, an Earthset, the disk crossing 0%, 50% or 100%), LUMEN narrows in on the exact moment to about 10 seconds.

## How is "how much of the Sun is visible" calculated?
Kind: method
Source: PLAN_FINAL §5.4
Tags: disk, disk fraction, partial sun, visible, percent of sun, terrain blocking, horizon, grazing, chord
The Sun and Earth are not points: LUMEN slices each disk into chords (24 for the Sun, 32 for Earth), scales each chord's width for the viewing angle, and compares each chord against the terrain horizon in its own direction. The share of chords above the horizon is the visible fraction of the disk, from 0 to 1. This is why a Sun skimming a ridge can be partly visible.

## How is the sunlit percentage calculated?
Kind: method
Source: PLAN_FINAL §5.4, §5.8 and glossary
Tags: sunlit, sunlight, percent, percentage, time in sun, light fraction, how much sun, availability, definition
A moment counts as sunlit when enough of the Sun's disk clears the terrain horizon; the threshold is a definition you can see and edit (for example "Sun at least 50% of the disk"). Sunlit % is the share of the chosen window that meets it. To show how sure we are, LUMEN evaluates the window three times — with the terrain horizon lowered by its uncertainty, as is, and raised by it — and reports the nominal value with a [low, high] range.

## How is the link to Earth decided?
Kind: method
Source: PLAN_FINAL §5.5
Tags: link, contact, communications, comms, dsn, earth visible, radio, direct to earth, dte, deep space network
Earth counts as visible when at least 50% of its disk is above the terrain horizon and the margin (DTE margin) is at least a threshold (default 1°). With DSN awareness on, the link is up only when Earth is visible AND at least one Deep Space Network complex (Goldstone, Canberra or Madrid) sees the Moon above its own horizon mask (default 10°). LUMEN also reports Earth's azimuth and elevation, range, one-way light time and disk fraction.

## What is the Earth–Moon light time and range?
Kind: method
Source: PLAN_FINAL §2, §5.5
Tags: range, distance, light time, delay, latency, how far, signal delay, speed of light, how long does the signal take, travel time, one way, seconds
Range is the distance from the site to Earth, and light time is that range divided by the speed of light — about 1.28 seconds one way on average.

## How is the longest night calculated?
Kind: method
Source: glossary (Longest night) and PLAN_FINAL §5.7
Tags: longest night, dark, darkness, longest dark stretch, battery, survive the night
It is the longest continuous stretch in the window when the Sun is not available under the chosen definition. It matters because a lander's battery must carry it through; LUMEN can compare it with battery endurance (battery energy × usable depth of discharge ÷ load).

## How is the verdict (GO / MARGINAL / NO-GO) decided?
Kind: method
Source: PLAN_FINAL §5.7
Tags: verdict, go, no go, marginal, rating, requirements, pass, fail, profile, viability, score
It checks the mission profile's hard requirements (for example minimum sunlit %, minimum link hours, maximum longest night, maximum pad slope). GO means every requirement passes even at the conservative bound. MARGINAL means one passes only at its nominal value or is within 10% of its limit. NO-GO means a requirement fails. The Viability Index is a weighted score of the same components, shown beside the verdict.

## How is the pad slope computed?
Kind: method
Source: PLAN_FINAL §5.6
Tags: slope, pad, tilt, ground, touchdown, uphill, downhill, aspect, terrain slope, steep
LUMEN fits a plane by least squares to the terrain over a footprint of about 5–6 m. The slope is the angle between that plane's normal and straight up. The downhill aspect is the compass direction of the steepest descent, and uphill is exactly opposite (downhill + 180°). Where the terrain data is too coarse for that footprint the slope is badged "under-resolved".

## How is solar power estimated?
Kind: method
Source: PLAN_FINAL §5.6
Tags: power, watts, energy, solar panel, array, cosine, panel angle, generation, output, preset
Power at a moment is the solar flux times the sum over panels of (area × efficiency × the cosine of the angle between the panel and the Sun, never below zero), times the visible fraction of the Sun's disk. The preset decides how many panels there are and where they point: four vertical side panels, one vertical panel at a heading, a horizontal deck, or a vertical Sun-tracking mast (an upper bound). These are generic geometries, not a specific lander.

## How is the ± on an event time calculated?
Kind: method
Source: PLAN_FINAL §5.8
Tags: plus minus, ±, uncertainty, error, margin, sunset time, sunrise time, how sure, confidence, sigma, bounds
Each event time carries a ± from the horizon's uncertainty: δt = σ ÷ |how fast the Sun's clearance above the horizon is changing| at that moment, where σ is the terrain uncertainty in that direction. So "Sunset in 41 h ± 5 h" means a horizon error of one σ would move the sunset by about 5 hours. If the clearance changes very slowly or the ± grows past about 12 hours, the event is labelled "grazing — timing poorly constrained" and a range is shown instead.

## What are the fidelity tiers A, B and C?
Kind: method
Source: PLAN_FINAL §4.2
Tags: tier, tier a, tier b, tier c, fidelity, accuracy level, detail, terrain data, badge, resolution
Tier C is a smooth sphere with no terrain (outside coverage, such as Apollo or SLIM sites), so its times are labelled "smooth-sphere estimate; terrain unavailable" and are not terrain-bounded predictions.

## Why does the Sun skim the horizon at the poles?
Kind: concept
Source: PLAN_FINAL §2
Tags: sun low, horizon, polar, why low sun, grazing light, pole, month, orbit, tilt, 1.54
The Moon's equator is tilted only about 1.54° to the ecliptic, so the Sun never climbs high at the poles: its maximum elevation is about (90° − latitude) + 1.54°. It circles the horizon about once per synodic month (29.53 days), which is why shadows are long and light comes and goes with every ridge.

## Why is the timing uncertainty hours, not minutes?
Kind: concept
Source: PLAN_FINAL §5.8
Tags: uncertainty hours, why so big, large error, slow sun, 0.044, near horizon, rate, sensitive
Near the pole the Sun's elevation changes very slowly — about 0.044° per hour at 85°S and 0.009° per hour at 89°S near the horizon — so a small horizon error shifts the moment of sunset a lot. A 0.2° error can move a sunset by about 4–5 hours at 85°S and nearly a day close to 89°S. Where the Sun slides sideways behind a steep ridge edge the effect is much smaller.

## Why does the Earth bob up and down near the horizon?
Kind: concept
Source: PLAN_FINAL §2
Tags: libration, earth wobble, earth moves, earth bobbing, sub-earth point, oscillation, tidal lock
The Moon always shows nearly the same face to Earth (tidal locking), but it rocks slightly: optical libration is about ±6.7° in latitude and ±7.9° in longitude. Seen from near the pole, that makes Earth bob roughly ±7° near the horizon, so ridges can hide it and reveal it again.

## Is there twilight or atmosphere on the Moon?
Kind: concept
Source: PLAN_FINAL §2, §5.9
Tags: atmosphere, twilight, air, refraction, sky, dusk, dawn, shadows, black sky, earth twin
No. There is no atmosphere, so there is no refraction and no twilight: the Sun goes from visible to gone as it crosses the horizon, shadows are pitch black, and the sky is black. The Earth Twin comparison shows this against an Earth location at the same latitude.

## What is the Earth Twin?
Kind: concept
Source: PLAN_FINAL §5.9 and glossary
Tags: earth twin, compare to earth, terrestrial, antarctica, same latitude, educational, contrast, day length
The Earth Twin draws the Sun's path for an Earth location at the same latitude (at 85°S that is Antarctica) over one day, using a standard terrestrial solar formula, labelled an educational approximation. The contrast is the lesson: a day lasts about 24 hours on Earth and about 29.5 days at the lunar pole, there is twilight on Earth and none on the Moon, and the sky and shadows differ.

## Why does a taller mast change the result?
Kind: decision
Source: PLAN_FINAL §2 and glossary (Mast height)
Tags: mast, height effect, raise array, horizon dip, why height matters, taller, lower horizon
Raising the array lowers the effective horizon: for a height h the horizon dips by √(2h/R), about 0.06° at 1 m and 0.19° at 10 m, and from higher up the array can see over nearby terrain that blocks it at ground level. Near the pole a fraction of a degree can decide whether the Sun is visible, so LUMEN lets you change the height instead of fixing one.

## Why is the slope clamp never applied to the terrain horizon itself?
Kind: decision
Source: PLAN_FINAL §5.6
Tags: clamp, slope plane, occluder, negative horizon, sphere dip, why clamp, terrain mask, uphill
The slope-plane correction is only allowed to raise the horizon, never to flatten it. Sphere dip and legitimately negative horizons must survive, and at the pole the Sun lives within about ±1.5° of the horizon, so clamping the terrain itself would remove real sunlight. The correction is used where it matters (Tier B, or terrain coarser than about twice the footprint) and the badge shows when it is active.

## Why does LUMEN show a ± on every time and percentage?
Kind: decision
Source: PLAN_FINAL Revision 2 (R2-7) and §5.8
Tags: why plus minus, why uncertainty, honest, error bars, why show bounds, trust, decision
Because near the pole a 0.2° horizon error can shift a sunrise or sunset by hours, a single number would sound more certain than it is. So every event time carries a ±, and every percentage carries a [low, high] range, with the source of the uncertainty (default, Monte-Carlo or calibrated) shown in the tooltip in the full design. Where no terrain uncertainty exists, LUMEN says so instead of inventing one.

## Why does the Sun elevation come first on the screen?
Kind: decision
Source: PLAN_FINAL Revision 2 (R2-6, R2-12)
Tags: hero, headline, why elevation, priority, first thing, main number
The first thing every user should see is the Sun and Earth against the horizon; slope and tilt are the second layer. Sun elevation is the headline number because the problem asks for solar elevation to be shown prominently.

## How do my definitions change the results?
Kind: decision
Source: PLAN_FINAL Revision 2 (R2-11) and §5.4–§5.5
Tags: definitions, threshold, settings, disk threshold, min elevation, ops, change definition, what counts as sunlit, assumptions
Sunlit %, link %, longest night and operating hours all depend on definitions: how much of the Sun's disk must be above the horizon, the minimum Earth margin, whether a Deep Space Network station must also see the Moon, and (optionally) a minimum Sun elevation for operations. In LUMEN's full design, because results are meaningless without them, the definitions are kept visible and editable, and changing one recomputes the result. (The four current pages do not show the definitions editor yet.)

## How do I get back to landing on time?
Kind: howto
Source: live pages (Slip explorer) and Ask LUMEN
Tags: on time, reset, undo, zero slip, no delay, back to start, clear slip, baseline, original date
On the Slip explorer, choose the first bar (zero days) — the "on time" baseline is marked with a dashed line — or press / and type "slip 0" or "reset slip".

## How does LUMEN work, and how are the results calculated overall?
Kind: method
Source: PLAN_FINAL §3, §4, §5
Tags: lumen, overview, pipeline, how does lumen work, how lumen works, explain lumen, process, steps, summary, behind the scenes, engine, whole thing, results, how are results calculated
In short: the heavy work is done once, ahead of time, and the app only does light vector maths. Ahead of time, LUMEN computes the Sun's and Earth's positions from NASA ephemeris data (SPICE kernels) and turns terrain elevation maps into horizon masks — the height of the skyline in every compass direction — for each site. In the browser, for any site and time, it interpolates the Sun and Earth positions, rotates them into the site's frame, compares them with the horizon mask, works out how much of each disk is visible, finds the exact moments things change, and then adds up windows, percentages and a ± from the horizon's uncertainty. A verdict is the last step. Every browser calculation has a Python twin, and the two are checked against each other with golden test cases.

## Where does LUMEN's data come from?
Kind: concept
Source: PLAN_FINAL §3, §4
Tags: data, sources, ephemeris, spice, naif, lola, dem, terrain, where from, kernels, dsn data, nasa
Sun and Earth positions come from NASA's SPICE ephemeris kernels, evaluated in a Moon-fixed frame consistent with the LOLA terrain data. Terrain comes from LRO LOLA elevation models, turned into horizon masks per site. The Deep Space Network visibility comes from station kernels: it is the Moon's elevation as seen from each Deep Space Network complex. All of this is computed ahead of time and shipped as data files; the app does not fetch anything live.

## Does LUMEN need an internet connection?
Kind: concept
Source: PLAN_FINAL §3 (design rules)
Tags: offline, internet, network, connection, online, wifi, pwa, install, live data, api
No. After the first load there are no network calls: the data files are cached and the calculations run in your browser, so it keeps working offline. Links to outside tools such as QuickMap, Moon Trek or JPL Horizons open in a new tab and are never needed.

## What is a horizon mask?
Kind: method
Source: PLAN_FINAL §4 (P5), §4.2
Tags: horizon mask, mask, skyline, terrain mask, elevation bins, horizon profile, azimuth bins, silhouette
A horizon mask is the height of the skyline, in degrees above flat, for every compass direction around a site. A Tier A site has bins 0.1° wide for four array heights (1, 2, 5 and 10 m) out to 250 km; Tier B has 0.5° bins. To decide whether the Sun is visible, LUMEN compares the Sun's elevation with the mask's value in the Sun's direction.

## How does LUMEN handle shadows?
Kind: concept
Source: PLAN_FINAL §2, §5.4 and live pages (Orbit)
Tags: shadow, shadows, cast shadow, dark, shade, how are shadows computed, how do shadows work, blocked, ridge, long shadows
LUMEN does not paint shadows on the ground. At each moment it asks one question: does the terrain horizon in the Sun's direction hide the Sun's disk, fully or partly? That is what "in shadow" means for a site. Shadows are long because the Sun is so low (a 10 m object casts a shadow of about 380 m when the Sun is 1.5° up) and pitch black because there is no atmosphere. The Orbit page's polar view uses NASA LOLA terrain with real cast shadows for the picture.

## How is Earth elevation calculated?
Kind: method
Source: PLAN_FINAL §5.2, §5.5
Tags: earth elevation, earth angle, how high is earth, earth altitude, earth position, earth in the sky, elevation of earth
Earth elevation is worked out the same way as the Sun's: Earth's position from the ephemeris is interpolated, the site's position is subtracted, and the direction is rotated into the site's frame to give an elevation and azimuth. Earth is a disk about 1.9° across, and it moves as the Moon rocks (libration), so near the pole it bobs by about ±7° near the horizon. Earth counts as visible when at least half its disk is above the terrain horizon.

## What is DTE (direct-to-Earth)?
Kind: concept
Source: glossary (DTE margin) and PLAN_FINAL §5.5
Tags: dte, direct to earth, direct-to-earth, dte margin, earth contact, line of sight to earth, what is dte
DTE means direct-to-Earth: a lander talking to Earth straight from the surface, with no relay. DTE margin is Earth-centre elevation above the effective horizon in Earth's direction. LUMEN needs it to be at least a threshold (default 1°) before it treats Earth as usable for contact.

## What is the Deep Space Network (DSN), and what is a DSN station?
Kind: concept
Source: PLAN_FINAL §4 (P3b), §5.5
Tags: dsn, deep space network, goldstone, canberra, madrid, ground station, antenna, station, dss
The Deep Space Network is the set of large ground antennas that talk to spacecraft. LUMEN uses its three complexes — Goldstone, Canberra and Madrid — placed around the world so that one is usually facing the Moon. With DSN awareness on, the link only counts as up when Earth is visible from the site AND at least one of those complexes can see the Moon above its own horizon (default 10°).

## What is a permanently shadowed region (PSR)?
Kind: concept
Source: PLAN_FINAL §4 (P11, P15), Revision 2 (R2-5)
Tags: psr, permanently shadowed, shadowed region, ice, cold trap, crater floor, never sunlit, distance to psr, science
A permanently shadowed region is ground that never receives sunlight. LUMEN reports the distance (and bearing) to the nearest one as science context next to the engineering numbers, and can show them as a map layer. The regions shown are derived from the illumination data (pixels with 0% average illumination) and are tagged "derived".

## How was LUMEN checked, and how do I know it is right?
Kind: concept
Source: docs/validation.md and PLAN_FINAL §10
Tags: validation, validated, tested, checks, gates, accurate, correct, trust, verified, proof, golden, how do you know
LUMEN has a set of validation gates (G0 to G11) with results in the validation report. Examples recorded so far: the interpolation of Sun and Earth positions agrees with direct evaluation to far better than 0.001° (gate G2), and the Chandrayaan-3 touchdown Sun elevation was calculated and compared with the planned value (gate G7 — the numerical comparison passes, but the plan's reference value has no primary source yet, so the report marks G7 as not yet independently sourced). The browser calculations are also checked against their Python twins with golden test cases.

## What are "Numbers for this window" on the Stand here page?
Kind: howto
Source: live pages (Stand here, "Numbers for this window")
Tags: numbers for this window, numbers, metrics, tiles, panel, results, verdict, summary, clearance, sunlit, link, longest night, comm gap, ops hours, psr
Below the panorama, Stand here lists the engine's numbers for the chosen site and array height over 30 days from 8 Feb 2027: Sun clearance and disk, Earth elevation and margin, sunlit %, link %, the longest night, the longest communications gap, operating hours and the distance to the nearest permanently shadowed region. Above them are the verdict, the reasons for it, and a badge saying what the numbers rest on (for example "Terrain mask · σ unavailable").

## What does the "Why?" button next to a number do?
Kind: howto
Source: live pages (Stand here) and Ask LUMEN
Tags: why button, why, explain this number, why this number, tile, button, what does why do, explain, understand a number
It opens Ask LUMEN on an explanation of that exact number, for the same site and array height you are looking at: what the quantity means, its value, whether it has a ± (and if not, why not), the definitions it used, and the engine's own verdict reasons. You can also press / and ask, for example, "why is this ± so big?".

## Why is there no ± on my numbers? (What does "σ unavailable" mean?)
Kind: concept
Source: engine results (tier badge and σ source) and PLAN_FINAL §5.8
Tags: sigma pending, sigma unavailable, σ unavailable, σ pending, terrain mask, no plus minus, uncertainty missing, badge, tier badge, no range, where did the range go
"Terrain mask · σ unavailable" means the site uses a real terrain skyline, but no terrain uncertainty (σ) was computed for it, and LUMEN does not make one up. Without σ, LUMEN cannot compute the ± on event times or the [low, high] ranges on percentages, so it shows the nominal values and says why there is no ±. Two kinds of σ exist, both preliminary Monte-Carlo (30 clones). Sites on NASA's polar elevation models use NASA's published per-pixel error map (an RMS height error, Barker et al. 2023) as one σ. The other sites use NASA's global 237 m model, which has no published error raster, so their σ assumes a constant 1 m one-σ elevation error (the accuracy of individual LOLA measurements). That is a lower bound: it leaves out the error from filling the gaps between LOLA tracks, so the real uncertainty there may be larger; the badge says "assumed 1 m DEM error". That σ is an assumption, not a measurement.

## What does "smooth Moon" mean on a site?
Kind: concept
Source: live pages (Stand here) and PLAN_FINAL §4.2
Tags: smooth moon, smooth-moon, no terrain, tier c, flat horizon, no skyline, sphere, no terrain data
"Smooth Moon" means there is no terrain data for that site or array height, so LUMEN treats the Moon as a smooth sphere with no skyline. The Sun and Earth are then blocked only by the curvature of the Moon. These are smooth-sphere estimates, not terrain-bounded sunrise, sunset, or visibility predictions. Stand here says so on the page.

## What is the Methodology page?
Kind: howto
Source: live pages (Methodology)
Tags: methodology, validation, glossary, scope, limitations, how it works page, about, documentation, report, gates, ai disclosure
Methodology is the reading page of LUMEN. It states what LUMEN does and does not compute, how a number is produced, the data sources with links, the definitions, how the ± is calculated and where σ comes from, and the glossary. Open it from the header, or press / and type "go to methodology".

## What is the Details section on Stand here?
Kind: howto
Source: live pages (Stand here, "Details")
Tags: details, windows table, pointing and link, power and barcode, tabs, export csv, dsn lanes, windows, survival barcode, power curve, clearance
Below the numbers, Stand here has a Details section with three views drawn from the same result as the numbers. Windows: every Sun, Earth, link and operating window in the 30 days with start and end times, duration, peak elevation and flags; click a row to jump the clock, and export the table as CSV or JSON. Pointing and link: where the Sun and Earth are at the clock time, Earth's range and one-way light time, and which Deep Space Network stations can see the Moon. Power and barcode: panel power and Sun and Earth clearance over the window with the uncertainty band, and the survival barcode by day.

## How do I export the windows table?
Kind: howto
Source: live pages (Stand here, Details, Windows)
Tags: export, csv, json, download, save, windows table, data, spreadsheet, copy numbers
On Stand here, open Details, choose Windows, and use the Export CSV or JSON buttons above the table. The file includes a header with the site, tier, uncertainty source and definitions, and respects the type filter (All, Sun, Earth, Link, Ops) you have selected.

## What do the validation gates mean, and how many pass?
Kind: status
Source: validation report (validation/report.json)
Tags: gates, validation gates, g0, g1, g2, g4, g7, pass, pending, blocked, how many pass, validated, checks, report status
LUMEN's checks are numbered gates (G0 to G11). Each gate's real status — PASS, FAIL, PENDING or BLOCKED — with its criterion and evidence is recorded in the validation report published with the project data (validation/report.json), together with the overall status. A gate is marked PASS only when a recorded check meets its criterion; a gate with no recorded result stays PENDING, and a gate that depends on missing inputs is BLOCKED. The counts change as new evidence is published, so read them in the validation report rather than relying on a number written here.

## Can I click a chart to move through time?
Kind: howto
Source: live pages (Stand here, Details)
Tags: scrub, click chart, hover, crosshair, ghost line, move time, jump, timeline, power chart, barcode click
Yes. On Stand here, hovering over the power chart or the barcode draws a dashed line on both, and clicking either one jumps the clock to that moment, so the panorama, the numbers panel and the charts all move together. Clicking a row of the Windows table jumps to the start of that window.

## Can I pick a different date?
Kind: howto
Source: live pages (header)
Tags: date, start date, date picker, change date, other date, different date, when, which dates, 2028, 2029, calendar, window start
Yes. The "Start date" box in the header sets the first day of every window (in UTC). It applies to all the pages: the Orbit clock, the Stand here numbers, Compare and the Slip explorer. You can choose any day from 2 January 2023 to 31 October 2030, because the ephemeris data ends on 31 December 2030 and the longest window needs room after the start. The default is 8 February 2027. The date resets to the default when you reload the page.
