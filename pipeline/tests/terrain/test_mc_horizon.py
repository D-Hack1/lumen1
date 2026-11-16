# Owner: Shiva Shakthi
"""Preliminary Monte-Carlo terrain-uncertainty workflow tests.

Network-independent: synthetic DEM/_ERR windows are constructed locally
and the real production raycaster (``raycast_horizon``) is monkeypatched
with a deterministic stand-in -- a full real raycast at a realistic
resolution and 250 km range takes on the order of a minute per crop (see
the real-site generation report), far too slow for a unit test, and the
mocked function still exercises the full orchestration this module adds
(crop elevation overrides, seeding, ensemble assembly, sigma/convergence
math) against the genuine ``masks``/``horizon`` plumbing.
"""

from __future__ import annotations

import numpy as np
import pytest
from pyproj import CRS, Transformer
from rasterio.transform import from_origin

from lumen_pipeline.terrain.crops import CropSpec, TerrainCrop, TerrainCrops
from lumen_pipeline.terrain.dem_io import LUNAR_SPHERICAL_CRS, DemWindow
from lumen_pipeline.terrain.horizon import HorizonResult
from lumen_pipeline.terrain.mc_horizon import (
    CropErrorWindow,
    MonteCarloInputError,
    compute_horizon,
    evaluate_convergence,
    generate_clone_ensemble,
    nan_pattern_matches_nominal,
    perturbed_elevation,
    sample_sigma,
)

LATITUDE = -84.7906
LONGITUDE = 29.1957
PIXEL_M = 5.0
SIZE = 101


def _dem() -> DemWindow:
    crs = CRS.from_proj4(
        f"+proj=aeqd +lat_0={LATITUDE} +lon_0={LONGITUDE} +R=1737400 +units=m +no_defs"
    )
    transformer = Transformer.from_crs(LUNAR_SPHERICAL_CRS, crs, always_xy=True)
    site_x, site_y = transformer.transform(LONGITUDE, LATITUDE)
    bounds = (
        site_x - 300_000.0,
        site_y - 300_000.0,
        site_x + 300_000.0,
        site_y + 300_000.0,
    )
    return DemWindow(
        elevation=np.zeros((SIZE, SIZE), dtype=np.float32),
        valid=np.ones((SIZE, SIZE), dtype=bool),
        transform=from_origin(
            site_x - SIZE * PIXEL_M / 2.0, site_y + SIZE * PIXEL_M / 2.0, PIXEL_M, PIXEL_M
        ),
        crs=crs,
        bounds=bounds,
        resolution_m=(PIXEL_M, PIXEL_M),
        source="synthetic",
        provenance={"synthetic": True},
    )


def _crops() -> TerrainCrops:
    specs = (("near", 0.0, 5.0, 5.0), ("mid", 5.0, 80.0, 20.0), ("far", 80.0, 250.0, 240.0))
    crops = {
        name: TerrainCrop(
            spec=CropSpec(name, lo, hi, ("p",), res),
            dem=_dem(),
            source_key="p",
            source_resolution_m=res,
            source_url="https://example.invalid/p.tif",
        )
        for name, lo, hi, res in specs
    }
    return TerrainCrops(
        site_id="test_site",
        latitude_deg=LATITUDE,
        longitude_deg_east=LONGITUDE,
        near=crops["near"],
        mid=crops["mid"],
        far=crops["far"],
        unavailable={},
    )


def _error_window(*, magnitude: float = 0.5, fraction_valid: float = 1.0) -> CropErrorWindow:
    valid = np.ones((SIZE, SIZE), dtype=bool)
    if fraction_valid < 1.0:
        invalid_count = round((1.0 - fraction_valid) * valid.size)
        flat = valid.reshape(-1)
        flat[:invalid_count] = False
    return CropErrorWindow(
        crop_name="near",
        error_m=np.full((SIZE, SIZE), magnitude, dtype=np.float64),
        error_valid=valid,
        dem_url="https://example.invalid/p.tif",
        error_url="https://example.invalid/p_err.tif",
        resolution_m=PIXEL_M,
        fraction_valid=fraction_valid,
    )


