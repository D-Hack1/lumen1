# Owner: Shiva Shakthi
"""S-7 layers.json <-> frontend loader contract (web/src/engine/data/layers.ts).

The frontend's RawProjection interface requires five fields on every
layer's `projection` object: size_px, centre_px, lat_limit_deg,
half_extent_km, metres_per_px. These were missing from the committed
index; this file both validates the real, committed
web/public/data/terrain/layers.json end-to-end, and exercises the
general validation rules against synthetic fixtures (missing fields,
missing data files, all-unavailable indexes) that are impractical to
set up against the real, network-backed generators."""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

TERRAIN_ROOT = Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "terrain"
LAYERS_JSON = TERRAIN_ROOT / "layers.json"

REQUIRED_PROJECTION_FIELDS = (
    "size_px",
    "centre_px",
    "lat_limit_deg",
    "half_extent_km",
    "metres_per_px",
)


def _validate_entry_for_frontend(entry: dict, *, terrain_root: Path) -> list[str]:
    """Mirror, as a test-only check, the minimum the frontend loader
    (layers.ts RawProjection) actually requires of one available entry.
    Returns a list of problems; empty means the entry is frontend-ready."""

    problems: list[str] = []
    filename = entry.get("filename")
    if not filename:
        return ["no filename"]
    png_path = terrain_root / filename
    if not png_path.is_file():
        problems.append(f"data file does not exist: {png_path}")

    projection = entry.get("projection")
    if not isinstance(projection, dict):
        return problems + ["no projection object"]

    missing = [f for f in REQUIRED_PROJECTION_FIELDS if f not in projection]
    if missing:
        problems.append(f"missing projection fields: {', '.join(missing)}")
        return problems  # further checks would be meaningless

    size_px = projection["size_px"]
    if (
        not isinstance(size_px, list)
        or len(size_px) != 2
        or any(not isinstance(v, int) or v <= 0 for v in size_px)
    ):
        problems.append(f"size_px must be two positive integers, got {size_px!r}")

    centre_px = projection["centre_px"]
    if (
        not isinstance(centre_px, list)
        or len(centre_px) != 2
        or any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in centre_px)
    ):
        problems.append(f"centre_px must be two finite numbers, got {centre_px!r}")
    elif isinstance(size_px, list) and len(size_px) == 2:
        height_px, width_px = size_px
        if centre_px != [width_px / 2.0, height_px / 2.0]:
            problems.append(
                f"centre_px {centre_px} is not the pixel-edge centre of size_px {size_px}"
            )

    lat_limit_deg = projection["lat_limit_deg"]
    if not isinstance(lat_limit_deg, (int, float)) or not math.isfinite(lat_limit_deg):
        problems.append(f"lat_limit_deg must be a finite number, got {lat_limit_deg!r}")
    elif lat_limit_deg not in (-80.0, -85.0):
        problems.append(
            f"lat_limit_deg must be one of the two contract extents, got {lat_limit_deg}"
        )

    half_extent_km = projection["half_extent_km"]
    if (
        not isinstance(half_extent_km, (int, float))
        or not math.isfinite(half_extent_km)
        or half_extent_km <= 0.0
    ):
        problems.append(f"half_extent_km must be a finite positive number, got {half_extent_km!r}")

    metres_per_px = projection["metres_per_px"]
    if (
        not isinstance(metres_per_px, (int, float))
        or not math.isfinite(metres_per_px)
        or metres_per_px <= 0.0
    ):
        problems.append(f"metres_per_px must be a finite positive number, got {metres_per_px!r}")

    return problems


# ---------------------------------------------------------------------------
# The real, committed index
# ---------------------------------------------------------------------------


def _load_real_index() -> dict:
    return json.loads(LAYERS_JSON.read_text(encoding="utf-8"))


def test_real_layers_json_has_eight_entries():
    index = _load_real_index()
    assert len(index["layers"]) == 8


@pytest.mark.parametrize(
    "layer_key",
    [
        ("slope_hazard", "80_90S"),
        ("average_illumination", "80_90S"),
        ("earth_visibility", "80_90S"),
        ("slope_hazard", "85_90S"),
        ("average_illumination", "85_90S"),
        ("earth_visibility", "85_90S"),
        ("psr", "80_90S"),
        ("psr", "85_90S"),
    ],
)
def test_real_layers_json_entry_is_frontend_ready(layer_key):
    layer_id, extent = layer_key
    index = _load_real_index()
    entry = next(e for e in index["layers"] if e["layer_id"] == layer_id and e["extent"] == extent)
    problems = _validate_entry_for_frontend(entry, terrain_root=TERRAIN_ROOT)
    assert problems == [], f"{layer_id}:{extent} is not frontend-ready: {problems}"


