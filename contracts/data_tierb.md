# Tier-B Regional Grid Tile Contract

_Owner: Shiva Shakthi_

Status: **Frozen — v0.1.0 producer/consumer contract**
Contract version: **`0.1.0`**

### Summary of Status & Decisions
To prevent unapproved implementation choices from being treated as normative, this specification distinguishes:
- **Confirmed Requirements:** Agreed upon and authoritative across project plans and upstream contracts.
- **Proposed Choices:** Architecturally motivated proposals awaiting formal team review and sign-off.
- **Unresolved Decisions:** Open architectural or integration questions pending coordination with Gowri and Nived before CP0 freeze.

---

## 1. Purpose, Scope, and Downstream Role

### 1.1 Purpose & Downstream Role (Confirmed)
Tier-B provides a precomputed regional horizon dataset with per-node terrain metadata across the lunar south-polar region (80° S – 90° S). It does not directly or independently evaluate illumination, communication, or terrain clearance. Downstream evaluators (the browser Web Worker engine and Python reference evaluator) consume this dataset: when an operator queries an arbitrary location within the south-polar domain, the downstream evaluator snaps to the nearest Tier-B node, loads the precomputed horizon mask and per-node terrain parameters, and computes illumination, communication, or clearance metrics. Tier-B itself is strictly a precomputed horizon dataset with per-node terrain metadata.

### 1.2 Relationship to Tier-A (Confirmed)
- **Tier-A:** High-fidelity, floating-point (`Float32`), 4-height (`1 m, 2 m, 5 m, 10 m`), 0.1° resolution (3600 bins) masks produced for curated landing sites.
- **Tier-B:** Quantized (`UInt8`), single-height (`1 m`), 0.5° resolution (720 bins) regional grid tiles with per-node terrain metadata enabling fast lookup across custom polar points.
- **Interoperability:** Both tiers share the verified site tangent-frame orientation, use an identical 7 × 7 local plane-fit rule for near-zone occluder modeling ($N^+$ clamp), and provide horizon elevation profiles used by downstream evaluators.

---

## 2. Regional Grid and Boundaries

### 2.1 Regional Coverage (Confirmed)
- Coverage spans the lunar south polar region from **80° S – 90° S** (-90.0° ≤ latitude ≤ -80.0°).

### 2.2 Dual-Zone Nominal Node Spacing (Confirmed)
- **Deep South (inside 85° S, -90.0° ≤ latitude < -85.0°):** Nominal **2 km** node spacing.
- **Outer Polar (80° S – 85° S, -85.0° ≤ latitude ≤ -80.0°):** Nominal **4 km** node spacing.

### 2.3 Grid Geometry, Alignment, and Boundaries (Confirmed)
- CRS: `+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400`.
- Nodes are aligned to integer multiples of their zone spacing from the pole. Tiles are 20 km squares and nodes are row-major (west-to-east, then south-to-north in projected coordinates).
- The 2 km zone owns nodes with latitude `< -85.0°`; the 4 km zone owns nodes with latitude `>= -85.0°`. A seam-crossing tile is invalid and must be split. Tile origins are 20 km multiples and adjacent tiles do not duplicate nodes.

---

## 3. Azimuth Sampling & Observer Height

### 3.1 Azimuth Resolution and Bin Count (Confirmed)
- **Azimuth bin width ($\Delta\text{az}$):** `0.5` degrees.
- **Number of azimuth bins:** `720` bins covering [0°, 360°).

### 3.2 Bin-Centre Sampling (Confirmed) and Frontend Interpolation (Pending Review)
- **Confirmed Bin-Centre Sampling:** Verified against `data_masks.md` §2. Bin $i \in [0, 719]$ represents the half-open interval $[i \times 0.5^\circ, (i + 1) \times 0.5^\circ)$. The representative sample centre is confirmed as:
  $$\text{azimuth}_i = (i + 0.5) \times 0.5^\circ$$
  Downstream evaluators must evaluate and sample horizon profiles at these sample centres (e.g. Bin 0 is centred at 0.25°, Bin 719 is centred at 359.75°).
- **Frontend Interpolation (Pending Review):** While bin-centre sampling is confirmed and established in `data_masks.md`, the exact client-side interpolation weighting, rounding, and edge-crossing behavior across 0.5° bins in the frontend Web Worker engine remain pending Nived's review. General similarity to Tier-A must not be treated as proof of an identical client-side interpolation implementation without formal engine review.