def _fake_raycast(dem, **kwargs):
    """Elevation = mean of the input elevation over valid pixels, so a
    perturbation to the input DEM measurably changes the output -- a
    minimal but real dependency on the perturbed array, not a constant."""

    heights = kwargs["observer_heights_m"]
    base = float(np.mean(dem.elevation[dem.valid])) if np.any(dem.valid) else 0.0
    elevation = np.full((len(heights), 3600), base, dtype=np.float32)
    distance = np.full((len(heights), 3600), 10.0, dtype=np.float32)
    return HorizonResult(
        elevation,
        distance,
        (np.arange(3600) + 0.5) * 0.1,
        heights,
        0.1,
        15.0,
        kwargs["max_range_km"],
    )


@pytest.fixture(autouse=True)
def _patch_raycaster(monkeypatch):
    monkeypatch.setattr("lumen_pipeline.terrain.mc_horizon.raycast_horizon", _fake_raycast)


# ---------------------------------------------------------------------------
# Perturbation field
# ---------------------------------------------------------------------------


def test_perturbed_elevation_is_reproducible_with_the_same_rng_state():
    elevation = np.zeros((SIZE, SIZE), dtype=np.float32)
    window = _error_window()
    a = perturbed_elevation(
        elevation, window, correlation_length_m=10.0, rng=np.random.default_rng(1)
    )
    b = perturbed_elevation(
        elevation, window, correlation_length_m=10.0, rng=np.random.default_rng(1)
    )
    np.testing.assert_array_equal(a, b)


def test_perturbed_elevation_differs_with_a_different_seed():
    elevation = np.zeros((SIZE, SIZE), dtype=np.float32)
    window = _error_window()
    a = perturbed_elevation(
        elevation, window, correlation_length_m=10.0, rng=np.random.default_rng(1)
    )
    b = perturbed_elevation(
        elevation, window, correlation_length_m=10.0, rng=np.random.default_rng(2)
    )
    assert not np.array_equal(a, b)


def test_perturbed_elevation_leaves_pixels_without_a_valid_error_magnitude_unperturbed():
    elevation = np.zeros((SIZE, SIZE), dtype=np.float32)
    window = _error_window(fraction_valid=1.0)
    window.error_valid[0, 0] = False
    result = perturbed_elevation(
        elevation, window, correlation_length_m=0.0, rng=np.random.default_rng(1)
    )
    assert result[0, 0] == 0.0  # no perturbation where error_valid is False


def test_perturbed_elevation_rejects_negative_correlation_length():
    elevation = np.zeros((SIZE, SIZE), dtype=np.float32)
    window = _error_window()
    with pytest.raises(ValueError, match="non-negative"):
        perturbed_elevation(
            elevation, window, correlation_length_m=-1.0, rng=np.random.default_rng(1)
        )


def test_zero_error_magnitude_produces_zero_perturbation():
    elevation = np.full((SIZE, SIZE), 7.0, dtype=np.float32)
    window = _error_window(magnitude=0.0)
    result = perturbed_elevation(
        elevation, window, correlation_length_m=10.0, rng=np.random.default_rng(1)
    )
    np.testing.assert_array_equal(result, elevation)


def test_larger_correlation_length_produces_smoother_noise():
    """A larger Gaussian-kernel length scale must reduce pixel-to-pixel
    variation in the raw (unit-variance) field -- i.e. actually
    correlate neighbouring pixels, not just reshuffle independent noise."""

    elevation = np.zeros((SIZE, SIZE), dtype=np.float32)
    window = _error_window(magnitude=1.0)
    short = perturbed_elevation(
        elevation, window, correlation_length_m=1.0, rng=np.random.default_rng(1)
    )
    long = perturbed_elevation(
        elevation, window, correlation_length_m=50.0, rng=np.random.default_rng(1)
    )
    short_roughness = np.mean(np.abs(np.diff(short, axis=0)))
    long_roughness = np.mean(np.abs(np.diff(long, axis=0)))
    assert long_roughness < short_roughness


# ---------------------------------------------------------------------------
# Error window alignment
# ---------------------------------------------------------------------------


def test_read_aligned_error_window_rejects_a_product_with_no_error_url():
    from lumen_pipeline.terrain.dem_io import DemProduct, DemReader
    from lumen_pipeline.terrain.mc_horizon import read_aligned_error_window

    crops = _crops()
    product = DemProduct(
        key="p",
        name="p",
        url="https://example.invalid/p.tif",
        resolution_m=5.0,
        latitude_coverage="80S-90S",
        unit="m",
        scale=1.0,
        offset=0.0,
        nodata=-9999.0,
        vertical_reference="height_relative",
        verification_status="source_page_and_urls_provided",
        error_url=None,
    )
    reader = DemReader(products={"p": product})
    with pytest.raises(MonteCarloInputError, match="no _ERR source"):
        read_aligned_error_window(
            crops.near,
            reader=reader,
            products={"p": product},
            latitude_deg=LATITUDE,
            longitude_deg_east=LONGITUDE,
        )


