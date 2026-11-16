# Owner: Shiva Shakthi
# Monte-Carlo DEM clone generation and horizon-uncertainty computation.
"""Preliminary Monte-Carlo terrain-uncertainty workflow.

Implements the methodology Gowri reviewed and approved as the agreed
preliminary implementation: spatially correlated Gaussian DEM
perturbations scaled by each product's own ``_ERR`` raster (explicitly
labeled an unverified 1-sigma interpretation, never claimed as
physically confirmed), re-running the *existing* production R3 horizon
pipeline (``masks.fit_near_field``, ``horizon.raycast_horizon``,
``masks._combine_horizons``, ``masks._apply_near_zone``) independently
for each clone, and computing a ``ddof=1`` sample standard deviation
across clones for every observer height and azimuth bin.

This module does not pick a single "correct" correlation length --
``correlation_length_m`` is a caller-supplied, freely configurable
parameter, and nothing here claims any tested value is physically
calibrated to real lunar DEM error statistics. It also does not invent
error magnitudes: a crop whose ``_ERR`` raster cannot be read and
aligned against the already-read nominal DEM window is reported via
:class:`MonteCarloInputError` rather than silently perturbed with zero
or an assumed magnitude.
"""

from __future__ import annotations

import dataclasses
import math
from collections.abc import Mapping
from dataclasses import dataclass

import numpy as np
from scipy.ndimage import gaussian_filter

from .crops import TerrainCrop, TerrainCrops
from .dem_io import DemProduct, DemReader
from .horizon import raycast_horizon
from .masks import (
    NearFieldUnavailable,
    _apply_near_zone,
    _combine_horizons,
    _restrict_crop,
    fit_near_field,
)

HEIGHTS_M = (1.0, 2.0, 5.0, 10.0)
AZIMUTH_COUNT = 3600
BIN_WIDTH_DEG = 0.1
MAX_RANGE_KM = 250.0


class MonteCarloInputError(RuntimeError):
    """Raised when a site's inputs cannot support clone generation.

    Always raised instead of fabricating an error magnitude, skipping a
    crop silently, or treating a misaligned grid as usable.
    """


@dataclass(frozen=True)
class CropErrorWindow:
    """One crop's _ERR-raster window, read at the identical bounds as
    the already-read nominal crop and verified to decode to the exact
    same elevation/validity (a genuine re-read alignment check, not
    merely trusting dem_io's internal CRS/transform/shape assertions)."""

    crop_name: str
    error_m: np.ndarray
    error_valid: np.ndarray
    dem_url: str
    error_url: str
    resolution_m: float
    fraction_valid: float


def read_aligned_error_window(
    crop: TerrainCrop,
    *,
    reader: DemReader,
    products: Mapping[str, DemProduct],
    latitude_deg: float,
    longitude_deg_east: float,
) -> CropErrorWindow:
    """Read ``crop``'s matching ``_ERR`` raster at the same window the
    nominal crop was read at, and verify the re-read elevation/validity
    is pixel-identical to the already-read crop before trusting the
    error window's alignment."""

    product = products[crop.source_key]
    if not product.error_url:
        raise MonteCarloInputError(
            f"{crop.source_key}: no _ERR source is registered for this product; "
            f"cannot perturb the {crop.spec.name} crop without an error magnitude"
        )
    width_m = 2.0 * crop.spec.max_distance_km * 1000.0
    window = reader.read_site_window(
        product,
        lon_deg=longitude_deg_east,
        lat_deg=latitude_deg,
        width_m=width_m,
        height_m=width_m,
        read_error=True,
    )
    if window.error is None or window.error_valid is None:
        raise MonteCarloInputError(
            f"{crop.source_key}: _ERR raster for the {crop.spec.name} crop did not decode"
        )
    if window.elevation.shape != crop.dem.elevation.shape:
        raise MonteCarloInputError(
            f"{crop.source_key}: _ERR-aligned re-read shape {window.elevation.shape} does not "
            f"match the nominal {crop.spec.name} crop shape {crop.dem.elevation.shape}"
        )
    elevation_matches = np.array_equal(
        np.nan_to_num(window.elevation, nan=0.0),
        np.nan_to_num(crop.dem.elevation, nan=0.0),
    )
    valid_matches = np.array_equal(window.valid, crop.dem.valid)
    if not (elevation_matches and valid_matches):
        raise MonteCarloInputError(
            f"{crop.source_key}: re-read elevation/validity for the {crop.spec.name} crop does "
            "not match the original crop exactly -- the _ERR window is not pixel-aligned with "
            "the nominal DEM window actually used"
        )
    error_valid = np.asarray(window.error_valid, dtype=bool)
    fraction_valid = float(error_valid.mean()) if error_valid.size else 0.0
    return CropErrorWindow(
        crop_name=crop.spec.name,
        error_m=np.asarray(window.error, dtype=np.float64),
        error_valid=error_valid,
        dem_url=product.url,
        error_url=product.error_url,
        resolution_m=crop.achieved_resolution_m,
        fraction_valid=fraction_valid,
    )