### 3.3 Observer Height (Confirmed)
- Observer height is fixed at **`1.0` metre** above the fitted ground plane $z_0$.
- Additional observer heights (2 m, 5 m, 10 m) are not stored for Tier-B.

### 3.4 Tangent Frame Convention (Confirmed)
Tier-B adheres to the verified coordinate frame in `data_masks.md` §2:
- Unit radial site normal $\mathbf{u}$ in `MOON_ME`.
- For $|\text{lat}| \ge 60^\circ$ (|lat| ≥ 60 degrees), the reference axis $\mathbf{a}$ is $+X_{\text{ME}}$ (mean sub-Earth direction toward 0° E); otherwise $+Z_{\text{ME}}$. Since Tier-B covers latitudes from 80° S – 90° S, the condition $|\text{lat}| \ge 60^\circ$ is satisfied everywhere in the domain, so $\mathbf{a} = +X_{\text{ME}}$.
- Projected reference direction $\mathbf{n}_{\text{ref}} = \operatorname{normalize}(\mathbf{a} - (\mathbf{a} \cdot \mathbf{u})\mathbf{u})$.
- East unit vector $\mathbf{e} = \mathbf{n}_{\text{ref}} \times \mathbf{u}$.
- Azimuth angle is $\operatorname{atan2}(\mathbf{v} \cdot \mathbf{e}, \mathbf{v} \cdot \mathbf{n}_{\text{ref}})$, normalized to $[0, 360)^\circ$, zero at $\mathbf{n}_{\text{ref}}$ and increasing toward east.

---

## 4. Tile Organization and File Packaging

### 4.1 Tile Dimensions and Resumability (Confirmed)
- Nodes are grouped into geographic tiles of approximately **20 km × 20 km**.
- Tile processing must be **resumable**: tiles are generated atomically, and finished tiles are skipped on subsequent runs to allow long-running batch generation on unattended laptops.

### 4.2 Packaging Architecture: Raw Binary Payload + JSON Index (Confirmed)
- Per the work-distribution specification, data artifacts follow the pattern of **binary arrays accompanied by a sidecar JSON header**.
- Intended publication directory: `web/public/data/terrain/tierb/`
  - Tile binaries: `tiles/<tile_id>.bin`
  - Tile metadata / header sidecars: `tiles/<tile_id>.json`
  - Regional index: `index.json`

### 4.3 v0.1.0 Binary and Index Schema (Confirmed)
- `<tile_id>.bin` is raw little-endian sections with no header. `index.json` is `{"schema":"tierb_index","version":"0.1.0"}` and records `crs`, `bin_deg`, `height_m`, `producer`, `git_commit`, and tile descriptors.
- Each descriptor has `id`, `file`, `n_nodes`, `spacing_m`, `bbox_xy_m`, `bbox_deg`, SHA-256, and section descriptors (`dtype`, `offset_bytes`, `byte_length`, `shape`, plus `scale`, `offset`, and `unit` where applicable).
- Sections are `lat_deg` Float32, `lon_deg` Float32, `mask` UInt16 `[n_nodes,720]`, `slope_deg` UInt16, `downhill_aspect_deg` UInt16, `z0_m` Float32, and `d_min_m` Float32. Optional `<tile_id>.json` records provenance and checksum. There is no global `node_spacing_m` or `d_min_m`.

---

## 5. UInt8 Horizon Quantization and Out-of-Range Handling

### 5.1 Quantization Step (Confirmed)
- Mask data type: little-endian `UInt16`; decoded elevation is `code * 0.01° - 10°`.
- `65535` is the only unavailable sentinel and is never a valid encoded horizon value. Finite values outside the representable range are rejected, never clamped.

### 5.2 Other Per-Node Encodings (Confirmed)
Decoding formula:
$$\text{elevation\_deg} = \text{code} \times 0.05^\circ + \text{offset\_deg}$$

- `slope_deg` and `downhill_aspect_deg` are UInt16 with `0.01°` scale and zero offset. `z0_m` and `d_min_m` are Float32 metres. Uphill azimuth is derived as `(downhill + 180) mod 360`.

