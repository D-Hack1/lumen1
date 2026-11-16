"""G1: independent SpiceyPy/Skyfield validation of the DE421 lunar frame."""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from importlib.metadata import version
from pathlib import Path

import numpy as np

from lumen_pipeline.common.constants import LUNAR_RADIUS_KM
from lumen_pipeline.common.frames import site_up_vector
from lumen_pipeline.common.timeutil import utc_to_et
from lumen_pipeline.ephem.kernels import MOON_FRAME, loaded_kernels

MATRIX_TOLERANCE = 1e-9
DIRECTION_TOLERANCE_RAD = 1e-6
PA_FRAME = "MOON_PA_DE421"
ME_FRAME = "MOON_ME_DE421"
DEFAULT_EPOCHS = ("2023-01-01T00:00:00Z", "2025-03-06T17:28:50Z", "2030-12-31T23:00:00Z")
DEFAULT_SITES = ((-84.7906, 29.1957), (-69.373, 32.319), (-90.0, 0.0))


@dataclass(frozen=True)
class TransformMetrics:
    matrix_max_abs_error: float
    max_angular_residual_rad: float
    max_angular_residual_deg: float
    rms_angular_residual_deg: float
    orthogonality_error_max_abs: float
    determinant_deviation: float


@dataclass(frozen=True)
class G1Result:
    passed: bool
    max_matrix_error: float
    max_direction_error_rad: float
    max_angular_residual_deg: float
    rms_angular_residual_deg: float
    max_orthogonality_error: float
    max_determinant_deviation: float
    minimum_determinant: float
    max_round_trip_vector_error_m: float
    max_site_transform_error_m: float
    pa_me_surface_offset_m: float
    pa_to_me: TransformMetrics
    me_to_pa: TransformMetrics
    epochs: tuple[str, ...]
    epoch_results: tuple[dict[str, object], ...]
    frames: dict[str, dict[str, object]]
    kernels: tuple[dict[str, object], ...]


def _angle(left: np.ndarray, right: np.ndarray) -> float:
    left_unit = left / np.linalg.norm(left)
    right_unit = right / np.linalg.norm(right)
    return math.atan2(
        float(np.linalg.norm(np.cross(left_unit, right_unit))),
        float(np.dot(left_unit, right_unit)),
    )


def _skyfield_rotations_and_directions(
    epoch: str, kernel_dir: Path
) -> tuple[np.ndarray, np.ndarray, dict[str, np.ndarray]]:
    from skyfield.api import load, load_file
    from skyfield.planetarylib import PlanetaryConstants

    constants = PlanetaryConstants()
    with (kernel_dir / "pck00011.tpc").open("rb") as kernel:
        constants.read_text(kernel)
    with (kernel_dir / "moon_080317.tf").open("rb") as kernel:
        constants.read_text(kernel)
    with (kernel_dir / "moon_pa_de421_1900-2050.bpc").open("rb") as kernel:
        constants.read_binary(kernel)
        pa_frame = constants.build_frame_named(PA_FRAME)
        me_frame = constants.build_frame_named(ME_FRAME)
        timescale = load.timescale()
        instant = timescale.tdb_jd(2451545.0 + utc_to_et(epoch) / 86400.0)
        ephemeris = load_file(kernel_dir / "de421.bsp")
        moon_position = ephemeris["moon"].at(instant).position.km
        directions = {
            body: ephemeris[body.lower()].at(instant).position.km - moon_position
            for body in ("SUN", "EARTH")
        }
        return (
            np.asarray(pa_frame.rotation_at(instant), dtype=float),
            np.asarray(me_frame.rotation_at(instant), dtype=float),
            directions,
        )


def _transform_metrics(reference: np.ndarray, application: np.ndarray) -> tuple[TransformMetrics, tuple[float, ...]]:
    angular_errors = tuple(_angle(reference @ vector, application @ vector) for vector in np.eye(3))
    metrics = TransformMetrics(
        matrix_max_abs_error=float(np.max(np.abs(reference - application))),
        max_angular_residual_rad=max(angular_errors),
        max_angular_residual_deg=math.degrees(max(angular_errors)),
        rms_angular_residual_deg=math.degrees(
            math.sqrt(sum(error * error for error in angular_errors) / len(angular_errors))
        ),
        orthogonality_error_max_abs=float(np.max(np.abs(application @ application.T - np.eye(3)))),
        determinant_deviation=abs(float(np.linalg.det(application)) - 1.0),
    )
    return metrics, angular_errors


