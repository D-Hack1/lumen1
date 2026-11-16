# Tier-A Terrain Mask Contract

_Owner: Shiva Shakthi_

Status: **Proposed — implementation baseline**
Contract version: **`1.0.0`**

This contract defines the producer output consumed by the mission visibility
evaluator and the frontend data-loading layer. The Python and TypeScript
implementations must conform to this document; neither implementation may
infer layout from file size.

## 1. Artifacts

For each Tier-A site, publish:

```text
terrain/masks/<site_id>.bin
terrain/masks/<site_id>.json
terrain/sigma/<site_id>.bin
terrain/sigma/<site_id>.json
```

`<site_id>` is the exact site identifier used in `sites.yaml` and the site
catalog. The identifier in each sidecar must match the filename stem.

Sigma is separate from the mask. This matches the separate frontend sigma
loader and permits Monte-Carlo recalibration without changing the geometric
mask. A consumer must not assume sigma is present in the mask binary.

## 2. Sampling and coordinate convention

| Property | Value |
|---|---:|
| Azimuth bin width | `0.1` degrees |
| Number of azimuth bins | `3600` |
| Observer heights | `[1.0, 2.0, 5.0, 10.0]` metres |
| Number of height levels | `4` |
| Maximum raycasting range | `250.0` km |
| Elevation unit | degrees |
| Distance unit | kilometres |
| Numeric type | IEEE-754 binary32 |

Azimuth is the site tangent-frame azimuth defined by PLAN_FINAL §5.1:

```text
u       = unit radial site vector in MOON_ME
n_ref   = normalize(a - dot(a, u) * u)
e       = cross(n_ref, u)
azimuth = atan2(dot(v, e), dot(v, n_ref)) in degrees, normalized to [0, 360)
```

`a` is `+X_ME` for `abs(latitude) >= 60°`, otherwise `+Z_ME`. The azimuth
zero direction is the projected `+X_ME`/`+Z_ME` reference axis `n_ref`;
azimuth increases toward `e`.

The frame convention (+X_ME for `abs(latitude) >= 60°`, +Z_ME otherwise,
azimuth increasing toward east) has been verified against `frames.py`, with
59 tests passed recorded as review evidence without claiming those tests
validate every contract requirement.

Bin `i` covers the half-open interval
`[i * 0.1°, (i + 1) * 0.1°)`. Its representative sample centre is
`(i + 0.5) * 0.1°`. Thus bin `0` is centred at `0.05°`, and bin `3599` is
centred at `359.95°`. Producers must sample and consumers must interpolate
using these centres, not the bin edges.

## 3. Mask binary layout

The binary file is a self-describing little-endian record. It has no padding
between fields or arrays.

### 3.1 Fixed header

| Offset | Size | Type | Value |
|---:|---:|---|---|
| `0` | 8 | ASCII | `LUMENMSK` |
| `8` | 2 | `uint16` | format version `1` |
| `10` | 2 | `uint16` | header size `64` bytes |
| `12` | 4 | `uint32` | `height_count = 4` |
| `16` | 4 | `uint32` | `azimuth_count = 3600` |
| `20` | 4 | float32 | `bin_width_deg = 0.1` |
| `24` | 4 | float32 | `ray_range_km = 250.0` |
| `28` | 4 | float32 | `distance_scale_km = 1.0` |
| `32` | 4 | `uint32` | elevation byte offset `64` |
| `36` | 4 | `uint32` | distance byte offset `57664` |
| `40` | 4 | `uint32` | elevation byte length `57600` |
| `44` | 4 | `uint32` | distance byte length `57600` |
| `48` | 4 | `uint32` | reserved; must be zero |
| `52` | 4 | `uint32` | reserved; must be zero |
| `56` | 8 | `uint64` | reserved; must be zero |

All integer and float fields are little-endian. The fixed header is followed
immediately by the arrays at the declared offsets. Consumers must reject a
file with an unexpected magic value, format version, header size, dimensions,
offset, length, or reserved field.

### 3.2 Array layout

1. Elevation: shape `(4, 3600)`, C-contiguous, height-major. The value at
   height index `h` and azimuth index `i` is at:
   `elevation[h * 3600 + i]`.
2. Distance: shape `(4, 3600)`, C-contiguous, height-major. The value at
   height index `h` and azimuth index `i` is at:
   `distance[h * 3600 + i]`.

Distance is height-indexed deliberately: the terrain point that produces the
maximum elevation angle can differ by observer height. A single `(3600,)`
distance array is not sufficient to satisfy the stated “distance to the
terrain point that produces that horizon” requirement.

The total file length is `115264` bytes. This is a validation check only; the
header remains authoritative.

