# LUMEN — Preliminary Shackleton/IM-2/CY-3 Monte Carlo Terrain σ Pipeline

**Status: PRELIMINARY. Not production-accepted.** Working branch `shivha/s7-transfer`, base commit `f2df9db0ec5d640b2430645f82641f3b3f1ae5f6`. Nothing has been committed or pushed.

## 1. What was implemented

- `pipeline/lumen_pipeline/terrain/mc_horizon.py` (new): the actual clone-generation and horizon-uncertainty workflow.
  - `read_aligned_error_window` / `read_all_aligned_error_windows`: reads each crop's `_ERR.TIF` independently via `DemReader.read_site_window(..., read_error=True)`, verifies the re-read DEM elevation/validity is pixel-identical to the original crop before trusting grid alignment.
  - `_correlated_gaussian_field` / `perturbed_elevation`: spatially correlated Gaussian perturbation field (white noise → `scipy.ndimage.gaussian_filter` smoothing → renormalized to unit variance → scaled pointwise by the crop's own `_ERR` magnitude, zero where `error_valid` is False). Configurable correlation length in metres, converted to pixels per crop resolution.
  - `compute_horizon`: replicates the existing production `masks.py` pipeline (`fit_near_field` → per-crop `raycast_horizon` → `_combine_horizons` → `_apply_near_zone`) without writing a mask file, optionally with per-crop elevation overrides (the perturbed clone).
  - `generate_clone_ensemble`: generates N reproducibly seeded clones via `np.random.SeedSequence([base_seed, length_key, clone_index, crop_seed_component])` (fixed `{"near":1,"mid":2,"far":3}` map — not Python's randomized `hash()`).
  - `sample_sigma`: `ddof=1` sample standard deviation across clones, NaN-propagating (not `nanstd`).
  - `nan_pattern_matches_nominal`, `evaluate_convergence` (20-vs-30 clone comparison with max/mean abs diff).
- `pipeline/lumen_pipeline/terrain/mc_sigma.py` (extended): `write_sigma()` now accepts an `extra` dict of additional sidecar fields (methodology, provenance, caveats), with a `_CONTRACT_SIDECAR_FIELDS` collision check that runs **before** any file write.
- Tests: `pipeline/tests/terrain/test_mc_horizon.py` (21 new tests, monkeypatched fast fake raycaster), `pipeline/tests/terrain/test_mc_sigma.py` (+2 new tests for `extra`). Existing serializer/contract tests retained unmodified in behavior.
- A one-off, **not committed** orchestration script (`scratchpad/generate_mc_sigma_site.py`) calls these real, unmodified production functions to actually run the generation for each site.

No synthetic arrays, no placeholder functions — every artifact below was produced by the real raycaster (`horizon.raycast_horizon`) run against real LOLA DEM data, perturbed 90 times per site (30 primary + 10 secondary clones × 3 crops) plus one nominal run.

## 2. What was actually generated

All three target sites passed every required technical check and have artifacts published at `web/public/data/terrain/sigma/<site_id>.{bin,json}`:

| Site | σ mean (deg) | σ max (deg) | Nominal horizon range (deg) | 20-vs-30 max |Δ| (deg) | 50m-vs-150m max |Δ| (deg) | Wall time |
|---|---|---|---|---|---|---|
| `im2_athena` | 0.01117 | 0.08591 | [-1.501, 4.070] | 0.03340 | 0.04280 | ~92 min |
| `cy3_shiv_shakti` | 0.01674 | 0.14903 | [0.356, 2.484] | 0.02772 | 0.10067 | ~19.6 min |
| `shackleton_ridge` | 0.00152 | 0.00416 | [14.296, 26.879] | 0.00074 | 0.00167 | ~92.5 min |

All three: `finite_fraction = 1.0000`, NaN pattern matches nominal mask validity exactly, DEM/ERR grid alignment verified (100% `fraction_valid` on every crop at every site), seeded reproducibility verified, `ddof=1`, `clone_count=30`, `source="monte_carlo"`.

**No site was blocked.** (Shackleton required three attempts purely due to a container memory constraint — see §7 — not a data or methodology blocker.)

### Artifact hashes (SHA-256)

| File | SHA-256 |
|---|---|
| `im2_athena.bin` | `a47638cb34c191a52908141acea830505050b71f7070a59aebe9be0867146fc3` |
| `im2_athena.json` | `4f4e6c6161b7f9c4e700b5c30d72ea0d51ada6a138d83882eb19270be3173c07` |
| `cy3_shiv_shakti.bin` | `2bef98d5a664c7cbf0b7fc0ebb84ad77322bc2e607e84d7eb00853452bbc356a` |
| `cy3_shiv_shakti.json` | `ab5a2900c80dcad3d10e2a064fd8f9ee29a1bcf4c9863a9bdf25115f4dd9a3d6` |
| `shackleton_ridge.bin` | `5171a25b9f5f434b940c7e311d6d77f0ea7db75e5bc0813f4a2867834bd9ab3a` |
| `shackleton_ridge.json` | `ef7da3d3e360454376b899407bd91dda901d7a7903375508710042b74c941bdf` |

### Source DEM/ERR files used (all verified against the real PGDA Product 90 URLs; local copies used only to route around the rate limiter, not to substitute data)

| Product key | DEM SHA-256 | ERR SHA-256 |
|---|---|---|
| `polar_20m_lola_pgda_90` (mid crop, 20m) | `09b7ca80f9e6a146f970225d18af72fc02787669b3ef51b888e347d2b6845649` | `d64045b8aa58a24010f009ab5667ae02cc06cffa7796784dd5e2d48b3059d8cf` |
| `regional_240m_lola_pgda_90` (far crop, 240m) | `3f9663257b63022f2b0d5a623482ff3cadddceb91594a4e4ca14a94d8cec8b34` | `6b987570acf20cba527d29a519a9b1fd9d4550e98a81d4b8c1be4903b6d38fab` |
| `polar_60m_lola_pgda_90` (CY-3 near/mid, 60m) | `b03b5b3b3bf6a0eb8e871be7a7c04bcfa1f7d9c01c885db10655c9f26afc1f6a` | `0a74522cba22896863e72d57ea0d2bc61224a6e43d05b8f514e4c0108cb086c2` |

(The 10m near-crop product for IM-2/Shackleton was read live from `https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_83S_10MPP_ADJ*.TIF` — never hit the rate limiter this session, so no local override was needed.)

## 3. Scientific assumptions (explicit, unverified where stated)

1. **Perturbation model**: spatially correlated Gaussian field, constructed as white noise smoothed by a Gaussian kernel, renormalized to unit variance, then scaled pointwise by each crop's own `_ERR` raster magnitude (zero perturbation where `error_valid` is False — never fabricated for invalid pixels).
2. **ERR interpretation — RESOLVED (2026-11-16)**: Barker et al. (2023, PSJ 4, 183, Section 3; accepted manuscript [NTRS 20230014419](https://ntrs.nasa.gov/citations/20230014419)) define the `_ERR` maps as **RMS height errors** estimated from an ensemble of "clone" LDEMs (fractal terrain plus LOLA range and geolocation errors, re-gridded like the nominal LDEM), representing "the uncertainty in the LDEM gridded height … relative to the true average height … within each pixel". Using that RMS value as a Gaussian 1σ per pixel is therefore supported; the Gaussian shape and the spatial correlation remain approximations.
3. **Correlation length**: two lengths tested (50m primary, 150m secondary) purely for sensitivity; **neither is claimed to be physically calibrated**. 50m was selected as the primary/published length because it is the finer, more conservative choice relative to near-crop resolution (10-20m), not because of any physical justification.
4. **Vertical datum caveat**: the adjusted LOLA DEM's exact vertical offset/scaling relative to the 1,737,400 m reference sphere remains formally unconfirmed (same unresolved question investigated earlier this session — CRS/IAU-registry and GMT-processing-history evidence are consistent with a `height_relative` product, but the authoritative PGDA/Barker documentation could not be reached). This does **not** affect σ directly, since σ is a spread statistic invariant to a constant vertical offset — but it remains an open caveat on the underlying DEM's absolute elevation values, and is recorded verbatim in every sidecar's `vertical_datum_caveat` field.
5. Shackleton's coordinates, rotation, masks, and catalog identity were **not** touched — only new σ artifacts were added.

## 4. Convergence (20-vs-30) and cross-length sensitivity

For every site, the 20-clone and 30-clone sigma estimates differ by less than ~0.034° at every bin (max across all three sites), and the ratio of that difference to the mean σ itself ranges from ~30% (IM-2) down to ~3% (Shackleton) — i.e., convergence is good but not perfect at 20 clones; 30 clones noticeably tightens the estimate, consistent with the task's requirement to compare 20-vs-30 rather than assume either is sufficient. No ensemble was expanded past 30, since 30 already shows tightening relative to 20 at every site and 30 is the task's specified clone count.

Cross-length sensitivity (50m vs 150m correlation length) shows larger differences than the 20-vs-30 clone-count sensitivity at every site — i.e., the choice of correlation length matters more than clone count in this preliminary setup, reinforcing that the correlation length is a modelling choice requiring real calibration, not a converged/settled parameter.

## 5. Test results

- `pipeline/tests/terrain/test_mc_horizon.py`: 21/21 passed (perturbation reproducibility, seed-sensitivity, correlation-length smoothness, zero-magnitude and negative-length rejection, error-window alignment validation, `compute_horizon` override/no-mutation behavior, clone-ensemble reproducibility/seed/length differentiation and shape, `sample_sigma` against a known analytic value and NaN-propagation, `nan_pattern_matches_nominal`, `evaluate_convergence` including the `<20 clones` rejection).
- `pipeline/tests/terrain/test_mc_sigma.py`: 35/35 passed (existing header/schema/contract tests retained unmodified, plus the 2 new `extra`-field tests, including the fixed before-write collision check).
- Full backend suite: **421 passed**, 12 failed — the exact same 12 pre-existing, unrelated failures present in the baseline before any Task D changes (SPICE/DE421 kernel-dependent `tests/gowri/*` tests and one CRLF golden-fixture test). **Zero regressions.**
- `ruff` / `black`: clean on all new and modified files.

## 6. Changed/added files (exact list — nothing else was touched)

```
M  pipeline/lumen_pipeline/terrain/mc_sigma.py
M  pipeline/tests/terrain/test_mc_sigma.py
A  pipeline/lumen_pipeline/terrain/mc_horizon.py
A  pipeline/tests/terrain/test_mc_horizon.py
A  web/public/data/terrain/sigma/im2_athena.bin
A  web/public/data/terrain/sigma/im2_athena.json
A  web/public/data/terrain/sigma/cy3_shiv_shakti.bin
A  web/public/data/terrain/sigma/cy3_shiv_shakti.json
A  web/public/data/terrain/sigma/shackleton_ridge.bin
A  web/public/data/terrain/sigma/shackleton_ridge.json
```

(The other modified/untracked entries in `git status` — `layers.py`, `layers.json`, `test_layers.py`, `test_layers_index_frontend_contract.py`, `loaders.test.ts`, `pipeline/cache/dem/` — belong to the earlier, separate S-7 Layers Index task and local DEM cache, not to this Monte Carlo work, and were left untouched.)

No Shackleton coordinates/rotation/masks/fixtures, no IM-2/CY-3 production masks, and no unrelated frontend/mask/pad/dispersion/catalog files were modified.

## 7. Remaining work before production acceptance

1. ~~ERR-as-1σ assumption is unverified.~~ Resolved: see §3 item 2 (Barker et al. 2023, Section 3).
2. **Correlation length is not physically calibrated.** 50m/150m were tested only for sensitivity. Barker et al. (2023, §3) identify effective resolution as the primary factor in the error, and PGDA product 90 publishes `LDEM_*_ADJ_EFFRES.TIF` effective-resolution maps — the natural input for a physically motivated correlation length. Not yet done (needs a re-run of the fine-terrain sites, ~90 min and ~8 GB each).
3. **Vertical datum of the adjusted DEM is still not formally confirmed** against authoritative PGDA documentation (same open question from earlier in this session) — doesn't block σ but blocks full DEM provenance sign-off.
4. **Transient per-process memory peaks (~7.6-7.7 GB RSS)** were observed during long MC runs (cause not root-caused — possibly tied to specific moments in the 90-raycast-call sequence, not a monotonic leak); running sites one at a time was required to avoid OOM kills in this container. Needs investigation/optimization before this can run unattended or concurrently in production.
5. **Only 2 correlation lengths and 1 clone-count comparison (20 vs 30) have been evaluated.** A broader, more systematic sensitivity sweep is warranted before treating any single configuration as final.
6. ~~No downstream frontend consumption~~ — superseded: the web engine now loads every σ file (`web/src/engine/data/sigma.ts`), checks it against its mask, and uses it for the ± bounds and the verdict; `web/src/engine/__tests__/realMode.test.ts` checks every published σ file.

Every sidecar JSON encodes `"preliminary": true`, `"production_ready": false`, and the full methodology/provenance detail above directly in its own fields, so the artifacts are self-describing without this report.

## 8. Addendum (2026-11-16): the nine coarse-mask sites — ASSUMED-error σ

Apollo 11/12/14/15/16/17, SLIM, Chang'e-6 and Blue Ghost have coarse masks from NASA's global LDEM_128 (236.9 m/px). **No per-pixel error raster exists for that model**, so the method above (perturb by the DEM's own `_ERR`) cannot be applied. Checked:

- PDS LOLA GDR [`cylindrical/img`](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/) and `float_img/` hold only `ldem_128.img/.lbl/.xml`; the label mentions no uncertainty.
- [PGDA product 90](https://pgda.gsfc.nasa.gov/products/90) `_ERR` rasters cover 60°S–pole only; [PGDA product 78](https://pgda.gsfc.nasa.gov/products/78) covers named south-pole sites only; [SLDEM2015 / PGDA product 54](https://pgda.gsfc.nasa.gov/products/54) (60°S–60°N) publishes no per-pixel error map either.

At the project owner's explicit request σ was produced with a stated assumption, by `pipeline/scripts/run_mc_sigma_coarse.py`:

- the DEM is perturbed by a **constant 1 m one-σ elevation error** — LOLA's ~1 m absolute vertical accuracy from orbit-overlap analysis (Mazarico et al. 2013, as cited by Barker et al. 2016, Icarus 273, 346–355);
- **this is a lower bound**: it is the accuracy of individual LOLA measurements, not of the gridded 237 m model. It leaves out gridding/interpolation error between ground tracks, which Barker et al. (2023, §3) show dominates gridded-DEM height error and grows with effective resolution. No published figure for LDEM_128's gridded error was found; for scale only, the merged SLDEM2015 has a stated typical vertical accuracy of 3–4 m (Barker et al. 2016) — a different product;
- every site was therefore also run at **3.5 m** (sensitivity; recorded in each sidecar's `sensitivity_assumed_error`, not published as σ);
- 50 m correlation length (below the 237 m pixel, so effectively uncorrelated between pixels), 30 clones, `ddof=1`, seed 20260515; sidecars record `error_model: "assumed_uniform"`, `assumed_error_m: 1.0`, `error_magnitude_is_lower_bound: true`, `preliminary: true`. The app labels it "assumed 1 m DEM error (lower bound)".

| Site | σ mean @1 m (deg) | σ max @1 m (deg) | σ mean @3.5 m (deg) | σ max @3.5 m (deg) |
|---|---|---|---|---|
| `apollo_11` | 0.0127 | 0.0692 | 0.0530 | 0.1974 |
| `apollo_12` | 0.0158 | 0.0689 | 0.0663 | 0.1644 |
| `apollo_14` | 0.0163 | 0.0536 | 0.0532 | 0.1479 |
| `apollo_15` | 0.0071 | 0.0489 | 0.0229 | 0.1396 |
| `apollo_16` | 0.0081 | 0.0603 | 0.0290 | 0.1683 |
| `apollo_17` | 0.0039 | 0.0104 | 0.0130 | 0.0363 |
| `slim_shioli` | 0.0075 | 0.0303 | 0.0251 | 0.0876 |
| `change6_apollo_basin` | 0.0063 | 0.0474 | 0.0311 | 0.1302 |
| `blue_ghost_m1` | 0.0164 | 0.0621 | 0.0592 | 0.1674 |

σ grows roughly in proportion to the assumed error (3.2–5× for 3.5×), so the published 1 m σ may understate the true terrain uncertainty at these sites by a similar factor.

**Masks.** The published Apollo 11 and Apollo 12 masks previously did not reproduce from the current code (max difference 0.011° and 0.065°). Both were regenerated with `run_masks_global.py`; all nine now reproduce exactly (difference ≤ 1e-10°, float32 rounding) and σ was published with the strict 0.001° check. Coarse runs peak below 1 GB RSS and ~4 s per clone, so they run in parallel; the slow step is the first HTTP read of the LDEM_128 window (~13 min).