def _rotation_angle(matrix: np.ndarray) -> float:
    cosine = float(np.clip((np.trace(matrix) - 1.0) / 2.0, -1.0, 1.0))
    sine = float(
        np.linalg.norm(
            np.array(
                [
                    matrix[2, 1] - matrix[1, 2],
                    matrix[0, 2] - matrix[2, 0],
                    matrix[1, 0] - matrix[0, 1],
                ]
            )
        )
        / 2.0
    )
    return math.atan2(sine, cosine)


def _round_trip_error_m(forward: np.ndarray, reverse: np.ndarray) -> float:
    vectors = np.eye(3) * LUNAR_RADIUS_KM
    return max(
        float(np.linalg.norm(reverse @ (forward @ vector) - vector) * 1000.0)
        for vector in vectors
    )


def _frame_info(spice: object, name: str) -> dict[str, object]:
    frame_id = spice.namfrm(name)
    if frame_id == 0:
        raise RuntimeError(f"SPICE did not resolve required frame {name}")
    center, frame_class, class_id = spice.frinfo(frame_id)
    return {
        "name": name,
        "frame_id": int(frame_id),
        "center_id": int(center),
        "class": int(frame_class),
        "class_id": int(class_id),
    }


def _kernel_provenance(paths: Sequence[Path]) -> tuple[dict[str, object], ...]:
    return tuple(
        {
            "filename": path.name,
            "size_bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
        for path in paths
    )


def run_g1(kernel_dir: str | Path | None = None, epochs: Sequence[str] = DEFAULT_EPOCHS) -> G1Result:
    """Compare PA/ME transformations from Skyfield and SPICE at mission epochs."""
    import spiceypy as spice

    if len(epochs) < 2:
        raise ValueError("G1 requires multiple UTC epochs")

    matrix_errors: list[float] = []
    direction_errors: list[float] = []
    pa_to_me_errors: list[float] = []
    me_to_pa_errors: list[float] = []
    orthogonality_errors: list[float] = []
    determinant_deviations: list[float] = []
    determinants: list[float] = []
    round_trip_errors: list[float] = []
    site_errors: list[float] = []
    surface_offsets: list[float] = []
    epoch_results: list[dict[str, object]] = []

    with loaded_kernels(kernel_dir) as paths:
        directory = paths[0].parent
        frames = {
            "principal_axis": _frame_info(spice, PA_FRAME),
            "mean_earth": {
                **_frame_info(spice, ME_FRAME),
                "relative_to": PA_FRAME,
                "definition": "fixed Euler rotation: axes 3-2-1; angles 67.92, 78.56, 0.30 arcseconds",
            },
            "aliases": {
                "MOON_PA": _frame_info(spice, "MOON_PA"),
                "MOON_ME": _frame_info(spice, "MOON_ME"),
            },
        }

        for epoch in epochs:
            et = utc_to_et(epoch)
            spice_j2000_me = np.asarray(spice.pxform("J2000", MOON_FRAME, et), dtype=float)
            skyfield_pa_j2000, skyfield_me_j2000, skyfield_directions = (
                _skyfield_rotations_and_directions(epoch, directory)
            )
            matrix_errors.append(float(np.max(np.abs(spice_j2000_me - skyfield_me_j2000))))

            for body in ("SUN", "EARTH"):
                spice_direction = np.asarray(
                    spice.spkpos(body, et, MOON_FRAME, "NONE", "MOON")[0], dtype=float
                )
                skyfield_direction = skyfield_me_j2000 @ skyfield_directions[body]
                direction_errors.append(_angle(spice_direction, skyfield_direction))

            spice_pa_me = np.asarray(spice.pxform(PA_FRAME, ME_FRAME, et), dtype=float)
            spice_me_pa = np.asarray(spice.pxform(ME_FRAME, PA_FRAME, et), dtype=float)
            skyfield_pa_me = skyfield_me_j2000 @ skyfield_pa_j2000.T
            skyfield_me_pa = skyfield_pa_j2000 @ skyfield_me_j2000.T
            pa_metrics, pa_angles = _transform_metrics(spice_pa_me, skyfield_pa_me)
            me_metrics, me_angles = _transform_metrics(spice_me_pa, skyfield_me_pa)
            pa_to_me_errors.extend(pa_angles)
            me_to_pa_errors.extend(me_angles)
            matrix_errors.extend((pa_metrics.matrix_max_abs_error, me_metrics.matrix_max_abs_error))
            direction_errors.extend((*pa_angles, *me_angles))

            checked_matrices = (
                spice_j2000_me,
                skyfield_me_j2000,
                spice_pa_me,
                spice_me_pa,
                skyfield_pa_me,
                skyfield_me_pa,
            )
            epoch_orthogonality = max(
                float(np.max(np.abs(matrix @ matrix.T - np.eye(3))))
                for matrix in checked_matrices
            )
            epoch_determinants = tuple(float(np.linalg.det(matrix)) for matrix in checked_matrices)
            epoch_determinant_deviation = max(abs(value - 1.0) for value in epoch_determinants)
            epoch_round_trip_error = max(
                _round_trip_error_m(skyfield_pa_me, skyfield_me_pa),
                _round_trip_error_m(skyfield_me_pa, skyfield_pa_me),
            )
            pa_me_angle = _rotation_angle(spice_pa_me)
            epoch_surface_offset = 2.0 * LUNAR_RADIUS_KM * math.sin(pa_me_angle / 2.0) * 1000.0

            orthogonality_errors.append(epoch_orthogonality)
            determinant_deviations.append(epoch_determinant_deviation)
            determinants.extend(epoch_determinants)
            round_trip_errors.append(epoch_round_trip_error)
            surface_offsets.append(epoch_surface_offset)
            for latitude, longitude in DEFAULT_SITES:
                site_me = LUNAR_RADIUS_KM * site_up_vector(latitude, longitude)
                site_j2000 = spice_j2000_me.T @ site_me
                site_round_trip = skyfield_me_j2000 @ site_j2000
                site_errors.append(float(np.linalg.norm(site_me - site_round_trip) * 1000.0))

            epoch_results.append(
                {
                    "utc": epoch,
                    "et_seconds": et,
                    "pa_to_me": asdict(pa_metrics),
                    "me_to_pa": asdict(me_metrics),
                    "orthogonality_error_max_abs": epoch_orthogonality,
                    "determinant_deviation_max_abs": epoch_determinant_deviation,
                    "minimum_determinant": min(epoch_determinants),
                    "round_trip_vector_error_m": epoch_round_trip_error,
                    "pa_me_max_surface_offset_m": epoch_surface_offset,
                }
            )

        kernels = _kernel_provenance(paths)

    max_direction_error = max(direction_errors)
    all_frame_angles = (*pa_to_me_errors, *me_to_pa_errors)
    passed = (
        max(matrix_errors) < MATRIX_TOLERANCE
        and max_direction_error < DIRECTION_TOLERANCE_RAD
        and max(orthogonality_errors) <= MATRIX_TOLERANCE
        and min(determinants) > 0.0
    )
    return G1Result(
        passed=passed,
        max_matrix_error=max(matrix_errors),
        max_direction_error_rad=max_direction_error,
        max_angular_residual_deg=math.degrees(max(all_frame_angles)),
        rms_angular_residual_deg=math.degrees(
            math.sqrt(sum(error * error for error in all_frame_angles) / len(all_frame_angles))
        ),
        max_orthogonality_error=max(orthogonality_errors),
        max_determinant_deviation=max(determinant_deviations),
        minimum_determinant=min(determinants),
        max_round_trip_vector_error_m=max(round_trip_errors),
        max_site_transform_error_m=max(site_errors),
        pa_me_surface_offset_m=max(surface_offsets),
        pa_to_me=TransformMetrics(
            matrix_max_abs_error=max(
                item["pa_to_me"]["matrix_max_abs_error"] for item in epoch_results
            ),
            max_angular_residual_rad=max(pa_to_me_errors),
            max_angular_residual_deg=math.degrees(max(pa_to_me_errors)),
            rms_angular_residual_deg=math.degrees(
                math.sqrt(sum(error * error for error in pa_to_me_errors) / len(pa_to_me_errors))
            ),
            orthogonality_error_max_abs=max(
                item["pa_to_me"]["orthogonality_error_max_abs"] for item in epoch_results
            ),
            determinant_deviation=max(
                item["pa_to_me"]["determinant_deviation"] for item in epoch_results
            ),
        ),
        me_to_pa=TransformMetrics(
            matrix_max_abs_error=max(
                item["me_to_pa"]["matrix_max_abs_error"] for item in epoch_results
            ),
            max_angular_residual_rad=max(me_to_pa_errors),
            max_angular_residual_deg=math.degrees(max(me_to_pa_errors)),
            rms_angular_residual_deg=math.degrees(
                math.sqrt(sum(error * error for error in me_to_pa_errors) / len(me_to_pa_errors))
            ),
            orthogonality_error_max_abs=max(
                item["me_to_pa"]["orthogonality_error_max_abs"] for item in epoch_results
            ),
            determinant_deviation=max(
                item["me_to_pa"]["determinant_deviation"] for item in epoch_results
            ),
        ),
        epochs=tuple(epochs),
        epoch_results=tuple(epoch_results),
        frames=frames,
        kernels=kernels,
    )


def default_output_path() -> Path:
    """Return the standalone G1 evidence path."""
    return Path(__file__).resolve().parents[2] / "reports" / "g1_lunar_frames.json"


def build_g1_report(
    kernel_dir: str | Path | None = None, epochs: Sequence[str] = DEFAULT_EPOCHS
) -> dict[str, object]:
    """Build machine-readable G1 evidence from the installed SPICE kernels."""
    result = run_g1(kernel_dir, epochs)
    metrics = {
        "max_matrix_error": result.max_matrix_error,
        "max_direction_error_rad": result.max_direction_error_rad,
        "max_direction_error_deg": math.degrees(result.max_direction_error_rad),
        "max_angular_residual_deg": result.max_angular_residual_deg,
        "rms_angular_residual_deg": result.rms_angular_residual_deg,
        "pa_to_me": asdict(result.pa_to_me),
        "me_to_pa": asdict(result.me_to_pa),
        "orthogonality_error_max_abs": result.max_orthogonality_error,
        "determinant_deviation_max_abs": result.max_determinant_deviation,
        "minimum_determinant": result.minimum_determinant,
        "round_trip_vector_error_m": result.max_round_trip_vector_error_m,
        "pa_me_surface_offset_m": result.pa_me_surface_offset_m,
        "site_transform_error_m": result.max_site_transform_error_m,
    }
    return {
        "schema_version": 1,
        "id": "G1",
        "status": "PASS" if result.passed else "FAIL",
        "criteria": {
            "matrix_max_abs_error": {"operator": "<", "value": MATRIX_TOLERANCE},
            "direction_max_angular_error_rad": {
                "operator": "<",
                "value": DIRECTION_TOLERANCE_RAD,
            },
            "orthogonality_error_max_abs": {
                "operator": "<=",
                "value": MATRIX_TOLERANCE,
                "basis": "existing G1 matrix-integrity check",
            },
            "determinant": {"criterion": "positive", "separate_deviation_tolerance": None},
            "round_trip_vector_error_m": {
                "tolerance": None,
                "basis": "R3 defines no separate round-trip vector tolerance",
            },
        },
        "frames": result.frames,
        "epochs_utc": list(result.epochs),
        "epoch_results": list(result.epoch_results),
        "reference": {
            "comparison": "SPICE pxform vs Skyfield PlanetaryConstants rotations",
            "independent_implementation": "Skyfield",
            "shared_input_data": "same SHA-256-identified DE421 kernels; independent library calculations",
            "time_alignment": "UTC converted to SPICE ET, then to Skyfield TDB using that ET",
            "software": {
                "spiceypy": version("spiceypy"),
                "skyfield": version("skyfield"),
            },
        },
        "kernels": list(result.kernels),
        "metrics": metrics,
    }


def write_g1_report(
    output_path: str | Path | None = None,
    kernel_dir: str | Path | None = None,
    epochs: Sequence[str] = DEFAULT_EPOCHS,
) -> dict[str, object]:
    """Write and return reproducible G1 evidence."""
    destination = Path(output_path) if output_path is not None else default_output_path()
    report = build_g1_report(kernel_dir, epochs)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    print(json.dumps(write_g1_report(), indent=2, sort_keys=True))
