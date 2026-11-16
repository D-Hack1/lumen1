"""Tier-A terrain mask generation and contract serialization."""

from __future__ import annotations

import json
import math
import re
import struct
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import yaml
from pyproj import Transformer

from ..common.frames import site_rotation_matrix, site_up_vector
from .crops import CropCoverageError, TerrainCrop, TerrainCrops
from .dem_io import LUNAR_SPHERICAL_CRS, DemWindow
from .horizon import HorizonResult, raycast_horizon


class NearFieldUnavailable(RuntimeError):
    """Raised when the required R3 near-field operation cannot be performed."""


@dataclass(frozen=True)
class NearFieldModel:
    """Fitted R3 plane and provenance for one actual near-field crop."""

    z0_m: float
    slope_deg: float
    downhill_aspect_deg: float
    uphill_azimuth_deg: float
    d_min_m: float
    near_field_resolution_m: float
    median_filter_status: str
    median_filter_reason: str | None
    median_filter_radius_m: float
    median_filter_kernel_px: tuple[int, int]
    plane_fit_k: int
    plane_fit_half_width_m: float
    filtered_elevation: np.ndarray


@dataclass(frozen=True)
class MaskArtifact:
    """Generated mask arrays, metadata, and published paths."""

    elevation_deg: np.ndarray
    distance_km: np.ndarray
    metadata: dict[str, Any]
    binary_path: Path
    sidecar_path: Path


def _terrain_root(output_root: Path | None) -> Path:
    if output_root is not None:
        return Path(output_root)
    return Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "terrain"


def _git_commit() -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    commit = result.stdout.strip()
    return commit if re.fullmatch(r"[0-9a-fA-F]{40}", commit) else None


def _site(site_id: str, sites_path: Path | None = None) -> dict[str, Any]:
    path = sites_path or Path(__file__).resolve().parents[2] / "config" / "sites.yaml"
    document = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    for record in document.get("sites", []):
        if record.get("id") == site_id:
            return record
    raise KeyError(f"unknown site identifier: {site_id}")


def _site_coordinates(site_id: str, site: dict[str, Any]) -> tuple[float, float]:
    """Return authoritative computation coordinates for a registered site."""

    coordinates = site.get("landing_coords") if site_id == "cy3_shiv_shakti" else None
    coordinates = coordinates or site
    latitude = coordinates.get("latitude_deg")
    longitude = coordinates.get("longitude_deg_east")
    if not isinstance(latitude, (int, float)) or not isinstance(longitude, (int, float)):
        raise TypeError(f"{site_id} has no verified computation coordinates")
    return float(latitude), float(longitude)


def _pixel_distances_m(dem: DemWindow, latitude_deg: float, longitude_deg: float) -> np.ndarray:
    transformer = Transformer.from_crs(dem.crs, LUNAR_SPHERICAL_CRS, always_xy=True)
    rows, cols = dem.elevation.shape
    row_grid, col_grid = np.indices((rows, cols), dtype=np.float64)
    x, y = dem.transform @ (col_grid + 0.5, row_grid + 0.5)
    longitudes, latitudes = transformer.transform(x, y)
    site = site_up_vector(latitude_deg, longitude_deg)
    points = np.stack(
        (
            np.cos(np.radians(latitudes)) * np.cos(np.radians(longitudes)),
            np.cos(np.radians(latitudes)) * np.sin(np.radians(longitudes)),
            np.sin(np.radians(latitudes)),
        ),
        axis=-1,
    )
    return 1_737_400.0 * np.arccos(np.clip(points @ site, -1.0, 1.0))


def _site_pixel(dem: DemWindow, latitude_deg: float, longitude_deg: float) -> tuple[int, int]:
    transformer = Transformer.from_crs(LUNAR_SPHERICAL_CRS, dem.crs, always_xy=True)
    x, y = transformer.transform(longitude_deg, latitude_deg)
    col, row = (~dem.transform) @ (x, y)
    return round(col - 0.5), round(row - 0.5)


