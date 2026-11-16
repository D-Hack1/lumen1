# Terrain Miscellaneous Artifact Contract

_Owner: Shiva Shakthi_

Status: **Proposed — implementation baseline**
Contract version: **`0.1.0`**

This contract defines the data schemas, metadata structures, and validation rules for the miscellaneous terrain artifacts produced by the LUMEN terrain pipeline. These artifacts include touchdown pad slope statistics, dispersion micro-grids, Monte-Carlo elevation uncertainty (sigma), Permanently Shadowed Region (PSR) distances, map layers, Artemis candidate region outlines, per-site summaries, and the pipeline run manifest.

The `git_commit` recorded in the manifest and in artifact sidecars identifies
the source-code repository commit used to generate those artifacts. It is not
the commit that merely copied, packaged, or served them.

### Summary of Status & Decisions
To maintain architectural boundaries, this document distinguishes:
- **Confirmed Requirements:** Explicitly established in project requirements and authoritative specifications.
- **Proposed Choices:** Architecturally consistent choices proposed to enable implementation, pending formal review.
- **Unresolved Decisions:** Open parameters, binary layouts, or conventions requiring coordination with Gowri and Nived before CP0 freeze.

---

## 1. Touchdown Pad Statistics

### 1.1 Artifact Path & Format
- **Path:** `web/public/data/terrain/pad/<site_id>.json`
- **Format:** JSON (UTF-8, indented, human-readable).
- `<site_id>` matches the site identifier in `pipeline/config/sites.yaml`.

### 1.2 Required Schema & Fields (Confirmed)
```json
{
  "version": "0.1.0",
  "producer": "lumen_pipeline.terrain.pad",
  "created_utc": "RFC3339 timestamp",
  "site_id": "string",
  "ground_normal_me": ["number", "number", "number"],
  "slope_deg": "number",
  "downhill_aspect_deg": "number",
  "uphill_az_deg": "number",
  "z0_m": "number",
  "d_min_m": "number",
  "near_field_resolution_m": "number",
  "under_resolved": "boolean",
  "plane_fit": {
    "k": 3,
    "window_px": [7, 7],
    "window_dim_m": ["number", "number"],
    "baseline_m": "number",
    "dem_source": "string"
  },
  "dispersion_slope_stats": {
    "p50": "number",
    "p95": "number",
    "max": "number",
    "pct_below_tolerance": "number"
  }
}
```

### 1.3 Field Semantics & Values (Confirmed)
- `ground_normal_me`: Unit 3-D ground-normal vector $\mathbf{g} = [g_x, g_y, g_z]$ in the `MOON_ME` reference frame, fitted via a least-squares plane over the local landing footprint.
- `slope_deg`: Terrain slope angle $\theta \in [0, 90)^\circ$, defined as the angle between $\mathbf{g}$ and the local radial up vector $\mathbf{u}$:
  $$\theta = \arccos(\mathbf{g} \cdot \mathbf{u})$$
- `downhill_aspect_deg`: Azimuth of steepest descent in the site tangent frame, normalized to $[0, 360)^\circ$.
- `uphill_az_deg`: Azimuth of steepest ascent in the site tangent frame, normalized to $[0, 360)^\circ$, satisfying:
  $$\text{uphill\_az\_deg} = (\text{downhill\_aspect\_deg} + 180^\circ) \bmod 360^\circ$$
- `z0_m`: Local plane elevation at the site centre, in **metres above the 1737.4 km reference sphere** (matching the normalized DEM vertical datum).
- `d_min_m`: Near-zone boundary distance in metres, satisfying $d_{\min} = 3 \times \text{near\_field\_resolution\_m}$.
- `near_field_resolution_m`: Spatial pixel resolution in metres of the finest covering DEM used for the pad fit.
- `under_resolved`: Boolean flag set to `true` whenever `near_field_resolution_m` is coarser than the lander footprint baseline (~5–6 m).
- `plane_fit`: Provenance metadata recording $k = 3$ ($7 × 7$ window), physical window dimensions in metres, the outer-pixel baseline ($6 \times \text{near\_field\_resolution\_m}$), and the source DEM identifier. The exact same fitted plane supplies $\theta$, aspect, and $z_0$.
- `dispersion_slope_stats`: Percentile slope statistics (`p50`, `p95`, `max`) and percentage of dispersion area below the slope hazard tolerance threshold (`pct_below_tolerance`), computed from the covering slope raster/DEM within the dispersion radius.