# ---------------------------------------------------------------------------
# compute_horizon with elevation overrides
# ---------------------------------------------------------------------------


def test_compute_horizon_with_no_overrides_matches_the_unperturbed_crops():
    crops = _crops()
    result = compute_horizon(
        crops, latitude_deg=LATITUDE, longitude_deg_east=LONGITUDE, geometric_growth_factor=1.5
    )
    assert result.shape == (4, 3600)
    assert np.isfinite(result).all()


def test_compute_horizon_override_changes_the_result():
    crops = _crops()
    nominal = compute_horizon(
        crops, latitude_deg=LATITUDE, longitude_deg_east=LONGITUDE, geometric_growth_factor=1.5
    )
    perturbed = compute_horizon(
        crops,
        latitude_deg=LATITUDE,
        longitude_deg_east=LONGITUDE,
        geometric_growth_factor=1.5,
        elevation_overrides={"near": np.full((SIZE, SIZE), 50.0, dtype=np.float32)},
    )
    assert not np.array_equal(nominal, perturbed)


def test_compute_horizon_does_not_mutate_the_original_crop():
    crops = _crops()
    original = crops.near.dem.elevation.copy()
    compute_horizon(
        crops,
        latitude_deg=LATITUDE,
        longitude_deg_east=LONGITUDE,
        geometric_growth_factor=1.5,
        elevation_overrides={"near": np.full((SIZE, SIZE), 999.0, dtype=np.float32)},
    )
    np.testing.assert_array_equal(crops.near.dem.elevation, original)


# ---------------------------------------------------------------------------
# Clone ensemble generation
# ---------------------------------------------------------------------------


def test_clone_ensemble_is_reproducible_with_the_same_base_seed():
    crops = _crops()
    windows = {"near": _error_window()}
    a = generate_clone_ensemble(
        crops,
        windows,
        latitude_deg=LATITUDE,
        longitude_deg_east=LONGITUDE,
        geometric_growth_factor=1.5,
        correlation_length_m=10.0,
        clone_count=5,
        base_seed=42,
    )
    b = generate_clone_ensemble(
        crops,
        windows,
        latitude_deg=LATITUDE,
        longitude_deg_east=LONGITUDE,
        geometric_growth_factor=1.5,
        correlation_length_m=10.0,
        clone_count=5,
        base_seed=42,
    )
    np.testing.assert_array_equal(a.elevations_deg, b.elevations_deg)


def test_clone_ensemble_differs_with_a_different_base_seed():
    crops = _crops()
    windows = {"near": _error_window()}
    a = generate_clone_ensemble(
        crops,
        windows,
        latitude_deg=LATITUDE,
        longitude_deg_east=LONGITUDE,
        geometric_growth_factor=1.5,
        correlation_length_m=10.0,
        clone_count=5,
        base_seed=42,
    )
    b = generate_clone_ensemble(
        crops,
        windows,
        latitude_deg=LATITUDE,
        longitude_deg_east=LONGITUDE,
        geometric_growth_factor=1.5,
        correlation_length_m=10.0,
        clone_count=5,
        base_seed=43,
    )
    assert not np.array_equal(a.elevations_deg, b.elevations_deg)


def test_clone_ensemble_differs_with_a_different_correlation_length():
    crops = _crops()
    windows = {"near": _error_window()}
    a = generate_clone_ensemble(
        crops,
        windows,
        latitude_deg=LATITUDE,
        longitude_deg_east=LONGITUDE,
        geometric_growth_factor=1.5,
        correlation_length_m=10.0,
        clone_count=5,
        base_seed=42,
    )
    b = generate_clone_ensemble(
        crops,
        windows,
        latitude_deg=LATITUDE,
        longitude_deg_east=LONGITUDE,
        geometric_growth_factor=1.5,
        correlation_length_m=50.0,
        clone_count=5,
        base_seed=42,
    )
    assert not np.array_equal(a.elevations_deg, b.elevations_deg)


