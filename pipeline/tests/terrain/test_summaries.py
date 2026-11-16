# Owner: Shiva Shakthi
"""write_terrain_summary cross-call preservation.

Each pipeline stage (run_pad.py, run_masks.py, a future sigma/dispersion
stage) calls write_terrain_summary independently and only knows about its
own artifact. Without carrying forward whatever a previous stage already
recorded for files_present/pad_headline/psr and the manifest's per-site
files, a later stage's call would silently erase the earlier stage's
record for the same site -- e.g. running run_masks.py after run_pad.py
would drop the site's pad_json entry. These tests cover that directly."""

from __future__ import annotations

import json
from pathlib import Path

from lumen_pipeline.terrain.masks import MaskArtifact
from lumen_pipeline.terrain.summaries import write_terrain_summary

SITE_ID = "test_site"


def _crops(unavailable: dict | None = None):
    return type(
        "Crops",
        (),
        {
            "near": None,
            "mid": None,
            "far": None,
            "unavailable": unavailable or {},
            "near_field_resolution_m": None,
        },
    )()


def _mask_artifact(output_root) -> MaskArtifact:
    masks_dir = output_root / "masks"
    masks_dir.mkdir(parents=True, exist_ok=True)
    binary_path = masks_dir / "mask.bin"
    sidecar_path = masks_dir / "mask.json"
    binary_path.write_bytes(b"\x00" * 115264)
    sidecar_path.write_text(json.dumps({"version": "1.0.0"}), encoding="utf-8")
    return MaskArtifact(
        elevation_deg=None,
        distance_km=None,
        metadata={"version": "1.0.0"},
        binary_path=binary_path,
        sidecar_path=sidecar_path,
    )


def _pad_json(output_root) -> Path:
    pad_dir = output_root / "pad"
    pad_dir.mkdir(parents=True, exist_ok=True)
    pad_path = pad_dir / "pad.json"
    pad_path.write_text(json.dumps({"version": "1.0.0"}), encoding="utf-8")
    return pad_path


def test_mask_call_preserves_an_earlier_pad_record(tmp_path):
    output_root = tmp_path / "terrain"
    pad_json_path = _pad_json(output_root)

    write_terrain_summary(
        SITE_ID,
        _crops(),
        pad_headline={"slope_deg": 5.0},
        pad_json_path=pad_json_path,
        output_root=output_root,
    )

    artifact = _mask_artifact(output_root)
    summary_path = write_terrain_summary(
        SITE_ID,
        _crops(),
        mask=artifact,
        output_root=output_root,
    )

    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["mask_available"] is True
    assert summary["pad_available"] is True
    assert summary["pad_headline"] == {"slope_deg": 5.0}
    assert summary["files_present"]["pad_json"] is not None
    assert summary["files_present"]["mask_bin"] is not None

    manifest = json.loads((output_root / "manifest.json").read_text(encoding="utf-8"))
    entry_files = manifest["artifacts"][SITE_ID]["files"]
    assert "pad_json" in entry_files
    assert "mask_bin" in entry_files
    assert "mask_json" in entry_files


def test_pad_call_preserves_an_earlier_mask_record(tmp_path):
    output_root = tmp_path / "terrain"
    artifact = _mask_artifact(output_root)
    write_terrain_summary(SITE_ID, _crops(), mask=artifact, output_root=output_root)

    pad_json_path = _pad_json(output_root)
    summary_path = write_terrain_summary(
        SITE_ID,
        _crops(),
        pad_headline={"slope_deg": 7.5},
        pad_json_path=pad_json_path,
        output_root=output_root,
    )

    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["mask_available"] is True
    assert summary["pad_available"] is True
    assert summary["files_present"]["mask_bin"] is not None
    assert summary["tier"] == "Tier A"

    manifest = json.loads((output_root / "manifest.json").read_text(encoding="utf-8"))
    entry_files = manifest["artifacts"][SITE_ID]["files"]
    assert "mask_bin" in entry_files
    assert "mask_json" in entry_files
    assert "pad_json" in entry_files


def test_psr_is_preserved_across_an_unrelated_later_call(tmp_path):
    output_root = tmp_path / "terrain"
    write_terrain_summary(
        SITE_ID,
        _crops(),
        psr={"status": "available"},
        output_root=output_root,
    )

    artifact = _mask_artifact(output_root)
    summary_path = write_terrain_summary(
        SITE_ID,
        _crops(),
        mask=artifact,
        output_root=output_root,
    )

    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["psr"] == {"status": "available"}


def test_an_unavailable_mask_leaves_tier_pending_even_with_prior_pad(tmp_path):
    """A later blocked-mask call (no mask passed) must not resurrect a
    stale "Tier A" claim just because an earlier pad call recorded one;
    tier here should reflect only whether a mask is actually present."""

    output_root = tmp_path / "terrain"
    pad_json_path = _pad_json(output_root)
    write_terrain_summary(
        SITE_ID,
        _crops(),
        pad_headline={"slope_deg": 5.0},
        pad_json_path=pad_json_path,
        output_root=output_root,
    )

    summary_path = write_terrain_summary(
        SITE_ID,
        _crops(unavailable={"mid": "blocked"}),
        output_root=output_root,
    )

    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["mask_available"] is False
    assert summary["tier"] == "pending"
    # the pad record from the earlier call must still survive
    assert summary["pad_available"] is True
    assert summary["unavailable"] == {"mid": "blocked"}
