"""Focused S-5 site ladders and fail-closed production tests."""

from __future__ import annotations

import numpy as np
import pytest
from pyproj import CRS, Transformer
from rasterio.transform import from_origin

from lumen_pipeline.terrain.crops import (
    CropCoverageError,
    CropSpec,
    TerrainCrop,
    _crop_specs,
    build_crops,
)
from lumen_pipeline.terrain.dem_io import (
    LUNAR_SPHERICAL_CRS,
    DemProduct,
    DemWindow,
    load_products,
)
from lumen_pipeline.terrain.horizon import HorizonResult
from lumen_pipeline.terrain.masks import (
    _site,
    _site_coordinates,
    generate_tier_a_mask,
)

CY3_LATITUDE = -69.373
CY3_LONGITUDE = 32.319


def _product(key: str, resolution_m: float, coverage: str) -> DemProduct:
    return DemProduct(
        key=key,
        name=key,
        url=f"https://example.invalid/{key}.tif",
        resolution_m=resolution_m,
        latitude_coverage=coverage,
        unit="m",
        scale=1.0,
        offset=0.0,
        nodata=-9999.0,
        vertical_reference="height_relative",
        verification_status="source_page_and_urls_provided",
        metadata={"synthetic_test_product": True},
    )


def _dem(latitude: float = CY3_LATITUDE, longitude: float = CY3_LONGITUDE) -> DemWindow:
    crs = CRS.from_proj4(
        f"+proj=aeqd +lat_0={latitude} +lon_0={longitude} +R=1737400 +units=m +no_defs"
    )
    transformer = Transformer.from_crs(LUNAR_SPHERICAL_CRS, crs, always_xy=True)
    site_x, site_y = transformer.transform(longitude, latitude)
    bounds = (site_x - 300_000.0, site_y - 300_000.0, site_x + 300_000.0, site_y + 300_000.0)
    return DemWindow(
        elevation=np.zeros((101, 101), dtype=np.float32),
        valid=np.ones((101, 101), dtype=bool),
        transform=from_origin(site_x - 252.5, site_y + 252.5, 5.0, 5.0),
        crs=crs,
        bounds=bounds,
        resolution_m=(5.0, 5.0),
        source="synthetic",
        provenance={"source_bounds": list(bounds), "synthetic": True},
    )


class _Reader:
    def __init__(self, dem: DemWindow) -> None:
        self.dem = dem

    def read_site_window(self, product, *, lon_deg, lat_deg, width_m, height_m):
        return self.dem


def test_cy3_ladder_prefers_dedicated_then_mid_then_regional():
    """Use explicitly marked synthetic products; this does not verify production sources."""

    specs = _crop_specs("cy3_shiv_shakti")
    assert specs[0].source_keys == (
        "chandrayaan3_lroc_vikramsite_dtm",
        "polar_60m_lola_pgda_90",
        "regional_240m_lola_pgda_90",
    )
    assert specs[1].source_keys == (
        "polar_60m_lola_pgda_90",
        "regional_240m_lola_pgda_90",
    )
    assert specs[1].source_keys == (
        "polar_60m_lola_pgda_90",
        "regional_240m_lola_pgda_90",
    )

    products = {
        "chandrayaan3_lroc_vikramsite_dtm": _product(
            "chandrayaan3_lroc_vikramsite_dtm", 3.0, "60S-75S"
        ),
        "polar_60m_lola_pgda_90": _product("polar_60m_lola_pgda_90", 60.0, "60S-90S"),
        "regional_240m_lola_pgda_90": _product("regional_240m_lola_pgda_90", 240.0, "60S-90S"),
    }
    crops = build_crops(
        "cy3_shiv_shakti",
        latitude_deg=CY3_LATITUDE,
        longitude_deg_east=CY3_LONGITUDE,
        reader=_Reader(_dem()),
        products=products,
        allow_unavailable=False,
    )

    assert crops.near is not None
    assert crops.mid is not None
    assert crops.far is not None
    assert crops.near.source_key == "chandrayaan3_lroc_vikramsite_dtm"
    assert crops.mid.source_key == "polar_60m_lola_pgda_90"
    assert crops.far.source_key == "regional_240m_lola_pgda_90"
    assert all(crop.dem.provenance["synthetic"] for crop in (crops.near, crops.mid, crops.far))