def read_all_aligned_error_windows(
    crops: TerrainCrops,
    *,
    reader: DemReader,
    products: Mapping[str, DemProduct],
    latitude_deg: float,
    longitude_deg_east: float,
) -> dict[str, CropErrorWindow]:
    """Read and verify the error window for every available crop
    (near/mid/far). Raises :class:`MonteCarloInputError` naming the
    first crop whose error window cannot be read or aligned -- the
    caller decides whether a partial set (e.g. near+mid but not far)
    is acceptable for its purpose."""

    windows: dict[str, CropErrorWindow] = {}
    for name, crop in (("near", crops.near), ("mid", crops.mid), ("far", crops.far)):
        if crop is None:
            continue
        windows[name] = read_aligned_error_window(
            crop,
            reader=reader,
            products=products,
            latitude_deg=latitude_deg,
            longitude_deg_east=longitude_deg_east,
        )
    return windows


def _correlated_gaussian_field(
    shape: tuple[int, int], *, correlation_length_px: float, rng: np.random.Generator
) -> np.ndarray:
    """Unit-variance, isotropic, spatially correlated Gaussian random
    field via Gaussian-kernel smoothing of white noise.

    This is a standard spectral-smoothing construction for generating a
    spatially correlated field with a configurable length scale -- it is
    not a claimed physical autocorrelation model for lunar DEM error;
    ``correlation_length_px`` is a free parameter supplied by the caller.
    """

    white = rng.standard_normal(shape)
    if correlation_length_px <= 0.0:
        return white
    smoothed = gaussian_filter(white, sigma=correlation_length_px, mode="nearest")
    std = float(np.std(smoothed))
    if std <= 0.0 or not math.isfinite(std):
        raise MonteCarloInputError(
            "correlated noise field has zero or non-finite variance after smoothing "
            f"(correlation_length_px={correlation_length_px})"
        )
    return smoothed / std


def perturbed_elevation(
    elevation: np.ndarray,
    error_window: CropErrorWindow,
    *,
    correlation_length_m: float,
    rng: np.random.Generator,
) -> np.ndarray:
    """Return ``elevation`` perturbed by a spatially correlated Gaussian
    field scaled by ``error_window``'s per-pixel magnitude.

    Pixels without a valid error magnitude are left unperturbed (0
    added) rather than assigned a fabricated magnitude; this is recorded
    in ``error_window.fraction_valid`` for the caller to report.
    """

    if correlation_length_m < 0.0:
        raise ValueError("correlation_length_m must be non-negative")
    correlation_length_px = correlation_length_m / error_window.resolution_m
    field = _correlated_gaussian_field(
        elevation.shape, correlation_length_px=correlation_length_px, rng=rng
    )
    perturbation = np.where(error_window.error_valid, field * error_window.error_m, 0.0)
    return elevation + perturbation


def _crop_with_elevation(
    crop: TerrainCrop | None, elevation: np.ndarray | None
) -> TerrainCrop | None:
    if crop is None or elevation is None:
        return crop
    perturbed_dem = dataclasses.replace(crop.dem, elevation=elevation)
    return dataclasses.replace(crop, dem=perturbed_dem)


