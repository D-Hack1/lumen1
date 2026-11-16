# Owner: Shiva Shakthi
# Monte-Carlo DEM clones -> per-bin sigma.
"""Sigma artifact: binary header/schema and validated serialization.

This module implements the LUMENSGM binary header, sidecar schema, and
publication validation exactly as specified in
``contracts/data_masks.md`` §4, §8 and §10 (byte-exact header layout,
NaN-matches-mask-validity rule, and the `source` field's three required
states).

What this module does **not** implement: the actual Monte-Carlo clone
generation (20-30 DEM clones with spatially correlated noise scaled by the
`_ERR` raster, re-running the full horizon raycaster per clone, per
``contracts/data_terrain_misc.md`` §3 and PLAN_FINAL P9). That requires
specification decisions that are not resolved anywhere in the contracts or
``pipeline/config/terrain.yaml`` (`clone_count` is explicitly `null`
there, and no spatial-correlation length/model is specified for the
synthetic noise), so no clone-based sigma is computed here -- doing so
would mean inventing those parameters. ``write_sigma`` instead publishes
whatever already-computed sigma array a caller supplies (e.g. the Tier-A
default sigma, 0.1 degrees per PLAN_FINAL §4.2, for every valid mask
sample), fully validated against the contract.
"""

from __future__ import annotations

import json
import math
import re
import struct
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

HEIGHTS_M = (1.0, 2.0, 5.0, 10.0)
AZIMUTH_COUNT = 3600
BIN_WIDTH_DEG = 0.1
RAY_RANGE_KM = 250.0
DISTANCE_SCALE_KM = 1.0
SIGMA_PAYLOAD_LENGTH = len(HEIGHTS_M) * AZIMUTH_COUNT * 4  # float32, 57600 bytes
HEADER_SIZE = 64
HEADER_STRUCT = "<8sHHIIfffIIIIIIQ"

_VALID_SOURCES = ("default", "monte_carlo", "calibrated")
_CONTRACT_SIDECAR_FIELDS = frozenset(
    {
        "version",
        "producer",
        "created_utc",
        "git_commit",
        "site_id",
        "shape",
        "height_order_m",
        "bin_width_deg",
        "ray_range_km",
        "unit",
        "source",
        "binary",
        "clone_count",
        "notes",
    }
)


class SigmaValidationError(ValueError):
    """Raised when a sigma array or its metadata fails contract §8/§10."""


def _sigma_header() -> bytes:
    return struct.pack(
        HEADER_STRUCT,
        b"LUMENSGM",
        1,
        HEADER_SIZE,
        len(HEIGHTS_M),
        AZIMUTH_COUNT,
        BIN_WIDTH_DEG,
        RAY_RANGE_KM,
        DISTANCE_SCALE_KM,
        HEADER_SIZE,  # sigma payload offset
        0,  # distance offset (sigma has no distance payload)
        SIGMA_PAYLOAD_LENGTH,  # sigma payload length
        0,  # distance length
        0,  # reserved
        0,  # reserved
        0,  # reserved
    )


