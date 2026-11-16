"""S-6 local plane and pad slope-statistics tests."""

from __future__ import annotations

import json
import math

import numpy as np
import pytest
from pyproj import CRS, Transformer
from rasterio.transform import from_origin

from lumen_pipeline.common.frames import site_rotation_matrix, site_up_vector
from lumen_pipeline.terrain.crops import CropSpec, TerrainCrop, TerrainCrops
from lumen_pipeline.terrain.dem_io import LUNAR_SPHERICAL_CRS, DemWindow
from lumen_pipeline.terrain.pad import (
    compute_slope_statistics,
    fit_ground_plane,
    generate_pad_statistics,
    write_pad_statistics,
)

LATITUDE = -84.7906
LONGITUDE = 29.1957


def _dem(
    *,
    resolution_m: float = 5.0,
    elevation: np.ndarray | None = None,
    valid: np.ndarray | None = None,
) -> DemWindow:
    size = 31
    crs = CRS.from_proj4(
        f"+proj=aeqd +lat_0={LATITUDE} +lon_0={LONGITUDE} +R=1737400 +units=m +no_defs"
    )
    transformer = Transformer.from_crs(LUNAR_SPHERICAL_CRS, crs, always_xy=True)
    site_x, site_y = transformer.transform(LONGITUDE, LATITUDE)
    if elevation is None:
        elevation = np.zeros((size, size), dtype=np.float64)
    if valid is None:
        valid = np.ones((size, size), dtype=bool)
    return DemWindow(
        elevation=elevation.astype(np.float32),
        valid=valid,
        transform=from_origin(
            site_x - size * resolution_m / 2.0,
            site_y + size * resolution_m / 2.0,
            resolution_m,
            resolution_m,
        ),
        crs=crs,
        bounds=(
            site_x - size * resolution_m / 2.0,
            site_y - size * resolution_m / 2.0,
            site_x + size * resolution_m / 2.0,
            site_y + size * resolution_m / 2.0,
        ),
        resolution_m=(resolution_m, resolution_m),
        source="synthetic-test-dem",
        provenance={"synthetic_test_data": True},
    )


def _plane_dem(
    *,
    slope_deg: float,
    uphill_azimuth_deg: float,
    resolution_m: float = 5.0,
    z0_m: float = 123.4,
) -> DemWindow:
    size = 31
    flat = _dem(resolution_m=resolution_m)
    row_grid, col_grid = np.indices((size, size), dtype=float)
    transformer = Transformer.from_crs(flat.crs, LUNAR_SPHERICAL_CRS, always_xy=True)
    x_projected, y_projected = flat.transform @ (col_grid + 0.5, row_grid + 0.5)
    longitudes, latitudes = transformer.transform(x_projected, y_projected)
    points = np.stack(
        (
            np.cos(np.radians(latitudes)) * np.cos(np.radians(longitudes)),
            np.cos(np.radians(latitudes)) * np.sin(np.radians(longitudes)),
            np.sin(np.radians(latitudes)),
        ),
        axis=-1,
    )
    site_position = site_up_vector(LATITUDE, LONGITUDE)
    local = 1_737_400.0 * (points - site_position) @ site_rotation_matrix(LATITUDE, LONGITUDE).T
    x = local[..., 0]
    y = local[..., 1]
    gradient = math.tan(math.radians(slope_deg))
    uphill = math.radians(uphill_azimuth_deg)
    elevation = z0_m + gradient * (math.sin(uphill) * x + math.cos(uphill) * y)
    return _dem(resolution_m=resolution_m, elevation=elevation, valid=flat.valid)


def _crops(dem: DemWindow) -> TerrainCrops:
    crop = TerrainCrop(
        spec=CropSpec("near", 0.0, 5.0, ("synthetic_test_dem",), 5.0),
        dem=dem,
        source_key="synthetic_test_dem",
        source_resolution_m=min(dem.resolution_m),
        source_url="synthetic://test-dem",
    )
    return TerrainCrops(
        site_id="im2_athena",
        latitude_deg=LATITUDE,
        longitude_deg_east=LONGITUDE,
        near=crop,
        mid=None,
        far=None,
        unavailable={},
    )


def test_flat_plane_has_zero_slope_and_expected_fit_window():
    fit = fit_ground_plane(
        _plane_dem(slope_deg=0.0, uphill_azimuth_deg=0.0),
        latitude_deg=LATITUDE,
        longitude_deg_east=LONGITUDE,
    )

    assert fit.slope_deg < 1e-6
    assert fit.z0_m == pytest.approx(123.4, abs=1e-4)
    assert fit.window_px == (7, 7)
    assert fit.window_m == (35.0, 35.0)
    assert fit.normal_local == pytest.approx((0.0, 0.0, 1.0), abs=1e-6)