def compute_horizon(
    crops: TerrainCrops,
    *,
    latitude_deg: float,
    longitude_deg_east: float,
    geometric_growth_factor: float,
    elevation_overrides: Mapping[str, np.ndarray] | None = None,
) -> np.ndarray:
    """Re-run the existing production R3 horizon pipeline exactly as
    ``masks.generate_tier_a_mask`` does (fit the near-field plane, raycast
    each available crop, combine, apply the near-zone correction), with
    an optional per-crop elevation override for Monte-Carlo clones.
    Returns only the ``(4, 3600)`` elevation-angle array; never writes a
    mask file.
    """

    overrides = elevation_overrides or {}
    near = _crop_with_elevation(crops.near, overrides.get("near"))
    mid = _crop_with_elevation(crops.mid, overrides.get("mid"))
    far = _crop_with_elevation(crops.far, overrides.get("far"))
    if near is None:
        raise NearFieldUnavailable("a near-field crop is required to compute a horizon")

    near_model = fit_near_field(near, latitude_deg=latitude_deg, longitude_deg=longitude_deg_east)
    results = []
    for crop in (near, mid, far):
        if crop is None:
            continue
        restricted = _restrict_crop(
            crop,
            latitude_deg=latitude_deg,
            longitude_deg=longitude_deg_east,
            elevation=near_model.filtered_elevation if crop is near else None,
        )
        results.append(
            raycast_horizon(
                restricted,
                latitude_deg=latitude_deg,
                longitude_deg_east=longitude_deg_east,
                observer_heights_m=HEIGHTS_M,
                bin_width_deg=BIN_WIDTH_DEG,
                max_range_km=MAX_RANGE_KM,
                near_field_pixel_size_m=near_model.near_field_resolution_m,
                geometric_growth_factor=geometric_growth_factor,
                site_elevation_m=near_model.z0_m,
            )
        )
    elevation, distance = _combine_horizons(results)
    azimuth = (np.arange(AZIMUTH_COUNT, dtype=np.float64) + 0.5) * BIN_WIDTH_DEG
    _apply_near_zone(elevation, distance, near_model, HEIGHTS_M, azimuth)
    return elevation


@dataclass(frozen=True)
class CloneEnsemble:
    """One correlation length's reproducibly seeded clone ensemble."""

    correlation_length_m: float
    base_seed: int
    clone_count: int
    elevations_deg: np.ndarray  # shape (clone_count, 4, 3600)


def generate_clone_ensemble(
    crops: TerrainCrops,
    error_windows: Mapping[str, CropErrorWindow],
    *,
    latitude_deg: float,
    longitude_deg_east: float,
    geometric_growth_factor: float,
    correlation_length_m: float,
    clone_count: int,
    base_seed: int,
) -> CloneEnsemble:
    """Generate ``clone_count`` reproducibly seeded DEM clones at one
    correlation length and recompute each clone's full horizon via the
    existing production pipeline.

    Reproducibility: ``np.random.SeedSequence([base_seed, correlation_length_fixed_point,
    clone_index])`` deterministically derives each clone's per-crop RNG,
    so re-running this function with the same arguments reproduces the
    identical clone ensemble bit-for-bit.
    """

    if clone_count < 1:
        raise ValueError("clone_count must be at least 1")
    # SeedSequence entropy must be integers; correlation length is a
    # float, so fold its bit pattern in deterministically rather than
    # truncating it (which could silently collide two close lengths).
    length_key = int(np.float64(correlation_length_m).view(np.uint64))
    # Fixed, deterministic per-crop seed component -- never Python's
    # built-in hash(), which is randomized per process (PYTHONHASHSEED)
    # and would silently break reproducibility across runs.
    crop_seed_component = {"near": 1, "mid": 2, "far": 3}
    elevations = np.empty((clone_count, len(HEIGHTS_M), AZIMUTH_COUNT), dtype=np.float32)
    for clone_index in range(clone_count):
        overrides: dict[str, np.ndarray] = {}
        for name, crop in (("near", crops.near), ("mid", crops.mid), ("far", crops.far)):
            if crop is None or name not in error_windows:
                continue
            seed_seq = np.random.SeedSequence(
                [base_seed, length_key, clone_index, crop_seed_component[name]]
            )
            rng = np.random.default_rng(seed_seq)
            window = error_windows[name]
            overrides[name] = perturbed_elevation(
                crop.dem.elevation,
                window,
                correlation_length_m=correlation_length_m,
                rng=rng,
            )
        elevations[clone_index] = compute_horizon(
            crops,
            latitude_deg=latitude_deg,
            longitude_deg_east=longitude_deg_east,
            geometric_growth_factor=geometric_growth_factor,
            elevation_overrides=overrides,
        )
    return CloneEnsemble(
        correlation_length_m=correlation_length_m,
        base_seed=base_seed,
        clone_count=clone_count,
        elevations_deg=elevations,
    )