Invalid or unavailable samples are encoded as quiet IEEE-754 NaN. Consumers
must preserve NaN and treat it as unavailable; they must not convert it to
zero or a success-shaped fallback. Valid distances are finite and satisfy
`0 < distance_km <= 250.0`.

## 4. Sigma artifact

The sigma files are:

```text
terrain/sigma/<site_id>.bin
terrain/sigma/<site_id>.json
```

The binary uses a 64-byte little-endian header with magic `LUMENSGM`,
format version `1`, and the same dimensions and azimuth convention.

| Offset | Size | Type | Value |
|---:|---:|---|---|
| `0` | 8 | ASCII | `LUMENSGM` |
| `8` | 2 | `uint16` | format version `1` |
| `10` | 2 | `uint16` | header size `64` bytes |
| `12` | 4 | `uint32` | `height_count = 4` |
| `16` | 4 | `uint32` | `azimuth_count = 3600` |
| `20` | 4 | float32 | `bin_width_deg = 0.1` |
| `24` | 4 | float32 | `ray_range_km = 250.0` |
| `28` | 4 | float32 | `distance_scale_km = 1.0` |
| `32` | 4 | `uint32` | sigma payload offset `64` |
| `36` | 4 | `uint32` | distance offset `0` |
| `40` | 4 | `uint32` | sigma payload length `57600` |
| `44` | 4 | `uint32` | distance length `0` |
| `48` | 4 | `uint32` | reserved; must be zero |
| `52` | 4 | `uint32` | reserved; must be zero |
| `56` | 8 | `uint64` | reserved; must be zero |

The sigma payload is one C-contiguous float32 array of shape `(4, 3600)`
containing one non-negative elevation standard deviation in degrees for each
height and azimuth bin.

The sigma sidecar uses the same required provenance fields as the mask
sidecar and additionally includes:

```json
{
  "source": "default | monte_carlo | calibrated",
  "clone_count": 30,
  "unit": "deg"
}
```

`clone_count` is required for `monte_carlo` and forbidden for `default`;
`calibrated` must identify the calibration method in `notes`. A missing sigma
artifact is permitted only for Tier-C data, never for a published Tier-A
mask.

## 5. Mask sidecar

`<site_id>.json` must contain:

```json
{
  "version": "1.0.0",
  "producer": "string",
  "created_utc": "RFC3339 UTC timestamp",
  "git_commit": "40-character commit",
  "site_id": "string",
  "latitude_deg": "number",
  "longitude_deg_east": "number",
  "coordinate_frame": "MOON_ME_DE421",
  "bin_width_deg": 0.1,
  "azimuth_count": 3600,
  "azimuth_zero": "projected_site_frame_reference",
  "azimuth_direction": "toward_site_frame_e",
  "azimuth_center": "i_plus_0.5_times_bin_width",
  "heights_m": [1.0, 2.0, 5.0, 10.0],
  "ray_range_km": 250.0,
  "near_field_resolution_m": "number",
  "d_min_m": "number",
  "z0_m": "number",
  "median_filter_region_radius_m": 100.0,
  "median_filter_kernel_px": 3,
  "median_filter_status": "applied",
  "plane_fit_kernel_px": 7,
  "plane_fit_half_width_px": 3,
  "slope_deg": "number",
  "downhill_aspect_deg": "number",
  "uphill_azimuth_deg": "number",
  "global_max_deg": ["number", "number", "number", "number"],
  "global_min_deg": ["number", "number", "number", "number"],
  "range_extrema": {
    "strategy": "finite_segment_tree",
    "supports_circular_azimuth_ranges": true
  },
  "near_zone_model": "fitted_local_plane",
  "dem_source": "string",
  "binary": {
    "magic": "LUMENMSK",
    "format_version": 1,
    "byte_order": "little",
    "float_encoding": "ieee754-binary32",
    "layout": "header_then_elevation_then_distance",
    "array_order": "c_contiguous_height_major"
  }
}
```

`latitude_deg`, `longitude_deg_east`, and `coordinate_frame` bind the mask to
the exact computation coordinate selected from the source-verified site row;
consumers must reject a mask that does not exactly match that coordinate.
`near_field_resolution_m` and `dem_source` describe the actual processed
inputs, not the preferred source. For Statio Shiv Shakthi, the selected source
must be the source actually obtained and processed from the PLAN_FINAL §4.1
ladder. The sidecar must not claim a finer resolution than that source
supports.

### 5.3 Metadata semantics

- `near_field_resolution_m` is the finest available near-field DEM pixel
  spacing, in metres. It must be finite and greater than zero.
- `d_min_m` is in metres and must equal
  `3 * near_field_resolution_m`.
