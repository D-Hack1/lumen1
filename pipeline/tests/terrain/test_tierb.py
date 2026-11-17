import json

import numpy as np
import pytest
from pyproj import CRS
from rasterio.transform import from_origin

from lumen_pipeline.terrain.dem_io import DemWindow
from lumen_pipeline.terrain.tierb import (
    MASK_SENTINEL,
    TierBError,
    TierBTile,
    TileSpec,
    _encode_mask,
    _tile_coordinates,
    estimated_crop_bytes,
    generate_tile,
    read_tile,
    write_index,
    write_tile,
)


def _dem() -> DemWindow:
    values = np.zeros((120, 120), dtype=np.float32)
    return DemWindow(
        elevation=values,
        valid=np.ones_like(values, dtype=bool),
        transform=from_origin(-1200, 1200, 20, 20),
        crs=CRS.from_proj4("+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400"),
        bounds=(-1200, -1200, 1200, 1200),
        resolution_m=(20.0, 20.0),
        source="synthetic-test-dem",
        provenance={"vertical_reference_applied": "height_relative", "unit_applied": "m"},
    )


def test_grid_alignment_row_order_and_seam_ownership():
    spec = TileSpec(0, 0, 2000)
    x, y, latitude, longitude = _tile_coordinates(spec)
    assert x.shape == y.shape == latitude.shape == longitude.shape == (100,)
    assert np.all(np.diff(x[:10]) == 2000)
    assert not np.all(x[:10] == x[0])
    assert np.all(y[:10] == y[0])
    assert np.all(latitude < -85.0)
    outer_x, outer_y, outer_latitude, _ = _tile_coordinates(TileSpec(160000, 0, 4000))
    assert outer_x.shape == outer_y.shape == outer_latitude.shape == (25,)
    assert np.all(np.diff(outer_x[:5]) == 4000)
    assert np.all(outer_y[:5] == outer_y[0])
    assert np.all(outer_latitude >= -85.0)
    with pytest.raises(TierBError, match="crosses"):
        _tile_coordinates(TileSpec(0, 140000, 2000))


def test_quantization_sentinel_and_overflow_rejection():
    encoded = _encode_mask(np.array([[-10.0, np.nan, 10.0]], dtype=np.float32))
    assert encoded.dtype.str == "<u2"
    assert encoded[0, 1] == MASK_SENTINEL
    with pytest.raises(TierBError, match="quantization"):
        _encode_mask(np.array([[700.0]], dtype=np.float32))


def test_tile_round_trip_layout_and_determinism(tmp_path):
    # Serialization uses synthetic values only; production generation requires a PGDA DEM window.
    spec = TileSpec(0, 0, 2000)
    _, _, latitude, longitude = _tile_coordinates(spec)
    mask = np.zeros((100, 720), dtype=np.float32)
    mask[0, :3] = [-10.0, np.nan, 0.0]
    tile = TierBTile(
        spec=spec,
        latitude_deg=latitude.astype(np.float32),
        longitude_deg=longitude.astype(np.float32),
        mask_deg=mask,
        slope_deg=np.arange(100, dtype=np.float32) * 0.01,
        downhill_aspect_deg=np.arange(100, dtype=np.float32) * 0.01,
        z0_m=-50.0 + np.arange(100, dtype=np.float32) * 0.25,
        d_min_m=60.0 + (np.arange(100, dtype=np.float32) % 2) * 30.0,
        provenance={"synthetic": True},
    )
    entry = write_tile(tile, tmp_path)
    write_index([entry], tmp_path)
    decoded = read_tile(entry, tmp_path)
    assert decoded["mask"].shape == (100, 720)
    assert decoded["mask"][0, :3].tolist() == [0, 65535, 1000]
    assert decoded["d_min_m"][:2].tolist() == [60.0, 90.0]
    assert decoded["slope_deg"][:2].tolist() == [0, 1]
    assert decoded["downhill_aspect_deg"][:2].tolist() == [0, 1]
    assert entry["sections"]["mask"]["offset"] == -10.0
    assert entry["sections"]["mask"]["unavailable_sentinel"] == 65535
    section_end = 0
    for section in entry["sections"].values():
        assert section["offset_bytes"] == section_end
        section_end += section["byte_length"]
    index = json.loads((tmp_path / "tierb" / "index.json").read_text())
    assert index["version"] == "0.1.0"
    assert "node_spacing_m" not in index and "d_min_m" not in index
    assert entry == write_tile(tile, tmp_path)


def test_invalid_dem_is_rejected():
    dem = _dem()
    dem.provenance["unit_applied"] = "km"
    with pytest.raises(TierBError, match="metre"):
        generate_tile(TileSpec(0, 0, 2000), dem, max_range_km=0.05)


def test_bounded_multires_crop_memory_estimate():
    spec = TileSpec(0, 0, 2000)
    # 20 m only to 5 km plus 240 m to 250 km stays below 40 MiB for source arrays.
    assert estimated_crop_bytes(spec, 20.0, 5.0) + estimated_crop_bytes(spec, 240.0, 250.0) < 40 * 1024**2
