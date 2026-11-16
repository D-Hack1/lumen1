# Owner: Shiva Shakthi
"""Shackleton production Tier-A integration tests for scripts/run_masks.py.

Network-independent: synthetic DEM crops are read through a fake DemReader,
exercising the same generate_tier_a_mask/write_terrain_summary pipeline used
for real sites. Covers the normal (complete-crop) path, the explicit
incomplete-crop block, and the unresolved-config-value guard."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import numpy as np
import pytest
from pyproj import CRS, Transformer
from rasterio.transform import from_origin

from lumen_pipeline.terrain.dem_io import LUNAR_SPHERICAL_CRS, DemProduct, DemWindow
from lumen_pipeline.terrain.horizon import HorizonResult

SHACKLETON_LATITUDE = -89.54
SHACKLETON_LONGITUDE = 129.0


def _load_run_masks():
    path = Path(__file__).resolve().parents[2] / "scripts" / "run_masks.py"
    spec = importlib.util.spec_from_file_location("run_masks", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


run_masks = _load_run_masks()


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


def _dem(*, resolution_m: float, half_width_px: int = 60) -> DemWindow:
    size = 2 * half_width_px
    crs = CRS.from_proj4(
        f"+proj=aeqd +lat_0={SHACKLETON_LATITUDE} +lon_0={SHACKLETON_LONGITUDE} "
        "+R=1737400 +units=m +no_defs"
    )
    transformer = Transformer.from_crs(LUNAR_SPHERICAL_CRS, crs, always_xy=True)
    site_x, site_y = transformer.transform(SHACKLETON_LONGITUDE, SHACKLETON_LATITUDE)
    bounds = (
        site_x - 300_000.0,
        site_y - 300_000.0,
        site_x + 300_000.0,
        site_y + 300_000.0,
    )
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
    """Fake DemReader: returns a synthetic DEM sized to the requested
    product's own resolution, optionally failing for named products to
    simulate an unavailable crop."""

    def __init__(self, *, fail_products: frozenset[str] = frozenset()) -> None:
        self.fail_products = fail_products

    def read_site_window(self, product, *, lon_deg, lat_deg, width_m, height_m):
        if product.key in self.fail_products:
            raise OSError(f"synthetic failure for {product.key}")
        return _dem(resolution_m=product.resolution_m)


def _products() -> dict[str, DemProduct]:
    return {
        "polar_10m_lola_pgda_90": _product("polar_10m_lola_pgda_90", 10.0, "83S-90S"),
        "polar_20m_lola_pgda_90": _product("polar_20m_lola_pgda_90", 20.0, "83S-90S"),
        "regional_240m_lola_pgda_90": _product("regional_240m_lola_pgda_90", 240.0, "60S-90S"),
    }


def _fake_raycast(*args, **kwargs) -> HorizonResult:
    """Stand in for the real raycaster (same technique as
    test_s4_terrain.py's test_mask_header_payload_metadata_and_summary):
    a full 250 km march at near-field resolution is prohibitively
    expensive to run for real against a synthetic DEM in a unit test, and
    this script's own wiring -- not the raycaster's numerics -- is what
    this test covers."""

    elevation = np.full((4, 3600), -1.0, dtype=np.float32)
    distance = np.full((4, 3600), 10.0, dtype=np.float32)
    return HorizonResult(
        elevation,
        distance,
        (np.arange(3600) + 0.5) * 0.1,
        (1.0, 2.0, 5.0, 10.0),
        0.1,
        15.0,
        250.0,
    )


def test_run_site_publishes_shackleton_mask_when_all_three_crops_are_available(
    tmp_path, monkeypatch
):
    monkeypatch.setattr("lumen_pipeline.terrain.masks._git_commit", lambda: "a" * 40)
    monkeypatch.setattr("lumen_pipeline.terrain.summaries._git_commit", lambda: "a" * 40)
    monkeypatch.setattr("lumen_pipeline.terrain.masks.raycast_horizon", _fake_raycast)
    output_root = tmp_path / "terrain"

    products = _products()
    reader = _Reader()
    run_masks.run_site(
        "shackleton_ridge",
        reader=reader,
        products=products,
        growth_factor=1.5,
        output_root=output_root,
    )

    mask_path = output_root / "masks" / "shackleton_ridge.bin"
    assert mask_path.exists()
    assert mask_path.stat().st_size == 115264

    summary_path = output_root / "summaries" / "shackleton_ridge.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["mask_available"] is True
    assert summary["tier"] == "Tier A"


def test_run_site_reports_blocked_when_mid_or_far_crop_is_unavailable(tmp_path, monkeypatch):
    """Mirrors the real, observed PGDA rate-limit failure mode: near
    succeeds, mid fails -- Shackleton must stay explicitly blocked (it
    requires complete near/mid/far coverage), not published with a
    substituted or partial crop."""

    monkeypatch.setattr("lumen_pipeline.terrain.masks._git_commit", lambda: "b" * 40)
    monkeypatch.setattr("lumen_pipeline.terrain.summaries._git_commit", lambda: "b" * 40)
    output_root = tmp_path / "terrain"

    products = _products()
    reader = _Reader(fail_products=frozenset({"polar_20m_lola_pgda_90"}))
    run_masks.run_site(
        "shackleton_ridge",
        reader=reader,
        products=products,
        growth_factor=1.5,
        output_root=output_root,
    )

    assert not (output_root / "masks" / "shackleton_ridge.bin").exists()
    summary_path = output_root / "summaries" / "shackleton_ridge.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["mask_available"] is False
    assert "mid" in summary["unavailable"]


def test_geometric_growth_factor_is_read_from_config_not_hardcoded():
    assert run_masks._geometric_growth_factor() == pytest.approx(1.5)


def test_geometric_growth_factor_refuses_to_invent_a_value_when_unset(tmp_path):
    bad_config = tmp_path / "terrain.yaml"
    bad_config.write_text("tier_a:\n  raycaster: {}\n", encoding="utf-8")
    with pytest.raises(RuntimeError, match="geometric_growth_factor"):
        run_masks._geometric_growth_factor(bad_config)
