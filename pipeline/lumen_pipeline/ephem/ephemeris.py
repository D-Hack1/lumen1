"""Build and validate LUMEN's hourly Moon-centred Sun/Earth ephemeris."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from lumen_pipeline.common.binio import sidecar_path, write_array
from lumen_pipeline.common.timeutil import parse_utc, utc_to_et
from lumen_pipeline.ephem.kernels import MOON_FRAME, kernel_paths, loaded_kernels

START_UTC = "2023-01-01T00:00:00Z"
END_UTC = "2030-12-31T23:00:00Z"
STEP_SECONDS = 3600
ABERRATION_CORRECTION = "LT+S"
PUBLIC_MOON_FRAME = "MOON_ME"
BODY_ORDER = ("sun", "earth")
FIELDS = [
    "sun_position_km",
    "sun_velocity_km_s",
    "earth_position_km",
    "earth_velocity_km_s",
]


@dataclass(frozen=True)
class HermiteValidation:
    """Measured G2 residuals for the generated float32 node grid."""

    epochs: int
    seed: int
    max_sun_direction_error_deg: float
    max_earth_direction_error_deg: float
    max_direction_error_deg: float


def default_output_path() -> Path:
    """Return the web artifact owned by this pipeline stage."""
    return Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "ephem" / "ephem.bin"


def hourly_ets(start_utc: str = START_UTC, end_utc: str = END_UTC) -> np.ndarray:
    """Return the inclusive UTC-hour grid as SPICE ephemeris seconds."""
    start_et = utc_to_et(start_utc)
    utc_elapsed_seconds = (parse_utc(end_utc) - parse_utc(start_utc)).total_seconds()
    count = round(utc_elapsed_seconds / STEP_SECONDS) + 1
    if count < 1 or not np.isclose(utc_elapsed_seconds, (count - 1) * STEP_SECONDS):
        raise ValueError("ephemeris bounds must align to the hourly grid")
    return start_et + np.arange(count, dtype=np.float64) * STEP_SECONDS


def _states_at(ets: np.ndarray, body: str) -> np.ndarray:
    import spiceypy as spice

    states = np.empty((len(ets), 6), dtype=np.float64)
    for index, et in enumerate(ets):
        state, _ = spice.spkezr(body, float(et), MOON_FRAME, ABERRATION_CORRECTION, "MOON")
        states[index] = state
    return states


def build_nodes(ets: np.ndarray) -> np.ndarray:
    """Query locked SPICE kernels for Sun then Earth states at each hourly node."""
    sun = _states_at(ets, "SUN")
    earth = _states_at(ets, "EARTH")
    return np.concatenate((sun, earth), axis=1).astype(np.float32)


def build_ephemeris(
    output_path: str | Path | None = None,
    *,
    kernel_dir: str | Path | None = None,
    start_utc: str = START_UTC,
    end_utc: str = END_UTC,
) -> dict[str, object]:
    """Write the contract-defined hourly Sun/Earth ephemeris and sidecar."""
    path = Path(output_path) if output_path is not None else default_output_path()
    with loaded_kernels(kernel_dir):
        ets = hourly_ets(start_utc, end_utc)
        nodes = build_nodes(ets)
        paths = kernel_paths(kernel_dir)
        metadata = write_array(
            path,
            nodes,
            fields=FIELDS,
            units=["km", "km/s", "km", "km/s"],
            producer="lumen_pipeline.ephem.ephemeris",
        )
        metadata.update(
            {
                "start_utc": start_utc,
                "start_et_tdb": float(ets[0]),
                "end_utc": end_utc,
                "step_seconds": STEP_SECONDS,
                "count": len(ets),
                "frame": PUBLIC_MOON_FRAME,
                "spice_frame": MOON_FRAME,
                "aberration_correction": ABERRATION_CORRECTION,
                "cadence_s": STEP_SECONDS,
                "body_order": list(BODY_ORDER),
                "kernel_provenance": [
                    {"filename": item.name, "sha256": hashlib.sha256(item.read_bytes()).hexdigest()}
                    for item in paths
                ],
            }
        )
        sidecar_path(path).write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return metadata


def hermite_position(nodes: np.ndarray, start_et: float, et: float) -> np.ndarray:
    """Interpolate both body positions from contract-order nodes at an in-range epoch."""
    interval = (et - start_et) / STEP_SECONDS
    index = int(np.floor(interval))
    if index < 0 or index >= len(nodes) - 1:
        raise ValueError("epoch must fall between ephemeris nodes")
    fraction = interval - index
    t2 = fraction * fraction
    t3 = t2 * fraction
    h00 = 2 * t3 - 3 * t2 + 1
    h10 = t3 - 2 * t2 + fraction
    h01 = -2 * t3 + 3 * t2
    h11 = t3 - t2
    start = nodes[index]
    end = nodes[index + 1]
    positions = np.empty((2, 3), dtype=np.float64)
    for body_index, offset in enumerate((0, 6)):
        positions[body_index] = (
            h00 * start[offset : offset + 3]
            + h10 * STEP_SECONDS * start[offset + 3 : offset + 6]
            + h01 * end[offset : offset + 3]
            + h11 * STEP_SECONDS * end[offset + 3 : offset + 6]
        )
    return positions


def _direction_error_deg(left: np.ndarray, right: np.ndarray) -> float:
    cosine = np.dot(left, right) / (np.linalg.norm(left) * np.linalg.norm(right))
    return float(np.degrees(np.arccos(np.clip(cosine, -1.0, 1.0))))


def validate_hermite(
    nodes: np.ndarray,
    start_et: float,
    *,
    epochs: int = 10_000,
    seed: int = 421,
) -> HermiteValidation:
    """Run G2: compare interpolated and direct-SPICE directions at random epochs."""
    if nodes.ndim != 2 or nodes.shape[1] != 12 or len(nodes) < 2:
        raise ValueError("nodes must have shape (count, 12) with at least two rows")
    if epochs <= 0:
        raise ValueError("epochs must be positive")
    import spiceypy as spice

    rng = np.random.default_rng(seed)
    sample_ets = start_et + rng.uniform(0, (len(nodes) - 1) * STEP_SECONDS, size=epochs)
    max_errors = np.zeros(2, dtype=np.float64)
    with loaded_kernels():
        for et in sample_ets:
            interpolated = hermite_position(nodes, start_et, float(et))
            for body_index, body in enumerate(("SUN", "EARTH")):
                direct, _ = spice.spkezr(
                    body, float(et), MOON_FRAME, ABERRATION_CORRECTION, "MOON"
                )
                max_errors[body_index] = max(
                    max_errors[body_index], _direction_error_deg(interpolated[body_index], direct[:3])
                )
    return HermiteValidation(
        epochs=epochs,
        seed=seed,
        max_sun_direction_error_deg=float(max_errors[0]),
        max_earth_direction_error_deg=float(max_errors[1]),
        max_direction_error_deg=float(max_errors.max()),
    )


def validate_ephemeris_file(
    path: str | Path | None = None, *, epochs: int = 10_000, seed: int = 421
) -> HermiteValidation:
    """Load an ephemeris sidecar and execute the full G2 validation."""
    binary_path = Path(path) if path is not None else default_output_path()
    metadata = json.loads(sidecar_path(binary_path).read_text(encoding="utf-8"))
    nodes = np.fromfile(binary_path, dtype="<f4").reshape(metadata["shape"])
    result = validate_hermite(nodes, float(metadata["start_et_tdb"]), epochs=epochs, seed=seed)
    if result.max_direction_error_deg >= 0.001:
        raise AssertionError(f"G2 failed: {result.max_direction_error_deg:.9f} deg is not below 0.001 deg")
    return result


def record_g2_result(path: str | Path, result: HermiteValidation) -> None:
    """Append the reproducible G2 measurement to the owner validation document."""
    report = Path(path)
    report.parent.mkdir(parents=True, exist_ok=True)
    existing = report.read_text(encoding="utf-8") if report.exists() else "# Validation\n"
    heading = "## G2 - Hourly ephemeris Hermite validation"
    section = (
        f"{heading}\n\n"
        f"- Epochs: {result.epochs} (deterministic seed {result.seed})\n"
        f"- Sun maximum direction residual: {result.max_sun_direction_error_deg:.9f} deg\n"
        f"- Earth maximum direction residual: {result.max_earth_direction_error_deg:.9f} deg\n"
        f"- Gate: PASS (< 0.001 deg; measured {result.max_direction_error_deg:.9f} deg)\n"
    )
    start = existing.find(heading)
    if start >= 0:
        next_heading = existing.find("\n## ", start + len(heading))
        existing = existing[:start] + section + (existing[next_heading + 1 :] if next_heading >= 0 else "")
    else:
        existing = existing.rstrip() + "\n\n" + section
    report.write_text(existing, encoding="utf-8")
