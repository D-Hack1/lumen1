"""Little-endian binary arrays with self-describing JSON sidecars."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

_DTYPES = {"float32": np.dtype("<f4"), "int16": np.dtype("<i2"), "uint8": np.dtype("u1")}


def sidecar_path(binary_path: str | Path) -> Path:
    return Path(binary_path).with_suffix(".json")


def write_array(
    binary_path: str | Path,
    array: np.ndarray,
    *,
    fields: list[str],
    units: str | list[str],
    producer: str,
    version: str = "1",
    scale: float | None = None,
    offset: float | None = None,
    created_utc: str | None = None,
) -> dict[str, Any]:
    """Write a float32, int16, or uint8 array and its required JSON sidecar metadata."""
    source = np.asarray(array)
    if source.dtype.kind == "f":
        dtype_name = "float32"
    elif source.dtype.kind == "i" and source.dtype.itemsize == 2:
        dtype_name = "int16"
    elif source.dtype.kind == "u" and source.dtype.itemsize == 1:
        dtype_name = "uint8"
    else:
        raise ValueError("only float32, int16, and uint8 arrays are supported")
    encoded = np.ascontiguousarray(source, dtype=_DTYPES[dtype_name])
    path = Path(binary_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encoded.tobytes())
    metadata = {
        "version": version,
        "shape": list(encoded.shape),
        "dtype": dtype_name,
        "fields": fields,
        "units": units,
        "scale": scale,
        "offset": offset,
        "producer": producer,
        "created_utc": created_utc or datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }
    sidecar_path(path).write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return metadata


def read_array(binary_path: str | Path) -> tuple[np.ndarray, dict[str, Any]]:
    """Read an array and verify its byte-level SHA-256 against the sidecar."""
    path = Path(binary_path)
    metadata = json.loads(sidecar_path(path).read_text(encoding="utf-8"))
    required = {"version", "shape", "dtype", "fields", "units", "scale", "offset", "producer", "created_utc", "sha256"}
    missing = required - metadata.keys()
    if missing:
        raise ValueError(f"sidecar is missing fields: {sorted(missing)}")
    payload = path.read_bytes()
    if hashlib.sha256(payload).hexdigest() != metadata["sha256"]:
        raise ValueError("binary SHA-256 does not match sidecar")
    if metadata["dtype"] not in _DTYPES:
        raise ValueError(f"unsupported dtype: {metadata['dtype']}")
    array = np.frombuffer(payload, dtype=_DTYPES[metadata["dtype"]]).reshape(metadata["shape"])
    return array, metadata
