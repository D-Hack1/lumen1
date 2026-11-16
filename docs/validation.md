# validation.md

_Owner: Gowri_

Human-readable gate results, scope statement.

## G1 - DE421 lunar frame validation

- Result: PASS for the checked thresholds. The comparison uses SpiceyPy 8.4.0
  `pxform` and Skyfield 1.55 `PlanetaryConstants` at
  `2023-01-01T00:00:00Z`, `2025-03-06T17:28:50Z`, and
  `2030-12-31T23:00:00Z`.
- Frames: `MOON_PA_DE421` to `MOON_ME_DE421` and the reverse. The DE421
  mean-Earth frame is fixed to the principal-axis frame by the 3-2-1 Euler
  rotation in `moon_080317.tf`.
- Maximum matrix absolute error: `3.480837840186268e-11` (limit `< 1e-9`).
  Maximum angular direction error: `3.57755385468222e-11 rad`
  (limit `< 1e-6 rad`).
- Maximum PA-to-ME angular residual: `4.239636467986046e-15 deg`;
  maximum ME-to-PA residual: `4.412742011943044e-15 deg`. Maximum
  orthogonality error: `6.661338147750939e-16` (limit `<= 1e-9`);
  minimum determinant: `0.9999999999999996`.
- PA-ME surface offset: `874.7474688514714 m` (about `874.75 m`).
  Round-trip vector error is `1.149714193796099e-9 m`; R3 defines no
  separate round-trip tolerance.
- Both implementations use the same DE421 kernel inputs but independently
  compute the transformations. Kernel filenames, sizes, SHA-256 identifiers,
  frame metadata, epoch results, and software versions are recorded in
  [the machine-readable G1 evidence](../pipeline/reports/g1_lunar_frames.json).

## G2 - Hourly ephemeris Hermite validation

- Epochs: 10000 (deterministic seed 421)
- Sun maximum direction residual: 0.000006502 deg
- Earth maximum direction residual: 0.000002091 deg
- Gate: PASS (< 0.001 deg; measured 0.000006502 deg)

## G7 - Chandrayaan-3 touchdown Sun elevation

- Calculation input: 2023-08-23T12:33:00Z (minute precision), 69.373 degrees S,
  32.319 degrees E, 0 m on the spherical lunar surface.
- Calculation geometry: LT+S apparent Moon-centred Sun vector minus the site vector,
  evaluated in `MOON_ME_DE421`; this is a Sun-centre elevation above the local spherical
  horizontal, with no terrain horizon applied.
- Calculated Sun-centre elevation: 8.612140050356778 degrees.
- Recorded, unverified comparison input: 8.75 +/- 0.25 degrees; the computed difference is
  0.13785994964322157 degrees. This is not a numerical PASS criterion.
- Result: BLOCKED. The R3 plan records the 8.75-degree comparison value but does not cite a
  primary source. Review of the ISRO mission and mission-detail pages did not locate a
  statement of 8.75 degrees, +/-0.25 degrees, or a Sun-centre/limb convention.
- Coordinate provenance is deliberately distinct: the computation uses the catalog/model
  assumption `69.373 S, 32.319 E`; NASA/LROC reports an observed approximate fix of
  `69.3741 S, 32.32 E`; ISRO lists the planned target as `69.367621 S, 32.348126 E`.
- The reported 6-degree threshold and the 2-4 September operations interpretation are also
  source-unverified. The calculated crossing is retained as a model output, not a passed
  timeline validation.

## G3b - DSN Moon elevation

- The locked direct-geometry check remains `< 0.1 deg` against Horizons.
- The published `dsn.bin` stores elevations quantized in 0.5-degree steps. Its
  decoded samples are compared separately at the same Horizons epochs; the
  artifact tolerance proposal is `< 0.35 deg` (the locked 0.1-degree geometry
  allowance plus the maximum 0.25-degree half-step quantization error). This
  proposal does not change the locked G3b criterion.

## G7 - IM-2 touchdown geometry

- The G7 report deterministically evaluates Sun and Earth centre elevations at
  `2025-03-06T17:28:50Z`, `84.7906 S, 29.1957 E` using the catalog landing
  coordinate. These are calculation outputs, not independently sourced mission conditions.
  NASA confirms an approximate touchdown around `17:30 UTC`, landing in a crater, the
  lander on its side, and the inability to recharge solar cells; it does not establish the
  catalog second, coordinates, or a numerical touchdown Sun/Earth elevation.

## Aggregate G0-G11 report

`web/public/data/validation/report.json` is generated offline by
`lumen_pipeline.validation.report.write_validation_report()`. It only marks a gate PASS
when its required measured evidence artifact is available. In particular, G5 remains
BLOCKED without independent PGDA map-pixel references, G10 remains BLOCKED without terrain
Monte Carlo sigma and Tier-B calibration artifacts, and G7 remains BLOCKED because its
mission comparisons are unsupported. The R3 near-zone helper now preserves the distant DEM horizon whenever
the near-zone contribution is zero, including negative and unavailable values.