def fit_near_field(
    crop: TerrainCrop,
    *,
    latitude_deg: float,
    longitude_deg: float,
) -> NearFieldModel:
    """Apply the R3 3x3 filter and fit the required 7x7 plane."""

    dem = crop.dem
    resolution_m = crop.achieved_resolution_m
    d_min_m = 3.0 * resolution_m
    row_c, col_c = _site_pixel(dem, latitude_deg, longitude_deg)
    rows, cols = dem.elevation.shape
    if row_c - 3 < 0 or row_c + 3 >= rows or col_c - 3 < 0 or col_c + 3 >= cols:
        raise NearFieldUnavailable("7x7 plane-fit window is outside the near crop")

    distances = _pixel_distances_m(dem, latitude_deg, longitude_deg)
    source = np.array(dem.elevation, dtype=np.float64, copy=True)
    filtered = source.copy()
    radius_pixels = math.ceil(100.0 / resolution_m) + 1
    for row in range(max(0, row_c - radius_pixels), min(rows, row_c + radius_pixels + 1)):
        for col in range(max(0, col_c - radius_pixels), min(cols, col_c + radius_pixels + 1)):
            if distances[row, col] > 100.0:
                continue
            if not dem.valid[row, col]:
                continue
            window = dem.valid[
                max(0, row - 1) : min(rows, row + 2),
                max(0, col - 1) : min(cols, col + 2),
            ]
            if window.shape != (3, 3) or not np.all(window):
                raise NearFieldUnavailable(
                    "3x3 median-filter neighbourhood is incomplete for a valid "
                    "source pixel within 100 m"
                )
            filtered[row, col] = float(np.median(source[row - 1 : row + 2, col - 1 : col + 2]))

    if not np.all(dem.valid[row_c - 3 : row_c + 4, col_c - 3 : col_c + 4]):
        raise NearFieldUnavailable("7x7 plane-fit samples contain unavailable DEM data")

    transformer = Transformer.from_crs(dem.crs, LUNAR_SPHERICAL_CRS, always_xy=True)
    rotation = site_rotation_matrix(latitude_deg, longitude_deg)
    site_position = 1_737.4 * site_up_vector(latitude_deg, longitude_deg)
    design: list[list[float]] = []
    values: list[float] = []
    for row in range(row_c - 3, row_c + 4):
        for col in range(col_c - 3, col_c + 4):
            x, y = dem.transform @ (col + 0.5, row + 0.5)
            lon, lat = transformer.transform(x, y)
            point = 1_737.4 * site_up_vector(lat, lon)
            local = 1000.0 * (rotation @ (point - site_position))
            design.append([float(local[0]), float(local[1]), 1.0])
            values.append(float(filtered[row, col]))
    coefficients, _, _, _ = np.linalg.lstsq(np.asarray(design), np.asarray(values), rcond=None)
    east_gradient, north_gradient, z0 = coefficients
    uphill = math.degrees(math.atan2(east_gradient, north_gradient)) % 360.0
    slope = math.degrees(math.atan(math.hypot(east_gradient, north_gradient)))
    return NearFieldModel(
        z0_m=float(z0),
        slope_deg=float(slope),
        downhill_aspect_deg=(uphill + 180.0) % 360.0,
        uphill_azimuth_deg=float(uphill),
        d_min_m=d_min_m,
        near_field_resolution_m=resolution_m,
        median_filter_status="applied",
        median_filter_reason=None,
        median_filter_radius_m=100.0,
        median_filter_kernel_px=(3, 3),
        plane_fit_k=3,
        plane_fit_half_width_m=3.0 * resolution_m,
        filtered_elevation=filtered,
    )