def _validate_sigma_header(payload: bytes) -> None:
    """Contract §10.1-2: decode and check magic, version, byte order,
    offsets, lengths, dimensions, and zero reserved fields."""

    if len(payload) < HEADER_SIZE:
        raise SigmaValidationError("sigma file is shorter than the 64-byte header")
    fields = struct.unpack(HEADER_STRUCT, payload[:HEADER_SIZE])
    (
        magic,
        version,
        header_size,
        height_count,
        azimuth_count,
        bin_width_deg,
        ray_range_km,
        distance_scale_km,
        sigma_offset,
        distance_offset,
        sigma_length,
        distance_length,
        reserved_1,
        reserved_2,
        reserved_3,
    ) = fields
    if magic != b"LUMENSGM":
        raise SigmaValidationError(f"unexpected sigma magic: {magic!r}")
    if version != 1:
        raise SigmaValidationError(f"unsupported sigma format version: {version}")
    if header_size != HEADER_SIZE:
        raise SigmaValidationError(f"unexpected sigma header size: {header_size}")
    if height_count != len(HEIGHTS_M) or azimuth_count != AZIMUTH_COUNT:
        raise SigmaValidationError(
            f"unexpected sigma dimensions: height_count={height_count}, "
            f"azimuth_count={azimuth_count}"
        )
    if not math.isclose(bin_width_deg, BIN_WIDTH_DEG, rel_tol=0.0, abs_tol=1e-6):
        raise SigmaValidationError(f"unexpected sigma bin_width_deg: {bin_width_deg}")
    if not math.isclose(ray_range_km, RAY_RANGE_KM, rel_tol=0.0, abs_tol=1e-6):
        raise SigmaValidationError(f"unexpected sigma ray_range_km: {ray_range_km}")
    if not math.isclose(distance_scale_km, DISTANCE_SCALE_KM, rel_tol=0.0, abs_tol=1e-6):
        raise SigmaValidationError(f"unexpected sigma distance_scale_km: {distance_scale_km}")
    if sigma_offset != HEADER_SIZE:
        raise SigmaValidationError(f"unexpected sigma payload offset: {sigma_offset}")
    if sigma_length != SIGMA_PAYLOAD_LENGTH:
        raise SigmaValidationError(f"unexpected sigma payload length: {sigma_length}")
    # Contract §8 / §10.2: the sigma header's distance offset and distance
    # length must both be zero -- sigma carries no distance payload.
    if distance_offset != 0:
        raise SigmaValidationError(f"sigma distance offset must be zero, got {distance_offset}")
    if distance_length != 0:
        raise SigmaValidationError(f"sigma distance length must be zero, got {distance_length}")
    if (reserved_1, reserved_2, reserved_3) != (0, 0, 0):
        raise SigmaValidationError("sigma header reserved fields must be zero")
    if len(payload) != HEADER_SIZE + SIGMA_PAYLOAD_LENGTH:
        raise SigmaValidationError(
            f"unexpected sigma file length: {len(payload)}, "
            f"expected {HEADER_SIZE + SIGMA_PAYLOAD_LENGTH}"
        )


def validate_sigma_array(sigma: np.ndarray, mask_valid: np.ndarray) -> None:
    """Contract §8 / §10.6: shape (4, 3600); finite and non-negative for
    every valid mask sample; NaN for every unavailable mask sample. Never
    silently convert NaN to zero, and never silently clamp a mismatch."""

    expected_shape = (len(HEIGHTS_M), AZIMUTH_COUNT)
    if sigma.shape != expected_shape:
        raise SigmaValidationError(f"sigma shape must be {expected_shape}, got {sigma.shape}")
    if mask_valid.shape != expected_shape:
        raise SigmaValidationError(
            f"mask_valid shape must be {expected_shape}, got {mask_valid.shape}"
        )
    sigma_values = np.asarray(sigma, dtype=np.float64)
    finite = np.isfinite(sigma_values)
    if np.any(finite & (sigma_values < 0.0)):
        raise SigmaValidationError("sigma contains a finite negative value")
    if not np.array_equal(finite, np.asarray(mask_valid, dtype=bool)):
        raise SigmaValidationError(
            "sigma's finite/NaN pattern does not match the associated mask validity"
        )


def _validate_source_metadata(source: str, *, clone_count: int | None, notes: str | None) -> None:
    if source not in _VALID_SOURCES:
        raise SigmaValidationError(f"sigma source must be one of {_VALID_SOURCES}, got {source!r}")
    if source == "monte_carlo":
        if clone_count is None:
            raise SigmaValidationError("clone_count is required when source is 'monte_carlo'")
        if not isinstance(clone_count, int) or isinstance(clone_count, bool):
            raise SigmaValidationError("clone_count must be an integer")
        if not (20 <= clone_count <= 30):
            raise SigmaValidationError(
                f"clone_count must be in the R3 range [20, 30], got {clone_count}"
            )
    elif source == "default":
        if clone_count is not None:
            raise SigmaValidationError("clone_count must be absent when source is 'default'")
    elif source == "calibrated" and not notes:
        raise SigmaValidationError(
            "notes identifying the calibration method is required when source is 'calibrated'"
        )


def _git_commit() -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"], check=True, capture_output=True, text=True
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    commit = result.stdout.strip()
    return commit if re.fullmatch(r"[0-9a-fA-F]{40}", commit) else None


