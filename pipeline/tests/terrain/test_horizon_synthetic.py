"""Synthetic S-3 horizon raycaster tests."""

from __future__ import annotations

import math

import numpy as np
import pytest
from pyproj import CRS
from rasterio.transform import from_origin

from lumen_pipeline.common.frames import site_position_km, site_rotation_matrix, site_up_vector
from lumen_pipeline.terrain.dem_io import LUNAR_SPHERICAL_CRS, DemWindow
from lumen_pipeline.terrain.horizon import (
    _bilinear_sample,
    _local_ground_resolution_m,
    _march_distances,
    raycast_horizon,
)

SITE_LAT = -60.0
SITE_LON = 0.0
PIXEL_M = 2.0
ROWS = COLS = 1001


def _synthetic_dem(elevation: np.ndarray, *, pixel_m: float = PIXEL_M) -> DemWindow:
    lat_step = math.degrees(pixel_m / 1_737_400.0)
    lon_step = math.degrees(pixel_m / (1_737_400.0 * math.cos(math.radians(SITE_LAT))))
    transform = from_origin(
        SITE_LON - COLS * lon_step / 2.0,
        SITE_LAT + ROWS * lat_step / 2.0,
        lon_step,
        lat_step,
    )
    return DemWindow(
        elevation=elevation.astype(np.float32),
        valid=np.ones(elevation.shape, dtype=bool),
        transform=transform,
        crs=LUNAR_SPHERICAL_CRS,
        bounds=(0.0, 0.0, 0.0, 0.0),
        resolution_m=(pixel_m, pixel_m),
        source="synthetic",
        provenance={},
    )


def _raycast(
    dem: DemWindow,
    *,
    heights=(0.0, 1.0, 10.0),
    max_range_km=0.2,
    site_elevation_m=0.0,
    near_field_pixel_size_m=PIXEL_M,
):
    return raycast_horizon(
        dem,
        latitude_deg=SITE_LAT,
        longitude_deg_east=SITE_LON,
        observer_heights_m=heights,
        bin_width_deg=45.0,
        max_range_km=max_range_km,
        near_field_pixel_size_m=near_field_pixel_size_m,
        geometric_growth_factor=1.5,
        site_elevation_m=site_elevation_m,
    )


def _flat_angle(distance_m: float, observer_height_m: float) -> float:
    site = site_position_km(SITE_LAT, SITE_LON)
    rotation = site_rotation_matrix(SITE_LAT, SITE_LON)
    # Bin 0.5 degrees is north-east of the site; the radial symmetry of a
    # spherical flat DEM makes its azimuth immaterial here.
    azimuth = math.radians(22.5)
    direction = np.array([math.sin(azimuth), math.cos(azimuth), 0.0])
    tangent = rotation.T @ direction
    up = np.array(
        [
            math.cos(math.radians(SITE_LAT)),
            0.0,
            math.sin(math.radians(SITE_LAT)),
        ]
    )
    arc = distance_m / 1_000.0 / 1_737.4
    terrain = 1_737.4 * (up * math.cos(arc) + tangent * math.sin(arc))
    observer = site + up * (observer_height_m / 1_000.0)
    local = rotation @ (terrain - observer)
    return math.degrees(math.atan2(local[2], math.hypot(local[0], local[1])))


def _pixel_surface_distances(dem: DemWindow) -> np.ndarray:
    rows, cols = dem.elevation.shape
    row_grid, col_grid = np.indices((rows, cols), dtype=np.float64)
    longitudes, latitudes = dem.transform @ (col_grid + 0.5, row_grid + 0.5)
    site = np.array(
        [
            math.cos(math.radians(SITE_LAT)),
            0.0,
            math.sin(math.radians(SITE_LAT)),
        ]
    )
    pixel = np.stack(
        [
            np.cos(np.radians(latitudes)) * np.cos(np.radians(longitudes)),
            np.cos(np.radians(latitudes)) * np.sin(np.radians(longitudes)),
            np.sin(np.radians(latitudes)),
        ],
        axis=-1,
    )
    return 1_737_400.0 * np.arccos(np.clip(pixel @ site, -1.0, 1.0))


