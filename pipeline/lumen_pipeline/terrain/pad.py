"""Validated local plane and pad slope statistics for Tier-A terrain sites."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
from pyproj import CRS, Transformer

from ..common.frames import site_rotation_matrix, site_up_vector
from .crops import TerrainCrops
from .dem_io import LUNAR_SPHERICAL_CRS, SPHERE_RADIUS_M, DemWindow

PLANE_FIT_K = 3
PLANE_FIT_SIZE_PX = 2 * PLANE_FIT_K + 1
MVP_SITE_IDS = ("im2_athena", "cy3_shiv_shakti", "shackleton_ridge")


class PadStatisticsUnavailable(RuntimeError):
    """Raised when required DEM data or explicit pad configuration is missing."""


@dataclass(frozen=True)
class GroundPlane:
    """A local least-squares ground plane, fitted in the site tangent frame."""

    z0_m: float
    normal_local: tuple[float, float, float]
    normal_me: tuple[float, float, float]
    slope_deg: float
    downhill_aspect_deg: float
    uphill_azimuth_deg: float
    window_px: tuple[int, int]
    window_m: tuple[float, float]
    coefficients: tuple[float, float, float]


@dataclass(frozen=True)
class SlopeStatistics:
    """Finite slope distribution statistics within a physical radius."""

    radius_m: float
    source: str
    p50_deg: float | None
    p95_deg: float | None
    maximum_deg: float | None
    percent_below_tolerance: float | None
    sample_count: int
    slope_tolerance_deg: float


@dataclass(frozen=True)
class PadStatistics:
    """Validated, JSON-serializable S-6 pad statistics."""

    site_id: str
    source_key: str
    source_resolution_m: float
    plane: GroundPlane
    slopes: SlopeStatistics | None
    slopes_unavailable_reason: str | None
    footprint_m: float | None
    under_resolved: bool | None


def _projected_metre_crs(dem: DemWindow) -> None:
    if not dem.crs.is_projected:
        raise PadStatisticsUnavailable("pad statistics require a projected DEM CRS")
    pyproj_crs = CRS.from_wkt(dem.crs.to_wkt())
    units = {axis.unit_name.lower() for axis in pyproj_crs.axis_info if axis.unit_name}
    if not units or not units <= {"metre", "meter", "metres", "meters"}:
        raise PadStatisticsUnavailable("pad statistics require DEM coordinates in metres")


def _site_pixel(
    dem: DemWindow,
    latitude_deg: float,
    longitude_deg_east: float,
) -> tuple[int, int]:
    transformer = Transformer.from_crs(LUNAR_SPHERICAL_CRS, dem.crs, always_xy=True)
    x, y = transformer.transform(longitude_deg_east, latitude_deg)
    col, row = (~dem.transform) @ (x, y)
    return round(col - 0.5), round(row - 0.5)


def _pixel_distances_m(
    dem: DemWindow,
    latitude_deg: float,
    longitude_deg_east: float,
) -> np.ndarray:
    transformer = Transformer.from_crs(dem.crs, LUNAR_SPHERICAL_CRS, always_xy=True)
    rows, cols = dem.elevation.shape
    row_grid, col_grid = np.indices((rows, cols), dtype=np.float64)
    x, y = dem.transform @ (col_grid + 0.5, row_grid + 0.5)
    longitudes, latitudes = transformer.transform(x, y)
    site = site_up_vector(latitude_deg, longitude_deg_east)
    points = np.stack(
        (
            np.cos(np.radians(latitudes)) * np.cos(np.radians(longitudes)),
            np.cos(np.radians(latitudes)) * np.sin(np.radians(longitudes)),
            np.sin(np.radians(latitudes)),
        ),
        axis=-1,
    )
    return SPHERE_RADIUS_M * np.arccos(np.clip(points @ site, -1.0, 1.0))


def fit_ground_plane(
    dem: DemWindow,
    *,
    latitude_deg: float,
    longitude_deg_east: float,
    k: int = PLANE_FIT_K,
) -> GroundPlane:
    """Fit the required 7x7 local plane and derive its normal and aspects."""

    if k != PLANE_FIT_K:
        raise ValueError("S-6 requires a plane-fit k of 3")
    _projected_metre_crs(dem)
    row_c, col_c = _site_pixel(dem, latitude_deg, longitude_deg_east)
    rows, cols = dem.elevation.shape
    if row_c - k < 0 or row_c + k >= rows or col_c - k < 0 or col_c + k >= cols:
        raise PadStatisticsUnavailable("7x7 plane-fit window is outside the DEM")
    window_valid = dem.valid[row_c - k : row_c + k + 1, col_c - k : col_c + k + 1]
    window_values = dem.elevation[row_c - k : row_c + k + 1, col_c - k : col_c + k + 1]
    if not np.all(window_valid) or not np.isfinite(window_values).all():
        raise PadStatisticsUnavailable("7x7 plane-fit window contains missing DEM samples")

    transformer = Transformer.from_crs(dem.crs, LUNAR_SPHERICAL_CRS, always_xy=True)
    rotation = site_rotation_matrix(latitude_deg, longitude_deg_east)
    site_position = 1_737.4 * site_up_vector(latitude_deg, longitude_deg_east)
    design: list[list[float]] = []
    values: list[float] = []
    for row in range(row_c - k, row_c + k + 1):
        for col in range(col_c - k, col_c + k + 1):
            x, y = dem.transform @ (col + 0.5, row + 0.5)
            longitude, latitude = transformer.transform(x, y)
            point = 1_737.4 * site_up_vector(latitude, longitude)
            local = 1000.0 * (rotation @ (point - site_position))
            design.append([float(local[0]), float(local[1]), 1.0])
            values.append(float(dem.elevation[row, col]))

    east_gradient, north_gradient, z0 = np.linalg.lstsq(
        np.asarray(design), np.asarray(values), rcond=None
    )[0]
    slope_deg = math.degrees(math.atan(math.hypot(east_gradient, north_gradient)))
    uphill_azimuth_deg = math.degrees(math.atan2(east_gradient, north_gradient)) % 360.0
    downhill_aspect_deg = (uphill_azimuth_deg + 180.0) % 360.0
    normal = np.asarray((-east_gradient, -north_gradient, 1.0), dtype=float)
    normal /= np.linalg.norm(normal)
    # ``rotation`` is orthonormal (rows east, north-reference, up), so its
    # transpose maps a direction back from the site tangent frame to MOON_ME.
    normal_me = rotation.T @ normal
    resolution_x, resolution_y = (abs(value) for value in dem.resolution_m)
    return GroundPlane(
        z0_m=float(z0),
        normal_local=tuple(float(value) for value in normal),
        normal_me=tuple(float(value) for value in normal_me),
        slope_deg=float(slope_deg),
        downhill_aspect_deg=float(downhill_aspect_deg),
        uphill_azimuth_deg=float(uphill_azimuth_deg),
        window_px=(PLANE_FIT_SIZE_PX, PLANE_FIT_SIZE_PX),
        window_m=(PLANE_FIT_SIZE_PX * resolution_x, PLANE_FIT_SIZE_PX * resolution_y),
        coefficients=(float(east_gradient), float(north_gradient), float(z0)),
    )


def compute_slope_statistics(
    dem: DemWindow,
    *,
    latitude_deg: float,
    longitude_deg_east: float,
    radius_m: float,
    slope_tolerance_deg: float,
    slope_data_deg: np.ndarray | None = None,
) -> SlopeStatistics:
    """Compute finite P50/P95/max slope statistics within ``radius_m``."""

    _projected_metre_crs(dem)
    if not math.isfinite(radius_m) or radius_m <= 0.0:
        raise ValueError("dispersion radius must be a positive finite distance")
    if not math.isfinite(slope_tolerance_deg):
        raise ValueError("slope tolerance must be finite")
    distances = _pixel_distances_m(dem, latitude_deg, longitude_deg_east)
    if slope_data_deg is not None:
        slope_values = np.asarray(slope_data_deg, dtype=float)
        if slope_values.shape != dem.elevation.shape:
            raise ValueError("slope data shape must match the DEM")
        source = "provided_slope_deg"
        valid = np.array(dem.valid, dtype=bool) & np.isfinite(slope_values)
    else:
        elevation = np.asarray(dem.elevation, dtype=float)
        valid_dem = np.array(dem.valid, dtype=bool) & np.isfinite(elevation)
        dx, dy = (abs(value) for value in dem.resolution_m)
        gradient_y, gradient_x = np.gradient(elevation, dy, dx)
        valid = valid_dem.copy()
        valid[0, :] = valid[-1, :] = valid[:, 0] = valid[:, -1] = False
        valid[1:-1, 1:-1] &= (
            valid_dem[:-2, 1:-1] & valid_dem[2:, 1:-1] & valid_dem[1:-1, :-2] & valid_dem[1:-1, 2:]
        )
        slope_values = np.degrees(np.arctan(np.hypot(gradient_x, gradient_y)))
        source = "dem_gradient"
    values = slope_values[valid & (distances <= radius_m)]
    values = values[np.isfinite(values)]
    if values.size == 0:
        return SlopeStatistics(
            radius_m=float(radius_m),
            source=source,
            p50_deg=None,
            p95_deg=None,
            maximum_deg=None,
            percent_below_tolerance=None,
            sample_count=0,
            slope_tolerance_deg=float(slope_tolerance_deg),
        )
    return SlopeStatistics(
        radius_m=float(radius_m),
        source=source,
        p50_deg=float(np.percentile(values, 50)),
        p95_deg=float(np.percentile(values, 95)),
        maximum_deg=float(np.max(values)),
        percent_below_tolerance=float(np.mean(values < slope_tolerance_deg) * 100.0),
        sample_count=int(values.size),
        slope_tolerance_deg=float(slope_tolerance_deg),
    )


def generate_pad_statistics(
    site_id: str,
    crops: TerrainCrops,
    *,
    latitude_deg: float,
    longitude_deg_east: float,
    dispersion_radius_m: float | None = None,
    slope_tolerance_deg: float | None = None,
    footprint_m: float | None = None,
    slope_data_deg: np.ndarray | None = None,
) -> PadStatistics:
    """Calculate S-6 statistics from an actual near-field terrain crop.

    ``dispersion_radius_m`` and ``slope_tolerance_deg`` are project-wide
    defaults (``pipeline/config/terrain.yaml`` ``pad_statistics``) that are
    unresolved as of this integration. When either is omitted, the
    dispersion slope distribution is reported as explicitly unavailable
    rather than computed from an invented radius or tolerance; the plane-fit
    geometry (slope, aspect, z0), which does not depend on those defaults,
    is still returned.
    """

    if crops.near is None:
        raise PadStatisticsUnavailable(f"{site_id}: near-field DEM is unavailable")
    crop = crops.near
    plane = fit_ground_plane(
        crop.dem,
        latitude_deg=latitude_deg,
        longitude_deg_east=longitude_deg_east,
    )
    if dispersion_radius_m is None or slope_tolerance_deg is None:
        slopes = None
        slopes_unavailable_reason = (
            "dispersion_radius_m and slope_tolerance_deg are unresolved project "
            "defaults (pad_statistics in pipeline/config/terrain.yaml); no value "
            "is invented"
        )
    else:
        slopes = compute_slope_statistics(
            crop.dem,
            latitude_deg=latitude_deg,
            longitude_deg_east=longitude_deg_east,
            radius_m=dispersion_radius_m,
            slope_tolerance_deg=slope_tolerance_deg,
            slope_data_deg=slope_data_deg,
        )
        slopes_unavailable_reason = None
    if footprint_m is not None and (not math.isfinite(footprint_m) or footprint_m <= 0.0):
        raise ValueError("footprint must be a positive finite length when provided")
    resolution = crop.achieved_resolution_m
    return PadStatistics(
        site_id=site_id,
        source_key=crop.source_key,
        source_resolution_m=resolution,
        plane=plane,
        slopes=slopes,
        slopes_unavailable_reason=slopes_unavailable_reason,
        footprint_m=footprint_m,
        under_resolved=None if footprint_m is None else resolution > footprint_m,
    )


def _record(statistics: PadStatistics) -> dict[str, Any]:
    """Serialize to the contract 0.1.0 schema (``contracts/data_terrain_misc.md``
    §1.2), matching the frontend loader (``web/src/engine/data/pad.ts``).

    ``under_resolved`` is nullable here even though the contract types it as
    a plain boolean: it depends on ``nominal_lander_footprint_m``, a
    project-wide default that is explicitly unresolved in
    ``pipeline/config/terrain.yaml`` (``pad_statistics``). No footprint value
    is invented to force a boolean; ``null`` is the honest result until that
    default is set, and is documented as a known deviation in the contract.
    """

    plane = statistics.plane
    d_min_m = 3.0 * statistics.source_resolution_m
    baseline_m = 6.0 * statistics.source_resolution_m
    slopes = statistics.slopes
    if slopes is None:
        dispersion_slope_stats: dict[str, Any] = {
            "available": False,
            "reason": statistics.slopes_unavailable_reason,
        }
    else:
        dispersion_slope_stats = {
            "p50": slopes.p50_deg,
            "p95": slopes.p95_deg,
            "max": slopes.maximum_deg,
            "pct_below_tolerance": slopes.percent_below_tolerance,
            # Additional provenance beyond the contract's required fields.
            "unit": "deg",
            "radius_m": slopes.radius_m,
            "source": slopes.source,
            "slope_tolerance_deg": slopes.slope_tolerance_deg,
            "sample_count": slopes.sample_count,
        }
    return {
        "version": "0.1.0",
        "producer": "lumen_pipeline.terrain.pad",
        "created_utc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "site_id": statistics.site_id,
        "ground_normal_me": list(plane.normal_me),
        "slope_deg": plane.slope_deg,
        "downhill_aspect_deg": plane.downhill_aspect_deg,
        "uphill_az_deg": plane.uphill_azimuth_deg,
        "z0_m": plane.z0_m,
        "d_min_m": d_min_m,
        "near_field_resolution_m": statistics.source_resolution_m,
        "under_resolved": statistics.under_resolved,
        "plane_fit": {
            "k": PLANE_FIT_K,
            "window_px": list(plane.window_px),
            "window_dim_m": list(plane.window_m),
            "baseline_m": baseline_m,
            "dem_source": statistics.source_key,
        },
        "dispersion_slope_stats": dispersion_slope_stats,
    }


def write_pad_statistics(
    statistics: PadStatistics,
    *,
    output_root: Path | None = None,
) -> Path:
    """Write one validated pad JSON record."""

    root = (
        Path(output_root)
        if output_root is not None
        else Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "terrain"
    )
    path = root / "pad" / f"{statistics.site_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(_record(statistics), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return path
