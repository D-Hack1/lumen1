# PLAN_FINAL.md — Revision 3 DELTA (audit lock)
### Apply on top of PLAN_FINAL.md Revision 2 · ZERO CODE · each block says exactly which section text it replaces or adds

---

## 0. Audit verdicts (summary)

| # | Item audited | Verdict | Action |
|---|---|---|---|
| 1.1 | Event-time uncertainty derivative | **Confirmed fault** — §2 explains with vertical rate only; §5.8 must use the total clearance derivative | §2, §5.8 rewritten (D-2, D-8) |
| 1.1b | *Found during audit:* coarse 60-min step can skip a narrow terrain spike | **New fault** | §5.3 rewritten with an envelope guard (D-6) |
| 1.2 | 1/cos(el) chord blow-up at high elevation | **Confirmed, with correction** — short-circuit must test the mask **extremes across the disk's azimuth span**, not the mask at the centre azimuth | §5.4 rewritten (D-7) |
| 1.3 | Raycast start distance vs pad slope | **Confirmed fault + inconsistency** — §5.6 says "~5–6 m baseline via 3×3 on 5 m DEM", which is wrong (3×3 at 5 m spans 15 m); also no d_min | §4 P5, §5.6 rewritten (D-4, D-9) |
| 1.3b | *Found during audit:* Tier-B custom points need slope/aspect for the slope-plane term but tiles don't store them | **New gap** | P8 + contracts (D-4, D-11) |
| 2.1 | DE421 + `moon_pa_de421_1900-2050.bpc` + `moon_080317.tf` | **Confirmed** — `MOON_ME` there is the DE421 ME frame; matches LOLA/PGDA; no DE440 FK needed | §4 P1/P2 locked (D-3) |
| 2.2 | `earth_latest_high_prec.bpc` future-coverage trap | **Confirmed trap.** IAU_EARTH + fixed station coordinates is within the 0.5° quantum, **but** must not be mixed with ITRF93 station kernels. Preferred: NAIF's combined long-term Earth PCK | §4 P1/P3b locked (D-3) |
| 2.3 | LT+S then subtract r_site; Earth LT vs LT+S; G3 parity | **Confirmed** for LT+S on both Sun and Earth; LT-only for Earth would waste ~0.006° of the 0.01° budget | §5.2, §10 G3 locked (D-8, D-13) |
| 3.1 | DEM scale/offset/units | **Confirmed fault, stricter than proposed** — range check alone cannot catch a km-unit DEM; proposed [−6000, +8000] m hard bound could false-trip in deep craters | §4 P4 locked (D-4) |
| 3.2 | PSR 1-pixel noise | **Confirmed** — threshold + connected-component area filter; wording must say "may host ice" | §4 P11/P15 (D-5) |
| 4a | Chandrayaan-3 data | **Partly corrected** — 69.3676°S, 32.3481°E is the **pre-landing primary target site**, not an LRA/LROC landing fix; "12:33:44 UTC" and "tilt ~6°" not found in sources | §7 (D-12) |
| 4b | IM-2 data | **Confirmed with wording fix** — 06:15 UTC is **last contact** | §7 (D-12) |
| 4c | Blue Ghost M1 data | **Confirmed with wording fix** — 18.56°N, 61.81°E is the **landing-ellipse centre**; landed within 100 m | §7 (D-12) |
| 4d | Answer Strip in shadow | **Confirmed** — needs a state table, not just two flips | §8.3 (D-14) |
| 4e | Scan latency guardrail | **Confirmed with refinement** — bounds also for near-threshold candidates, not only top-ranked | §8.6, G8 (D-15) |
| 4f | ISRO 6° ops preset | **Accepted** — and it turns G7 into a quantitative check (Sun elevation at CY-3 touchdown) | Definitions, Quick-Start 4, G7 (D-10, D-13) |

---

## D-1 · Changelog row (add to "Revision 2 changelog" table, retitle table "Revision changelog")
| R3-1 … R3-15 | Audit lock: total-derivative uncertainty, envelope-guarded sampling, span-safe disk short-circuit, raycast d_min + near-zone plane model, corrected slope baseline, Tier-B slope/aspect, kernel lock incl. Earth PCK, DEM unit normalisation, PSR filtering, verified mission data, Answer Strip state machine, two-stage Scan, ISRO ops preset, G3/G7/G12/G13 | Pre-H0 audit | D-2 … D-16 |

