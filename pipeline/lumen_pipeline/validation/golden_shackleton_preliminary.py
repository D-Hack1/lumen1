"""Preliminary real-site Golden Set 2 fixtures for the Shackleton Tier-A handoff.

These are Python-generated parity fixtures, not independently verified scientific
ground truth or a substitute for sigma, pad, or PGDA reference measurements.
"""

from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path

import numpy as np

from lumen_pipeline.common.timeutil import utc_to_ephemeris_index
from lumen_pipeline.reference.events import detect_events, sample_times
from lumen_pipeline.reference.interp import Ephemeris
from lumen_pipeline.reference.visibility import Horizon, availability

SITE_ID = "shackleton_ridge"
LATITUDE_DEG = -89.54
LONGITUDE_DEG_EAST = 129.0
HEIGHTS_M = (1.0, 2.0, 5.0, 10.0)
REPRESENTATIVE_TIMESTAMPS = (
    "2025-01-01T00:00:00Z",
    "2025-06-01T00:00:00Z",
    "2025-12-01T00:00:00Z",
)
EVENT_RANGE_UTC = ("2025-12-01T00:00:00Z", "2025-12-31T00:00:00Z")
INTERPOLATION_AZIMUTHS_DEG = (0.0, 123.456, 359.999)
_HEADER_FORMAT = "<8sHHIIfffIIIIIIQ"
_HEADER_EXPECTED = (b"LUMENMSK", 1, 64, 4, 3600, 0.1, 250.0, 1.0, 64, 57664, 57600, 57600, 0, 0, 0)


def _data_root() -> Path:
    return Path(__file__).resolve().parents[3] / "web" / "public" / "data"


def default_preliminary_output_path() -> Path:
    return _data_root() / "golden" / "golden_set2_shackleton_preliminary.json"


def _load_mask() -> tuple[np.ndarray, np.ndarray, dict[str, object], bytes]:
    binary_path = _data_root() / "terrain" / "masks" / f"{SITE_ID}.bin"
    sidecar_path = binary_path.with_suffix(".json")
    payload = binary_path.read_bytes()
    if len(payload) != 115264:
        raise ValueError("Shackleton mask has an unexpected file length")
    header = struct.unpack(_HEADER_FORMAT, payload[:64])
    if header[:5] != _HEADER_EXPECTED[:5] or header[8:] != _HEADER_EXPECTED[8:]:
        raise ValueError("Shackleton mask header does not match the Tier-A contract")
    if not np.allclose(header[5:8], _HEADER_EXPECTED[5:8], rtol=0.0, atol=1e-6):
        raise ValueError("Shackleton mask header float fields do not match the Tier-A contract")
    elevation = np.frombuffer(payload, dtype="<f4", count=14400, offset=header[8]).reshape(4, 3600)
    distance = np.frombuffer(payload, dtype="<f4", count=14400, offset=header[9]).reshape(4, 3600)
    metadata = json.loads(sidecar_path.read_text(encoding="utf-8"))
    return elevation, distance, metadata, payload


def _ephemeris_et(ephemeris: Ephemeris, metadata: dict[str, object], timestamp: str) -> float:
    """Map a grid-aligned UTC fixture timestamp through the pinned ephemeris sidecar."""
    cadence_s = metadata["cadence_s"]
    start_utc = metadata["start_utc"]
    if not isinstance(cadence_s, int) or not isinstance(start_utc, str):
        raise TypeError("ephemeris sidecar lacks a usable UTC grid")
    return ephemeris.start_et + utc_to_ephemeris_index(start_utc, timestamp, cadence_s) * cadence_s


def _visibility(body: str, geometry: object, horizon: Horizon) -> dict[str, float | bool]:
    fraction, clearance, visible = availability(
        body,
        geometry.elevation_deg,  # type: ignore[attr-defined]
        geometry.azimuth_deg,  # type: ignore[attr-defined]
        geometry.distance_km,  # type: ignore[attr-defined]
        horizon,
        disk_threshold=0.5,
    )
    return {
        "disk_fraction": fraction,
        "clearance_deg": clearance,
        "visible": visible,
    }


