import json
import math

import pytest
import yaml

from lumen_pipeline.ephem.dsn import STATIONS
from lumen_pipeline.ephem.kernels import loaded_kernels
from lumen_pipeline.validation.horizons_client import (
    AZIMUTH_TOLERANCE_DEG,
    DSN_ARTIFACT_TOLERANCE_PROPOSAL_DEG,
    DSN_ELEVATION_TOLERANCE_DEG,
    DSN_QUANTIZATION_HALF_STEP_DEG,
    ELEVATION_TOLERANCE_DEG,
    EPOCHS_PER_SITE,
    RANGE_TOLERANCE_KM,
    SITE_CASES,
    Comparison,
    DsnComparison,
    SiteCase,
    _spice_observation,
    assert_g3_tolerances,
    assert_g3b_tolerances,
    assert_site_cases_match_config,
    dsn_fixture_path,
    fixture_path,
    load_dsn_fixture,
    load_fixture,
    run_g3,
    run_g3b,
    run_g3b_artifact,
)


def test_horizons_fixtures_are_traceable_and_complete():
    assert_site_cases_match_config()
    for site in SITE_CASES:
        for body in ("sun", "earth"):
            fixture_site, fixture_body, records = load_fixture(fixture_path(site, body))
            assert fixture_site == site
            assert fixture_body == body
            assert len(records) == EPOCHS_PER_SITE


def test_g3_de421_smooth_sphere_agrees_with_horizons():
    comparisons = run_g3()

    assert len(comparisons) == len(SITE_CASES) * EPOCHS_PER_SITE * 2
    assert_g3_tolerances(comparisons)
    assert max(result.elevation_error_deg for result in comparisons) < ELEVATION_TOLERANCE_DEG
    earth_range_errors = [result.range_error_km for result in comparisons if result.body == "earth"]
    assert max(earth_range_errors) < RANGE_TOLERANCE_KM
    azimuth_errors = [result.azimuth_error_deg for result in comparisons if result.azimuth_error_deg is not None]
    assert max(azimuth_errors) < AZIMUTH_TOLERANCE_DEG


def test_g3_equator_longitude_sign_sanity_check():
    _, _, records = load_fixture(fixture_path(SITE_CASES[-1], "earth"))

    assert all(record.elevation_deg > 75.0 for record in records)
    assert all(not math.isnan(record.azimuth_deg) for record in records)


def test_g3_exact_pole_skips_undefined_true_azimuth():
    with loaded_kernels():
        azimuth, elevation, distance = _spice_observation(
            SiteCase("south_pole", -90.0, 0.0), "earth", "2025-03-06T00:00:00Z"
        )

    assert math.isnan(azimuth)
    assert -90.0 <= elevation <= 90.0
    assert distance > 0.0


def test_g3_site_cases_reject_config_coordinate_drift(tmp_path):
    source = {
        "sites": [
            {"id": site.id, "latitude_deg": site.latitude_deg, "longitude_deg_east": site.longitude_deg_east}
            for site in SITE_CASES
            if site.id != "equator_zero"
        ]
    }
    source["sites"][0]["latitude_deg"] = 0.0
    path = tmp_path / "sites.yaml"
    path.write_text(yaml.safe_dump(source), encoding="utf-8")

    with pytest.raises(ValueError, match="coordinates differ"):
        assert_site_cases_match_config(path)


def test_g3_fixtures_reject_missing_provenance_and_frame_mismatch(tmp_path):
    payload = json.loads(fixture_path(SITE_CASES[0], "sun").read_text(encoding="utf-8"))
    payload.pop("fetched_utc")
    missing = tmp_path / "missing.json"
    missing.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="provenance"):
        load_fixture(missing)

    payload = json.loads(fixture_path(SITE_CASES[0], "sun").read_text(encoding="utf-8"))
    payload["request_parameters"]["CENTER"] = "'500@10'"
    mismatch = tmp_path / "mismatch.json"
    mismatch.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="R3 G3 query"):
        load_fixture(mismatch)


def test_g3_tolerance_boundaries_are_strict():
    below = Comparison("site", "earth", "2023-01-01T00:00:00Z", 0.009, 0.009, 0.9)
    assert_g3_tolerances((below,))
    with pytest.raises(AssertionError, match="elevation"):
        assert_g3_tolerances((Comparison("site", "sun", "utc", ELEVATION_TOLERANCE_DEG, 0.0, 0.0),))
    with pytest.raises(AssertionError, match="azimuth"):
        assert_g3_tolerances((Comparison("site", "sun", "utc", 0.0, AZIMUTH_TOLERANCE_DEG, 0.0),))
    with pytest.raises(AssertionError, match="range"):
        assert_g3_tolerances((Comparison("site", "earth", "utc", 0.0, 0.0, RANGE_TOLERANCE_KM),))


def test_g3b_fixtures_are_traceable_complete_and_within_tolerance():
    for station in STATIONS:
        fixture_station, records = load_dsn_fixture(dsn_fixture_path(station))
        assert fixture_station == station
        assert len(records) == 15
        assert sum(record.utc[:4] in ("2023", "2024") for record in records) == 10
        assert sum(record.utc[:4] in ("2029", "2030") for record in records) == 5

    comparisons = run_g3b()
    assert len(comparisons) == len(STATIONS) * 15
    assert_g3b_tolerances(comparisons)
    assert max(result.elevation_error_deg for result in comparisons) < DSN_ELEVATION_TOLERANCE_DEG


def test_g3b_published_dsn_artifact_records_quantization_separately():
    comparisons = run_g3b_artifact()

    assert len(comparisons) == len(STATIONS) * 15
    assert max(item.direct_elevation_error_deg for item in comparisons) < DSN_ELEVATION_TOLERANCE_DEG
    assert max(item.quantization_error_deg for item in comparisons) <= DSN_QUANTIZATION_HALF_STEP_DEG
    assert max(item.decoded_elevation_error_deg for item in comparisons) < DSN_ARTIFACT_TOLERANCE_PROPOSAL_DEG


def test_g3b_fixture_provenance_and_tolerance_boundary(tmp_path):
    payload = json.loads(dsn_fixture_path(STATIONS[0]).read_text(encoding="utf-8"))
    payload["queries"][0]["request_parameters"]["CENTER"] = "'DSS-43'"
    mismatch = tmp_path / "mismatch.json"
    mismatch.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="R3 G3b query"):
        load_dsn_fixture(mismatch)

    payload = json.loads(dsn_fixture_path(STATIONS[0]).read_text(encoding="utf-8"))
    payload["queries"][0].pop("request_url")
    missing_url = tmp_path / "missing-url.json"
    missing_url.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="request URL"):
        load_dsn_fixture(missing_url)

    assert_g3b_tolerances((DsnComparison("DSS-14", "utc", 0.099),))
    with pytest.raises(AssertionError, match="station-elevation"):
        assert_g3b_tolerances((DsnComparison("DSS-14", "utc", DSN_ELEVATION_TOLERANCE_DEG),))
