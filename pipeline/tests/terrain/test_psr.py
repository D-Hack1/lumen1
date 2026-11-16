# Owner: Shiva Shakthi
"""S-7 PSR tests: connected-component area filtering (including the
contract's exact 28 px @ 60 m / 2 px @ 240 m thresholds), Euclidean distance
transform, and polar-stereographic scale correction. Network-independent."""

from __future__ import annotations

import math

import numpy as np
import pytest

from lumen_pipeline.terrain.layers import polar_stereographic_scale_factor
from lumen_pipeline.terrain.psr import MIN_PSR_AREA_KM2, PSR_DEFINITION, compute_psr


def test_min_qualifying_pixels_matches_contract_values_exactly():
    """Contract §4.2: >=28 pixels at 60 m/px, >=2 pixels at 240 m/px,
    derived independently from the 0.1 km^2 area threshold."""

    pixel_area_km2_60m = (60.0 * 60.0) / 1.0e6
    pixel_area_km2_240m = (240.0 * 240.0) / 1.0e6
    assert math.ceil(MIN_PSR_AREA_KM2 / pixel_area_km2_60m) == 28
    assert math.ceil(MIN_PSR_AREA_KM2 / pixel_area_km2_240m) == 2


def test_psr_definition_wording_matches_contract_exactly():
    assert PSR_DEFINITION == "permanently shadowed region (a cold trap that may host ice)"
    assert "ice deposit" not in PSR_DEFINITION
    assert "confirmed" not in PSR_DEFINITION


def test_component_area_filter_excludes_small_components(monkeypatch):
    """A classification raster with one large (qualifying) and one small
    (sub-threshold) 8-connected shadow blob; only the large one should
    survive the area filter, and should have distance 0 everywhere inside
    it."""

    size = 50
    resolution_m = 240.0
    decoded = np.zeros((size, size), dtype=np.float32)
    # Large qualifying blob: 3x3 = 9 px >= 2 px threshold at 240 m.
    decoded[10:13, 10:13] = 1.0
    # Small sub-threshold blob: a single pixel, still < 2 px... use area
    # filter at 60 m instead to get a meaningful "too small" case: fake a
    # product at 240 m where 1 px (0.0576 km^2) is below the 0.1 km^2 / 2 px
    # threshold is NOT guaranteed (ceil(0.1/0.0576)=2, so 1 px really is
    # sub-threshold at 240 m).
    decoded[30, 30] = 1.0
    valid = np.ones((size, size), dtype=bool)

    from rasterio.transform import from_origin

    import lumen_pipeline.terrain.psr as psr_module
    from lumen_pipeline.terrain.layers import RegionalLayerProduct, RegionalRaster

    product = RegionalLayerProduct(
        key="synthetic_psr",
        name="synthetic",
        url="synthetic://psr",
        resolution_m=resolution_m,
        latitude_coverage="60S-90S",
        scale=1.0,
        offset=0.0,
        nodata=float("nan"),
        value_meaning="synthetic binary PSR classification",
        citation="synthetic test fixture",
        source_page=None,
        availability_status="verified_product",
        verification_status="live_opened_and_inspected",
    )
    transform = from_origin(
        -size * resolution_m / 2.0, size * resolution_m / 2.0, resolution_m, resolution_m
    )
    raster = RegionalRaster(
        values=decoded,
        valid=valid,
        resolution_m=resolution_m,
        transform=transform,
        crs=None,
        product=product,
    )

    monkeypatch.setattr(psr_module, "read_regional_window", lambda p, radius_m: raster)
    monkeypatch.setattr(
        psr_module,
        "load_regional_layer_products",
        lambda: {"psr_lpsr_65S_240m_pgda_69": product},
    )

    result = compute_psr("80_90S")

    assert result.min_qualifying_pixels == 2
    assert result.component_count_total == 2
    assert result.component_count_qualifying == 1
    # The 3x3 blob qualifies and has zero self-distance everywhere inside it.
    assert np.all(result.qualifying_mask[10:13, 10:13])
    assert np.all(result.distance_km[10:13, 10:13] == 0.0)
    # The single-pixel blob does not qualify, so it is measured as distance
    # to the nearest *qualifying* PSR (the 3x3 blob), not itself: positive.
    assert not result.qualifying_mask[30, 30]
    assert result.distance_km[30, 30] > 0.0


def test_distance_is_zero_inside_and_positive_outside_qualifying_psr(monkeypatch):
    size = 40
    resolution_m = 60.0
    decoded = np.zeros((size, size), dtype=np.float32)
    decoded[15:21, 15:21] = 1.0  # 6x6 = 36 px, well above the 28 px/60 m threshold
    valid = np.ones((size, size), dtype=bool)

    from rasterio.transform import from_origin

    import lumen_pipeline.terrain.psr as psr_module
    from lumen_pipeline.terrain.layers import RegionalLayerProduct, RegionalRaster

    product = RegionalLayerProduct(
        key="synthetic_psr_60m",
        name="synthetic",
        url="synthetic://psr60",
        resolution_m=resolution_m,
        latitude_coverage="85S-90S",
        scale=1.0,
        offset=0.0,
        nodata=float("nan"),
        value_meaning="synthetic binary PSR classification",
        citation="synthetic test fixture",
        source_page=None,
        availability_status="verified_product",
        verification_status="live_opened_and_inspected",
    )
    transform = from_origin(
        -size * resolution_m / 2.0, size * resolution_m / 2.0, resolution_m, resolution_m
    )
    raster = RegionalRaster(
        values=decoded,
        valid=valid,
        resolution_m=resolution_m,
        transform=transform,
        crs=None,
        product=product,
    )

    monkeypatch.setattr(psr_module, "read_regional_window", lambda p, radius_m: raster)
    monkeypatch.setattr(
        psr_module,
        "load_regional_layer_products",
        lambda: {"psr_lpsr_85S_60m_pgda_69": product},
    )

    result = compute_psr("85_90S")

    assert np.all(result.distance_km[15:21, 15:21] == 0.0)
    assert np.all(result.distance_km[0, :] > 0.0)
    # A pixel one step outside the blob must have a positive, finite,
    # scale-corrected distance roughly equal to one pixel's true ground size.
    outside_distance = result.distance_km[14, 17]
    k = polar_stereographic_scale_factor(-89.0)  # interior of the 85_90S window
    expected_min = (resolution_m / k) / 1000.0
    assert outside_distance > 0.0
    assert outside_distance == pytest.approx(expected_min, rel=0.05)