def test_tilted_plane_recovers_slope_and_aspects():
    fit = fit_ground_plane(
        _plane_dem(slope_deg=10.0, uphill_azimuth_deg=45.0),
        latitude_deg=LATITUDE,
        longitude_deg_east=LONGITUDE,
    )

    assert fit.slope_deg == pytest.approx(10.0, abs=0.01)
    assert fit.uphill_azimuth_deg == pytest.approx(45.0, abs=0.01)
    assert fit.downhill_aspect_deg == pytest.approx(225.0, abs=0.01)
    assert np.linalg.norm(fit.normal_local) == pytest.approx(1.0)
    assert np.linalg.norm(fit.normal_me) == pytest.approx(1.0)
    # normal_me is normal_local expressed in MOON_ME; rotating it back must
    # exactly recover normal_local (same basis change used in fit_ground_plane).
    rotation = site_rotation_matrix(LATITUDE, LONGITUDE)
    assert rotation @ np.asarray(fit.normal_me) == pytest.approx(fit.normal_local, abs=1e-9)


def test_twenty_metre_fit_records_140_metre_window():
    fit = fit_ground_plane(
        _plane_dem(slope_deg=2.0, uphill_azimuth_deg=90.0, resolution_m=20.0),
        latitude_deg=LATITUDE,
        longitude_deg_east=LONGITUDE,
    )

    assert fit.window_px == (7, 7)
    assert fit.window_m == (140.0, 140.0)


def test_slope_statistics_use_finite_samples_and_configured_tolerance():
    dem = _dem()
    slope_data = np.full(dem.elevation.shape, 4.0, dtype=float)
    slope_data[15, 15] = np.nan
    slope_data[14, 14] = 2.0
    stats = compute_slope_statistics(
        dem,
        latitude_deg=LATITUDE,
        longitude_deg_east=LONGITUDE,
        radius_m=200.0,
        slope_tolerance_deg=5.0,
        slope_data_deg=slope_data,
    )

    assert stats.source == "provided_slope_deg"
    assert stats.sample_count == slope_data.size - 1
    assert stats.p50_deg == pytest.approx(4.0)
    assert stats.p95_deg == pytest.approx(4.0)
    assert stats.maximum_deg == pytest.approx(4.0)
    assert stats.percent_below_tolerance == pytest.approx(100.0)


def test_dem_slope_statistics_handle_nodata():
    dem = _dem()
    dem.valid[15, 15] = False
    stats = compute_slope_statistics(
        dem,
        latitude_deg=LATITUDE,
        longitude_deg_east=LONGITUDE,
        radius_m=50.0,
        slope_tolerance_deg=1.0,
    )

    assert stats.source == "dem_gradient"
    assert stats.sample_count > 0
    assert stats.maximum_deg == pytest.approx(0.0)


def test_pad_json_records_statistics_baseline_and_under_resolution(tmp_path):
    statistics = generate_pad_statistics(
        "im2_athena",
        _crops(_plane_dem(slope_deg=5.0, uphill_azimuth_deg=90.0)),
        latitude_deg=LATITUDE,
        longitude_deg_east=LONGITUDE,
        dispersion_radius_m=50.0,
        slope_tolerance_deg=10.0,
        footprint_m=4.0,
        slope_data_deg=np.full((31, 31), 5.0),
    )
    path = write_pad_statistics(statistics, output_root=tmp_path / "terrain")
    record = json.loads(path.read_text(encoding="utf-8"))

    # Contract 0.1.0 (contracts/data_terrain_misc.md §1.2 / web/src/engine/data/pad.ts).
    assert record["version"] == "0.1.0"
    assert record["producer"] == "lumen_pipeline.terrain.pad"
    assert record["d_min_m"] == pytest.approx(15.0)
    assert record["plane_fit"]["window_px"] == [7, 7]
    assert record["plane_fit"]["window_dim_m"] == [35.0, 35.0]
    assert record["plane_fit"]["baseline_m"] == pytest.approx(30.0)
    assert record["plane_fit"]["dem_source"] == "synthetic_test_dem"
    assert record["dispersion_slope_stats"]["unit"] == "deg"
    assert record["dispersion_slope_stats"]["max"] == 5.0
    assert record["under_resolved"] is True
    normal = record["ground_normal_me"]
    assert len(normal) == 3
    assert math.hypot(*normal) == pytest.approx(1.0, abs=1e-6)