def test_real_layers_json_entries_are_not_assumed_identical_across_an_extent():
    """slope_hazard_85_90S.png is a different, coarser native raster than
    its siblings at the same extent -- the fix must not have hard-coded one
    size/resolution for all of 85_90S."""

    index = _load_real_index()
    by_key = {(e["layer_id"], e["extent"]): e for e in index["layers"]}
    slope_85 = by_key[("slope_hazard", "85_90S")]["projection"]
    illum_85 = by_key[("average_illumination", "85_90S")]["projection"]
    assert slope_85["size_px"] != illum_85["size_px"]
    assert slope_85["metres_per_px"] != illum_85["metres_per_px"]
    # but the shared extent radius must still agree
    assert slope_85["half_extent_km"] == pytest.approx(illum_85["half_extent_km"])
    assert slope_85["lat_limit_deg"] == illum_85["lat_limit_deg"]


def test_real_layers_json_85_90s_has_smaller_half_extent_than_80_90s():
    index = _load_real_index()
    by_extent = {e["extent"]: e["projection"]["half_extent_km"] for e in index["layers"]}
    assert by_extent["85_90S"] < by_extent["80_90S"]


# ---------------------------------------------------------------------------
# Synthetic fixtures: missing/incomplete metadata, missing files,
# available:false, all-unavailable -- impractical to produce from the real,
# network-backed generators.
# ---------------------------------------------------------------------------


def test_entry_with_no_projection_object_is_rejected(tmp_path):
    (tmp_path / "layers").mkdir()
    (tmp_path / "layers" / "x.png").write_bytes(b"\x00")
    entry = {"layer_id": "x", "extent": "80_90S", "filename": "layers/x.png"}
    problems = _validate_entry_for_frontend(entry, terrain_root=tmp_path)
    assert problems == ["no projection object"]


def test_entry_missing_some_projection_fields_is_rejected():
    entry = {
        "layer_id": "x",
        "extent": "80_90S",
        "filename": "layers/slope_hazard_80_90S.png",
        "projection": {"size_px": [10, 10], "centre_px": [5.0, 5.0]},
    }
    problems = _validate_entry_for_frontend(entry, terrain_root=TERRAIN_ROOT)
    assert len(problems) == 1
    assert "lat_limit_deg" in problems[0]
    assert "half_extent_km" in problems[0]
    assert "metres_per_px" in problems[0]


def test_entry_with_missing_data_file_is_rejected(tmp_path):
    entry = {
        "layer_id": "x",
        "extent": "80_90S",
        "filename": "layers/does_not_exist.png",
        "projection": {
            "size_px": [10, 10],
            "centre_px": [5.0, 5.0],
            "lat_limit_deg": -80.0,
            "half_extent_km": 304.0,
            "metres_per_px": 240.0,
        },
    }
    problems = _validate_entry_for_frontend(entry, terrain_root=tmp_path)
    assert any("does not exist" in p for p in problems)


def test_entry_with_mismatched_centre_px_is_rejected(tmp_path):
    (tmp_path / "layers").mkdir()
    (tmp_path / "layers" / "x.png").write_bytes(b"\x00")
    entry = {
        "layer_id": "x",
        "extent": "80_90S",
        "filename": "layers/x.png",
        "projection": {
            "size_px": [2534, 2534],
            "centre_px": [0.0, 0.0],  # wrong: should be [1267.0, 1267.0]
            "lat_limit_deg": -80.0,
            "half_extent_km": 304.0,
            "metres_per_px": 240.0,
        },
    }
    problems = _validate_entry_for_frontend(entry, terrain_root=tmp_path)
    assert any("not the pixel-edge centre" in p for p in problems)


def test_entry_with_non_contract_lat_limit_is_rejected(tmp_path):
    (tmp_path / "layers").mkdir()
    (tmp_path / "layers" / "x.png").write_bytes(b"\x00")
    entry = {
        "layer_id": "x",
        "extent": "90_90S",
        "filename": "layers/x.png",
        "projection": {
            "size_px": [10, 10],
            "centre_px": [5.0, 5.0],
            "lat_limit_deg": -90.0,  # not one of the two contract extents
            "half_extent_km": 304.0,
            "metres_per_px": 240.0,
        },
    }
    problems = _validate_entry_for_frontend(entry, terrain_root=tmp_path)
    assert any("contract extent" in p for p in problems)


def test_available_false_entry_is_never_treated_as_frontend_ready():
    """unavailable_layer_entry()'s own shape (available=False, no filename,
    no projection) must fail the same frontend-readiness check, not be
    silently accepted as an empty-but-valid entry."""

    from lumen_pipeline.terrain.layers import unavailable_layer_entry

    entry = unavailable_layer_entry("psr", "80_90S", reason="verified PSR raster is unavailable")
    assert entry["available"] is False
    problems = _validate_entry_for_frontend(entry, terrain_root=TERRAIN_ROOT)
    assert problems == ["no filename"]


def test_all_layers_unavailable_index_has_zero_frontend_ready_entries():
    from lumen_pipeline.terrain.layers import EXTENTS, LAYER_IDS, unavailable_layer_entry

    entries = [
        unavailable_layer_entry(layer_id, extent, reason="source unavailable")
        for layer_id in LAYER_IDS
        for extent in EXTENTS
    ]
    ready = [e for e in entries if not _validate_entry_for_frontend(e, terrain_root=TERRAIN_ROOT)]
    assert ready == []
    assert all(e["available"] is False for e in entries)
