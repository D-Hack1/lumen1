import json
from pathlib import Path

import pytest

from lumen_pipeline.ephem import kernels
from lumen_pipeline.ephem.kernels import MissingKernelError, kernel_paths
from lumen_pipeline.validation.frame_check import (
    DEFAULT_EPOCHS,
    DIRECTION_TOLERANCE_RAD,
    MATRIX_TOLERANCE,
    default_output_path,
    run_g1,
    write_g1_report,
)


def test_missing_kernel_error_lists_every_required_file(tmp_path):
    with pytest.raises(MissingKernelError) as error:
        kernel_paths(tmp_path)
    for filename in kernels.KERNEL_FILENAMES:
        assert filename in str(error.value)


def test_resolve_moon_frame_requires_the_de421_frame():
    class MatchingSpice:
        def namfrm(self, name):
            return 31006

    assert kernels.resolve_moon_frame(MatchingSpice()) == "MOON_ME_DE421"


def test_resolve_moon_frame_rejects_missing_frame():
    class MissingSpice:
        def namfrm(self, name):
            return 0

    with pytest.raises(RuntimeError, match="MOON_ME_DE421"):
        kernels.resolve_moon_frame(MissingSpice())


def test_loaded_kernels_always_clears_the_kernel_pool(monkeypatch):
    calls = []

    monkeypatch.setattr(kernels, "load_kernels", lambda directory: calls.append(("load", directory)) or ())
    monkeypatch.setattr(kernels, "clear_kernels", lambda: calls.append(("clear", None)))

    with kernels.loaded_kernels("test-kernels"):
        pass

    assert calls == [("load", "test-kernels"), ("clear", None)]


def test_g1_requires_actual_kernel_files(tmp_path):
    with pytest.raises(MissingKernelError):
        run_g1(Path(tmp_path))


def test_g1_pa_me_transforms_match_independent_spice_reference(tmp_path):
    report_path = tmp_path / "g1.json"
    repeated_path = tmp_path / "g1-repeated.json"
    report = write_g1_report(report_path)
    write_g1_report(repeated_path)
    metrics = report["metrics"]

    assert report_path.exists()
    assert report_path.read_bytes() == repeated_path.read_bytes()
    assert report["status"] == "PASS"
    assert report["reference"]["independent_implementation"] == "Skyfield"
    assert report["epochs_utc"] == list(DEFAULT_EPOCHS)
    assert report["frames"]["principal_axis"]["frame_id"] == 31006
    assert report["frames"]["mean_earth"]["frame_id"] == 31007
    assert len(report["kernels"]) == len(kernels.KERNEL_FILENAMES)
    assert all(len(kernel["sha256"]) == 64 for kernel in report["kernels"])
    persisted_report = json.loads(default_output_path().read_text(encoding="utf-8"))
    assert persisted_report == report
    assert persisted_report["status"] == "PASS"
    assert persisted_report["kernels"] == report["kernels"]
    assert report["frames"]["principal_axis"]["name"] == "MOON_PA_DE421"
    assert report["frames"]["mean_earth"]["name"] == "MOON_ME_DE421"
    assert report["frames"]["mean_earth"]["relative_to"] == "MOON_PA_DE421"
    assert report["metrics"]["pa_me_surface_offset_m"] == pytest.approx(
        874.7474688514714, abs=1e-6
    )

    assert metrics["max_matrix_error"] < MATRIX_TOLERANCE
    assert metrics["max_direction_error_rad"] < DIRECTION_TOLERANCE_RAD
    assert metrics["max_angular_residual_deg"] >= 0.0
    assert metrics["rms_angular_residual_deg"] >= 0.0
    assert metrics["orthogonality_error_max_abs"] <= MATRIX_TOLERANCE
    assert metrics["minimum_determinant"] > 0.0
    assert metrics["determinant_deviation_max_abs"] >= 0.0
    assert metrics["round_trip_vector_error_m"] >= 0.0
    assert metrics["pa_me_surface_offset_m"] > 0.0

    for direction in ("pa_to_me", "me_to_pa"):
        assert metrics[direction]["matrix_max_abs_error"] < MATRIX_TOLERANCE
        assert metrics[direction]["max_angular_residual_rad"] < DIRECTION_TOLERANCE_RAD
        assert metrics[direction]["max_angular_residual_deg"] >= 0.0
        assert metrics[direction]["rms_angular_residual_deg"] >= 0.0
