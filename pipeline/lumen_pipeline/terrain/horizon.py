"""Numba-accelerated terrain horizon raycasting."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from numba import njit, prange
from pyproj import Transformer
from rasterio.transform import Affine

from ..common.constants import LUNAR_RADIUS_KM
from ..common.frames import site_position_km, site_rotation_matrix, site_up_vector
from .dem_io import LUNAR_SPHERICAL_CRS, DemWindow

# Upper bound on (bins_in_chunk * distance_samples) kept live at once across
# the half-dozen float64 (bins, samples[, 3]) arrays built per azimuth chunk
# in raycast_horizon. At a fine near-field resolution (e.g. 10 m), max_step_m
# in _march_distances stays near its 0.25x-resolution cap for the whole
# 250 km march, so distance_samples.size can reach ~1e5; an unchunked,
# all-3600-bins computation then needs tens of GB. Chunking bins bounds peak
# memory to a roughly constant, size-independent budget instead.
_CHUNK_TARGET_ELEMENTS = 2_000_000


@dataclass(frozen=True)
class HorizonResult:
    """Horizon elevations and producing distances indexed by height and bin."""

    elevation_deg: np.ndarray
    distance_km: np.ndarray
    azimuth_deg: np.ndarray
    observer_heights_m: tuple[float, ...]
    bin_width_deg: float
    d_min_m: float
    max_range_km: float


def _validate_inputs(
    observer_heights_m: tuple[float, ...],
    bin_width_deg: float,
    max_range_km: float,
    near_field_pixel_size_m: float,
    geometric_growth_factor: float,
) -> int:
    if not observer_heights_m:
        raise ValueError("observer_heights_m must not be empty")
    if not all(math.isfinite(height) and height >= 0.0 for height in observer_heights_m):
        raise ValueError("observer heights must be finite and non-negative")
    if not math.isfinite(bin_width_deg) or bin_width_deg <= 0.0:
        raise ValueError("bin_width_deg must be finite and positive")
    bin_count = round(360.0 / bin_width_deg)
    if not math.isclose(bin_count * bin_width_deg, 360.0, rel_tol=0.0, abs_tol=1e-10):
        raise ValueError("bin_width_deg must divide one complete 360 degree revolution")
    if not math.isfinite(max_range_km) or max_range_km <= 0.0:
        raise ValueError("max_range_km must be finite and positive")
    if not math.isfinite(near_field_pixel_size_m) or near_field_pixel_size_m <= 0.0:
        raise ValueError("near_field_pixel_size_m must be finite and positive")
    if not math.isfinite(geometric_growth_factor) or geometric_growth_factor <= 1.0:
        raise ValueError(
            "geometric_growth_factor is required and must be finite and greater than one"
        )
    return bin_count


def _march_distances(
    d_min_m: float,
    max_range_km: float,
    near_field_pixel_size_m: float,
    geometric_growth_factor: float,
    max_step_m: float,
) -> np.ndarray:
    """Return ray samples with geometric steps capped at DEM sampling spacing."""

    distances: list[float] = []
    distance_m = d_min_m
    step_m = 0.5 * near_field_pixel_size_m
    while distance_m <= max_range_km * 1000.0:
        distances.append(distance_m)
        distance_m += min(step_m, max_step_m)
        step_m = min(step_m * geometric_growth_factor, max_step_m)
    return np.asarray(distances, dtype=np.float64)


def _surface_distance_m(
    latitude_a_deg: float,
    longitude_a_deg: float,
    latitude_b_deg: float,
    longitude_b_deg: float,
) -> float:
    latitude_a = math.radians(latitude_a_deg)
    latitude_b = math.radians(latitude_b_deg)
    delta_lat = latitude_b - latitude_a
    delta_lon = math.radians(longitude_b_deg - longitude_a_deg)
    haversine = (
        math.sin(delta_lat / 2.0) ** 2
        + math.cos(latitude_a) * math.cos(latitude_b) * math.sin(delta_lon / 2.0) ** 2
    )
    return 2.0 * 1_737_400.0 * math.asin(math.sqrt(min(1.0, haversine)))


def _local_ground_resolution_m(
    dem: DemWindow,
    latitude_deg: float,
    longitude_deg_east: float,
) -> float:
    """Return the smaller local ground spacing of the DEM pixel axes."""

    source_from_lunar = Transformer.from_crs(LUNAR_SPHERICAL_CRS, dem.crs, always_xy=True)
    lunar_from_source = Transformer.from_crs(dem.crs, LUNAR_SPHERICAL_CRS, always_xy=True)
    source_x, source_y = source_from_lunar.transform(longitude_deg_east, latitude_deg)
    inverse = ~dem.transform
    col, row = inverse @ (source_x, source_y)
    centre_x, centre_y = dem.transform @ (col, row)
    x_pixel = dem.transform @ (col + 1.0, row)
    y_pixel = dem.transform @ (col, row + 1.0)
    centre_lon, centre_lat = lunar_from_source.transform(centre_x, centre_y)
    x_lon, x_lat = lunar_from_source.transform(*x_pixel)
    y_lon, y_lat = lunar_from_source.transform(*y_pixel)
    resolutions = (
        _surface_distance_m(centre_lat, centre_lon, x_lat, x_lon),
        _surface_distance_m(centre_lat, centre_lon, y_lat, y_lon),
    )
    if not all(math.isfinite(value) and value > 0.0 for value in resolutions):
        raise ValueError("DEM local ground resolution must be finite and positive")
    return min(resolutions)


def _affine_inverse(transform: Affine) -> tuple[float, float, float, float, float, float]:
    inverse = ~transform
    return (
        inverse.a,
        inverse.b,
        inverse.c,
        inverse.d,
        inverse.e,
        inverse.f,
    )


@njit
def _bilinear_sample(
    elevation: np.ndarray,
    valid: np.ndarray,
    col: float,
    row: float,
) -> tuple[float, bool]:
    height, width = elevation.shape
    if col < 0.5 or col > width - 0.5 or row < 0.5 or row > height - 0.5:
        return 0.0, False
    left = math.floor(col - 0.5)
    top = math.floor(row - 0.5)
    fraction_col = col - (left + 0.5)
    fraction_row = row - (top + 0.5)
    right = min(left + 1, width - 1)
    bottom = min(top + 1, height - 1)
    weights = (
        (1.0 - fraction_col) * (1.0 - fraction_row),
        fraction_col * (1.0 - fraction_row),
        (1.0 - fraction_col) * fraction_row,
        fraction_col * fraction_row,
    )
    cells = ((top, left), (top, right), (bottom, left), (bottom, right))
    for index in range(4):
        if weights[index] > 0.0 and not valid[cells[index][0], cells[index][1]]:
            return 0.0, False
    top_value = elevation[top, left] * (1.0 - fraction_col) + elevation[top, right] * fraction_col
    bottom_value = (
        elevation[bottom, left] * (1.0 - fraction_col) + elevation[bottom, right] * fraction_col
    )
    return top_value * (1.0 - fraction_row) + bottom_value * fraction_row, True


@njit
def _sample_angle(
    elevation: np.ndarray,
    valid: np.ndarray,
    inverse_affine: np.ndarray,
    x: float,
    y: float,
    latitude: float,
    longitude: float,
    site_position: np.ndarray,
    site_up: np.ndarray,
    site_rotation: np.ndarray,
    observer_height_m: float,
    sphere_radius_km: float,
) -> tuple[float, bool]:
    col = inverse_affine[0] * x + inverse_affine[1] * y + inverse_affine[2]
    row = inverse_affine[3] * x + inverse_affine[4] * y + inverse_affine[5]
    terrain_elevation, sample_valid = _bilinear_sample(elevation, valid, col, row)
    if not sample_valid:
        return 0.0, False
    terrain_radius = sphere_radius_km + terrain_elevation / 1000.0
    terrain = np.empty(3, dtype=np.float64)
    terrain[0] = terrain_radius * math.cos(latitude) * math.cos(longitude)
    terrain[1] = terrain_radius * math.cos(latitude) * math.sin(longitude)
    terrain[2] = terrain_radius * math.sin(latitude)
    observer = site_position.copy()
    observer[0] += site_up[0] * (observer_height_m / 1000.0)
    observer[1] += site_up[1] * (observer_height_m / 1000.0)
    observer[2] += site_up[2] * (observer_height_m / 1000.0)
    delta = terrain - observer
    east_component = (
        site_rotation[0, 0] * delta[0]
        + site_rotation[0, 1] * delta[1]
        + site_rotation[0, 2] * delta[2]
    )
    north_component = (
        site_rotation[1, 0] * delta[0]
        + site_rotation[1, 1] * delta[1]
        + site_rotation[1, 2] * delta[2]
    )
    up_component = (
        site_rotation[2, 0] * delta[0]
        + site_rotation[2, 1] * delta[1]
        + site_rotation[2, 2] * delta[2]
    )
    return (
        math.degrees(
            math.atan2(
                up_component,
                math.sqrt(east_component * east_component + north_component * north_component),
            )
        ),
        True,
    )


@njit(cache=True, parallel=True)
def _raycast(
    elevation: np.ndarray,
    valid: np.ndarray,
    inverse_affine: np.ndarray,
    sample_x: np.ndarray,
    sample_y: np.ndarray,
    sample_lat: np.ndarray,
    sample_lon: np.ndarray,
    sample_distance_m: np.ndarray,
    site_position: np.ndarray,
    site_up: np.ndarray,
    site_rotation: np.ndarray,
    observer_heights_m: np.ndarray,
    sphere_radius_km: float,
) -> tuple[np.ndarray, np.ndarray]:
    heights = observer_heights_m.shape[0]
    bins = sample_x.shape[0]
    horizon = np.full((heights, bins), np.nan, dtype=np.float32)
    distance = np.full((heights, bins), np.nan, dtype=np.float32)
    best_index = np.full((heights, bins), -1, dtype=np.int64)

    for bin_index in prange(bins):
        for sample_index in range(sample_x.shape[1]):
            x = sample_x[bin_index, sample_index]
            y = sample_y[bin_index, sample_index]
            latitude = sample_lat[bin_index, sample_index]
            longitude = sample_lon[bin_index, sample_index]
            col = inverse_affine[0] * x + inverse_affine[1] * y + inverse_affine[2]
            row = inverse_affine[3] * x + inverse_affine[4] * y + inverse_affine[5]
            terrain_elevation, sample_valid = _bilinear_sample(elevation, valid, col, row)
            if sample_valid:
                terrain_radius = sphere_radius_km + terrain_elevation / 1000.0
                terrain = np.empty(3, dtype=np.float64)
                terrain[0] = terrain_radius * math.cos(latitude) * math.cos(longitude)
                terrain[1] = terrain_radius * math.cos(latitude) * math.sin(longitude)
                terrain[2] = terrain_radius * math.sin(latitude)
                for height_index in range(heights):
                    observer = site_position.copy()
                    observer[0] += site_up[0] * (observer_heights_m[height_index] / 1000.0)
                    observer[1] += site_up[1] * (observer_heights_m[height_index] / 1000.0)
                    observer[2] += site_up[2] * (observer_heights_m[height_index] / 1000.0)
                    del_x = terrain[0] - observer[0]
                    del_y = terrain[1] - observer[1]
                    del_z = terrain[2] - observer[2]
                    east_component = (
                        site_rotation[0, 0] * del_x
                        + site_rotation[0, 1] * del_y
                        + site_rotation[0, 2] * del_z
                    )
                    north_component = (
                        site_rotation[1, 0] * del_x
                        + site_rotation[1, 1] * del_y
                        + site_rotation[1, 2] * del_z
                    )
                    up_component = (
                        site_rotation[2, 0] * del_x
                        + site_rotation[2, 1] * del_y
                        + site_rotation[2, 2] * del_z
                    )
                    angle = math.degrees(
                        math.atan2(
                            up_component,
                            math.sqrt(
                                east_component * east_component + north_component * north_component
                            ),
                        )
                    )
                    if (
                        math.isnan(horizon[height_index, bin_index])
                        or angle > horizon[height_index, bin_index]
                    ):
                        horizon[height_index, bin_index] = angle
                        best_index[height_index, bin_index] = sample_index
                        distance[height_index, bin_index] = (
                            sample_distance_m[bin_index, sample_index] / 1000.0
                        )

    for bin_index in prange(bins):
        for height_index in range(heights):
            index = best_index[height_index, bin_index]
            if index < 0:
                continue
            left = max(0, index - 1)
            right = min(sample_x.shape[1] - 1, index + 1)
            if left == right:
                continue
            left_fraction = 0.0
            right_fraction = 1.0
            left_angle = horizon[height_index, bin_index]
            right_angle = left_angle
            for _ in range(8):
                first_fraction = left_fraction + (right_fraction - left_fraction) / 3.0
                second_fraction = right_fraction - (right_fraction - left_fraction) / 3.0
                first_x = (
                    sample_x[bin_index, left]
                    + (sample_x[bin_index, right] - sample_x[bin_index, left]) * first_fraction
                )
                first_y = (
                    sample_y[bin_index, left]
                    + (sample_y[bin_index, right] - sample_y[bin_index, left]) * first_fraction
                )
                first_lat = (
                    sample_lat[bin_index, left]
                    + (sample_lat[bin_index, right] - sample_lat[bin_index, left]) * first_fraction
                )
                first_lon = (
                    sample_lon[bin_index, left]
                    + (sample_lon[bin_index, right] - sample_lon[bin_index, left]) * first_fraction
                )
                first_angle, first_valid = _sample_angle(
                    elevation,
                    valid,
                    inverse_affine,
                    first_x,
                    first_y,
                    first_lat,
                    first_lon,
                    site_position,
                    site_up,
                    site_rotation,
                    observer_heights_m[height_index],
                    sphere_radius_km,
                )
                second_x = (
                    sample_x[bin_index, left]
                    + (sample_x[bin_index, right] - sample_x[bin_index, left]) * second_fraction
                )
                second_y = (
                    sample_y[bin_index, left]
                    + (sample_y[bin_index, right] - sample_y[bin_index, left]) * second_fraction
                )
                second_lat = (
                    sample_lat[bin_index, left]
                    + (sample_lat[bin_index, right] - sample_lat[bin_index, left]) * second_fraction
                )
                second_lon = (
                    sample_lon[bin_index, left]
                    + (sample_lon[bin_index, right] - sample_lon[bin_index, left]) * second_fraction
                )
                second_angle, second_valid = _sample_angle(
                    elevation,
                    valid,
                    inverse_affine,
                    second_x,
                    second_y,
                    second_lat,
                    second_lon,
                    site_position,
                    site_up,
                    site_rotation,
                    observer_heights_m[height_index],
                    sphere_radius_km,
                )
                if not first_valid or not second_valid:
                    break
                if first_angle < second_angle:
                    left_fraction = first_fraction
                    left_angle = second_angle
                else:
                    right_fraction = second_fraction
                    right_angle = first_angle
            if left_angle > horizon[height_index, bin_index]:
                horizon[height_index, bin_index] = left_angle
                distance[height_index, bin_index] = (
                    sample_distance_m[bin_index, left]
                    + (sample_distance_m[bin_index, right] - sample_distance_m[bin_index, left])
                    * left_fraction
                ) / 1000.0
            if right_angle > horizon[height_index, bin_index]:
                horizon[height_index, bin_index] = right_angle
                distance[height_index, bin_index] = (
                    sample_distance_m[bin_index, left]
                    + (sample_distance_m[bin_index, right] - sample_distance_m[bin_index, left])
                    * right_fraction
                ) / 1000.0
    return horizon, distance


def raycast_horizon(
    dem: DemWindow,
    *,
    latitude_deg: float,
    longitude_deg_east: float,
    observer_heights_m: tuple[float, ...],
    bin_width_deg: float,
    max_range_km: float,
    near_field_pixel_size_m: float,
    geometric_growth_factor: float,
    site_elevation_m: float,
) -> HorizonResult:
    """Raycast DEM terrain into site-frame horizon bins.

    ``geometric_growth_factor`` is required because the terrain configuration
    intentionally leaves it unresolved. The DEM may use the lunar spherical
    CRS or its native projected CRS; crop construction and multi-resolution
    selection are outside S-3. Each ray starts at ``d_min`` and grows
    geometrically, but no step exceeds one quarter of the smallest local DEM
    ground spacing. This sub-cell cap prevents a narrow bilinear feature from
    being skipped between successive samples.
    """

    bin_count = _validate_inputs(
        observer_heights_m,
        bin_width_deg,
        max_range_km,
        near_field_pixel_size_m,
        geometric_growth_factor,
    )
    if dem.elevation.ndim != 2 or dem.valid.shape != dem.elevation.shape:
        raise ValueError("DEM elevation and validity arrays must be matching 2-D arrays")
    if dem.crs is None:
        raise ValueError("DEM CRS is required for horizon raycasting")
    if not (
        math.isfinite(latitude_deg)
        and math.isfinite(longitude_deg_east)
        and -90.0 <= latitude_deg <= 90.0
    ):
        raise ValueError("site latitude and longitude must be finite")
    if not math.isfinite(site_elevation_m):
        raise ValueError("site_elevation_m must be finite")
    max_step_m = 0.25 * _local_ground_resolution_m(dem, latitude_deg, longitude_deg_east)

    transformer = Transformer.from_crs(LUNAR_SPHERICAL_CRS, dem.crs, always_xy=True)
    d_min_m = 3.0 * near_field_pixel_size_m
    distance_samples = _march_distances(
        d_min_m,
        max_range_km,
        near_field_pixel_size_m,
        geometric_growth_factor,
        max_step_m,
    )
    if not distance_samples.size:
        raise ValueError("d_min_m must be below max_range_km")

    rotation = site_rotation_matrix(latitude_deg, longitude_deg_east)
    site_up = site_up_vector(latitude_deg, longitude_deg_east)
    site_position = site_position_km(
        latitude_deg,
        longitude_deg_east,
        surface_elevation_m=site_elevation_m,
    )
    inverse = np.asarray(_affine_inverse(dem.transform), dtype=np.float64)
    elevation = np.ascontiguousarray(dem.elevation, dtype=np.float64)
    valid = np.ascontiguousarray(dem.valid, dtype=np.bool_)
    heights = np.asarray(observer_heights_m, dtype=np.float64)

    # Each azimuth bin's ray geometry and horizon search is independent of
    # every other bin (no accumulation or lookup crosses bin boundaries
    # anywhere above or inside ``_raycast``), so bins are processed in
    # chunks to bound peak memory instead of materializing one
    # ``(bin_count, distance_samples.size)`` set of arrays at once. This
    # changes only how much work is batched per call, not the arithmetic:
    # results are bit-for-bit identical to the unchunked computation.
    chunk_bins = max(1, min(bin_count, _CHUNK_TARGET_ELEMENTS // max(1, distance_samples.size)))
    elevations = np.empty((heights.shape[0], bin_count), dtype=np.float32)
    distances = np.empty((heights.shape[0], bin_count), dtype=np.float32)
    for start in range(0, bin_count, chunk_bins):
        end = min(start + chunk_bins, bin_count)
        bin_indices = np.arange(start, end, dtype=np.float64)
        azimuth_rad = np.radians((bin_indices + 0.5) * bin_width_deg)
        east = np.sin(azimuth_rad)
        north = np.cos(azimuth_rad)
        tangent = np.outer(east, rotation[0]) + np.outer(north, rotation[1])
        distance_grid = np.broadcast_to(
            distance_samples, (end - start, distance_samples.size)
        ).copy()
        arc = distance_grid / 1000.0 / LUNAR_RADIUS_KM
        site_up_grid = site_up[None, None, :]
        points = (
            site_up_grid * np.cos(arc)[:, :, None] + tangent[:, None, :] * np.sin(arc)[:, :, None]
        )
        latitudes = np.arcsin(points[:, :, 2])
        longitudes = np.arctan2(points[:, :, 1], points[:, :, 0])
        source_x, source_y = transformer.transform(np.degrees(longitudes), np.degrees(latitudes))
        if not np.isfinite(source_x).all() or not np.isfinite(source_y).all():
            raise ValueError("DEM CRS transformation produced non-finite coordinates")

        chunk_elevations, chunk_distances = _raycast(
            elevation,
            valid,
            inverse,
            np.ascontiguousarray(source_x, dtype=np.float64),
            np.ascontiguousarray(source_y, dtype=np.float64),
            np.ascontiguousarray(latitudes, dtype=np.float64),
            np.ascontiguousarray(longitudes, dtype=np.float64),
            np.ascontiguousarray(distance_grid, dtype=np.float64),
            np.asarray(site_position, dtype=np.float64),
            np.asarray(site_up, dtype=np.float64),
            np.asarray(rotation, dtype=np.float64),
            heights,
            LUNAR_RADIUS_KM,
        )
        elevations[:, start:end] = chunk_elevations
        distances[:, start:end] = chunk_distances
    return HorizonResult(
        elevation_deg=elevations,
        distance_km=distances,
        azimuth_deg=(np.arange(bin_count, dtype=np.float64) + 0.5) * bin_width_deg,
        observer_heights_m=tuple(observer_heights_m),
        bin_width_deg=bin_width_deg,
        d_min_m=3.0 * near_field_pixel_size_m,
        max_range_km=max_range_km,
    )
