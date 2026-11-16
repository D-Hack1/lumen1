import json

import pytest

from lumen_pipeline.validation.g7 import (
    REFERENCE_ELEVATION_DEG,
    REFERENCE_SOURCE,
    TOLERANCE_DEG,
    build_g7_report,
    write_g7_report,
)


def test_g7_report_reproduces_touchdown_reference_and_provenance(tmp_path):
    report_path = tmp_path / "g7.json"
    repeated_path = tmp_path / "g7-repeated.json"
    report = write_g7_report(report_path)
    write_g7_report(repeated_path)
    reread = json.loads(report_path.read_text(encoding="utf-8"))

    assert reread == report
    assert report_path.read_bytes() == repeated_path.read_bytes()
    assert report["calculation_status"] == "COMPUTED", json.dumps(
        {
            "numerical_result": report["numerical_result"],
            "provenance_result": report["provenance_result"],
            "sun_elevation_deg": report["computed"]["sun_elevation_deg"],
            "absolute_error_deg": report["absolute_error_deg"],
            "ephemeris_hash_matches_sidecar": report["ephemeris"][
                "ephemeris_hash_matches_sidecar"
            ],
            "kernel_hashes_match_sidecar": report["ephemeris"]["kernel_hashes_match_sidecar"],
            "failure_reasons": report["failure_reasons"],
        },
        sort_keys=True,
    )
    assert report["timestamp_utc"] == "2023-08-23T12:33:00Z"
    assert report["coordinates"]["latitude_deg"] == pytest.approx(-69.373)
    assert report["coordinates"]["longitude_deg_east"] == pytest.approx(32.319)
    assert report["reference"]["sun_elevation_deg"] == REFERENCE_ELEVATION_DEG
    assert report["reference"]["recorded_tolerance_deg"] == TOLERANCE_DEG
    assert report["absolute_error_deg"] == pytest.approx(
        abs(report["computed"]["sun_elevation_deg"] - REFERENCE_ELEVATION_DEG)
    )
    # The 8.75 deg reference is now sourced (TOI 2023-09-02, project director) and evaluated against the plan's +/-0.25 deg tolerance.
    assert report["numerical_result"] == ("PASS" if report["absolute_error_deg"] <= TOLERANCE_DEG else "FAIL")
    assert report["source_provenance_result"] == "PASS"
    expected_provenance_reasons = []
    if not report["ephemeris"]["ephemeris_hash_matches_sidecar"]:
        expected_provenance_reasons.append("ephemeris_sha256_mismatch")
    if not report["ephemeris"]["kernel_hashes_match_sidecar"]:
        expected_provenance_reasons.append("kernel_sha256_mismatch")
    assert report["provenance_result"] == (
        "PASS" if not expected_provenance_reasons else "FAIL"
    )
    assert report["failure_reasons"]["numerical"] == ([] if report["numerical_result"] == "PASS" else ["outside_tolerance"])
    assert report["failure_reasons"]["provenance"] == expected_provenance_reasons
    assert report["failure_reasons"]["timeline"] == []
    assert report["qualitative_timeline_check"]["status"] == "PASS"
    expected = "PASS" if (report["numerical_result"] == "PASS" and report["provenance_result"] == "PASS") else "FAIL"
    assert report["status"] == expected
    assert report["qualitative_timeline_check"]["sun_below_6_deg_utc"].startswith("2023-09-")
    assert report["ephemeris"]["ephemeris_hash_matches_sidecar"]
    assert report["reference"]["primary_source_status"] == "MISSION_TEAM_STATEMENT_IN_PRESS"
    assert report["reference"]["source_metadata"] == REFERENCE_SOURCE
    assert report["reference"]["source_metadata"]["source_url"].startswith("https://timesofindia.indiatimes.com/")
    assert "8.75" in report["reference"]["source_metadata"]["quoted_numerical_claim"]
    assert report["reference"]["source_metadata"]["reported_uncertainty_deg"] is None  # the source states none; the tolerance is the plan's
    assert any(source["supports_8_75_degree_claim"] for source in report["reference"]["source_metadata"]["sources_examined"])
    assert report["calculation_assumptions"]["touchdown_time"]["value_utc"] == report["timestamp_utc"]
    assert report["calculation_assumptions"]["landing_location"]["latitude_deg"] == pytest.approx(
        -69.373
    )
    assert report["coordinates"]["status"] == "SOURCE_UNVERIFIED"
    assert report["coordinates"]["observed_landing_fix"]["latitude_deg"] == pytest.approx(-69.3741)
    assert report["coordinates"]["planned_target"]["longitude_deg_east"] == pytest.approx(32.348126)
    assert report["calculation_assumptions"]["reference_frame"]["value"] == "MOON_ME_DE421"
    assert report["calculation_assumptions"]["sun_elevation_definition"][
        "reported_claim_limb_convention"
    ] == "NOT_STATED_BY_SOURCE"
    im2 = report["im2_touchdown_conditions"]
    assert im2["status"] == "SOURCE_UNVERIFIED"
    assert im2["timestamp_utc"] == "2025-03-06T17:28:50Z"
    assert im2["coordinates"]["latitude_deg"] == pytest.approx(-84.7906)
    assert im2["coordinates"]["longitude_deg_east"] == pytest.approx(29.1957)
    assert im2["coordinates"]["status"] == "SOURCE_UNVERIFIED"
    assert -90.0 <= im2["computed"]["sun_elevation_deg"] <= 90.0
    assert -90.0 <= im2["computed"]["earth_elevation_deg"] <= 90.0


def test_g7_uses_landing_coordinates_not_prelanding_target():
    report = build_g7_report()

    assert report["coordinates"]["latitude_deg"] == pytest.approx(-69.373)
    assert report["coordinates"]["longitude_deg_east"] == pytest.approx(32.319)
    assert report["coordinates"]["latitude_deg"] != pytest.approx(-69.367621)
    assert report["coordinates"]["longitude_deg_east"] != pytest.approx(32.348126)
