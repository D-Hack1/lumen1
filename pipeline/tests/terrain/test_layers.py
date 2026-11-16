# Owner: Shiva Shakthi
# Unit/validation test: test_layers.
"""S-7 regional layer tests: projection math, slope-hazard classification,
PNG/sidecar rendering, nodata handling, and explicit unavailable-source
behavior. Network-independent: synthetic rasters are written locally and
read back through the same code paths used for the real PGDA sources."""

from __future__ import annotations

import math

import numpy as np
import pytest
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_origin

from lumen_pipeline.terrain.layers import (
    EXTENT_COLATITUDE_DEG,
    EXTENT_LAT_LIMIT_DEG,
    SLOPE_HAZARD_NODATA_CODE,
    LayerUnavailable,
    RegionalLayerProduct,
    RegionalRaster,
    _write_layer_sidecar,
    classify_slope_hazard,
    extent_radius_m,
    polar_stereographic_scale_factor,
    radius_for_colatitude_m,
    read_regional_window,
    render_categorical_png,
    render_continuous_png,
)

SOUTH_POLAR_STEREO_PROJ4 = (
    "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400 +units=m +no_defs"
)


# ---------------------------------------------------------------------------
# Projection math
# ---------------------------------------------------------------------------


def test_extent_radius_matches_real_product_boundaries():
    """Cross-validated against three independently observed product
    extents: 80S/85S/60S boundaries of real PGDA rasters (see
    dem_sources.yaml notes)."""

    assert extent_radius_m("80_90S") == pytest.approx(304_005.6, abs=1.0)
    assert extent_radius_m("85_90S") == pytest.approx(151_713.0, abs=1.0)
    # The real 60S-90S product's declared extent is +-931200 m, rounded to
    # a whole number of its own 240 m pixels; the formula value is close
    # but not required to match that rounding exactly.
    assert radius_for_colatitude_m(30.0) == pytest.approx(931_200.0, abs=200.0)


def test_extent_radius_rejects_unknown_extent():
    with pytest.raises(ValueError):
        extent_radius_m("90_100S")


def test_polar_stereographic_scale_factor_is_one_at_the_pole_and_increases_away():
    assert polar_stereographic_scale_factor(-90.0) == pytest.approx(1.0)
    k80 = polar_stereographic_scale_factor(-80.0)
    k85 = polar_stereographic_scale_factor(-85.0)
    assert 1.0 < k85 < k80
    # True distance = projected / k, so k > 1 away from the pole.
    assert k80 == pytest.approx(2.0 / (1.0 + math.sin(math.radians(80.0))))


def test_extent_colatitude_values_match_contract_section_5_2():
    assert EXTENT_COLATITUDE_DEG == {"80_90S": 10.0, "85_90S": 5.0}


# ---------------------------------------------------------------------------
# Slope-hazard classification (contract §5.3 boundaries)
# ---------------------------------------------------------------------------


def test_slope_hazard_class_boundaries_are_exact():
    slopes = np.array([0.0, 4.999, 5.0, 9.999, 10.0, 15.0, 15.0001, 90.0])
    valid = np.ones_like(slopes, dtype=bool)
    codes = classify_slope_hazard(slopes, valid)
    assert list(codes) == [0, 0, 1, 1, 2, 2, 3, 3]


def test_slope_hazard_nodata_is_never_classified_safe():
    slopes = np.array([0.0, np.nan, 3.0])
    valid = np.array([True, True, False])
    codes = classify_slope_hazard(slopes, valid)
    assert codes[0] == 0
    assert codes[1] == SLOPE_HAZARD_NODATA_CODE  # NaN, even though "valid"
    assert codes[2] == SLOPE_HAZARD_NODATA_CODE  # explicitly invalid


def test_slope_hazard_negative_slope_is_treated_as_nodata_not_safe():
    # Negative values are not physical slope angles; classify_slope_hazard
    # itself does not clamp, but a caller marking them invalid must not
    # have them silently fall into "safe".
    slopes = np.array([-0.5])
    valid = np.array([False])
    codes = classify_slope_hazard(slopes, valid)
    assert codes[0] == SLOPE_HAZARD_NODATA_CODE


# ---------------------------------------------------------------------------
# PNG rendering: nodata handling, never zero
# ---------------------------------------------------------------------------


def test_render_categorical_png_nodata_is_transparent_not_zero(tmp_path):
    codes = np.array([[0, 1], [SLOPE_HAZARD_NODATA_CODE, 3]], dtype=np.uint8)
    path = tmp_path / "cat.png"
    render_categorical_png(
        codes,
        class_order=("safe", "caution", "critical", "exceeded"),
        palette={
            "safe": "#ffffb2",
            "caution": "#fecc5c",
            "critical": "#fd8d3c",
            "exceeded": "#e31a1c",
        },
        nodata_code=SLOPE_HAZARD_NODATA_CODE,
        path=path,
    )
    from PIL import Image

    arr = np.array(Image.open(path))
    assert arr.shape == (2, 2, 4)
    assert tuple(arr[0, 0]) == (0xFF, 0xFF, 0xB2, 255)
    assert tuple(arr[0, 1]) == (0xFE, 0xCC, 0x5C, 255)
    assert tuple(arr[1, 0]) == (0, 0, 0, 0)  # nodata: fully transparent
    assert tuple(arr[1, 1]) == (0xE3, 0x1A, 0x1C, 255)