def _expected_angle(
    distance_m: float,
    observer_height_m: float,
    terrain_elevation_m: float,
    site_elevation_m: float = 0.0,
) -> float:
    site = site_position_km(
        SITE_LAT,
        SITE_LON,
        surface_elevation_m=site_elevation_m,
    )
    rotation = site_rotation_matrix(SITE_LAT, SITE_LON)
    azimuth = math.radians(22.5)
    direction = np.array([math.sin(azimuth), math.cos(azimuth), 0.0])
    tangent = rotation.T @ direction
    up = np.array(
        [
            math.cos(math.radians(SITE_LAT)),
            0.0,
            math.sin(math.radians(SITE_LAT)),
        ]
    )
    arc = distance_m / 1_000.0 / 1_737.4
    terrain_radius = 1_737.4 + terrain_elevation_m / 1_000.0
    terrain = terrain_radius * (up * math.cos(arc) + tangent * math.sin(arc))
    observer = site + up * (observer_height_m / 1_000.0)
    local = rotation @ (terrain - observer)
    return math.degrees(math.atan2(local[2], math.hypot(local[0], local[1])))


def test_g0_flat_spherical_dem_matches_curvature_and_height_effects():
    result = _raycast(_synthetic_dem(np.zeros((ROWS, COLS), dtype=np.float32)))

    assert result.elevation_deg.shape == (3, 8)
    assert result.distance_km.shape == (3, 8)
    assert result.azimuth_deg[0] == pytest.approx(22.5)
    assert result.azimuth_deg[-1] == pytest.approx(337.5)
    assert np.all(result.distance_km > 0.0)
    assert np.all(result.distance_km >= result.d_min_m / 1000.0)
    max_error = 0.0
    for height_index, height in enumerate((0.0, 1.0, 10.0)):
        for bin_index in range(8):
            expected = _flat_angle(
                result.distance_km[height_index, bin_index] * 1000.0,
                height,
            )
            max_error = max(
                max_error,
                abs(result.elevation_deg[height_index, bin_index] - expected),
            )
    assert max_error < 0.01
    assert np.all(result.elevation_deg[0] > result.elevation_deg[1])
    assert np.all(result.elevation_deg[1] > result.elevation_deg[2])


def test_cone_and_crater_have_expected_horizon_behavior():
    cone_pixel_m = 0.001
    cone_flat = _synthetic_dem(
        np.zeros((ROWS, COLS), dtype=np.float32),
        pixel_m=cone_pixel_m,
    )
    radius_m = _pixel_surface_distances(cone_flat)
    cone = np.tan(math.radians(5.0)) * radius_m
    cone_dem = _synthetic_dem(cone, pixel_m=cone_pixel_m)
    cone_result = _raycast(
        cone_dem,
        heights=(10.0,),
        max_range_km=0.0004,
        near_field_pixel_size_m=0.05,
    )
    expected_distances = _march_distances(
        0.15,
        0.0004,
        0.05,
        1.5,
        cone_pixel_m,
    )
    analytical_angles = [
        _expected_angle(
            distance,
            10.0,
            math.tan(math.radians(5.0)) * distance,
        )
        for distance in expected_distances
    ]
    expected_index = int(np.argmax(analytical_angles))
    expected_distance = expected_distances[expected_index]
    expected_angle = analytical_angles[expected_index]
    cone_errors = []
    for bin_index in range(8):
        cone_errors.append(abs(cone_result.elevation_deg[0, bin_index] - expected_angle))
        assert cone_result.distance_km[0, bin_index] == pytest.approx(
            expected_distance / 1000.0,
            abs=cone_pixel_m / 1000.0,
        )
    assert max(cone_errors) < 0.01

    crater_flat = _synthetic_dem(np.zeros((ROWS, COLS), dtype=np.float32))
    radius_m = _pixel_surface_distances(crater_flat)
    crater = np.zeros((ROWS, COLS), dtype=np.float32)
    crater[radius_m < 20.0] = -100.0
    crater_result = _raycast(
        _synthetic_dem(crater),
        heights=(0.0,),
        max_range_km=0.08,
    )
    crater_distances = _march_distances(6.0, 0.08, PIXEL_M, 1.5, PIXEL_M)
    crater_distance = next(distance for distance in crater_distances if distance > 20.0)
    crater_errors = [
        abs(crater_result.elevation_deg[0, bin_index] - _expected_angle(crater_distance, 0.0, 0.0))
        for bin_index in range(8)
    ]
    assert max(crater_errors) < 0.01
    np.testing.assert_allclose(
        crater_result.distance_km[0],
        crater_distance / 1000.0,
        atol=PIXEL_M / 1000.0,
    )


