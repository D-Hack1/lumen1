# Owner: Shiva Shakthi
# PSR mask + distance transform.
"""S-7 Permanently Shadowed Region (PSR) layer.

Per contracts/data_terrain_misc.md §4.2, the source hierarchy is:
  (1) a validated published polar PSR polygon/shapefile, if available;
  (2) otherwise, derived from the PGDA average-illumination map via a
      <=0.1% threshold, 8-connected labeling, and a >=0.1 km^2 area filter.

No published vector PSR polygon/shapefile was identified or verified for
this south-polar region as of this writing (see the S-7 final report).
What *was* identified and verified is PGDA's own "LPSR" raster (product 69,
same page as the illumination/Earth-visibility rasters): a directly
published permanent-shadow classification computed by the LOLA/PGDA team,
distributed as a raster rather than a vector polygon. This module uses that
raster as the classification input (labelled "published", with its raster
nature disclosed) and still applies the contract's full processing
pipeline (8-connected component labeling, area filter, Euclidean distance
transform, polar-stereographic scale correction) on top of it, rather than
trusting an unlabelled binary mask at face value.

PSRs are *never* described as confirmed ice deposits anywhere in this
module's output or documentation: per contract §4.4, the only permitted
wording is "permanently shadowed region (a cold trap that may host ice)".
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image
from scipy import ndimage

from .layers import (
    SPHERE_RADIUS_M,
    LayerArtifact,
    LayerUnavailable,
    RegionalRaster,
    _git_commit,
    _hex_to_rgb,
    _terrain_root,
    extent_radius_m,
    load_regional_layer_products,
    polar_stereographic_scale_factor,
    read_regional_window,
)

PSR_DEFINITION = "permanently shadowed region (a cold trap that may host ice)"
MIN_PSR_AREA_KM2 = 0.1
PSR_SHADOW_THRESHOLD = 0.5  # decoded LPSR value > 0.5 => classified shadowed
PSR_MASK_PALETTE = {"psr": "#3182bd", "none": "#00000000"}


@dataclass(frozen=True)
class PsrResult:
    qualifying_mask: np.ndarray  # bool, True where pixel belongs to a qualifying PSR
    valid: np.ndarray
    distance_km: np.ndarray  # true ground-distance km to nearest qualifying PSR pixel
    component_count_total: int
    component_count_qualifying: int
    min_qualifying_pixels: int
    resolution_m: float
    raster: RegionalRaster


def _pixel_latitudes_deg(raster: RegionalRaster) -> np.ndarray:
    """Latitude (deg, negative = south) of every pixel centre, from its
    projected (x, y) via the inverse sphere-based polar stereographic
    transform: colat = 2*atan(rho / (2R)); lat = -(90 - colat) for south.
    """

    rows, cols = raster.values.shape
    row_idx, col_idx = np.indices((rows, cols), dtype=np.float64)
    x, y = raster.transform @ (col_idx + 0.5, row_idx + 0.5)
    rho = np.hypot(x, y)
    colatitude = 2.0 * np.arctan(rho / (2.0 * SPHERE_RADIUS_M))
    return np.degrees(colatitude) - 90.0


def compute_psr(extent: str) -> PsrResult:
    """Classify permanent shadow, filter qualifying components, and compute
    the true ground-distance-to-nearest-qualifying-PSR raster, for one
    extent."""

    products = load_regional_layer_products()
    key = "psr_lpsr_85S_60m_pgda_69" if extent == "85_90S" else "psr_lpsr_65S_240m_pgda_69"
    product = products.get(key)
    if product is None:
        raise LayerUnavailable(f"{key}: no verified PSR classification product registered")
    radius_m = extent_radius_m(extent)
    raster = read_regional_window(product, radius_m=radius_m)

    resolution_m = raster.resolution_m
    pixel_area_km2 = (resolution_m * resolution_m) / 1.0e6
    min_pixels = int(np.ceil(MIN_PSR_AREA_KM2 / pixel_area_km2))

    shadowed = raster.valid & (raster.values > PSR_SHADOW_THRESHOLD)
    structure = np.ones((3, 3), dtype=bool)  # 8-connectivity
    labels, component_count_total = ndimage.label(shadowed, structure=structure)
    if component_count_total > 0:
        sizes = ndimage.sum(
            np.ones_like(labels), labels, index=np.arange(1, component_count_total + 1)
        )
        qualifying_labels = np.flatnonzero(sizes >= min_pixels) + 1
        qualifying_mask = np.isin(labels, qualifying_labels)
        component_count_qualifying = int(qualifying_labels.size)
    else:
        qualifying_mask = np.zeros_like(shadowed, dtype=bool)
        component_count_qualifying = 0

    # Distance transform: 0 inside a qualifying PSR, positive distance (in
    # projected metres) to the nearest qualifying-PSR pixel outside it.
    distance_px = ndimage.distance_transform_edt(~qualifying_mask)
    distance_m = distance_px * resolution_m

    pixel_lat = _pixel_latitudes_deg(raster)
    scale = np.vectorize(polar_stereographic_scale_factor)(pixel_lat)
    distance_km = (distance_m / scale) / 1000.0

    return PsrResult(
        qualifying_mask=qualifying_mask,
        valid=raster.valid,
        distance_km=distance_km.astype(np.float32),
        component_count_total=int(component_count_total),
        component_count_qualifying=component_count_qualifying,
        min_qualifying_pixels=min_pixels,
        resolution_m=resolution_m,
        raster=raster,
    )


def generate_psr_layer(extent: str, *, output_root: Path | None = None) -> LayerArtifact:
    """Generate the PSR binary-mask PNG + sidecar for one extent."""

    result = compute_psr(extent)
    terrain_root = _terrain_root(output_root)
    png_path = terrain_root / "layers" / f"psr_{extent}.png"

    height, width = result.qualifying_mask.shape
    rgba = np.zeros((height, width, 4), dtype=np.uint8)
    rgb = _hex_to_rgb(PSR_MASK_PALETTE["psr"])
    rgba[result.qualifying_mask, 0] = rgb[0]
    rgba[result.qualifying_mask, 1] = rgb[1]
    rgba[result.qualifying_mask, 2] = rgb[2]
    rgba[result.qualifying_mask, 3] = 255
    # Non-qualifying and invalid pixels stay (0,0,0,0): transparent.
    png_path.parent.mkdir(parents=True, exist_ok=True)

    Image.fromarray(rgba, mode="RGBA").save(png_path)

    radius_m = extent_radius_m(extent)
    sidecar: dict[str, Any] = {
        "version": "0.1.0",
        "producer": "lumen_pipeline.terrain.psr",
        "created_utc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "git_commit": _git_commit(),
        "layer_id": "psr",
        "extent": extent,
        "filename": png_path.relative_to(terrain_root).as_posix(),
        "definition": PSR_DEFINITION,
        "projection": {
            "name": "south-polar stereographic",
            "reference_radius_m": SPHERE_RADIUS_M,
            "latitude_of_origin_deg": -90.0,
            "central_meridian_deg": 0.0,
            "scale_factor_at_pole": 1.0,
            "proj4": "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400 +units=m +no_defs",
        },
        "radius_m": radius_m,
        "resolution_m": result.resolution_m,
        "width_px": int(width),
        "height_px": int(height),
        "nodata_encoding": "fully transparent alpha channel (RGBA PNG); non-qualifying pixels are also transparent",
        "legend_stops": [
            {"class": "psr", "label": PSR_DEFINITION, "hex": PSR_MASK_PALETTE["psr"]},
            {"class": "none", "label": "not a qualifying permanently shadowed region", "hex": None},
        ],
        "source": {
            "product_key": result.raster.product.key,
            "name": result.raster.product.name,
            "url": result.raster.product.url,
            "source_page": result.raster.product.source_page,
            "citation": result.raster.product.citation,
            "source_classification": "published",
            "format": "raster (not vector polygon/shapefile; see module docstring)",
        },
        "method": (
            "Classification input: PGDA LPSR raster, decoded value > 0.5 "
            "treated as shadowed. 8-connected component labeling "
            "(scipy.ndimage.label, 3x3 structure). Area filter: components "
            f"retained only if pixel count >= {result.min_qualifying_pixels} "
            f"(>= {MIN_PSR_AREA_KM2} km^2 at {result.resolution_m:g} m/px). "
            "Euclidean distance transform (scipy.ndimage.distance_transform_edt) "
            "computed in projected metres, then divided by the per-pixel "
            "polar-stereographic scale factor k(lat)=2/(1+sin|lat|) to give "
            "true ground-distance kilometres."
        ),
        "components": {
            "total_shadowed_components": result.component_count_total,
            "qualifying_components": result.component_count_qualifying,
            "min_qualifying_pixels": result.min_qualifying_pixels,
        },
    }
    sidecar_path = png_path.with_suffix(".json")
    sidecar_path.write_text(json.dumps(sidecar, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return LayerArtifact("psr", extent, png_path, sidecar)


def generate_psr_distance_layer(extent: str, *, output_root: Path | None = None) -> Path:
    """Write the PSR distance-transform binary + sidecar (Tier 1 "Distance-
    to-PSR" layer, contract §5.3 item 5), as a Float32 raster of true
    ground-distance kilometres to the nearest qualifying PSR pixel."""

    result = compute_psr(extent)
    terrain_root = _terrain_root(output_root)
    bin_path = terrain_root / "psr" / f"psr_distance_{extent}.bin"
    bin_path.parent.mkdir(parents=True, exist_ok=True)
    distance = np.where(result.valid, result.distance_km, np.nan).astype("<f4")
    bin_path.write_bytes(np.ascontiguousarray(distance).tobytes())

    radius_m = extent_radius_m(extent)
    sidecar = {
        "version": "0.1.0",
        "producer": "lumen_pipeline.terrain.psr",
        "created_utc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "git_commit": _git_commit(),
        "extent": extent,
        "filename": bin_path.relative_to(terrain_root).as_posix(),
        "definition": PSR_DEFINITION,
        "dtype": "float32",
        "unit": "km",
        "nodata": "NaN",
        "byte_order": "little",
        "array_order": "c_contiguous_row_major",
        "width_px": int(result.distance_km.shape[1]),
        "height_px": int(result.distance_km.shape[0]),
        "resolution_m": result.resolution_m,
        "radius_m": radius_m,
        "scale_correction": "true_km = projected_m_to_nearest_qualifying_psr / k(lat); k(lat) = 2/(1+sin|lat|), per-pixel",
        "qualifying_components": result.component_count_qualifying,
    }
    sidecar_path = bin_path.with_suffix(".json")
    sidecar_path.write_text(json.dumps(sidecar, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return bin_path