def test_render_continuous_png_invalid_pixels_are_transparent(tmp_path):
    values = np.array([[0.0, 0.5], [1.0, 0.3]], dtype=np.float32)
    valid = np.array([[True, True], [True, False]])
    path = tmp_path / "cont.png"
    render_continuous_png(
        values,
        valid,
        stops=((0.0, "#000000"), (1.0, "#ffffff")),
        path=path,
    )
    from PIL import Image

    arr = np.array(Image.open(path))
    assert tuple(arr[0, 0]) == (0, 0, 0, 255)
    assert tuple(arr[1, 0, :3]) == (255, 255, 255)
    assert arr[1, 0, 3] == 255
    assert arr[1, 1, 3] == 0  # invalid pixel: transparent regardless of its color


# ---------------------------------------------------------------------------
# read_regional_window: synthetic local raster, scale/offset, nodata, crop
# ---------------------------------------------------------------------------


def _write_synthetic_regional_raster(path, *, resolution_m: float, half_width_px: int) -> None:
    """A square raster centred on the projection origin (the pole), with a
    simple linear ramp of int16 raw values and a nodata border ring, to
    exercise scale/offset decoding and nodata masking end-to-end."""

    size = 2 * half_width_px
    crs = CRS.from_proj4(SOUTH_POLAR_STEREO_PROJ4)
    transform = from_origin(
        -half_width_px * resolution_m,
        half_width_px * resolution_m,
        resolution_m,
        resolution_m,
    )
    raw = np.arange(size * size, dtype=np.int16).reshape(size, size) % 1000
    raw[0, :] = -32768  # nodata border row
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=size,
        width=size,
        count=1,
        dtype="int16",
        crs=crs,
        transform=transform,
        nodata=-32768,
    ) as dst:
        dst.write(raw, 1)
        dst.scales = [4.0e-05]
        dst.offsets = [0.0]


def _synthetic_product(url: str) -> RegionalLayerProduct:
    return RegionalLayerProduct(
        key="synthetic_test_product",
        name="synthetic",
        url=url,
        resolution_m=240.0,
        latitude_coverage="60S-90S",
        scale=4.0e-05,
        offset=0.0,
        nodata=-32768.0,
        value_meaning="synthetic test fraction",
        citation="synthetic test fixture",
        source_page=None,
        availability_status="verified_product",
        verification_status="live_opened_and_inspected",
    )


def test_read_regional_window_decodes_scale_offset_and_masks_nodata(tmp_path):
    raster_path = tmp_path / "synthetic.tif"
    _write_synthetic_regional_raster(raster_path, resolution_m=240.0, half_width_px=50)
    product = _synthetic_product(str(raster_path))

    result = read_regional_window(product, radius_m=50 * 240.0)

    assert result.resolution_m == pytest.approx(240.0)
    # Decoded values are raw * scale (+ offset 0); raw in [0, 999] here.
    assert result.values[result.valid].max() <= 999 * 4.0e-05 + 1e-9
    assert result.values[result.valid].min() >= 0.0
    # The nodata border row must be masked out entirely.
    assert not np.any(result.valid[0, :])


def test_read_regional_window_crops_to_requested_radius(tmp_path):
    raster_path = tmp_path / "synthetic_large.tif"
    _write_synthetic_regional_raster(raster_path, resolution_m=240.0, half_width_px=200)
    product = _synthetic_product(str(raster_path))

    small = read_regional_window(product, radius_m=10_000.0)
    large = read_regional_window(product, radius_m=40_000.0)

    assert small.values.shape[0] < large.values.shape[0]
    # Requested radius 10 km at 240 m/px -> ceil(10000/240)=42 half-pixels -> 84 px.
    assert small.values.shape == (84, 84)


def test_read_regional_window_rejects_unverified_product(tmp_path):
    product = _synthetic_product(str(tmp_path / "does_not_exist.tif"))
    bad_product = RegionalLayerProduct(**{**product.__dict__, "verification_status": "pending"})
    with pytest.raises(LayerUnavailable):
        read_regional_window(bad_product, radius_m=1000.0)


# ---------------------------------------------------------------------------
# Explicit unavailable-source behavior for the regional-layer registry
# ---------------------------------------------------------------------------