def test_dem_marching_starts_at_d_min_and_skips_invalid_samples():
    elevation = np.zeros((ROWS, COLS), dtype=np.float32)
    yy, xx = np.indices(elevation.shape)
    radius_m = np.hypot(xx - COLS / 2.0, yy - ROWS / 2.0) * PIXEL_M
    elevation[radius_m < 1.0] = 1000.0
    dem = _synthetic_dem(elevation)
    dem.valid[radius_m >= 1.0] = False

    result = _raycast(dem, heights=(0.0,), max_range_km=0.08)
    assert np.isnan(result.elevation_deg).all()
    assert np.isnan(result.distance_km).all()


def test_march_step_starts_at_half_pixel_and_grows_geometrically():
    distances = _march_distances(6.0, 0.1, 2.0, 2.0, 2.0)
    np.testing.assert_allclose(distances[:4], [6.0, 7.0, 9.0, 11.0])


def test_bilinear_sampling_handles_edges_weights_and_bounds():
    elevation = np.array([[1.0, 2.0], [3.0, 4.0]], dtype=np.float64)
    valid = np.array([[True, False], [False, False]])
    value, sample_valid = _bilinear_sample(elevation, valid, 0.5, 0.5)
    assert sample_valid
    assert value == pytest.approx(1.0)

    value, sample_valid = _bilinear_sample(elevation, valid, 0.5, 1.5)
    assert not sample_valid
    assert value == 0.0

    valid[:, :] = True
    valid[0, 1] = False
    value, sample_valid = _bilinear_sample(elevation, valid, 0.75, 0.5)
    assert not sample_valid
    assert value == 0.0

    value, sample_valid = _bilinear_sample(elevation, valid, 0.49, 0.5)
    assert not sample_valid
    assert value == 0.0


def test_geographic_resolution_cap_uses_local_ground_distance():
    transform = from_origin(-0.005, -59.995, 0.001, 0.001)
    dem = DemWindow(
        elevation=np.zeros((10, 10), dtype=np.float32),
        valid=np.ones((10, 10), dtype=bool),
        transform=transform,
        crs=LUNAR_SPHERICAL_CRS,
        bounds=(0.0, 0.0, 0.0, 0.0),
        resolution_m=(0.001, 0.001),
        source="geographic-resolution",
        provenance={},
    )
    resolution_m = _local_ground_resolution_m(dem, SITE_LAT, SITE_LON)
    expected_longitude_m = 1_737_400.0 * math.cos(math.radians(SITE_LAT)) * math.radians(0.001)
    assert resolution_m == pytest.approx(expected_longitude_m, rel=1e-6)
    assert resolution_m > 1.0
    distances = _march_distances(10.0, 0.1, 1.0, 2.0, resolution_m)
    assert np.all(np.diff(distances) <= resolution_m + 1e-12)


def test_site_elevation_and_observer_height_are_combined():
    site_elevation_m = 100.0
    result = _raycast(
        _synthetic_dem(np.full((ROWS, COLS), site_elevation_m, dtype=np.float32)),
        heights=(10.0,),
        site_elevation_m=site_elevation_m,
    )
    expected = _expected_angle(
        result.distance_km[0, 0] * 1000.0,
        10.0,
        site_elevation_m,
        site_elevation_m,
    )
    assert result.elevation_deg[0, 0] == pytest.approx(expected, abs=0.01)