def _restrict_crop(
    crop: TerrainCrop,
    *,
    latitude_deg: float,
    longitude_deg: float,
    elevation: np.ndarray | None = None,
) -> DemWindow:
    dem = crop.dem
    distances = _pixel_distances_m(dem, latitude_deg, longitude_deg) / 1000.0
    valid = np.array(dem.valid, copy=True)
    valid &= distances > crop.spec.min_distance_km
    valid &= distances <= crop.spec.max_distance_km
    return DemWindow(
        elevation=dem.elevation if elevation is None else elevation,
        valid=valid,
        transform=dem.transform,
        crs=dem.crs,
        bounds=dem.bounds,
        resolution_m=dem.resolution_m,
        source=dem.source,
        provenance=dem.provenance,
        error=dem.error,
        error_valid=dem.error_valid,
    )


def _combine_horizons(results: list[HorizonResult]) -> tuple[np.ndarray, np.ndarray]:
    elevation = np.full((4, 3600), np.nan, dtype=np.float32)
    distance = np.full((4, 3600), np.nan, dtype=np.float32)
    for result in results:
        take = np.isfinite(result.elevation_deg) & (
            ~np.isfinite(elevation) | (result.elevation_deg > elevation)
        )
        elevation[take] = result.elevation_deg[take]
        distance[take] = result.distance_km[take]
    return elevation, distance


def _apply_near_zone(
    elevation: np.ndarray,
    distance: np.ndarray,
    near: NearFieldModel,
    observer_heights_m: tuple[float, ...],
    azimuth_deg: np.ndarray,
) -> None:
    theta = math.radians(near.slope_deg)
    uphill = math.radians(near.uphill_azimuth_deg)
    for height_index, height_m in enumerate(observer_heights_m):
        near_angle = np.degrees(
            np.arctan(
                np.tan(theta) * np.cos(np.radians(azimuth_deg) - uphill) - height_m / near.d_min_m
            )
        )
        near_angle = np.maximum(0.0, near_angle)
        # R3 D-9 application rule: m_eff = m_dem wherever N+ = 0 (the clamp
        # is never applied to m_dem itself, so a negative distant horizon
        # must be preserved exactly); only a strictly positive near-zone
        # contribution may replace the distant horizon/distance.
        take = (near_angle > 0.0) & (
            ~np.isfinite(elevation[height_index]) | (near_angle > elevation[height_index])
        )
        elevation[height_index, take] = near_angle[take]
        distance[height_index, take] = near.d_min_m / 1000.0


def _header() -> bytes:
    return struct.pack(
        "<8sHHIIfffIIIIIIQ",
        b"LUMENMSK",
        1,
        64,
        4,
        3600,
        0.1,
        250.0,
        1.0,
        64,
        57664,
        57600,
        57600,
        0,
        0,
        0,
    )


def _validate_mask_arrays(elevation: np.ndarray, distance: np.ndarray) -> None:
    if elevation.shape != (4, 3600) or distance.shape != (4, 3600):
        raise ValueError("Tier-A arrays must both have shape (4, 3600)")
    if not np.array_equal(np.isfinite(elevation), np.isfinite(distance)):
        raise ValueError("elevation and distance availability masks must match")
    for name, values in (("elevation", elevation), ("distance", distance)):
        values = np.asarray(values)
        if np.any(np.isinf(values)):
            raise ValueError(f"{name} contains infinity")
        if name == "distance":
            finite = np.isfinite(values)
            if np.any(values[finite] <= 0.0) or np.any(values[finite] > 250.0):
                raise ValueError("finite distances must be in (0, 250] km")


def _validate_header(payload: bytes) -> None:
    if len(payload) != 115264:
        raise ValueError("Tier-A mask has an unexpected file length")
    header = struct.unpack("<8sHHIIfffIIIIIIQ", payload[:64])
    expected = (b"LUMENMSK", 1, 64, 4, 3600, 0.1, 250.0, 1.0, 64, 57664, 57600, 57600, 0, 0, 0)
    if header[:5] != expected[:5] or header[8:] != expected[8:]:
        raise ValueError("Tier-A mask header does not match the contract")
    if not all(
        math.isclose(header[index], expected[index], rel_tol=0.0, abs_tol=1e-6)
        for index in (5, 6, 7)
    ):
        raise ValueError("Tier-A mask header float fields do not match the contract")