---

## D-2 · §2 Physics constants — replace the "Sun elevation swing" row
| Quantity | Value | Use |
|---|---|---|
| Sun elevation swing at colatitude c | ≈ ±c per month; peak **vertical** rate ≈ 2π·c / 29.53 d (85°S ≈ 0.044°/h; 89°S ≈ 0.009°/h) | **Illustration only** of why timing uncertainty can reach hours on a smooth horizon. The engine never uses this rate; it uses the total clearance rate (§5.8), which is much larger when the Sun slides behind a steep wall |

---

## D-3 · §4 P1, P2, P3, P3b — kernel lock (replace rows)

| Stage | Locked content |
|---|---|
| **P1 Kernels** | Lunar/ephemeris set (locked): `naif0012.tls`, `pck00011.tpc`, `de421.bsp`, `moon_pa_de421_1900-2050.bpc`, `moon_080317.tf`. **No DE440 lunar kernels.** Earth set (P3b): **primary** NAIF combined Earth PCK (historical high-accuracy + long-term predict, ITRF93; current file named like `earth_1962_YYMMDD_YYYY_combined.bpc` — R1 confirms exact name at H0) + DSN station SPK and topocentric FK. **Never load `earth_latest_high_prec.bpc` alone** (it covers only ~2 months ahead and will fail for 2027–2030). **Fallback** (if any ITRF93 kernel issue): IAU_EARTH from `pck00011.tpc` + station geodetic coordinates converted by us; in that mode **no ITRF93 kernels, station SPK, topo FK or Earth frame-association kernel are loaded**. |
| **P2 Frame decision** | Locked: body-fixed frame = `MOON_ME` as defined by `moon_080317.tf` (alias of `MOON_ME_DE421`, a fixed rotation from `MOON_PA_DE421` in the DE421 binary PCK). This is the frame of the LOLA/PGDA DEMs. G1 still runs (SpiceyPy vs Skyfield `MOON_ME_DE421`) and records the PA↔ME offset. |
| **P3 Ephemeris** | Locked: aberration correction **LT+S for both Sun and Earth**, observer = Moon centre, frame `MOON_ME`. Topocentric direction = apparent Moon-centred vector − site vector (§5.2). Error of doing LT+S at the Moon centre instead of at the site: light-time difference ≤ 5.8 ms, site rotational velocity ≤ 4.6 m/s → both < 10⁻⁶ ° — negligible. |
| **P3b DSN** | Locked: Moon-centre elevation per station (DSS-14, DSS-43, DSS-63), 10-min, 2023–2030, quantised 0.5°. Expected orientation error: combined PCK predict region ≈ arcsecond level; IAU_EARTH fallback ≈ few hundredths of a degree (prime-meridian model error) — both far inside the 0.5° quantum. Validation: G3b (D-13). |

---

## D-4 · §4 P4, P5, P6, P8 — terrain safeguards (replace/extend rows)