- `z0_m` is the fitted local-plane elevation at the site centre, in metres in
  the normalized DEM vertical datum. It must be finite when the plane fit is
  available; otherwise it is unavailable and the mask is not publishable as a
  compliant Tier-A artifact.
- `median_filter_region_radius_m` identifies the spatial region around the
  site, in metres, within which the filter is applied. It is not the radius
  of the filter kernel and must be `100.0` for this contract.
  `median_filter_kernel_px` is the pixel kernel width and must be `3`.
  `median_filter_status` is `applied` only when that operation was completed.
  If a valid 3x3 median-filter neighbourhood cannot be obtained within the
  100 m region, set `median_filter_status = "unavailable"` and record the
  reason in provenance.
- The physical footprint of the 3x3 kernel is determined by
  `near_field_resolution_m`. Do not fabricate finer data, enlarge the
  filtering region, or substitute another filter. Tier-A publication is
  allowed with `median_filter_status = "unavailable"` only if the required
  plane fit and all other geometry requirements remain valid. The achieved
  DEM resolution must be documented in `near_field_resolution_m`.
- `plane_fit_kernel_px` must be `7`; `plane_fit_half_width_px` must be `3`.
  The 7-pixel window has an outer-pixel-centre baseline of
  `6 * near_field_resolution_m`, not `7 * near_field_resolution_m`.
- `slope_deg` is the fitted plane slope in degrees, finite and in
  `[0, 90)`. The two aspect fields are degrees normalized to `[0, 360)`.
  They are unavailable when the plane fit is unavailable. Use `null` for
  unavailable scalar metadata in JSON; use NaN only in binary arrays.
- `global_max_deg` and `global_min_deg` contain four values in height order,
  in degrees. Each is computed over finite elevation samples only. If a
  height has no finite elevation sample, its extrema value is unavailable.
  In JSON, unavailable metadata values are `null`; JSON must not use a
  non-standard NaN token. In binary arrays, unavailable samples remain NaN.
  NaN must never be converted to zero.

`range_extrema` is not binary payload. With
`strategy = "finite_segment_tree"`, the loader builds one min/max segment tree
per height from the finite elevation bins. A query uses half-open bin indices
`[start, end)`. A non-wrapping query is one interval; a query crossing zero is
split into `[start, 3600)` and `[0, end)`, and the two finite results are
combined. If every bin in a queried interval is NaN, both results are NaN.
The loader must use the same height and azimuth ordering as the payload.

## 6. R3 near-field processing

The producer uses the finest available DEM for the near-field operation.
Before raycasting, it applies a 3x3 pixel median filter to the source samples
within the 100 m spatial region around the site and records the operation and
source resolution in the sidecar. It fits
the local plane using a 7x7 pixel window (`k = 3`) centred on the site.
`z0_m` is the fitted plane value at the site centre; the raw centre DEM pixel
must not be substituted. DEM raycasting begins at `d_min_m`; the fitted plane
handles the near zone, so DEM samples are not marched through that zone a
second time.

If `theta` is the fitted slope in radians, `downhill_aspect` is the fitted
downhill direction in radians, `uphill_azimuth = downhill_aspect + pi`, `az`
is the ray azimuth in radians, `h` is observer height in metres, and
`d_min` is `d_min_m` in metres, then:

```
N(az) = atan(tan(theta) * cos(az - uphill_azimuth) - h / d_min)
N_plus(az) = max(0, N(az))
effective_horizon = max(m_dem, N_plus)
```

`N` is converted to degrees before comparison with `m_dem`. The near-zone
model is active for both Tier A and Tier B. The DEM horizon `m_dem` is never
clamped; only the near-zone contribution is clamped to zero.

The 100 m value defines the spatial region, not a kernel radius. The producer
must not enlarge that region, fabricate finer data, or substitute another
filter when source resolution is coarse. If a valid 3x3 median-filter
neighbourhood cannot be obtained within the 100 m region, set
`median_filter_status = "unavailable"` and record the reason in provenance.
Tier-A publication is allowed only if the required plane fit and all other
geometry requirements remain valid; the achieved DEM resolution must be
documented in `near_field_resolution_m` (e.g. 240 m/px).

## 7. Distance semantics

For each `(height, azimuth)` sample:

1. If `m_dem` is finite and `N_plus` is unavailable, distance is the distance
   in kilometres to the DEM sample/ray intersection that produced `m_dem`.
2. If `N_plus` is finite and `m_dem` is unavailable, distance is
   `d_min_m / 1000`, the near-zone boundary at which the fitted-plane
   contribution is evaluated.
3. If both are finite and `m_dem > N_plus`, distance is the DEM distance that
   produced `m_dem`.