def _crop_metadata(crop: TerrainCrop) -> dict[str, Any]:
    provenance = crop.dem.provenance
    return {
        "source_key": crop.source_key,
        "source_url": crop.source_url,
        "shape": list(crop.dem.elevation.shape),
        "resolution_m": list(crop.dem.resolution_m),
        "crs": provenance.get("source_crs"),
        "frame": provenance.get("frame"),
        "vertical_reference": provenance.get("vertical_reference"),
        "datum_reference": provenance.get("datum_reference"),
        "unit": provenance.get("unit"),
        "scale": provenance.get("scale"),
        "offset": provenance.get("offset"),
        "nodata": None
        if not isinstance(provenance.get("nodata"), (int, float))
        or not math.isfinite(float(provenance["nodata"]))
        else provenance["nodata"],
        "cache_key": provenance.get("cache_key"),
    }


def _write_mask(binary_path: Path, elevation: np.ndarray, distance: np.ndarray) -> None:
    _validate_mask_arrays(elevation, distance)
    binary_path.parent.mkdir(parents=True, exist_ok=True)
    payload = _header()
    payload += np.ascontiguousarray(elevation, dtype="<f4").tobytes()
    payload += np.ascontiguousarray(distance, dtype="<f4").tobytes()
    if len(payload) != 115264:
        raise ValueError(f"unexpected Tier-A mask size: {len(payload)}")
    _validate_header(payload)
    binary_path.write_bytes(payload)