def test_load_regional_layer_products_excludes_unverified_entries(tmp_path):
    from lumen_pipeline.terrain.layers import load_regional_layer_products as load_fn

    config_path = tmp_path / "dem_sources.yaml"
    config_path.write_text(
        """
regional_layer_products:
  verified_one:
    url: "https://example.invalid/verified.tif"
    resolution_m: 240.0
    scale: 1.0
    offset: 0.0
    nodata: -32768
    verification_status: "live_opened_and_inspected"
  unverified_one:
    url: "https://example.invalid/unverified.tif"
    resolution_m: 240.0
    scale: 1.0
    offset: 0.0
    nodata: -32768
    verification_status: "pending"
""",
        encoding="utf-8",
    )
    products = load_fn(config_path)
    assert "verified_one" in products
    assert "unverified_one" not in products


# ---------------------------------------------------------------------------
# Sidecar/index projection fields (size_px, centre_px, lat_limit_deg,
# half_extent_km, metres_per_px) consumed by web/src/engine/data/layers.ts
# ---------------------------------------------------------------------------


def _synthetic_source(*, width_px: int, height_px: int, resolution_m: float) -> RegionalRaster:
    product = RegionalLayerProduct(
        key="test_product",
        name="Test product",
        url="https://example.invalid/test.tif",
        resolution_m=resolution_m,
        latitude_coverage="60S-90S",
        scale=1.0,
        offset=0.0,
        nodata=-32768,
        value_meaning="test",
        citation="test citation",
        source_page="https://example.invalid",
        availability_status="verified_product",
        verification_status="live_opened_and_inspected",
    )
    return RegionalRaster(
        values=np.zeros((height_px, width_px), dtype=np.float32),
        valid=np.ones((height_px, width_px), dtype=bool),
        resolution_m=resolution_m,
        transform=from_origin(0.0, 0.0, resolution_m, resolution_m),
        crs=None,
        product=product,
    )


@pytest.mark.parametrize(
    ("extent", "width_px", "height_px", "resolution_m"),
    [
        ("80_90S", 2534, 2534, 240.0),
        ("85_90S", 5058, 5058, 60.0),
        # A layer can use a coarser native raster than its siblings at the
        # same extent (e.g. the real slope_hazard_85_90S.png is 1266x1266
        # at 240 m/px, not 5058x5058 at 60 m/px) -- the five fields must be
        # derived per-entry, never assumed shared across an extent.
        ("85_90S", 1266, 1266, 240.0),
    ],
)
def test_write_layer_sidecar_populates_all_five_frontend_projection_fields(
    tmp_path, extent, width_px, height_px, resolution_m
):
    source = _synthetic_source(width_px=width_px, height_px=height_px, resolution_m=resolution_m)
    (tmp_path / "layers").mkdir(parents=True, exist_ok=True)
    sidecar = _write_layer_sidecar(
        layer_id="slope_hazard",
        extent=extent,
        png_path=tmp_path / "layers" / f"slope_hazard_{extent}.png",
        terrain_root=tmp_path,
        source=source,
        legend_stops=[],
        classification=None,
        method="test",
    )
    projection = sidecar["projection"]
    for field in ("size_px", "centre_px", "lat_limit_deg", "half_extent_km", "metres_per_px"):
        assert field in projection, f"missing required projection field: {field}"

    # size_px: [height, width] (matches this module's spatial "shape"
    # convention; the real rasters are square so this is also verifiable
    # independent of axis order).
    assert projection["size_px"] == [height_px, width_px]

    # centre_px: pixel-edge centre of the square crop (matches
    # web/src/mocks/make_mock.py's established [size/2, size/2]
    # convention), not an off-by-half-pixel "pixel centre" convention.
    assert projection["centre_px"] == [width_px / 2.0, height_px / 2.0]

    # lat_limit_deg: south-negative, matching this project's MOON_ME
    # convention (sites.yaml, dem_sources.yaml all use negative south
    # latitudes).
    assert projection["lat_limit_deg"] == EXTENT_LAT_LIMIT_DEG[extent]
    assert projection["lat_limit_deg"] < 0.0

    # half_extent_km: the crop's own actual half-width (radius_m / 1000),
    # not re-derived from width_px/resolution_m (which would differ
    # slightly from the true extent_radius_m because the crop's half-pixel
    # count is ceil()-rounded when the window is read).
    expected_half_extent_km = extent_radius_m(extent) / 1000.0
    assert projection["half_extent_km"] == pytest.approx(expected_half_extent_km)

    # metres_per_px: the raster's own exact pixel spacing, not an
    # approximation back-derived from half_extent_km and size_px.
    assert projection["metres_per_px"] == resolution_m


def test_write_layer_sidecar_rejects_unknown_extent(tmp_path):
    source = _synthetic_source(width_px=100, height_px=100, resolution_m=240.0)
    with pytest.raises(ValueError, match="unknown extent"):
        _write_layer_sidecar(
            layer_id="slope_hazard",
            extent="60_90S",
            png_path=tmp_path / "layers" / "slope_hazard_60_90S.png",
            terrain_root=tmp_path,
            source=source,
            legend_stops=[],
            classification=None,
            method="test",
        )


def test_extent_lat_limit_deg_matches_the_two_contract_extents():
    assert EXTENT_LAT_LIMIT_DEG == {"80_90S": -80.0, "85_90S": -85.0}