### 5.3 Out-of-Range and Unavailable Value Handling (Confirmed)
- Nodata horizons encode as `65535`; finite out-of-range horizons and invalid slope/aspect values fail generation. Writer and reader validate all section bounds, shapes, and little-endian lengths before publishing/reusing a tile.

---

## 6. Per-Node Terrain Metadata and R3 Plane-Fit Requirements

### 6.1 Required Node Metadata (Confirmed)
Each node must carry the following terrain parameters:
1. **Slope angle $\theta$ (`slope_deg`):** Ground-normal plane slope angle in degrees, $[0, 90)^\circ$, defined as the angle between the ground normal $\mathbf{g}$ and the local radial up vector $\mathbf{u}$.
2. **Downhill aspect (`downhill_aspect_deg`):** Azimuth of the downhill direction (direction of steepest descent, opposite to the horizontal projection of the ground normal $\mathbf{g}$) in the node tangent frame, in degrees normalized to $[0, 360)^\circ$. (The horizontal projection of the ground normal points uphill; downhill aspect is opposite this projection).
3. **Uphill azimuth (`uphill_azimuth_deg`):** Azimuth of steepest ascent (direction of the horizontal projection of the ground normal $\mathbf{g}$ in the node tangent frame), calculated as $(\text{downhill\_aspect\_deg} + 180^\circ) \bmod 360^\circ$, in degrees normalized to $[0, 360)^\circ$.
4. **Plane-fit elevation $z_0$ (`z0_m`):** Fitted plane elevation at the node centre, in **metres above the 1737.4 km reference sphere** (consistent with the normalized DEM vertical datum).
5. **Near-zone boundary distance $d_{\min}$ (`d_min_m`):** Near-zone boundary distance in metres.
6. **Observer Height:** Explicitly **1.0 metre** above $z_0$.

### 6.2 R3 Plane-Fit Formulation (Confirmed)
- **Kernel Size:** $k = 3$, using a 7 × 7 window ($2k + 1 = 7$) on the finest available DEM covering the node.
- **Simultaneous Derivation:** $\theta$, downhill aspect, and $z_0$ must be derived simultaneously from the same fitted ground-normal plane $\mathbf{g}$.
- **Near-Zone Boundary:** $d_{\min} = 3 \times \text{near\_field\_pixel\_size}$ (e.g., $d_{\min} = 60\text{ m}$ for a 20 m/px DEM).

---

## 7. Near-Zone Occluder Formula and Tie-Break Behavior

### 7.1 Near-Zone Slope-Plane Formula (Confirmed)
At query time, downstream evaluators apply the R3 slope-plane geometric occluder:
1. Slope-plane elevation in radians:
   $$N(\text{az}) = \arctan\left(\tan \theta \cdot \cos(\text{az} - \text{uphill\_azimuth}) - \frac{h}{d_{\min}}\right)$$
   where $h = 1.0\text{ m}$, $d_{\min}$ is in metres, and $\text{az}$, $\text{uphill\_azimuth}$, and $\theta$ are converted to radians.
2. Clamped slope-plane term in degrees:
   $$N^+(\text{az}) = \max(0^\circ, N(\text{az}) \times \frac{180^\circ}{\pi})$$
3. Effective horizon elevation:
   $$m_{\text{eff}}(\text{az}) = \max(m_{\text{dem}}(\text{az}), N^+(\text{az}))$$
   where $m_{\text{dem}}(\text{az})$ is the decoded DEM horizon elevation in degrees.

### 7.2 Exact-Tie Behavior (Confirmed & Preserved from Tier-A)
In the event of an exact tie between the decoded DEM horizon and the near-zone occluder:
- When $m_{\text{dem}}(\text{az}) == N^+(\text{az})$ and both are finite, downstream evaluators select the DEM distance that produced $m_{\text{dem}}$ (preserving consistency with `data_masks.md` §7).

---

## 8. Coverage, Staging, and Fallback Paths

### 8.1 Publication Schedule (Confirmed)
Per the master plan (PLAN_FINAL §4, §11.3):
- **Phase 1 (Priority): 84° S – 90° S** (encompassing high-priority Artemis candidate regions), targeted for completion by milestone **H22**.
- **Phase 2: 80° S – 84° S**, scheduled for milestone **H28**.

