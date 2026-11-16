"""Retained per-site terrain summaries and manifest updates."""

from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .crops import TerrainCrops
from .masks import MaskArtifact


def _git_commit() -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return result.stdout.strip() or None


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _served_path(path: Path, terrain_root: Path) -> str:
    return f"terrain/{path.relative_to(terrain_root).as_posix()}"


def _source_manifest(crop: Any) -> dict[str, Any]:
    provenance = crop.dem.provenance
    cache_key = provenance.get("cache_key")
    cache_manifest = Path(__file__).resolve().parents[2] / "cache" / "dem" / f"{cache_key}.json"
    cache_sha256 = None
    if isinstance(cache_key, str) and cache_manifest.is_file():
        cached = json.loads(cache_manifest.read_text(encoding="utf-8"))
        cache_sha256 = cached.get("sha256")
    return {
        "source_key": crop.source_key,
        "source_url": crop.source_url,
        "shape": list(crop.dem.elevation.shape),
        "resolution_m": list(crop.dem.resolution_m),
        "crs": provenance.get("source_crs"),
        "frame": provenance.get("frame"),
        "vertical_reference": provenance.get("vertical_reference"),
        "datum_reference": provenance.get("datum_reference"),
        "cache_key": cache_key,
        "cache_sha256": cache_sha256,
    }


def write_terrain_summary(
    site_id: str,
    crops: TerrainCrops,
    *,
    mask: MaskArtifact | None = None,
    output_root: Path | None = None,
    tier: str = "Tier A",
    pad_headline: dict[str, Any] | None = None,
    pad_json_path: Path | None = None,
    psr: dict[str, Any] | None = None,
) -> Path:
    """Write one actual-output summary, preserving prior manifest entries and
    prior artifact references for this same site that this call does not
    itself touch.

    Each pipeline stage (mask, pad, sigma, ...) calls this independently and
    only knows about its own artifact. Without carrying forward whatever a
    previous stage already recorded, a later stage's call would silently
    erase the earlier stage's files_present/manifest entries (e.g. running
    run_masks.py after run_pad.py would drop the site's pad_json record).
    """

    terrain_root = (
        Path(output_root)
        if output_root is not None
        else Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "terrain"
    )
    timestamp = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    git_commit = _git_commit()

    summary_path = terrain_root / "summaries" / f"{site_id}.json"
    previous_summary: dict[str, Any] = {}
    if summary_path.is_file():
        loaded = json.loads(summary_path.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            previous_summary = loaded
    previous_files_present = previous_summary.get("files_present")
    if not isinstance(previous_files_present, dict):
        previous_files_present = {}

    files_present = {
        "mask_bin": (
            _served_path(mask.binary_path, terrain_root)
            if mask
            else previous_files_present.get("mask_bin")
        ),
        "mask_json": (
            _served_path(mask.sidecar_path, terrain_root)
            if mask
            else previous_files_present.get("mask_json")
        ),
        "sigma_bin": previous_files_present.get("sigma_bin"),
        "sigma_json": previous_files_present.get("sigma_json"),
        "pad_json": (
            _served_path(pad_json_path, terrain_root)
            if pad_json_path
            else previous_files_present.get("pad_json")
        ),
        "dispersion_bin": previous_files_present.get("dispersion_bin"),
        "dispersion_json": previous_files_present.get("dispersion_json"),
    }
    mask_available = files_present["mask_bin"] is not None
    resolved_pad_headline = (
        pad_headline if pad_headline is not None else previous_summary.get("pad_headline")
    )
    resolved_psr = psr if psr is not None else previous_summary.get("psr")
    summary = {
        "version": "0.1.0",
        "site_id": site_id,
        "run_timestamp_utc": timestamp,
        "git_commit": git_commit,
        "tier": tier if mask_available else "pending",
        "near_field_res_m": (crops.near_field_resolution_m if crops.near is not None else None),
        "dem_source": crops.near.source_key if crops.near is not None else None,
        "files_present": files_present,
        "mask_available": mask_available,
        "sigma_available": files_present["sigma_bin"] is not None,
        "pad_available": resolved_pad_headline is not None,
        "dispersion_available": files_present["dispersion_bin"] is not None,
        "pad_headline": resolved_pad_headline,
        "psr": resolved_psr,
        "unavailable": dict(crops.unavailable),
    }
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    manifest_path = terrain_root / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict):
            raise ValueError("terrain manifest must contain a JSON object")
    else:
        manifest = {}
    artifacts = manifest.setdefault("artifacts", {})
    if not isinstance(artifacts, dict):
        raise TypeError("terrain manifest artifacts must be an object")
    previous_entry = artifacts.get(site_id)
    previous_files = previous_entry.get("files") if isinstance(previous_entry, dict) else None
    entry: dict[str, Any] = {
        "version": "1.0.0",
        "site_id": site_id,
        "created_utc": timestamp,
        "git_commit": git_commit,
        "files": dict(previous_files) if isinstance(previous_files, dict) else {},
    }
    if mask is not None:
        entry["files"].update(
            {
                "mask_bin": {
                    "path": files_present["mask_bin"],
                    "version": mask.metadata["version"],
                    "sha256": _sha256(mask.binary_path),
                },
                "mask_json": {
                    "path": files_present["mask_json"],
                    "version": mask.metadata["version"],
                    "sha256": _sha256(mask.sidecar_path),
                },
            }
        )
    if pad_json_path is not None:
        entry["files"]["pad_json"] = {
            "path": files_present["pad_json"],
            "version": json.loads(Path(pad_json_path).read_text(encoding="utf-8"))["version"],
            "sha256": _sha256(Path(pad_json_path)),
        }
    entry["sources"] = {
        name: _source_manifest(crop)
        for name, crop in (("near", crops.near), ("mid", crops.mid), ("far", crops.far))
        if crop is not None
    }
    artifacts[site_id] = entry
    manifest["version"] = manifest.get("version", "0.1.0")
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return summary_path