@dataclass(frozen=True)
class SigmaArtifact:
    sigma_deg: np.ndarray
    binary_path: Path
    sidecar_path: Path
    sidecar: dict[str, Any]


def write_sigma(
    site_id: str,
    sigma_deg: np.ndarray,
    *,
    mask_valid: np.ndarray,
    source: str,
    clone_count: int | None = None,
    notes: str | None = None,
    output_root: Path | None = None,
    producer: str = "lumen_pipeline.terrain.mc_sigma",
    extra: dict[str, Any] | None = None,
) -> SigmaArtifact:
    """Validate and publish one sigma artifact per contract §4/§8/§10.

    ``sigma_deg`` must already be computed by the caller; this function
    never invents, defaults, or clamps a sigma value -- it only validates
    and serializes the array it is given, matching it against
    ``mask_valid`` (the corresponding mask's own per-bin validity, shape
    ``(4, 3600)``).

    ``extra`` adds caller-supplied sidecar fields beyond the contract's
    required minimum (e.g. Monte-Carlo provenance: source DEM/_ERR paths
    and hashes, correlation lengths tested, seeds, the 20-vs-30-clone
    comparison, cross-length sensitivity, and preliminary-status
    caveats). Keys must not collide with a contract-required field name.
    """

    _validate_source_metadata(source, clone_count=clone_count, notes=notes)
    validate_sigma_array(sigma_deg, mask_valid)
    if extra:
        colliding = sorted(set(extra) & _CONTRACT_SIDECAR_FIELDS)
        if colliding:
            raise SigmaValidationError(
                f"extra sidecar fields collide with contract-required fields: {colliding}"
            )

    git_commit = _git_commit()
    if not isinstance(git_commit, str) or re.fullmatch(r"[0-9a-fA-F]{40}", git_commit) is None:
        raise SigmaValidationError(
            "sigma publication requires a valid 40-character Git commit hash"
        )

    root = (
        Path(output_root)
        if output_root is not None
        else Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "terrain"
    )
    binary_path = root / "sigma" / f"{site_id}.bin"
    sidecar_path = root / "sigma" / f"{site_id}.json"

    payload = _sigma_header() + np.ascontiguousarray(sigma_deg, dtype="<f4").tobytes()
    _validate_sigma_header(payload)  # self-check before publishing

    binary_path.parent.mkdir(parents=True, exist_ok=True)
    binary_path.write_bytes(payload)

    sidecar: dict[str, Any] = {
        "version": "1.0.0",
        "producer": producer,
        "created_utc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "git_commit": git_commit,
        "site_id": site_id,
        "shape": [len(HEIGHTS_M), AZIMUTH_COUNT],
        "height_order_m": list(HEIGHTS_M),
        "bin_width_deg": BIN_WIDTH_DEG,
        "ray_range_km": RAY_RANGE_KM,
        "unit": "deg",
        "source": source,
        "binary": {
            "magic": "LUMENSGM",
            "format_version": 1,
            "byte_order": "little",
            "float_encoding": "ieee754-binary32",
            "layout": "header_then_sigma",
            "array_order": "c_contiguous_height_major",
        },
    }
    if clone_count is not None:
        sidecar["clone_count"] = clone_count
    if notes is not None:
        sidecar["notes"] = notes
    if extra:
        sidecar.update(extra)

    sidecar_path.parent.mkdir(parents=True, exist_ok=True)
    sidecar_path.write_text(json.dumps(sidecar, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    return SigmaArtifact(
        sigma_deg=np.asarray(sigma_deg, dtype=np.float32),
        binary_path=binary_path,
        sidecar_path=sidecar_path,
        sidecar=sidecar,
    )


def read_sigma(path: Path) -> np.ndarray:
    """Read and fully validate a published sigma binary, returning the
    decoded ``(4, 3600)`` float32 array. Raises :class:`SigmaValidationError`
    rather than silently applying a default on any malformed input."""

    payload = Path(path).read_bytes()
    _validate_sigma_header(payload)
    sigma = np.frombuffer(
        payload, dtype="<f4", count=len(HEIGHTS_M) * AZIMUTH_COUNT, offset=HEADER_SIZE
    ).reshape(len(HEIGHTS_M), AZIMUTH_COUNT)
    return sigma