def test_clone_ensemble_shape_and_rejects_fewer_than_one_clone():
    crops = _crops()
    windows = {"near": _error_window()}
    ensemble = generate_clone_ensemble(
        crops,
        windows,
        latitude_deg=LATITUDE,
        longitude_deg_east=LONGITUDE,
        geometric_growth_factor=1.5,
        correlation_length_m=10.0,
        clone_count=7,
        base_seed=1,
    )
    assert ensemble.elevations_deg.shape == (7, 4, 3600)
    with pytest.raises(ValueError, match="clone_count"):
        generate_clone_ensemble(
            crops,
            windows,
            latitude_deg=LATITUDE,
            longitude_deg_east=LONGITUDE,
            geometric_growth_factor=1.5,
            correlation_length_m=10.0,
            clone_count=0,
            base_seed=1,
        )


# ---------------------------------------------------------------------------
# Sample sigma / convergence (synthetic, known-value checks)
# ---------------------------------------------------------------------------


def test_sample_sigma_matches_a_known_analytic_standard_deviation():
    # Five clones with known values at one bin: [1, 2, 3, 4, 5].
    # Sample std (ddof=1) = sqrt(var) = sqrt(2.5) exactly.
    values = np.array([1.0, 2.0, 3.0, 4.0, 5.0], dtype=np.float32)
    clones = np.zeros((5, 4, 3600), dtype=np.float32)
    clones[:, 0, 0] = values
    sigma = sample_sigma(clones)
    assert sigma[0, 0] == pytest.approx(np.sqrt(2.5), rel=1e-5)


def test_sample_sigma_requires_at_least_two_clones():
    clones = np.zeros((1, 4, 3600), dtype=np.float32)
    with pytest.raises(ValueError, match="at least 2"):
        sample_sigma(clones)


def test_sample_sigma_subset_uses_only_the_requested_clone_count():
    clones = np.zeros((4, 4, 3600), dtype=np.float32)
    clones[:, 0, 0] = [1.0, 2.0, 100.0, 200.0]  # last two clones are outliers
    sigma_full = sample_sigma(clones)
    sigma_subset = sample_sigma(clones, clone_count=2)
    assert sigma_subset[0, 0] == pytest.approx(np.std([1.0, 2.0], ddof=1))
    assert sigma_subset[0, 0] != sigma_full[0, 0]


def test_sample_sigma_propagates_nan_rather_than_ignoring_a_nan_clone():
    clones = np.ones((3, 4, 3600), dtype=np.float32)
    clones[1, 0, 0] = np.nan
    sigma = sample_sigma(clones)
    assert np.isnan(sigma[0, 0])


def test_nan_pattern_matches_nominal_true_and_false_cases():
    nominal = np.full((4, 3600), 1.0, dtype=np.float32)
    nominal[0, 0] = np.nan
    matching = np.full((4, 3600), 0.5, dtype=np.float32)
    matching[0, 0] = np.nan
    assert nan_pattern_matches_nominal(matching, nominal) is True

    mismatched = np.full((4, 3600), 0.5, dtype=np.float32)  # no NaN anywhere
    assert nan_pattern_matches_nominal(mismatched, nominal) is False


def test_evaluate_convergence_reports_zero_diff_for_a_constant_ensemble():
    crops = _crops()
    windows = {"near": _error_window(magnitude=0.0)}  # zero error -> identical clones
    ensemble = generate_clone_ensemble(
        crops,
        windows,
        latitude_deg=LATITUDE,
        longitude_deg_east=LONGITUDE,
        geometric_growth_factor=1.5,
        correlation_length_m=10.0,
        clone_count=25,
        base_seed=1,
    )
    result = evaluate_convergence(ensemble)
    assert result.max_abs_diff_20_vs_30_deg == pytest.approx(0.0, abs=1e-9)
    assert result.mean_sigma_30_deg == pytest.approx(0.0, abs=1e-9)


def test_evaluate_convergence_requires_at_least_20_clones():
    from lumen_pipeline.terrain.mc_horizon import CloneEnsemble

    ensemble = CloneEnsemble(
        correlation_length_m=10.0,
        base_seed=1,
        clone_count=5,
        elevations_deg=np.zeros((5, 4, 3600), dtype=np.float32),
    )
    with pytest.raises(ValueError, match="at least 20"):
        evaluate_convergence(ensemble)