def preliminary_golden_payload() -> dict[str, object]:
    """Evaluate the supplied Tier-A mask into deterministic preliminary fixtures."""
    elevation, distance, metadata, binary = _load_mask()
    ephemeris_path = _data_root() / "ephem" / "ephem.bin"
    ephemeris = Ephemeris.from_file(ephemeris_path)
    ephemeris_metadata = json.loads(ephemeris_path.with_suffix(".json").read_text(encoding="utf-8"))
    horizons = [Horizon(row, observer_height_m=height) for height, row in zip(HEIGHTS_M, elevation, strict=True)]
    visibility_cases = []
    for timestamp in REPRESENTATIVE_TIMESTAMPS:
        et = _ephemeris_et(ephemeris, ephemeris_metadata, timestamp)
        bodies = {
            body: ephemeris.body_at(body, et, LATITUDE_DEG, LONGITUDE_DEG_EAST)
            for body in ("sun", "earth")
        }
        visibility_cases.append(
            {
                "id": f"shackleton_ridge_visibility_{timestamp[:10]}",
                "input": {"utc": timestamp, "observer_heights_m": list(HEIGHTS_M)},
                "expected": {
                    body: {
                        "azimuth_deg": geometry.azimuth_deg,
                        "elevation_deg": geometry.elevation_deg,
                        "distance_km": geometry.distance_km,
                        "by_height_m": {
                            str(int(height)): _visibility(body, geometry, horizon)
                            for height, horizon in zip(HEIGHTS_M, horizons, strict=True)
                        },
                    }
                    for body, geometry in bodies.items()
                },
            }
        )

    start_et, end_et = (_ephemeris_et(ephemeris, ephemeris_metadata, timestamp) for timestamp in EVENT_RANGE_UTC)
    event_horizon = horizons[-1]
    visible_at = lambda et: _visibility(
        "sun", ephemeris.body_at("sun", et, LATITUDE_DEG, LONGITUDE_DEG_EAST), event_horizon
    )["visible"]
    times = sample_times(start_et, end_et)
    events = detect_events(start_et, end_et, visible_at, down="sunset", up="shadowExit")
    if events:
        raise ValueError("preliminary zero-visibility fixture unexpectedly contains Sun events")
    event_case = {
        "id": "shackleton_ridge_sun_event_consistency_30d_10m",
        "input": {"start_utc": EVENT_RANGE_UTC[0], "end_utc": EVENT_RANGE_UTC[1], "observer_height_m": 10.0},
        "expected": {
            "sample_count": len(times),
            "sample_visible_count": sum(bool(visible_at(time)) for time in times),
            "events": [],
        },
    }

    interpolation_case = {
        "id": "shackleton_ridge_horizon_interpolation",
        "input": {"azimuth_deg": list(INTERPOLATION_AZIMUTHS_DEG), "observer_heights_m": list(HEIGHTS_M)},
        "expected": {
            str(int(height)): [horizon.elevation_at(azimuth) for azimuth in INTERPOLATION_AZIMUTHS_DEG]
            for height, horizon in zip(HEIGHTS_M, horizons, strict=True)
        },
    }
    finite_elevation = np.isfinite(elevation)
    finite_distance = np.isfinite(distance)
    artifact_case = {
        "id": "shackleton_ridge_mask_numerical_invariants",
        "expected": {
            "sha256": hashlib.sha256(binary).hexdigest(),
            "shape": [4, 3600],
            "finite_elevation_count_by_height": np.sum(finite_elevation, axis=1).tolist(),
            "finite_distance_count_by_height": np.sum(finite_distance, axis=1).tolist(),
            "nan_patterns_equal": bool(np.array_equal(finite_elevation, finite_distance)),
            "elevation_min_deg": np.nanmin(elevation, axis=1).tolist(),
            "elevation_max_deg": np.nanmax(elevation, axis=1).tolist(),
            "distance_min_km": np.nanmin(distance, axis=1).tolist(),
            "distance_max_km": np.nanmax(distance, axis=1).tolist(),
        },
    }
    return {
        "version": "1.0.0",
        "set": 2,
        "kind": "real_site_preliminary_parity_fixtures",
        "description": "Python-generated preliminary parity fixtures for the supplied Shackleton Tier-A mask; not independently verified scientific ground truth.",
        "tolerances": {"angle_deg": 0.00001, "distance_km": 0.001, "event_time_s": 10.0},
        "provenance": {
            "label": "Python-generated preliminary parity fixtures",
            "terrain_mask_sha256": hashlib.sha256(binary).hexdigest(),
            "ephem_sha256": hashlib.sha256(ephemeris_path.read_bytes()).hexdigest(),
            "coordinate_frame": ephemeris.frame,
            "site_coordinates": {"latitude_deg": LATITUDE_DEG, "longitude_deg_east": LONGITUDE_DEG_EAST},
            "mask_site_id": metadata["site_id"],
            "terrain_sigma": "unavailable; no uncertainty bounds or timing uncertainty asserted",
            "pad": "unavailable; no pad values asserted",
            "pgda_reference_measurements": "not asserted",
        },
        "cases": [*visibility_cases, interpolation_case, event_case, artifact_case],
    }


def build_preliminary_golden_set(output_path: str | Path | None = None) -> dict[str, object]:
    """Write the preliminary real-site Set 2 fixtures from current artifacts."""
    output = Path(output_path) if output_path is not None else default_preliminary_output_path()
    payload = preliminary_golden_payload()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(payload, indent=2, sort_keys=True, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    return payload