def test_shackleton_ladder_prefers_ten_metre_near_source():
    """Synthetic products exercise the ladder; they do not verify production suitability."""

    specs = _crop_specs("shackleton_ridge")
    assert "polar_10m_lola_pgda_90" in specs[0].source_keys

    products = {
        "polar_10m_lola_pgda_90": _product("polar_10m_lola_pgda_90", 10.0, "83S-90S"),
        "polar_20m_lola_pgda_90": _product("polar_20m_lola_pgda_90", 20.0, "83S-90S"),
        "regional_240m_lola_pgda_90": _product("regional_240m_lola_pgda_90", 240.0, "60S-90S"),
    }
    crops = build_crops(
        "shackleton_ridge",
        latitude_deg=-89.54,
        longitude_deg_east=129.0,
        reader=_Reader(_dem(-89.54, 129.0)),
        products=products,
        allow_unavailable=False,
    )

    assert crops.near is not None
    assert crops.near.source_key == "polar_10m_lola_pgda_90"
    assert crops.mid is not None
    assert crops.mid.source_key == "polar_20m_lola_pgda_90"
    assert crops.far is not None
    assert crops.far.source_key == "regional_240m_lola_pgda_90"
    assert all(crop.dem.provenance["synthetic"] for crop in (crops.near, crops.mid, crops.far))


def test_cy3_ladder_falls_back_to_regional_240m_as_near_field_last_resort():
    """PLAN_FINAL §4.1 ladder item (3): the 240 m product is explicitly
    "guaranteed" as the CY-3 near-field fallback of last resort, selected
    only once both the DTM (item 1) and the 60 m source (item 2) are
    unavailable. It also serves mid/far as before."""

    products = {
        "regional_240m_lola_pgda_90": _product("regional_240m_lola_pgda_90", 240.0, "60S-90S")
    }
    crops = build_crops(
        "cy3_shiv_shakti",
        latitude_deg=CY3_LATITUDE,
        longitude_deg_east=CY3_LONGITUDE,
        reader=_Reader(_dem()),
        products=products,
        allow_unavailable=True,
    )

    assert crops.near is not None
    assert crops.near.source_key == "regional_240m_lola_pgda_90"
    assert crops.mid is not None
    assert crops.mid.source_key == "regional_240m_lola_pgda_90"
    assert crops.far is not None
    assert crops.far.source_key == "regional_240m_lola_pgda_90"


def test_cy3_ladder_near_field_exhausted_when_no_source_is_registered():
    """With none of the three ladder items registered, CY-3's near field
    stays explicitly unavailable rather than fabricating a source."""

    crops = build_crops(
        "cy3_shiv_shakti",
        latitude_deg=CY3_LATITUDE,
        longitude_deg_east=CY3_LONGITUDE,
        reader=_Reader(_dem()),
        products={},
        allow_unavailable=True,
    )

    assert crops.near is None
    assert "near" in crops.unavailable


def test_cy3_ladder_prefers_60m_over_240m_when_both_are_registered():
    """PLAN_FINAL §4.1 ladder item (2) outranks item (3): when both the 60 m
    and 240 m sources are verified and available, the finer 60 m source is
    selected for the near field, and the 240 m last resort is never reached."""

    products = {
        "polar_60m_lola_pgda_90": _product("polar_60m_lola_pgda_90", 60.0, "60S-90S"),
        "regional_240m_lola_pgda_90": _product("regional_240m_lola_pgda_90", 240.0, "60S-90S"),
    }
    crops = build_crops(
        "cy3_shiv_shakti",
        latitude_deg=CY3_LATITUDE,
        longitude_deg_east=CY3_LONGITUDE,
        reader=_Reader(_dem()),
        products=products,
        allow_unavailable=True,
    )

    assert crops.near is not None
    assert crops.near.source_key == "polar_60m_lola_pgda_90"


def test_registered_sites_use_authoritative_coordinates_and_no_invented_artemis_region_id():
    site = _site("cy3_shiv_shakti")
    assert _site_coordinates("cy3_shiv_shakti", site) == (CY3_LATITUDE, CY3_LONGITUDE)
    im2 = _site("im2_athena")
    assert im2["verification_status"] == "verified"
    assert im2["program"] == "CLPS IM-2"
    with pytest.raises(KeyError):
        _site("artemis_region")