4. If both are finite and `N_plus > m_dem`, distance is `d_min_m / 1000`.
5. If both contributions are unavailable, elevation and distance are NaN.
6. If `m_dem == N_plus` and both are finite, select the DEM distance that
   produced `m_dem`.

The distance must identify the contribution selected by the same comparison
that produces the stored elevation. It must be finite and in `(0, 250]` km
whenever the elevation is finite.

## 8. Sigma semantics

Sigma is a C-contiguous, height-major Float32 array of shape `(4, 3600)`;
values are non-negative elevation standard deviations in degrees. For every
valid mask sample, sigma is mandatory and must be finite and non-negative.
For every unavailable mask sample, sigma must be NaN. Sigma validity must
match the associated mask sample; consumers must not replace NaN with zero.

For `source = "monte_carlo"`, `clone_count` is required and must be an
integer in the R3 range `[20, 30]`. For `source = "default"`, `clone_count`
must be absent. For `source = "calibrated"`, `notes` is required and must
identify the calibration method. The sigma header's distance offset and
distance length must both be zero.

The sigma sidecar must also contain `shape: [4, 3600]`,
`height_order_m: [1.0, 2.0, 5.0, 10.0]`, and `binary` fields describing
`LUMENSGM`, format version `1`, 64-byte header, little-endian
IEEE-754 binary32 values, and the height-major C-contiguous payload.

## 9. Pipeline and served paths

The pipeline producer writes directly to the corresponding paths under
`web/public/data/`:

```text
web/public/data/terrain/masks/<site_id>.bin
web/public/data/terrain/masks/<site_id>.json
web/public/data/terrain/sigma/<site_id>.bin
web/public/data/terrain/sigma/<site_id>.json
```

The paths in §1 are the same files relative to the web data root; they are
not a separate pipeline output or staging location. The publication process
serves or packages these files without renaming them.

## 10. Validation and publication gates

A Tier-A publication is valid only when all of the following pass:

1. The mask and sigma headers decode with the specified magic, version,
   byte order, offsets, lengths, dimensions, and zero reserved fields.
2. Sigma header distance offset and distance length are both zero.
3. The sidecar filename, `site_id`, dimensions, heights, bin width, range,
   and binary descriptor agree.
4. Elevation and distance payloads decode as `(4, 3600)` float32 arrays.
5. Every valid distance is finite and within `(0, 250.0]` km; unavailable
   samples are NaN.
6. Sigma is shape `(4, 3600)`; its finite values are non-negative, and its
   NaN pattern matches mask validity.
7. `d_min_m` equals `3 * near_field_resolution_m`; the 3x3 filter and 7x7
   plane-fit metadata match the actual processing. If a valid 3x3 median-filter
   neighbourhood cannot be obtained within the 100 m region,
   `median_filter_status = "unavailable"` is conditionally acceptable (not an
   automatic failure) for Tier-A publication provided the reason is recorded,
   the achieved DEM resolution is documented in `near_field_resolution_m`, and
   the required plane fit and all other geometry requirements remain valid.
8. `z0_m`, slope/aspects, extrema, and filter metadata satisfy §5.3.
9. Range-extrema reconstruction uses finite-only segment-tree queries and
   correctly handles intervals crossing azimuth zero.
10. Near-zone processing follows §6, including the `-h / d_min` term, and
    distance follows §7.
11. Source and achieved near-field resolution match the actual production
   inputs and the retained site summary.
12. Synthetic horizon cases validate the azimuth centre convention, height
   ordering, elevation ordering, distance ordering, and include an exact-tie
   test verifying that when `m_dem == N_plus` and both are finite, the DEM
   distance is selected.
13. The producer/consumer golden-vector test reads the same representative
   bins in Python and TypeScript.

Consumers must reject incompatible versions or malformed metadata rather than
silently applying defaults. Any change to magic, header, dimensions,
ordering, units, azimuth convention, NaN policy, or sigma semantics requires
a new incompatible contract version and coordinated producer/consumer
approval.

## 11. Integration status

The following checkpoints track contract integration and verification:

1. Gowri implements matching mask and sigma binary support in `binio.py`.
2. The frame convention is verified: `+X_ME` for `|lat| >= 60°`, `+Z_ME`
   otherwise, with azimuth increasing toward east (`e = cross(n_ref, u)`).
   59 tests passed, which is recorded as review evidence without claiming
   those tests validate every contract requirement.
3. Frontend compatibility remains pending Nived's confirmation, including the
   `(4, 3600)` distance arrays, `range_extrema` segment-tree queries, and
   sigma artifact paths.
4. Python and TypeScript golden vectors pass.
5. The team confirms the contract for CP0 freeze.

Until all checkpoints pass (specifically pending frontend compatibility
confirmation by Nived), this document remains **Proposed** and must not be
marked frozen.