def test_invalid_inputs_and_projected_native_crs_are_explicit():
    dem = _synthetic_dem(np.zeros((ROWS, COLS), dtype=np.float32))
    with pytest.raises(ValueError, match="growth_factor"):
        raycast_horizon(
            dem,
            latitude_deg=SITE_LAT,
            longitude_deg_east=SITE_LON,
            observer_heights_m=(1.0,),
            bin_width_deg=45.0,
            max_range_km=0.2,
            near_field_pixel_size_m=PIXEL_M,
            geometric_growth_factor=1.0,
            site_elevation_m=0.0,
        )

    projected = CRS.from_proj4("+proj=aeqd +lat_0=-60 +lon_0=0 +R=1737400 +units=m +no_defs")
    projected_dem = DemWindow(
        elevation=np.zeros((1001, 1001), dtype=np.float32),
        valid=np.ones((1001, 1001), dtype=bool),
        transform=from_origin(-1000.0, 1000.0, 2.0, 2.0),
        crs=projected,
        bounds=(-1000.0, -1000.0, 1000.0, 1000.0),
        resolution_m=(2.0, 2.0),
        source="synthetic-projected",
        provenance={},
    )
    result = _raycast(projected_dem)
    assert result.elevation_deg.shape == (3, 8)
    assert np.isfinite(result.elevation_deg).all()


def test_adaptive_peak_refinement_matches_independent_dense_bilinear_reference():
    """A narrow interpolated ridge must not be lost between ray samples."""

    pixel_m = 2.0
    size = 401
    lat_step = math.degrees(pixel_m / 1_737_400.0)
    lon_step = math.degrees(pixel_m / (1_737_400.0 * math.cos(math.radians(SITE_LAT))))
    transform = from_origin(
        SITE_LON - size * lon_step / 2.0,
        SITE_LAT + size * lat_step / 2.0,
        lon_step,
        lat_step,
    )
    row_grid, col_grid = np.indices((size, size), dtype=np.float64)
    longitudes, latitudes = transform @ (col_grid + 0.5, row_grid + 0.5)
    radial_x = 1_737_400.0 * np.radians(longitudes) * math.cos(math.radians(SITE_LAT))
    radial_y = 1_737_400.0 * np.radians(latitudes - SITE_LAT)
    radius = np.hypot(radial_x, radial_y)
    azimuth = np.degrees(np.arctan2(radial_x, radial_y)) % 360.0
    ridge = 500.0 * np.exp(-0.5 * ((radius - 100.0) / 2.0) ** 2)
    ridge *= np.exp(-0.5 * ((((azimuth - 22.5 + 180.0) % 360.0) - 180.0) / 0.15) ** 2)
    dem = DemWindow(
        elevation=ridge.astype(np.float32),
        valid=np.ones(ridge.shape, dtype=bool),
        transform=transform,
        crs=LUNAR_SPHERICAL_CRS,
        bounds=(0.0, 0.0, 0.0, 0.0),
        resolution_m=(pixel_m, pixel_m),
        source="independent-reference-ridge",
        provenance={},
    )

    result = raycast_horizon(
        dem,
        latitude_deg=SITE_LAT,
        longitude_deg_east=SITE_LON,
        observer_heights_m=(1.0,),
        bin_width_deg=45.0,
        max_range_km=0.2,
        near_field_pixel_size_m=pixel_m,
        geometric_growth_factor=1.5,
        site_elevation_m=0.0,
    )

    site = site_position_km(SITE_LAT, SITE_LON)
    rotation = site_rotation_matrix(SITE_LAT, SITE_LON)
    up = site_up_vector(SITE_LAT, SITE_LON)
    tangent = rotation.T @ np.array(
        [math.sin(math.radians(22.5)), math.cos(math.radians(22.5)), 0.0]
    )
    dense_max = -math.inf
    for distance_m in np.arange(6.0, 200.0001, 0.005):
        arc = distance_m / 1_737_400.0
        point = up * math.cos(arc) + tangent * math.sin(arc)
        longitude, latitude = (
            math.degrees(math.atan2(point[1], point[0])),
            math.degrees(math.asin(point[2])),
        )
        column, row = (~transform) @ (longitude, latitude)
        left = math.floor(column - 0.5)
        top = math.floor(row - 0.5)
        fraction_column = column - (left + 0.5)
        fraction_row = row - (top + 0.5)
        elevation = (
            ridge[top, left] * (1.0 - fraction_column) * (1.0 - fraction_row)
            + ridge[top, left + 1] * fraction_column * (1.0 - fraction_row)
            + ridge[top + 1, left] * (1.0 - fraction_column) * fraction_row
            + ridge[top + 1, left + 1] * fraction_column * fraction_row
        )
        terrain = (1_737.4 + elevation / 1000.0) * point
        local = rotation @ (terrain - (site + up * 0.001))
        angle = math.degrees(math.atan2(local[2], math.hypot(local[0], local[1])))
        dense_max = max(dense_max, angle)

    assert abs(float(result.elevation_deg[0, 0]) - dense_max) < 0.01


