import json
from copy import deepcopy
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


def _assert_exact(expected, actual) -> None:
    if isinstance(expected, dict):
        assert expected.keys() == actual.keys()
        for key in expected:
            _assert_exact(expected[key], actual[key])
    elif isinstance(expected, list):
        assert len(expected) == len(actual)
        for expected_item, actual_item in zip(expected, actual, strict=True):
            _assert_exact(expected_item, actual_item)
    else:
        assert type(expected) is type(actual)
        assert expected == actual


def _assert_diagnostic_float(expected, actual) -> None:
    assert type(expected) is float
    assert type(actual) is float
    assert actual == pytest.approx(expected, rel=0.0, abs=1e-10)


def _assert_g1_report_equivalent(expected, actual) -> None:
    """Compare all G1 evidence while allowing only sub-ULP diagnostics to vary."""
    assert expected.keys() == actual.keys()
    for key in ("schema_version", "id", "status", "criteria", "epochs_utc", "frames", "kernels", "reference"):
        _assert_exact(expected[key], actual[key])
    assert len(expected["epoch_results"]) == len(actual["epoch_results"])
    for expected_epoch, actual_epoch in zip(expected["epoch_results"], actual["epoch_results"], strict=True):
        assert expected_epoch.keys() == actual_epoch.keys()
        _assert_exact(expected_epoch["utc"], actual_epoch["utc"])
        for key in (
            "et_seconds",
            "determinant_deviation_max_abs",
            "orthogonality_error_max_abs",
            "minimum_determinant",
            "round_trip_vector_error_m",
            "pa_me_max_surface_offset_m",
        ):
            _assert_diagnostic_float(expected_epoch[key], actual_epoch[key])
        for direction in ("pa_to_me", "me_to_pa"):
            assert expected_epoch[direction].keys() == actual_epoch[direction].keys()
            for key, expected_value in expected_epoch[direction].items():
                _assert_diagnostic_float(expected_value, actual_epoch[direction][key])
    assert expected["metrics"].keys() == actual["metrics"].keys()
    for key, expected_value in expected["metrics"].items():
        if isinstance(expected_value, dict):
            assert expected_value.keys() == actual["metrics"][key].keys()
            for nested_key, nested_value in expected_value.items():
                _assert_diagnostic_float(nested_value, actual["metrics"][key][nested_key])
        else:
            _assert_diagnostic_float(expected_value, actual["metrics"][key])


def _assert_g1_thresholds(report):
    metrics = report["metrics"]
    assert metrics["max_matrix_error"] < MATRIX_TOLERANCE
    assert metrics["max_direction_error_rad"] < DIRECTION_TOLERANCE_RAD
    assert metrics["orthogonality_error_max_abs"] <= MATRIX_TOLERANCE
    assert metrics["minimum_determinant"] > 0.0
    for direction in ("pa_to_me", "me_to_pa"):
        assert metrics[direction]["matrix_max_abs_error"] < MATRIX_TOLERANCE
        assert metrics[direction]["max_angular_residual_rad"] < DIRECTION_TOLERANCE_RAD


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
    _assert_g1_report_equivalent(persisted_report, report)
    _assert_g1_thresholds(persisted_report)
    _assert_g1_thresholds(report)
    assert report["frames"]["principal_axis"]["name"] == "MOON_PA_DE421"
    assert report["frames"]["mean_earth"]["name"] == "MOON_ME_DE421"
    assert report["frames"]["mean_earth"]["relative_to"] == "MOON_PA_DE421"
    assert report["metrics"]["pa_me_surface_offset_m"] == pytest.approx(
        874.7474688514714, abs=1e-6
    )



def test_g1_comparator_rejects_changed_evidence():
    expected = json.loads(default_output_path().read_text(encoding="utf-8"))
    for mutate in (
        lambda report: report["reference"].update(independent_implementation="other"),
        lambda report: report["metrics"].pop("max_matrix_error"),
        lambda report: report["epochs_utc"].__setitem__(0, "2023-01-02T00:00:00Z"),
        lambda report: report["metrics"]["pa_to_me"].update(max_angular_residual_rad=1e-6),
    ):
        actual = deepcopy(expected)
        mutate(actual)
        with pytest.raises(AssertionError):
            _assert_g1_report_equivalent(expected, actual)