def test_s4_partial_crop_mask_behavior_remains_default(monkeypatch, tmp_path):
    dem = _dem(-84.7906, 29.1957)
    crop = TerrainCrop(
        spec=CropSpec("near", 0.0, 5.0, ("synthetic_test_near",), 5.0),
        dem=dem,
        source_key="synthetic_test_near",
        source_resolution_m=5.0,
        source_url="https://example.invalid/synthetic_test_near.tif",
    )
    crops = type("Crops", (), {"near": crop, "mid": None, "far": None})()

    def fake_raycast(*args, **kwargs):
        return HorizonResult(
            np.zeros((4, 3600), dtype=np.float32),
            np.ones((4, 3600), dtype=np.float32),
            (np.arange(3600) + 0.5) * 0.1,
            (1.0, 2.0, 5.0, 10.0),
            0.1,
            15.0,
            250.0,
        )

    monkeypatch.setattr("lumen_pipeline.terrain.masks._git_commit", lambda: "a" * 40)
    monkeypatch.setattr("lumen_pipeline.terrain.masks.raycast_horizon", fake_raycast)
    artifact = generate_tier_a_mask(
        "im2_athena",
        crops,
        output_root=tmp_path / "terrain",
        geometric_growth_factor=1.5,
    )
    assert artifact.binary_path.exists()

    with pytest.raises(CropCoverageError, match="complete near/mid/far"):
        generate_tier_a_mask(
            "im2_athena",
            crops,
            output_root=tmp_path / "strict-terrain",
            geometric_growth_factor=1.5,
            require_complete_crops=True,
        )


def test_s5_shackleton_requires_complete_crops_by_default(monkeypatch, tmp_path):
    dem = _dem(-89.54, 129.0)
    crop = TerrainCrop(
        spec=CropSpec("near", 0.0, 5.0, ("synthetic_test_near",), 5.0),
        dem=dem,
        source_key="synthetic_test_near",
        source_resolution_m=5.0,
        source_url="https://example.invalid/synthetic_test_near.tif",
    )
    crops = type("Crops", (), {"near": crop, "mid": None, "far": None})()

    monkeypatch.setattr("lumen_pipeline.terrain.masks._git_commit", lambda: "a" * 40)

    with pytest.raises(CropCoverageError, match="complete near/mid/far"):
        generate_tier_a_mask(
            "shackleton_ridge",
            crops,
            output_root=tmp_path / "terrain",
            geometric_growth_factor=1.5,
        )


def test_production_dem_registry_blocks_unresolved_s5_sources():
    products = load_products()
    assert "chandrayaan3_lroc_vikramsite_dtm" not in products
    assert "chandrayaan3_lola_30m_pgda_90" not in products
    assert "regional_240m_lola_pgda_90" in products
    assert "polar_5m_lola_pgda_81" not in products


def test_s5_production_crops_remain_blocked_without_verified_sources():
    """Shackleton has no verified source yet; untouched by the CY-3 S-6 fix."""

    crops = build_crops(
        "shackleton_ridge",
        latitude_deg=-89.54,
        longitude_deg_east=129.0,
        reader=_Reader(_dem()),
        products=load_products(),
    )
    assert crops.near is None
    assert set(crops.unavailable) == {"near", "mid", "far"}


def test_s5_production_cy3_near_field_falls_back_to_the_finest_verified_lola_product():
    """PLAN_FINAL §4.1 ladder item (2): polar_60m_lola_pgda_90 is the finest
    verified LOLA product covering 69.37°S, so it is the legitimate near-field
    source while the LROC DTM (item 1) remains unverified."""

    products = load_products()
    assert "chandrayaan3_lroc_vikramsite_dtm" not in products

    crops = build_crops(
        "cy3_shiv_shakti",
        latitude_deg=CY3_LATITUDE,
        longitude_deg_east=CY3_LONGITUDE,
        reader=_Reader(_dem()),
        products=products,
    )
    assert "near" not in crops.unavailable
    assert crops.near is not None
    assert crops.near.source_key == "polar_60m_lola_pgda_90"
    assert crops.near.source_url == products["polar_60m_lola_pgda_90"].url