### 8.2 Fallback Conditions (Confirmed Mechanics, Integration Presentation Pending)
1. **H22 Fallback (4 km Spacing Everywhere):** If processing for 84° S – 90° S is delayed at milestone H22, the fallback is **4 km spacing everywhere across the full 80° S – 90° S Tier-B coverage** (PLAN_FINAL §11.4).
2. **H28 Fallback (Tier-C Fallback for 80° S – 84° S):** If coverage for 80° S – 84° S is unavailable at milestone H28, custom-point queries in that band fall back to **Tier-C (smooth-Moon sphere, no terrain)** (PLAN_FINAL §11.4).
3. **Consumer-Facing Fallback Presentation (Integration Decision):** The exact visual badge text (e.g. badge naming conventions) in the frontend UI is an integration decision managed by Abhinav and Nived; it is not frozen by this data contract.

---

## 9. Validation and Gates

### 9.1 Raw Tile Publication Gates (Structural Checks Only)
A generated Tier-B tile is publishable only when it satisfies all structural checks:
1. Exactly 720 bins per node decode successfully.
2. Node counts in the binary and sidecar match the tile index descriptor.
3. Derived node metadata satisfy basic geometric definitions: $\theta \in [0, 90)^\circ$, downhill aspect $\in [0, 360)^\circ$, $d_{\min} > 0$, and finite $z_0$.
4. Node spacing complies with the nominal zone requirement (2 km inside 85° S, 4 km for 80° S – 85° S, or 4 km fallback everywhere).
5. Tile spatial extents completely cover the declared geographic bounds without corrupted or empty internal blocks.

Validation of horizon elevation values relies on these structural checks and consistency with the local terrain model; arbitrary or unsupported physical elevation acceptance ranges are not part of the publication gate.

### 9.2 Gate G10 Uncertainty Calibration (Separate Calibration Gate)
- **Gate G10 Scope:** Verification that at curated benchmark sites, snapped Tier-B event times fall within Tier-A event times $\pm$ reported $\delta t$ for $\ge 68\%$ of evaluated events.
- **Calibration Decoupling:** Gate G10 is a separate **uncertainty-calibration requirement**, not a blocking prerequisite for publishing basic geometric tile files. If G10 fails initially, the Tier-B nominal uncertainty ($\sigma$) is inflated until calibration passes; raw tile files are not discarded or blocked from publication.

---

## 10. Summary of Integration Dependencies & Decisions

| Decision / Item | Category | Status & Action Required |
|---|---|---|
| Regional coverage (80° S – 90° S) | Confirmed | Approved |
| Dual-zone spacing (2 km / 4 km) | Confirmed | Approved |
| 720 bins, 0.5° bin width | Confirmed | Approved |
| 1.0 m observer height | Confirmed | Approved |
| R3 plane-fit (7 × 7, $d_{\min} = 3 \times \text{px}$, $z_0$ ref sphere) | Confirmed | Approved |
| $N^+$ slope-plane occluder & tie-break | Confirmed | Approved |
| Resumable batch execution (~20 km tiles) | Confirmed | Approved |
| Staging (84° S – 90° S first at H22, 80° S – 84° S at H28) | Confirmed | Approved |
| H22 fallback: 4 km spacing everywhere (80° S – 90° S) | Confirmed | Approved |
| H28 fallback: Tier-C for unavailable 80° S – 84° S | Confirmed | Approved |
| G10 uncertainty calibration gate separation | Confirmed | Approved |
| Global quantization offset (`-2.5°`, codes 0 – 254 = `-2.5°` to `+10.2°`) | Proposed | Pending team approval |
| Quantization unavailable sentinel (`255`) | Proposed | Pending confirmation by Nived |
| Out-of-range clamping / saturation rule | Unresolved | Requires decision on dynamic vs fixed range |
| Cartographic projection & grid alignment | Unresolved | Pending coordinate alignment with map layers |
| Boundary node assignment at 85.0° S | Unresolved | Requires pipeline/lookup convention agreement |
| Binary header layout & field serialization | Unresolved | To be authored with Gowri (`binio.py`) |
| Tile index JSON schema & bounding-box format | Unresolved | Pending client loader review with Nived |
| Contract Freeze | Proposed | Kept Proposed pending CP0 integration sign-off |