**P4 DEM crops — add "DEM normalisation and assertions" (owner R2):**
1. `dem_sources.yaml` declares per product, copied from its label/metadata at H0: storage type, **unit** (m or km), **scale**, **offset**, **reference** (height above 1737.4 km sphere vs absolute radius), nodata value. Product families differ (16-bit DN with 0.5 m scaling; float metres; float km relative to the reference radius; absolute radius) — never assume.
2. Reads use masked arrays; nodata masked **before** any statistic.
3. Apply value × scale + offset explicitly (rasterio exposes scale/offset metadata but does not apply it on read), then convert to **metres above the 1737.4 km sphere**.
4. **Hard assertion** (fail the run): all valid heights within **[−9,500 m, +11,000 m]** (Moon's global extremes with margin).
5. **Soft assertion** (warning logged, run continues): heights within [−6,000 m, +8,000 m] for polar crops.
6. **Unit-trap assertion** (fail): over any crop ≥ 10 km wide at a polar site, relief (P99 − P1) ≥ 50 m. A km-unit DEM read as metres (values like −4…+4) passes range checks but fails this.
7. **Absolute-radius trap** (fail): median |height| < 20,000 m (catches radius stored in metres ≈ 1.737 × 10⁶).
8. `_ERR` rasters get the same unit handling.
9. Unit test G12 (D-13).

**P5 Tier-A masks — add "near-zone boundary" (owner R2):**
- **d_min = 3 × near-field pixel size** (5 m DEM → 15 m; 20 m → 60 m; 240 m → 720 m). The raycaster starts at d_min with half-pixel steps growing geometrically.
- **Observer ground height z₀** = value of the fitted local plane (P6) at the site centre — **not** the raw centre pixel. Observer = z₀ + h.
- **Near-field de-noising:** 3×3 median filter applied to the near-field crop within 100 m of the site before raycasting (documented in provenance).
- **Inside d_min** the ground is the fitted plane, handled analytically by the near-zone occluder (§5.6). Because the DEM march starts at d_min, the pad slope is **never double-counted**.
- **Mask header additions:** global mask max and min per height (used by §5.3 and §5.4 guards).

**P6 Touchdown Pad — replace baseline wording:**
- Plane fit window = (2k+1) × (2k+1) pixels with **k = 3**, i.e. spanning ±d_min (5 m DEM: 35 m window, 30 m between outer pixel centres; 20 m DEM: 140 m window).
- The same plane gives slope θ, downhill_aspect, z₀ and the near-zone occluder.
- **Honest scale statement:** lander-footprint (~5 m) slope is **not resolvable** from LOLA (most 5 m pixels are interpolated); we report slope at the fit baseline and badge it ("slope at 30 m baseline").

**P8 Tier-B grid — add per-node fields:** slope θ, downhill_aspect and z₀ from a k = 3 plane fit on the finest DEM at the node (20 m → 140 m window), so Tier-B custom points get the near-zone occluder and tilt model.

---

## D-5 · §4 P11 / P15 — PSR definition (replace PSR wording)
- **Preferred source:** a published PSR polygon dataset for the south pole (e.g., the LOLA-derived PSR maps referenced by Mazarico et al. 2011, or an atlas/USGS polygon set) **if obtained and citable by H8**.
- **Fallback (derived):** pixels with average illumination **≤ 0.1%** in the PGDA map (not exactly 0, to absorb quantisation) → **8-connected components** → keep components with area **≥ 0.1 km²** (at 60 m/px ≥ 28 pixels; at 240 m/px ≥ 2 pixels) → distance transform.
- Distances computed in projected metres then divided by the polar-stereographic scale factor at the site latitude (≤ ~0.8% correction at 80°S).
- **Outputs per site:** distance (km), bearing, and **area of that nearest PSR (km²)**. Tier 1 toggle: "nearest major PSR (≥ 10 km²)".
- **Wording everywhere:** "permanently shadowed region (a cold trap that may host ice)". Never "volatile-bearing" or "ice deposit".
- Layer and metric labelled "derived" when the fallback is used.

---

## D-6 · §5.3 Adaptive time sampling — replace entire subsection
- **Fine step:** 2 min (rule: Δt ≤ (bin / 2) ÷ angular rate; Tier A 0.1° bins → ≤ ~5.9 min).
- **Coarse step:** 60 min, **allowed only when an envelope guard proves no event can occur inside the step:**
  - Let [az₁, az₂] be the azimuths of the body at the step's two ends, widened by the disk's azimuth half-width w (§5.4) plus one bin.
  - Let M = maximum and m = minimum of the effective mask over that azimuth range (range-max/min lookup on a precomputed table per mask; O(1)).
  - Coarse step allowed if **min(el₁, el₂) − r − M > 0.25°** (certainly fully visible) **or max(el₁, el₂) + r − m < −0.25°** (certainly fully hidden). Otherwise subdivide into 2-min steps.
- This replaces the old "±3° clearance band" heuristic, which could step over a narrow ridge spike (e.g., a 0.3°-wide spike hides the Sun for ~35 min while clearance elsewhere is > 3°).
- Events: bisection on continuous interpolated geometry to ~10 s at every change of visibility state and disk-fraction thresholds 0 / 50 / 100%.

---

## D-7 · §5.4 Disk visibility — replace entire subsection
- **Exact azimuth half-width** of a disk of angular radius r centred at elevation e: w = asin( sin r ÷ cos e ) when r < 90° − e; otherwise w = 180° (disk contains the zenith). cos e is floored at cos 89.9°.
- **Short-circuit first (always):** with M, m = max, min of the effective mask over [az − w, az + w]:
  - e − 1.05 r > M → fraction = **1.0**
  - e + 1.05 r < m → fraction = **0.0**
  - otherwise run chord quadrature.
- **Why span extremes, not the centre value:** at the pole the disk spans ~0.53° of azimuth; a steep wall can rise several degrees inside that span, so a centre-only test could wrongly return 1.0.
- **Chord quadrature** (Sun 24 chords, Earth 32) runs only when the disk overlaps the mask range, which caps e at about (mask max + r) — in practice < ~35°, so the 1/cos e factor stays ≤ ~1.2 and never blows up. Tier-C sites (smooth sphere, mask ≈ −dip) always short-circuit except within ~r of the horizon.

---

## D-8 · §5.2 and §5.8 — replace §5.8 entirely; add one line to §5.2
**§5.2 addition:** Topocentric direction = (LT+S apparent Moon-centred vector) − (site vector), for both Sun and Earth (D-3, P3).

**§5.8 Uncertainty propagation (replacement)**
- **Clearance function:** C(t) = el(t) − m_eff(az(t)), with m_eff from §5.6 (terrain beyond d_min combined with the near-zone occluder).
- **Total rate:** dC/dt = d el/dt − (∂m_eff/∂az) · d az/dt. When the Sun slides behind a steep wall, the second term dominates and δt becomes small; on a flat horizon the first term dominates and δt can be hours.
- **Numerical evaluation (locked):** dC/dt at the refined event from a central difference of C over ±2 min, using the same piecewise-linear mask interpolation as the visibility code. If t_event ± 2 min crosses a mask bin boundary, use the one-sided difference on the side that contains the event's bracketing interval.
- **Event-specific clearance:** for disk-fraction events, C uses the matching limb: 0% → C + r (upper limb), 50% → C (centre), 100% → C − r (lower limb).
- **δt (fast path)** = σ_m(az_event) ÷ |dC/dt|, σ_m from tier default → MC σ → Tier-B calibration.
- **δt (exact path, precedence when available):** events re-solved on masks shifted by −σ and +σ (the same 3 passes used for percentage bounds). δt = half the spread of the three event times. Used for the current scenario and for Scan stage-2 results. The fast path is used for Scan stage 1 and Quick Answer.
- **Grazing flag:** |dC/dt| < 0.005°/h, **or** δt > 12 h, **or** the event disappears in either shifted pass. Display "grazing — timing poorly constrained" with the range.
- **Bounds** for sunlit %, link %, longest night: unchanged three-pass method.
- Assumption stated in Methodology: mask errors treated as fully correlated in azimuth for the ± passes (conservative for event timing).

---

## D-9 · §5.6 Touchdown Pad — replace "Ground geometry" and "Slope-plane horizon occluder" paragraphs
**Ground geometry**
- Plane fit (k = 3 window, D-4) gives ground normal g, slope θ = angle(g, u), downhill_aspect (azimuth of the horizontal projection of g), **uphill_az = (downhill_aspect + 180°) mod 360°**, and z₀.

**Near-zone occluder (replaces the infinite slope-plane term)**
- The ground between the observer and d_min is the fitted plane. Seen from height h above z₀, the plane's highest elevation angle in direction az occurs at the zone edge d = d_min:
  N(az) = atan( tan θ · cos(az − uphill_az) − h ÷ d_min ).
- **Clamp:** N⁺(az) = max(0°, N(az)).
- **Application rule (unchanged logic):** m_eff(az) = m_dem(az) wherever N⁺(az) = 0; otherwise m_eff(az) = max(m_dem(az), N⁺(az)). m_dem is the raycast mask, which starts at d_min. The clamp is never applied to m_dem itself.
- **Always active** for Tier A and Tier B (it now models only the near zone and cannot double-count). Example: h = 1 m, d_min = 15 m → an uphill slope must exceed ≈ 3.8° before it occludes anything.
- Off-nominal lander tilt affects panels and antenna only, never m_eff.
- **Golden cases (update P10):** θ = 0 → N⁺ ≡ 0 and m_eff ≡ m_dem; pure downhill → unchanged; uphill θ = 10°, h = 1 m, d_min = 15 m → N = atan(0.1763 − 0.0667) ≈ 6.25°; cross-slope → unchanged; negative m_dem downhill → preserved exactly.

---

## D-10 · Definitions (§5.5 / §8.3 Definitions Bar / §6 Scenario) — add one parameter and one preset
- **New parameter:** `minSunElevationOps` (degrees, default **0 = off**). When > 0, "Sun available" requires **disk ≥ threshold AND Sun elevation ≥ minSunElevationOps**. Elevation here is geometric elevation above the local horizontal of the sphere at the site.
- **New preset in the Definitions popover:** **"ISRO Vikram ops (min Sun elevation 6°)"** — sets minSunElevationOps = 6°. Source label: mission team statement as reported (R6 replaces the secondary citation with the primary article at H0).
- **Quick-Start 4** ("Validate a Real Landing: Chandrayaan-3") applies this preset and shows: Sun elevation at touchdown, and when the Sun falls below 6° at the site.

---

## D-11 · §6 Data contracts — additions
| Artifact | Added fields |
|---|---|
| Mask file | `d_min_m`, `z0_m`, `median_filter_radius_m`, global `max_deg` / `min_deg` per height, range-max/min lookup table (or rebuilt on load) |
| Pad record | fit window (pixels, metres), slope θ, downhill_aspect, uphill_az, z₀, baseline badge text |
| Tier-B tile | per node: slope θ, downhill_aspect, z₀ (quantised), d_min |
| PSR outputs | per site: distance_km, bearing_deg, nearest_psr_area_km2, source (`published` / `derived`) |
| Site record | `landing_coords` {lat, lon, source}, `target_coords` {lat, lon, source} (optional), `coord_note`, `touchdown_utc` + precision (`minute` / `second`), `last_contact_utc` (optional) |
| Scenario | `minSunElevationOps`, `definitionsPreset` |
| Result | per event: `dt_method` (`fast` / `exact`), `grazing_reason`; Scan rows: `bounds_status` (`nominal` / `bounded`) |
| DEM source entry | storage type, unit, scale, offset, reference, nodata, label URL |

---

## D-12 · §7 Site catalog — replace these rows
| Site | Category | Locked values | Notes |
|---|---|---|---|
| **Chandrayaan-3 Statio Shiv Shakti** | historical_landing (India) | Touchdown **2023-08-23 12:33 UTC** (ISRO: 18:03–18:04 IST); precision = minute. **Landing coords 69.373°S, 32.319°E** (69°22′23″S, 32°19′08″E). **Target (pre-landing primary site) 69.367621°S, 32.348126°E** (PRL, *Current Science*). | The target and landing points are ~350 m apart, consistent with ISRO reporting a landing ~350 m from the targeted spot. Use landing coords for all computations; show target as a secondary pin. Seconds-level touchdown time and lander tilt: **only** if found in an ISRO or peer-reviewed source at H0 (not found in this audit). LROC NAC-derived lander coordinate: pull from the LROC coordinate table at H0 and record as a third, cross-check value. No public LRA-derived coordinate found — don't label any value "LRA". |
| **IM-2 Athena (Mons Mouton)** | historical_landing (USA, CLPS) | Touchdown **2025-03-06 17:28:50 UTC**; **84.7906°S, 29.1957°E**; ~250 m from target, inside a crater, on its side; **last contact 2025-03-07 06:15 UTC**. | Say "last contact", not "battery depleted at". Some outlets give 17:31 UTC; keep the seconds value with its source and note the discrepancy. |
| **Blue Ghost Mission 1 (Mare Crisium, near Mons Latreille)** | historical_landing (USA, CLPS) | Touchdown **2025-03-02 08:34 UTC**; **landing-ellipse centre 18.56°N, 61.81°E**; landed upright within its 100 m target; last contact 2025-03-16 23:25 UTC (~5 h after local sunset, as reported). | Label coordinates "target centre (landed within 100 m)". Check LROC for a final landing fix at H0. Tier C. Optional sanity check: predicted sunset should fall ~5 h before last contact (qualitative). |

---

## D-13 · §10 Validation — replace G3 and G7; add G3b, G12, G13
| ID | Check | Pass criterion | When |
|---|---|---|---|
| **G3** | Smooth-sphere topocentric vs JPL Horizons. Horizons settings: observer `coord@301`, geodetic site at altitude 0 on the 1737.4 km sphere, targets **10 (Sun)** and **399 (Earth centre, not 3 = Earth–Moon barycentre)**, apparent airless az/el + range, extra precision, CSV. Horizons uses JPL's DE441 mean-Earth lunar frame; difference from our DE421 ME is far below 0.001°. Longitude sign sanity test: a site at 0°N, 0°E must see Earth near the zenith. Compare elevation everywhere; azimuth and full vectors in the true-north frame at all points not exactly at the pole. 5 sites × 20 epochs incl. IM-2 and CY-3. | Sun & Earth el/az < 0.01°; range < 1 km. Expected error budget: interpolation < 0.001°, aberration consistency < 0.0005° (LT+S both sides), frames < 0.001°, ephemeris negligible | H6 |
| **G3b** | DSN: Moon elevation at DSS-14/43/63 vs Horizons (station as observer) at 10 epochs in 2023–2024 and 5 in 2029–2030 | < 0.1° (quantum 0.5°) | H8 |
| **G7** | **Quantitative:** our Sun elevation at the CY-3 landing coords at 2023-08-23 12:33 UTC vs the mission team's reported **8.75°**; tolerance ±0.25° (minute-level time precision). **Qualitative:** time when Sun elevation at the site drops below 6° vs the reported shutdown period (Pragyan 2 Sep, Vikram 4 Sep 2023); IM-2 low-Sun conditions at touchdown | Elevation within tolerance; timeline consistent; no invented numbers | H28 |
| **G12** | DEM normalisation: synthetic GeoTIFFs in each declared unit/scale/reference convention (incl. a km-unit file and an absolute-radius file) → dem_io outputs identical metres-above-sphere or fails the right assertion | 100% | H4 |
| **G13** | Scan staging: stage-1 latency, stage-2 first results, and verdict stability (no candidate shown GO in stage 1 is NO-GO after bounds without being labelled "provisional") | Stage 1 ≤ 100 ms, first bounded results ≤ 300 ms (curated sites, 60-day sweep) | H28 |

---

## D-14 · §8.3 Answer Strip — add state table (replaces the Answer Strip paragraph's countdown wording)
| Condition at t_scrub | Sun cell | Earth cell |
|---|---|---|
| Sun available (per Definitions) | "Sunset in 41 h ± 5 h" | — |
| Sun not available, rises later in window | **"Sunrise (Shadow Exit) in 18 h ± 2 h"** + "dark for 31 h so far" | — |
| Sun not available, no rise before window end | "No sunrise before window end (+N d)" | — |
| Sun available, no set before window end | "Stays up past window end" | — |
| Earth visible | — | "Earthset in 3 d 4 h ± 6 h" |
| Earth not visible | — | **"Earthrise in 5 d 2 h ± 6 h"** |
| Earth visible but DSN-aware link down | — | "Link resumes in 2 h (DSN)" |
| Grazing event next | "Sunset ~12–30 h (grazing)" | same pattern |
| Ops preset active and Sun visible but below the minimum elevation | "Below ops elevation (6°) — ops resume in …" | — |
- **Mission Bar jumps follow the same states:** the E button reads "Next Earthrise" when Earth is down and "Next Earthset" when it is up; S/X stay "Next Sunset" / "Next Shadow Exit". Tooltips show target time ±.
- Colour and icon change with the state (Sun icon outlined when down); never rely on colour alone.

---

## D-15 · §8.6 Scan + G8 — replace Scan description
- **Stage 1 (nominal, fast):** per site the worker caches one nominal yearly visibility series for the current definitions and height (built once, invalidated when definitions, height or attitude change). Every candidate landing date is scored with sliding-window prefix sums → all candidates ranked by nominal Viability Index; fast-path δt only. Target ≤ 100 ms.
- **Stage 2 (bounded):** full adaptive evaluation + three-pass bounds + exact δt for (a) the **top 10** and (b) **every candidate whose nominal metric lies within 10% of any hard profile threshold** (these are the ones whose verdict can flip). Results stream into the list; rows show a "nominal" badge until bounded. First bounded results ≤ 300 ms.
- Verdicts from stage 1 are labelled "provisional"; GO requires the conservative bound (unchanged rule).
- Calendar (12-month) uses stage 1 only, with a "provisional" legend; clicking a cell runs stage 2 for that cell.

---

## D-16 · §15 Verify-at-H0 — replace list items
- Exact challenge title and submission format (R6).
- Exact current filename of NAIF's combined long-term Earth PCK; station SPK/topo FK names; confirm `moon_080317.tf` defines `MOON_ME` as the DE421 ME alias (R1).
- Horizons API parameter names (observer site, airless apparent, extra precision, CSV) and longitude sign convention for lunar sites (R1).
- Per-product unit/scale/offset/reference/nodata for every DEM, from labels (R2).
- Published south-pole PSR polygon dataset availability (R2, by H8).
- Chandrayaan-3: seconds-level touchdown UTC and lander tilt (ISRO/peer-reviewed only); LROC NAC lander coordinate; primary article for the "6–9° landing, 6° ops, 8.75° at touchdown" statement (R6).
- IM-2: official touchdown UTC source (17:28:50 vs 17:31 discrepancy) (R6).
- Blue Ghost M1: LROC final landing coordinate (R6).
- Any published illumination statistics to be quoted (R1).
- Local event rules on pre-staged data (R6).

---

## D-17 · WORK_DISTRIBUTION.md impacts (owners)
| Change | Owner | File(s) |
|---|---|---|
| Kernel lock, combined Earth PCK / IAU fallback, G3 settings, G3b | Gowri | `config/kernels.tm`, `ephem/dsn.py`, `validation/horizons_client.py`, `tests/gowri/test_horizons.py` |
| Total-derivative δt, exact-path δt, event-specific limbs, envelope guard, span-safe short-circuit, near-zone occluder | Gowri (Python twin) → Nived (TS) | `reference/events.py`, `uncertainty.py`, `visibility.py` → `engine/core/events.ts`, `uncertainty.ts`, `visibility.ts`; new golden cases |
| d_min, z₀, median filter, k = 3 plane fit, mask max/min, Tier-B slope/aspect/z₀ | Shiva Shakthi | `terrain/horizon.py`, `masks.py`, `pad.py`, `tierb.py`, `config/terrain.yaml` |
| DEM unit normalisation + G12 | Shiva Shakthi | `terrain/dem_io.py`, `config/dem_sources.yaml`, `tests/terrain/test_dem_units.py` (new) |
| PSR threshold + component filter + area output | Shiva Shakthi | `terrain/psr.py`, `terrain/layers.py` |
| Mission data rows, coordinate fields | Gowri | `config/sites.yaml`, `catalog/build_catalog.py`, `contracts/data_catalog.md` |
| minSunElevationOps + ISRO preset | Abhinav (UI/state) + Gowri (reference) + Nived (engine) | `state/scenarioStore.ts`, `features/definitions/`, `reference/windows.py`, `engine/core/windows.ts`, `public/content/quickstart.json` |
| Answer Strip state table, contextual E jump | Nived (strip) + Abhinav (Mission Bar) | `features/answer/AnswerStrip.tsx`, `app/MissionBar.tsx` |
| Two-stage Scan + G13 | Nived | `engine/compare/scan.ts`, `features/compareResults/ScanPanel.tsx` |
| G7 quantitative check | Gowri | `validation/pgda_compare.py` (or new `validation/historical.py`) |
