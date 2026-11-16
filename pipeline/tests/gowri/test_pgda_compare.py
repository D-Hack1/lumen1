from lumen_pipeline.validation.pgda_compare import compare_pgda, evaluate_records


def _record(reference=10.0, tolerance=0.5):
    return {
        "site": {"id": "test-site", "latitude_deg": -89.0, "longitude_deg_east": 45.0, "height_m": 2.0},
        "timestamp_utc": "2025-01-01T00:00:00Z",
        "body": "sun",
        "elevation_deg": reference,
        "tolerance_deg": tolerance,
    }


def test_pgda_comparison_reports_values_errors_and_inclusive_tolerance():
    report = evaluate_records("PGDA", "documented-version", [_record()], lambda *_args: 10.5)

    assert report["status"] == "PASS"
    assert report["comparisons"] == [
        {
            "site_id": "test-site",
            "latitude_deg": -89.0,
            "longitude_deg_east": 45.0,
            "height_m": 2.0,
            "timestamp_utc": "2025-01-01T00:00:00Z",
            "body": "sun",
            "computed_elevation_deg": 10.5,
            "reference_elevation_deg": 10.0,
            "absolute_error_deg": 0.5,
            "tolerance_deg": 0.5,
            "status": "PASS",
        }
    ]


def test_pgda_comparison_fails_above_tolerance():
    assert evaluate_records("PGDA", "documented-version", [_record()], lambda *_args: 10.5001)["status"] == "FAIL"


def test_pgda_comparison_is_blocked_without_documented_references(tmp_path):
    report = compare_pgda(tmp_path / "missing.json", tmp_path / "unused.bin")

    assert report["status"] == "BLOCKED"
    assert report["comparisons"] == []