def test_bin_chunking_is_bit_identical_to_a_single_unchunked_pass(monkeypatch):
    """Production-scale rays (fine near-field resolution, full 250 km range)
    can need on the order of 1e5 distance samples per bin; materializing all
    3600 bins of (bins, samples) float64 geometry arrays at once for that
    case needs tens of GB (see horizon._CHUNK_TARGET_ELEMENTS). Bins carry no
    cross-bin state anywhere in raycast_horizon or _raycast, so batching them
    in chunks must not change a single output value -- only how much is held
    in memory at once."""

    import lumen_pipeline.terrain.horizon as horizon_module

    dem = _synthetic_dem(np.zeros((ROWS, COLS), dtype=np.float32))
    unchunked = _raycast(dem)

    monkeypatch.setattr(horizon_module, "_CHUNK_TARGET_ELEMENTS", 1)
    chunked = _raycast(dem)

    assert chunked.elevation_deg.shape == unchunked.elevation_deg.shape
    np.testing.assert_array_equal(chunked.elevation_deg, unchunked.elevation_deg)
    np.testing.assert_array_equal(chunked.distance_km, unchunked.distance_km)


def test_bin_chunking_handles_a_ragged_final_chunk(monkeypatch):
    """bin_count (3600) is not always a multiple of the chunk size the
    memory budget picks. Force a chunk size (1000 bins) that leaves a
    short last chunk (bins 3000-3599, size 600) and check every chunk
    boundary -- including the very first and very last bins -- lines up
    exactly with the unchunked result, not just the bins away from a
    boundary."""

    import lumen_pipeline.terrain.horizon as horizon_module

    dem = _synthetic_dem(np.zeros((ROWS, COLS), dtype=np.float32))
    kwargs = {
        "latitude_deg": SITE_LAT,
        "longitude_deg_east": SITE_LON,
        "observer_heights_m": (1.0, 2.0, 5.0, 10.0),
        "bin_width_deg": 0.1,
        "max_range_km": 0.08,
        "near_field_pixel_size_m": PIXEL_M,
        "geometric_growth_factor": 1.5,
        "site_elevation_m": 0.0,
    }
    monkeypatch.setattr(horizon_module, "_CHUNK_TARGET_ELEMENTS", 2_000_000)
    unchunked = raycast_horizon(dem, **kwargs)

    # distance_samples.size is 38 for these march parameters, so
    # 1000 * 38 = 38000 yields a 1000-bin chunk: chunks of
    # [0:1000), [1000:2000), [2000:3000), [3000:3600) -- a ragged final
    # chunk of 600 bins, not an exact divisor of 3600.
    monkeypatch.setattr(horizon_module, "_CHUNK_TARGET_ELEMENTS", 38_000)
    chunked = raycast_horizon(dem, **kwargs)

    np.testing.assert_array_equal(chunked.elevation_deg, unchunked.elevation_deg)
    np.testing.assert_array_equal(chunked.distance_km, unchunked.distance_km)
    for boundary_bin in (0, 999, 1000, 2999, 3000, 3599):
        assert np.array_equal(
            chunked.elevation_deg[:, boundary_bin], unchunked.elevation_deg[:, boundary_bin]
        )