def sample_sigma(elevations_deg: np.ndarray, *, clone_count: int | None = None) -> np.ndarray:
    """ddof=1 sample standard deviation across the clone axis (axis 0),
    for the first ``clone_count`` clones (or all of them if omitted).

    Uses plain (NaN-propagating) ``np.std``, not ``nanstd``: if even one
    clone has no determinable horizon at a bin, the ensemble statistic
    at that bin is itself undefined, not a value silently computed from
    whichever clones happened to be finite. Callers must separately
    verify (see ``nan_pattern_matches_nominal``) that this NaN pattern
    actually matches the nominal mask's own validity, and report a
    mismatch rather than paper over it.
    """

    subset = elevations_deg if clone_count is None else elevations_deg[:clone_count]
    if subset.shape[0] < 2:
        raise ValueError("sample standard deviation requires at least 2 clones")
    return np.std(subset, axis=0, ddof=1)


def nan_pattern_matches_nominal(sigma_deg: np.ndarray, nominal_elevation_deg: np.ndarray) -> bool:
    """True iff ``sigma_deg``'s NaN pattern exactly matches the nominal
    (unperturbed) horizon's own NaN pattern -- the contract (§8)
    requires sigma to be finite wherever the mask sample is valid and
    NaN wherever it is not."""

    return bool(np.array_equal(np.isnan(sigma_deg), np.isnan(np.asarray(nominal_elevation_deg))))


@dataclass(frozen=True)
class SensitivityResult:
    """20-vs-30-clone convergence and cross-length sensitivity for one
    correlation length."""

    correlation_length_m: float
    sigma_20_deg: np.ndarray
    sigma_30_deg: np.ndarray
    max_abs_diff_20_vs_30_deg: float
    mean_abs_diff_20_vs_30_deg: float
    mean_sigma_30_deg: float
    max_sigma_30_deg: float


def evaluate_convergence(ensemble: CloneEnsemble) -> SensitivityResult:
    """Compare the sigma computed from the first 20 clones against the
    sigma computed from all 30 (or however many were generated)."""

    if ensemble.clone_count < 20:
        raise ValueError(
            f"convergence comparison requires at least 20 clones, got {ensemble.clone_count}"
        )
    sigma_20 = sample_sigma(ensemble.elevations_deg, clone_count=20)
    sigma_30 = sample_sigma(ensemble.elevations_deg, clone_count=ensemble.clone_count)
    finite = np.isfinite(sigma_20) & np.isfinite(sigma_30)
    diff = np.abs(sigma_30 - sigma_20)[finite]
    return SensitivityResult(
        correlation_length_m=ensemble.correlation_length_m,
        sigma_20_deg=sigma_20,
        sigma_30_deg=sigma_30,
        max_abs_diff_20_vs_30_deg=float(np.max(diff)) if diff.size else 0.0,
        mean_abs_diff_20_vs_30_deg=float(np.mean(diff)) if diff.size else 0.0,
        mean_sigma_30_deg=float(np.mean(sigma_30[np.isfinite(sigma_30)])),
        max_sigma_30_deg=float(np.max(sigma_30[np.isfinite(sigma_30)])),
    )