### 1.3.1 Known, Documented Deviations (Unresolved Project Defaults)
- **`under_resolved` may be `null`.** `pipeline/config/terrain.yaml`'s `pad_statistics.nominal_lander_footprint_m` is explicitly unresolved (`null`, "no confirmed numeric default"). Until a footprint baseline is decided, `pad.py` reports `under_resolved: null` rather than inventing a 5–6 m default to force a boolean. Consumers must treat `null` as "not yet determinable," not as `false`.
- **`dispersion_slope_stats` may report `{"available": false, "reason": "..."}` instead of `{p50, p95, max, pct_below_tolerance}`.** `pad_statistics.dispersion_radius_m` and `pad_statistics.slope_tolerance_deg` are both explicitly unresolved in `terrain.yaml`. `pad.py` never invents a radius or tolerance to force these statistics; it reports the block as unavailable, with a reason, until the project sets both defaults. This is a cross-team blocker: `web/src/engine/data/pad.ts`'s `parsePad` does not yet branch on an `available` flag for this block, so a frontend consumer of `dispersionSlopeStats.p50` will currently read `undefined` rather than a validated number when the block is unavailable. Resolving the project defaults removes this gap without any further schema change.
- Both deviations are scoped to sites where the plane-fit geometry (`ground_normal_me`, `slope_deg`, `downhill_aspect_deg`, `uphill_az_deg`, `z0_m`, `d_min_m`) is otherwise fully valid and provenance-backed.

### 1.4 Downhill Aspect Cross-Contract Conflict (Explicit Clarification)
- **Documented Conflict:** In PLAN_FINAL §5.6 / R3 D-9, `downhill_aspect` is phrased as *"azimuth of the horizontal projection of g"*. However, geometrically the horizontal projection of the upward ground normal $\mathbf{g}$ points in the direction of steepest ascent (**uphill**).
- **Established Convention:** To maintain mathematical consistency with the near-zone occluder formula $N(\text{az})$ in `data_masks.md` §6 and `data_tierb.md` §6.1, `downhill_aspect_deg` represents the direction of steepest descent (opposite to the horizontal projection of $\mathbf{g}$), while `uphill_az_deg` represents the horizontal projection of $\mathbf{g}$.
- **Status:** Identified as an explicit cross-contract clarification point requiring formal harmonization across project text, without altering the working near-zone formula.

---

## 2. Dispersion Micro-Grid

### 2.1 Artifact Paths
- **Binary Grid:** `web/public/data/terrain/dispersion/<site_id>.bin`
- **Sidecar JSON:** `web/public/data/terrain/dispersion/<site_id>.json`

### 2.2 Confirmed Requirements
- **Grid Dimensions:** $11 × 11$ nodes (121 total nodes) centered at each Tier-A site.
- **Node Spacing:** Exactly **50 m** metric node spacing along the local site tangent axes.
- **Node Content:** Each node carries:
  1. A $0.5^\circ$ horizon mask (720 azimuth bins) at **1.0 m** observer height.
  2. Local slope angle $\theta$ in degrees.
  3. Local downhill aspect in degrees.
- **Sidecar Metadata:** `<site_id>.json` must describe the bin width
  ($0.5^\circ$), observer height ($1.0\text{ m}$), and standard producer
  provenance (`version`, `producer`, `created_utc`, `git_commit`). The
  dispersion-grid origin and node offsets relative to the site centre,
  including their exact serialization, remain unresolved.