def _assert_chunked_matches_unchunked(monkeypatch, dem, **raycast_kwargs) -> None:
    import lumen_pipeline.terrain.horizon as horizon_module

    monkeypatch.setattr(horizon_module, "_CHUNK_TARGET_ELEMENTS", 2_000_000)
    unchunked = raycast_horizon(dem, **raycast_kwargs)

    # Force several chunk boundaries to fall inside the bin range being
    # exercised (1 element per chunk -> as many chunks as there are bins
    # that need more than one sample, i.e. the worst case for chunking).
    monkeypatch.setattr(horizon_module, "_CHUNK_TARGET_ELEMENTS", 1)
    chunked = raycast_horizon(dem, **raycast_kwargs)

    assert chunked.elevation_deg.shape == unchunked.elevation_deg.shape
    np.testing.assert_array_equal(chunked.elevation_deg, unchunked.elevation_deg)
    np.testing.assert_array_equal(chunked.distance_km, unchunked.distance_km)
    return unchunked


def test_bin_chunking_matches_unchunked_with_nodata_negative_terrain_and_full_production_bins(
    monkeypatch,
):
    """Exercises the chunking boundary at the full production azimuth
    resolution (3600 bins, including the wrap-around bins 0 and 3599) over
    terrain that mixes a below-datum crater (negative elevation angles),
    an invalid/nodata annulus (NaN propagation), and four distinct observer
    heights -- the same shape of inputs generate_tier_a_mask uses in
    production."""

    elevation = np.zeros((ROWS, COLS), dtype=np.float32)
    dem = _synthetic_dem(elevation)
    radius_m = _pixel_surface_distances(dem)

    # A below-datum crater near the site: produces negative horizon angles
    # for the near bins, not merely "no feature" (angle == 0).
    elevation[radius_m < 20.0] = -100.0
    # An invalid/nodata annulus further out: any ray whose only in-range
    # terrain sample lands there must come back NaN, never a fabricated
    # finite value or a silently-skipped sample.
    nodata_ring = (radius_m >= 40.0) & (radius_m < 60.0)
    dem.valid[nodata_ring] = False

    unchunked = _assert_chunked_matches_unchunked(
        monkeypatch,
        dem,
        latitude_deg=SITE_LAT,
        longitude_deg_east=SITE_LON,
        observer_heights_m=(1.0, 2.0, 5.0, 10.0),
        bin_width_deg=0.1,
        max_range_km=0.08,
        near_field_pixel_size_m=PIXEL_M,
        geometric_growth_factor=1.5,
        site_elevation_m=0.0,
    )

    assert unchunked.elevation_deg.shape == (4, 3600)
    # The wrap-around boundary bins (azimuth 0.05 deg and 359.95 deg) must
    # have been raycast like every other bin, not dropped or left as a
    # leftover/partial chunk.
    assert np.isfinite(unchunked.elevation_deg[:, 0]).any()
    assert np.isfinite(unchunked.elevation_deg[:, 3599]).any()
    # The crater must produce a negative horizon for at least one height
    # (R3 D-9 requires negative horizons to survive, not be clamped to 0).
    assert np.nanmin(unchunked.elevation_deg) < 0.0


def test_bin_chunking_matches_unchunked_when_every_sample_is_invalid(monkeypatch):
    """All-nodata terrain (e.g. a crop whose only coverage falls outside the
    verified DEM footprint) must raycast to all-NaN under chunking exactly
    as it does unchunked -- chunk boundaries must not fabricate a finite
    value out of missing data."""

    elevation = np.zeros((ROWS, COLS), dtype=np.float32)
    dem = _synthetic_dem(elevation)
    dem.valid[:, :] = False

    unchunked = _assert_chunked_matches_unchunked(
        monkeypatch,
        dem,
        latitude_deg=SITE_LAT,
        longitude_deg_east=SITE_LON,
        observer_heights_m=(1.0, 2.0, 5.0, 10.0),
        bin_width_deg=0.1,
        max_range_km=0.08,
        near_field_pixel_size_m=PIXEL_M,
        geometric_growth_factor=1.5,
        site_elevation_m=0.0,
    )
    assert np.isnan(unchunked.elevation_deg).all()
    assert np.isnan(unchunked.distance_km).all()