def generate_tier_a_mask(
    site_id: str,
    crops: TerrainCrops,
    *,
    output_root: Path | None = None,
    geometric_growth_factor: float,
    sites_path: Path | None = None,
    producer: str = "lumen_pipeline.terrain.masks",
    require_complete_crops: bool = False,
) -> MaskArtifact:
    """Generate and publish one Tier-A mask from already-read crops.

    S-4 callers retain the historical partial-crop behavior by leaving
    ``require_complete_crops`` disabled. S-5 publication enables it.
    """

    if crops.near is None:
        raise CropCoverageError(f"{site_id} Tier-A mask requires a verified near-field crop")
    git_commit = _git_commit()
    if not isinstance(git_commit, str) or re.fullmatch(r"[0-9a-fA-F]{40}", git_commit) is None:
        raise ValueError("Tier-A publication requires a valid 40-character Git commit hash")
    site = _site(site_id, sites_path)
    site_latitude, site_longitude = _site_coordinates(site_id, site)
    near = fit_near_field(
        crops.near,
        latitude_deg=site_latitude,
        longitude_deg=site_longitude,
    )
    require_complete_crops = require_complete_crops or site_id in {
        "shackleton_ridge",
        "cy3_shiv_shakti",
    }
    if require_complete_crops:
        missing_crops = tuple(
            name
            for name, crop in (("near", crops.near), ("mid", crops.mid), ("far", crops.far))
            if crop is None
        )
        if missing_crops:
            raise CropCoverageError(
                f"{site_id} Tier-A mask requires complete near/mid/far coverage; "
                f"unavailable crops: {', '.join(missing_crops)}"
            )
    heights = (1.0, 2.0, 5.0, 10.0)
    results: list[HorizonResult] = []
    for crop in (crops.near, crops.mid, crops.far):
        if crop is None:
            continue
        restricted = _restrict_crop(
            crop,
            latitude_deg=site_latitude,
            longitude_deg=site_longitude,
            elevation=near.filtered_elevation if crop is crops.near else None,
        )
        results.append(
            raycast_horizon(
                restricted,
                latitude_deg=site_latitude,
                longitude_deg_east=site_longitude,
                observer_heights_m=heights,
                bin_width_deg=0.1,
                max_range_km=250.0,
                near_field_pixel_size_m=near.near_field_resolution_m,
                geometric_growth_factor=geometric_growth_factor,
                site_elevation_m=near.z0_m,
            )
        )
    elevation, distance = _combine_horizons(results)
    azimuth = (np.arange(3600, dtype=np.float64) + 0.5) * 0.1
    _apply_near_zone(elevation, distance, near, heights, azimuth)
    finite_extrema = [
        {
            "min_deg": float(np.min(row[finite])),
            "max_deg": float(np.max(row[finite])),
        }
        if np.any(finite := np.isfinite(row))
        else {"min_deg": None, "max_deg": None}
        for row in elevation
    ]
    root = _terrain_root(output_root)
    binary_path = root / "masks" / f"{site_id}.bin"
    sidecar_path = root / "masks" / f"{site_id}.json"
    metadata: dict[str, Any] = {
        "version": "1.0.0",
        "producer": producer,
        "created_utc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "git_commit": git_commit,
        "site_id": site_id,
        "latitude_deg": site_latitude,
        "longitude_deg_east": site_longitude,
        "coordinate_frame": "MOON_ME_DE421",
        "bin_width_deg": 0.1,
        "azimuth_count": 3600,
        "azimuth_zero": "projected_site_frame_reference",
        "azimuth_direction": "toward_site_frame_e",
        "azimuth_center": "i_plus_0.5_times_bin_width",
        "heights_m": list(heights),
        "ray_range_km": 250.0,
        "near_field_resolution_m": near.near_field_resolution_m,
        "d_min_m": near.d_min_m,
        "z0_m": near.z0_m,
        # contracts/data_masks.md §5/§5.3 names this field
        # "median_filter_region_radius_m" (the spatial region around the
        # site, not the filter kernel's own radius). The internal
        # NearFieldModel.median_filter_radius_m attribute keeps its name
        # unchanged since golden_near_zone_synthetic.py constructs
        # NearFieldModel with that keyword and must not be touched here.
        "median_filter_region_radius_m": near.median_filter_radius_m,
        "median_filter_kernel_px": near.median_filter_kernel_px[0],
        "median_filter_status": near.median_filter_status,
        "plane_fit_kernel_px": 2 * near.plane_fit_k + 1,
        "plane_fit_half_width_px": near.plane_fit_k,
        "slope_deg": near.slope_deg,
        "downhill_aspect_deg": near.downhill_aspect_deg,
        "uphill_azimuth_deg": near.uphill_azimuth_deg,
        "global_max_deg": [item["max_deg"] for item in finite_extrema],
        "global_min_deg": [item["min_deg"] for item in finite_extrema],
        "range_extrema": {
            "strategy": "finite_segment_tree",
            "supports_circular_azimuth_ranges": True,
        },
        "near_zone_model": "fitted_local_plane",
        "dem_source": crops.near.source_key,
        "dem_crops": {
            "near": _crop_metadata(crops.near),
            "mid": _crop_metadata(crops.mid) if crops.mid is not None else None,
            "far": _crop_metadata(crops.far) if crops.far is not None else None,
        },
        "provenance": {
            "median_filter_reason": near.median_filter_reason,
        },
        "binary": {
            "magic": "LUMENMSK",
            "format_version": 1,
            "byte_order": "little",
            "float_encoding": "ieee754-binary32",
            "layout": "header_then_elevation_then_distance",
            "array_order": "c_contiguous_height_major",
        },
    }
    _write_mask(binary_path, elevation, distance)
    sidecar_path.parent.mkdir(parents=True, exist_ok=True)
    sidecar_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return MaskArtifact(elevation, distance, metadata, binary_path, sidecar_path)
