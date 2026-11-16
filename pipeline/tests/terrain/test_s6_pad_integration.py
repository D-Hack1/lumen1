"""S-6 end-to-end pad integration: real site wiring, explicit unavailability."""

from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path

import numpy as np
import pytest
from pyproj import CRS, Transformer
from rasterio.transform import from_origin

from lumen_pipeline.terrain.dem_io import LUNAR_SPHERICAL_CRS, DemProduct, DemWindow, load_products

IM2_LATITUDE = -84.7906
IM2_LONGITUDE = 29.1957
CY3_LATITUDE = -69.373
CY3_LONGITUDE = 32.319


def _load_run_pad():
    path = Path(__file__).resolve().parents[2] / "scripts" / "run_pad.py"
    spec = importlib.util.spec_from_file_location("run_pad", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


run_pad = _load_run_pad()


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


def _dem(latitude: float, longitude: float, *, resolution_m: float = 5.0) -> DemWindow:
    crs = CRS.from_proj4(
        f"+proj=aeqd +lat_0={latitude} +lon_0={longitude} +R=1737400 +units=m +no_defs"
    )
    transformer = Transformer.from_crs(LUNAR_SPHERICAL_CRS, crs, always_xy=True)
    site_x, site_y = transformer.transform(longitude, latitude)
    bounds = (site_x - 300_000.0, site_y - 300_000.0, site_x + 300_000.0, site_y + 300_000.0)
    size = 31
    return DemWindow(
        elevation=np.zeros((size, size), dtype=np.float32),
        valid=np.ones((size, size), dtype=bool),
        transform=from_origin(
            site_x - size * resolution_m / 2.0,
            site_y + size * resolution_m / 2.0,
            resolution_m,
            resolution_m,
        ),
        crs=crs,
        bounds=bounds,
        resolution_m=(resolution_m, resolution_m),
        source="synthetic",
        provenance={"source_bounds": list(bounds), "synthetic": True},
    )


class _Reader:
    """Returns a synthetic DEM window matching the requested product's own
    resolution, so ``achieved_resolution_m`` reflects the selected source."""

    def __init__(self, latitude_deg: float, longitude_deg_east: float) -> None:
        self.latitude_deg = latitude_deg
        self.longitude_deg_east = longitude_deg_east

    def read_site_window(self, product, *, lon_deg, lat_deg, width_m, height_m):
        return _dem(
            self.latitude_deg,
            self.longitude_deg_east,
            resolution_m=product.resolution_m,
        )


def test_run_site_publishes_pad_statistics_for_im2_without_inventing_dispersion(tmp_path, monkeypatch):
    # With no configured defaults the dispersion statistics must stay explicitly unavailable.
    monkeypatch.setattr(run_pad, "_pad_defaults", dict)
    products = {
        "site_specific_5m_lola_pgda_78": _product("site_specific_5m_lola_pgda_78", 5.0, "80S-90S"),
    }
    reader = _Reader(IM2_LATITUDE, IM2_LONGITUDE)
    output_root = tmp_path / "terrain"

    run_pad.run_site(
        "im2_athena",
        reader=reader,
        products=products,
        output_root=output_root,
    )

    pad_path = output_root / "pad" / "im2_athena.json"
    assert pad_path.exists()
    record = json.loads(pad_path.read_text(encoding="utf-8"))

    # Contract 0.1.0 (contracts/data_terrain_misc.md §1.2 / web/src/engine/data/pad.ts).
    assert record["version"] == "0.1.0"
    assert record["producer"] == "lumen_pipeline.terrain.pad"
    assert record["site_id"] == "im2_athena"
    assert record["plane_fit"]["dem_source"] == "site_specific_5m_lola_pgda_78"
    assert record["near_field_resolution_m"] == 5.0
    assert record["d_min_m"] == pytest.approx(15.0)
    assert record["slope_deg"] == 0.0
    normal = record["ground_normal_me"]
    assert len(normal) == 3
    assert math.hypot(*normal) == pytest.approx(1.0)
    # Dispersion radius/tolerance are unresolved project defaults: never invented.
    assert record["dispersion_slope_stats"] == {
        "available": False,
        "reason": (
            "dispersion_radius_m and slope_tolerance_deg are unresolved project "
            "defaults (pad_statistics in pipeline/config/terrain.yaml); no value "
            "is invented"
        ),
    }

    summary_path = output_root / "summaries" / "im2_athena.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["pad_available"] is True
    assert summary["files_present"]["pad_json"] == "terrain/pad/im2_athena.json"
    # Aspect is degenerate on a perfectly flat plane; only slope is meaningful.
    assert summary["pad_headline"]["slope_deg"] == 0.0
    assert summary["pad_headline"]["under_resolved"] is None

    manifest = json.loads((output_root / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["artifacts"]["im2_athena"]["files"]["pad_json"]["path"] == (
        "terrain/pad/im2_athena.json"
    )


def test_run_site_reports_cy3_blocked_when_no_source_is_registered_at_all(tmp_path):
    """With neither the LROC DTM nor the 60 m LOLA fallback registered, CY-3
    stays explicitly blocked rather than fabricating a near-field source."""

    output_root = tmp_path / "terrain"
    reader = _Reader(CY3_LATITUDE, CY3_LONGITUDE)

    run_pad.run_site(
        "cy3_shiv_shakti",
        reader=reader,
        products={},
        output_root=output_root,
    )

    assert not (output_root / "pad" / "cy3_shiv_shakti.json").exists()

    summary_path = output_root / "summaries" / "cy3_shiv_shakti.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["pad_available"] is False
    assert summary["pad_headline"] is None
    assert summary["files_present"]["pad_json"] is None
    assert "near" in summary["unavailable"]
    assert "no verified source" in summary["unavailable"]["near"]


def test_run_site_publishes_cy3_pad_statistics_from_the_finest_verified_lola_fallback(tmp_path):
    """PLAN_FINAL §4.1 ladder item (2): once the real production registry is
    used, polar_60m_lola_pgda_90 (the finest verified LOLA product covering
    69.37°S) legitimately serves as CY-3's near-field source while the LROC
    DTM (item 1) remains unverified."""

    products = load_products()
    assert "chandrayaan3_lroc_vikramsite_dtm" not in products

    output_root = tmp_path / "terrain"
    reader = _Reader(CY3_LATITUDE, CY3_LONGITUDE)

    run_pad.run_site(
        "cy3_shiv_shakti",
        reader=reader,
        products=products,
        output_root=output_root,
    )

    pad_path = output_root / "pad" / "cy3_shiv_shakti.json"
    assert pad_path.exists()
    record = json.loads(pad_path.read_text(encoding="utf-8"))
    assert record["site_id"] == "cy3_shiv_shakti"
    assert record["plane_fit"]["dem_source"] == "polar_60m_lola_pgda_90"
    assert record["near_field_resolution_m"] == 60.0
    assert record["d_min_m"] == pytest.approx(180.0)

    summary_path = output_root / "summaries" / "cy3_shiv_shakti.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["pad_available"] is True
    assert summary["dem_source"] == "polar_60m_lola_pgda_90"
    assert "near" not in summary["unavailable"]


def test_run_site_uses_the_configured_pad_defaults_when_they_are_set(tmp_path):
    products = {
        "site_specific_5m_lola_pgda_78": _product("site_specific_5m_lola_pgda_78", 5.0, "80S-90S"),
    }
    defaults = run_pad._pad_defaults()
    assert defaults == {"dispersion_radius_m": 250.0, "slope_tolerance_deg": 10.0, "footprint_m": 5.5}
    run_pad.run_site("im2_athena", reader=_Reader(IM2_LATITUDE, IM2_LONGITUDE), products=products, output_root=tmp_path / "terrain")
    record = json.loads((tmp_path / "terrain" / "pad" / "im2_athena.json").read_text(encoding="utf-8"))
    stats = record["dispersion_slope_stats"]
    assert "available" not in stats  # present: the statistics themselves, not the "unavailable" marker
    assert stats["radius_m"] == 250.0
    assert stats["slope_tolerance_deg"] == 10.0
    assert {"p50", "p95", "max", "pct_below_tolerance", "sample_count"} <= set(stats)