### 2.3 Unresolved Binary Serialization Details
- **Unresolved:** The exact binary layout inside `<site_id>.bin` (magic bytes, numeric encoding such as `UInt8` quantized vs `Float32`, interleaving of horizon bins with slope/aspect metadata, and node traversal ordering: row-major vs concentric).
- **Status:** Pending coordination with Gowri (`binio.py`) and Nived (frontend loader). No binary header or field offsets are invented in this contract.

---

## 3. Monte-Carlo Uncertainty (Sigma)

### 3.1 Artifact Paths
- **Binary Sigma:** `web/public/data/terrain/sigma/<site_id>.bin`
- **Sidecar JSON:** `web/public/data/terrain/sigma/<site_id>.json`

### 3.2 Confirmed Requirements (Preserved from `data_masks.md` §4 & §8)
- **Scope:** Computed for Tier-A centre points.
- **DEM Error Clones:** Generated from 20 to 30 DEM error clones using spatially correlated noise scaled by the covering LOLA `_ERR` raster (or PGDA-provided error clones where available).
- **Raycasting:** Full horizon raycaster is re-executed across each clone.
- **Per-Bin Standard Deviation:** The standard deviation of elevation angles across all clones is computed for each azimuth bin and height.
- **Data Type & Shape:** C-contiguous IEEE-754 `Float32` array of shape `(4, 3600)`, matching the 4 observer heights (`1 m, 2 m, 5 m, 10 m`) and 3600 azimuth bins ($0.1^\circ$ width).
- **Separation:** Sigma is strictly separated from the geometric mask binary to allow independent recalibration and separate frontend loading.
- **Header Standard:** Uses the established 64-byte header with magic `LUMENSGM`, format version `1`, zero distance offset/length, and sidecar metadata (`source = "monte_carlo"`, `clone_count`, `unit = "deg"`).
- **No Inventions:** No new binary layout or alternative calibration formula is invented beyond `data_masks.md`.

---

## 4. Permanently Shadowed Region (PSR) Distances

### 4.1 Artifact Paths
- **Raster Distance Binary:** `web/public/data/terrain/psr/psr_distance.bin`
- **Metadata Sidecar:** `web/public/data/terrain/psr/psr_distance.json` (also referenced in site summaries).
- The raster is a shared distance-to-PSR artifact. Per-site `distance_km`,
  `bearing_deg`, and area fields in site summaries are derived site metrics,
  not separate raster values.
- **Verified naming clarification (not yet implemented):** `web/src/engine/data/psr.ts`'s
  `loadPsr()` currently reads exactly this single, un-suffixed, merged
  `psr_distance.{bin,json}` pair (a quantized `uint16` raster with
  `half_extent_km`/`pixel_m` fields) for point-query lookups
  (e.g. `Basemap.tsx`'s hover distance readout). No producer currently
  writes this specific artifact; it remains an open implementation gap,
  independent of the §5.3 item 5 naming below.
- **Do not confuse this artifact with the §5.3 item 5 "Distance-to-PSR" map
  layer.** `lumen_pipeline.terrain.psr.generate_psr_distance_layer(extent)`
  already writes `psr_distance_80_90S.{bin,json}` and
  `psr_distance_85_90S.{bin,json}` -- per-extent, `float32`, ground-distance
  kilometres, with `radius_m`/`resolution_m`/`width_px`/`height_px` fields.
  That is a *different*, already-implemented Tier-1 map-layer artifact (one
  raster per standard S-7 extent, matching every other map layer's naming
  convention), not a draft or incorrect name for this section's merged
  evaluator raster. The two are schema-incompatible (`uint16` vs `float32`,
  merged vs per-extent, different field names) and must not be treated as
  interchangeable. If a consumer (e.g. a loader reading
  `psr_distance_80_90S.*`) is integrating against the Tier-1 map layer, that
  is correct and matches the producer; it is not a fix for the still-missing
  single merged raster this section describes.

### 4.2 Source Ladder & Derivation Rules (Confirmed)
- **Preferred Source:** Published polar PSR polygon/shapefile dataset, if accessible, validated, and citable by milestone H8.
- **Fallback Derivation:**
  - Derived from the PGDA Average Illumination map: pixels with average illumination $≤ 0.1\%$ are classified as candidate shadow.
  - Morphological filtering: 8-connected component labeling.
  - Area threshold: Retain only connected components with area $≥ 0.1\text{ km}^2$.
  - Equivalent minimum pixel counts:
    - At $60\text{ m/px}$ resolution: $≥ 28\text{ pixels}$.
    - At $240\text{ m/px}$ resolution: $≥ 2\text{ pixels}$.
  - Distance computation: Euclidean 2D distance transform computed in projected metres.
- **Map Scale Correction:** Projected metre distances are converted to true ground-distance kilometres using the exact polar-stereographic scale factor at the site latitude.
- Per-site distance values are ground distances in kilometres. Raster
  resolution, no-data semantics, and the PSR raster binary layout remain
  unresolved and require coordination with the producer, binary helper, and
  frontend loader.

### 4.3 Per-Site Summary Fields (Confirmed)
For each landing site, the PSR pipeline outputs:
- `distance_km`: Ground distance in kilometres to the nearest qualifying PSR boundary.
- `bearing_deg`: Azimuth/bearing from the site to the closest point of the nearest PSR in degrees ($[0, 360)^\circ$, site tangent frame).
- `nearest_psr_area_km2`: Area in square kilometres of the nearest qualifying PSR component.
- `source_classification`: Either `"published"` or `"derived"`.
- **Tier 1 Major PSR Toggle:** Distance, bearing, and area to the nearest major PSR with area $≥ 10\text{ km}^2$.

### 4.4 Mandatory Scientific Wording & Disclaimer (Confirmed)
- **Required Terminology:** In all documentation and sidecars, PSRs must be defined verbatim as:
  > *"permanently shadowed region (a cold trap that may host ice)"*
- **Strict Prohibition:** The pipeline and documentation must **never** claim that a region is an ice deposit or is confirmed volatile-bearing. Permanently shadowed status is strictly thermal/geometric.

---

## 5. Map Layers

### 5.1 Artifact Paths & Formats
- **Image Rasters:** PNG image files under `web/public/data/terrain/layers/`
- **Catalog Descriptor:** `web/public/data/terrain/layers.json`

### 5.2 Required Extents (Confirmed)
Every map layer is rendered at two standard polar extents:
1. **Full Polar Domain:** $80° S – 90° S$ ($-90.0^\circ \le \text{lat} \le -80.0^\circ$).
2. **Inner Deep South:** $85° S – 90° S$ ($-90.0^\circ \le \text{lat} \le -85.0^\circ$).

### 5.3 Required Layer Set (Confirmed)
1. **Average Illumination:** Multi-year average solar illumination percentage (PGDA LOLA dataset).
2. **Earth Visibility:** Multi-year percentage of time the Earth is visible above the local horizon.
3. **Slope Hazard:** Classified terrain slope raster partitioned into 4 distinct hazard classes:
   - Safe: $[0^\circ, 5^\circ)$
   - Caution: $[5^\circ, 10^\circ)$
   - Critical: $[10^\circ, 15^\circ]$
   - Exceeded: $(15^\circ, 90^\circ)$
4. **PSR (Permanently Shadowed Regions):** Binary mask of qualifying cold-trap regions (published or derived).
5. **Distance-to-PSR (Tier 1):** Continuous distance transform raster from qualifying PSR boundaries.
   **Verified, already implemented:** `lumen_pipeline.terrain.psr.generate_psr_distance_layer(extent)`
   writes `web/public/data/terrain/psr/psr_distance_<extent>.bin` (`<extent>`
   is `80_90S` or `85_90S`, matching every other S-7 layer's naming) plus a
   matching `.json` sidecar, as a little-endian `float32`,
   C-contiguous row-major raster of true ground-distance kilometres
   (`NaN` outside DEM coverage), not a palette-indexed PNG like the other
   four layers in this list -- a confirmed, deliberate deviation from §5.1's
   general "PNG" rule for this one continuous-valued layer. This artifact is
   distinct from, and must not be confused with, the single merged
   `psr_distance.bin` evaluator raster in §4.1.

### 5.4 Visual & Technical Rules
- **Projection:** A single polar-stereographic projection shared across the entire layer set.
- **Palettes:** Strict colour-blind-safe continuous and discrete color ramps.
- **Descriptor Schema (`layers.json`):**
  For each layer entry: `layer_id`, `name`, `extent` (`"80_90S"` or `"85_90S"`), `filename`, `projection` parameters, `legend_stops` (values, labels, hex colors), and `source_citation`.
- **Unresolved Projection Parameters:** The exact central meridian, standard parallel, raster pixel dimensions, and palette hex values are proposed pending coordination with Ebin and Abhinav; they are not frozen by this contract.

---

## 6. Artemis Candidate Regions

### 6.1 Artifact Paths & Formats
- **Vector Descriptor:** `web/public/data/terrain/regions.json`
- **Vector Assets:** Vector paths embedded in `regions.json` (or companion SVG assets).

### 6.2 Confirmed Metadata Fields
- `region_id`: Unique identifier for each candidate region.
- `name`: Official USGS/NASA Artemis III candidate region name.
- `centroid_lat_deg`: Centroid latitude in degrees MOON_ME.
- `centroid_lon_deg`: Centroid longitude in degrees MOON_ME.
- `svg_path`: Simplified vector polygon path string in SVG format.
- `projection`: Shared polar-stereographic projection matching the map layers so region outlines overlay seamlessly onto PNG rasters.
- **No Inventions:** Exact region IDs, coordinates, and boundaries are ingested directly from official USGS Artemis shapefiles without manual fabrication.

---

## 7. Site Summaries and Manifest

### 7.1 Site Summary (`summaries/<site_id>.json`)
Generated after every terrain execution to provide Gowri's catalog builder (`pipeline/lumen_pipeline/catalog/build_catalog.py`) with authoritative per-site terrain metadata.

Each `files_present` entry is optional: an unavailable artifact may be
represented by JSON `null` or the entry may be omitted. A present path must
refer to the artifact generated for the same site and source-code commit.

Required fields:
```json
{
  "version": "0.1.0",
  "site_id": "string",
  "run_timestamp_utc": "RFC3339 timestamp",
  "tier": "Tier A | Tier B | pending",
  "near_field_res_m": "number",
  "dem_source": "string",
  "files_present": {
    "mask_bin": "path/string or null",
    "mask_json": "path/string or null",
    "sigma_bin": "path/string or null",
    "sigma_json": "path/string or null",
    "pad_json": "path/string or null",
    "dispersion_bin": "path/string or null",
    "dispersion_json": "path/string or null"
  },
  "pad_headline": {
    "slope_deg": "number",
    "downhill_aspect_deg": "number",
    "uphill_az_deg": "number",
    "under_resolved": "boolean"
  },
  "psr": {
    "distance_km": "number",
    "bearing_deg": "number",
    "nearest_psr_area_km2": "number",
    "source_classification": "published | derived"
  }
}
```

### 7.2 Terrain Manifest (`terrain/manifest.json`)
Lists all published terrain artifacts, format versions, git commit hash, generation timestamps, and checksums.

### 7.3 Catalog Ownership Boundary (Strict Requirement)
- Shiva's pipeline writes `summaries/<site_id>.json` and `manifest.json`.
- Shiva's pipeline **never** writes or modifies `pipeline/config/sites.yaml` or `web/public/data/catalog/sites.json`. Gowri is the sole owner and builder of the unified catalog.

---

## 8. Ownership and Integration

| Area | Lead Owner | Integration Responsibility |
|---|---|---|
| Terrain pipelines & contracts | **Shiva Shakthi** | Author of all modules in `pipeline/lumen_pipeline/terrain/` and `contracts/data_terrain_*.md` |
| Catalog construction | **Gowri** | Ingests `summaries/<site_id>.json` into `sites.json` via `build_catalog.py` |
| Data serialization helpers | **Gowri** | Supplies shared readers/writers in `common/binio.py` |
| Coordinate frames & constants | **Gowri** | Supplies `frames.py` and `constants.py` |
| Master site list | **Gowri** | Maintains `pipeline/config/sites.yaml` |
| Frontend data loaders | **Nived** | Implements loaders in `web/src/engine/data/*` (not Shiva) |
| Frontend map rendering | **Ebin / Nived** | Integrates PNG layers and region SVGs into `features/map/Basemap.tsx` |

All generated files are written strictly into subdirectories of `web/public/data/terrain/`.

---

## 9. Validation Gates and Open Decisions

### 9.1 Validation Requirements
Before artifacts are accepted for publication:
1. **Touchdown Pad Plane Fit:** A proposed test target is validation on a
   synthetic tilted-plane DEM with mathematically known slope and aspect,
   with fitted parameters within $< 0.001^\circ$. This is not a confirmed
   acceptance requirement.
2. **Dispersion Grid:** Validated for exactly $11 × 11 = 121$ nodes, strictly uniform $50\text{ m}$ spacing, and valid $[0, 360)^\circ$ aspect definitions.
3. **Monte-Carlo Sigma:** Validated for shape $(4, 3600)$, non-negative Float32 values, and matching mask sample validity per `data_masks.md`.
4. **PSR Processing:** Validated 8-connectivity component grouping, area filtering $≥ 0.1\text{ km}^2$, polar-stereographic scale factor application, and strictly compliant scientific disclaimer phrasing.
5. **Map Layers & Regions:** Validated identical projection bounding box between PNG layers and SVG vectors; known benchmark coordinates project to the exact matching pixel coordinates across both extents ($80\text{--}90^\circ\text{S}$ and $85\text{--}90^\circ\text{S}$).
6. **Manifest & Summary Consistency:** Validated that every file declared in `manifest.json` and `summaries/<site_id>.json` exists on disk with matching paths and non-zero byte size.

### 9.2 Summary of Decisions & Dependencies

| Item | Category | Status & Action |
|---|---|---|
| Pad statistics fields & $7 × 7$ plane-fit | Confirmed | Approved |
| Pad $z_0$ datum (metres above 1737.4 km sphere) | Confirmed | Approved |
| Pad downhill/uphill aspect convention | Confirmed | Clarified geometry vs R3 D-9 wording |
| Dispersion $11 × 11$ grid at $50\text{ m}$ spacing | Confirmed | Approved |
| Sigma 20–30 clones, `Float32`, `LUMENSGM` | Confirmed | Preserved from `data_masks.md` |
| PSR fallback ($≤ 0.1\%$ illum, $≥ 0.1\text{ km}^2$) | Confirmed | Approved |
| PSR mandatory cold-trap wording | Confirmed | Approved |
| Map layer set & dual extents ($80\text{--}90^\circ\text{S}$, $85\text{--}90^\circ\text{S}$) | Confirmed | Approved |
| Artemis regions USGS shapefile provenance | Confirmed | Approved |
| Summary & manifest role for `build_catalog.py` | Confirmed | Approved |
| Dispersion binary layout & field ordering | Unresolved | Requires agreement with Gowri and Nived |
| PSR distance raster binary header | Unresolved | Requires agreement with Gowri and Nived |
| Map layer projection parameters & color hex stops | Unresolved | Requires agreement with Ebin and Abhinav |
| Artemis SVG simplification tolerance | Proposed | Pending visual inspection on map widget |
| Contract Freeze | Proposed | Kept Proposed pending CP0 review |
