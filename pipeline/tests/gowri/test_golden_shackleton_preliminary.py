import json

import numpy as np
import pytest
import yaml

from lumen_pipeline.reference.events import detect_events, sample_times
from lumen_pipeline.reference.interp import Ephemeris
from lumen_pipeline.reference.visibility import Horizon, availability
from lumen_pipeline.validation.golden_shackleton_preliminary import (
    EVENT_RANGE_UTC,
    HEIGHTS_M,
    INTERPOLATION_AZIMUTHS_DEG,
    LATITUDE_DEG,
    LONGITUDE_DEG_EAST,
    REPRESENTATIVE_TIMESTAMPS,
    _data_root,
    _ephemeris_et,
    _load_mask,
    build_preliminary_golden_set,
    preliminary_golden_payload,
)


def _case(payload, case_id):
    return next(case for case in payload["cases"] if case["id"] == case_id)


def _assert_fixture_equal(expected, actual, tolerances, field_name=""):
    if isinstance(expected, dict):
        assert isinstance(actual, dict)
        assert actual.keys() == expected.keys()
        for key, value in expected.items():
            _assert_fixture_equal(value, actual[key], tolerances, key)
    elif isinstance(expected, list):
        assert isinstance(actual, list)
        assert len(actual) == len(expected)
        for value, actual_value in zip(expected, actual, strict=True):
            _assert_fixture_equal(value, actual_value, tolerances, field_name)
    elif isinstance(expected, float) and field_name.endswith("_deg"):
        assert actual == pytest.approx(expected, abs=tolerances["angle_deg"])
    elif isinstance(expected, float) and field_name.endswith("_km"):
        assert actual == pytest.approx(expected, abs=tolerances["distance_km"])
    else:
        assert actual == expected


def test_preliminary_shackleton_fixture_is_deterministic_and_explicitly_scoped(tmp_path):
    output = tmp_path / "shackleton.json"
    payload = build_preliminary_golden_set(output)
    committed = _data_root() / "golden" / "golden_set2_shackleton_preliminary.json"

    assert json.loads(output.read_text(encoding="utf-8")) == payload
    _assert_fixture_equal(json.loads(committed.read_text(encoding="utf-8")), payload, payload["tolerances"])
    assert payload["provenance"]["label"] == "Python-generated preliminary parity fixtures"
    assert "not independently verified scientific ground truth" in payload["description"]
    assert "unavailable" in payload["provenance"]["terrain_sigma"]
    assert payload["provenance"]["pgda_reference_measurements"] == "not asserted"


def test_preliminary_shackleton_mask_invariants_and_interpolation():
    payload = preliminary_golden_payload()
    elevation, distance, metadata, _ = _load_mask()
    expected = _case(payload, "shackleton_ridge_mask_numerical_invariants")["expected"]
    data_root = _data_root()
    manifest = json.loads((data_root / "terrain" / "manifest.json").read_text(encoding="utf-8"))
    summary = json.loads((data_root / "terrain" / "summaries" / "shackleton_ridge.json").read_text(encoding="utf-8"))
    sites = yaml.safe_load((data_root.parents[2] / "pipeline" / "config" / "sites.yaml").read_text(encoding="utf-8"))
    site = next(record for record in sites["sites"] if record["id"] == "shackleton_ridge")

    assert metadata["site_id"] == "shackleton_ridge"
    assert metadata["heights_m"] == list(HEIGHTS_M)
    assert metadata["binary"] == {
        "magic": "LUMENMSK",
        "format_version": 1,
        "byte_order": "little",
        "float_encoding": "ieee754-binary32",
        "layout": "header_then_elevation_then_distance",
        "array_order": "c_contiguous_height_major",
    }
    assert metadata["dem_crops"]["near"]["frame"] == "MOON_ME / DE421"
    assert all(
        crop["unit"] == "m" and crop["scale"] == 1.0 and crop["offset"] == 0.0 and crop["nodata"] is None
        for crop in metadata["dem_crops"].values()
    )
    assert summary["site_id"] == metadata["site_id"] == manifest["artifacts"]["shackleton_ridge"]["site_id"]
    assert summary["tier"] == "Tier A"
    assert summary["sigma_available"] is False
    assert summary["pad_available"] is False
    assert site["latitude_deg"] == LATITUDE_DEG
    assert site["longitude_deg_east"] == LONGITUDE_DEG_EAST
    assert manifest["artifacts"]["shackleton_ridge"]["files"]["mask_bin"]["sha256"] == expected["sha256"]
    assert elevation.shape == distance.shape == (4, 3600)
    assert np.array_equal(np.isfinite(elevation), np.isfinite(distance))
    assert np.sum(np.isfinite(elevation), axis=1).tolist() == expected["finite_elevation_count_by_height"]
    assert np.nanmin(elevation, axis=1).tolist() == pytest.approx(expected["elevation_min_deg"])
    assert np.nanmax(elevation, axis=1).tolist() == pytest.approx(expected["elevation_max_deg"])
    assert np.nanmin(distance, axis=1).tolist() == pytest.approx(expected["distance_min_km"])
    assert np.nanmax(distance, axis=1).tolist() == pytest.approx(expected["distance_max_km"])

    interpolation = _case(payload, "shackleton_ridge_horizon_interpolation")["expected"]
    for height, row in zip(HEIGHTS_M, elevation, strict=True):
        horizon = Horizon(row, observer_height_m=height)
        assert [horizon.elevation_at(azimuth) for azimuth in INTERPOLATION_AZIMUTHS_DEG] == pytest.approx(
            interpolation[str(int(height))], abs=payload["tolerances"]["angle_deg"]
        )


def test_preliminary_shackleton_visibility_all_heights_and_event_consistency():
    payload = preliminary_golden_payload()
    elevation, _, _, _ = _load_mask()
    horizons = [Horizon(row, observer_height_m=height) for height, row in zip(HEIGHTS_M, elevation, strict=True)]
    ephemeris = Ephemeris.from_file(_data_root() / "ephem" / "ephem.bin")
    tolerance = payload["tolerances"]

    ephemeris_metadata = json.loads((_data_root() / "ephem" / "ephem.json").read_text(encoding="utf-8"))
    for timestamp in REPRESENTATIVE_TIMESTAMPS:
        expected = _case(payload, f"shackleton_ridge_visibility_{timestamp[:10]}")["expected"]
        et = _ephemeris_et(ephemeris, ephemeris_metadata, timestamp)
        for body in ("sun", "earth"):
            geometry = ephemeris.body_at(body, et, LATITUDE_DEG, LONGITUDE_DEG_EAST)
            assert geometry.azimuth_deg == pytest.approx(expected[body]["azimuth_deg"], abs=tolerance["angle_deg"])
            assert geometry.elevation_deg == pytest.approx(expected[body]["elevation_deg"], abs=tolerance["angle_deg"])
            assert geometry.distance_km == pytest.approx(expected[body]["distance_km"], abs=tolerance["distance_km"])
            for height, horizon in zip(HEIGHTS_M, horizons, strict=True):
                fraction, clearance, visible = availability(
                    body, geometry.elevation_deg, geometry.azimuth_deg, geometry.distance_km, horizon, disk_threshold=0.5
                )
                wanted = expected[body]["by_height_m"][str(int(height))]
                assert fraction == pytest.approx(wanted["disk_fraction"], abs=tolerance["angle_deg"])
                assert clearance == pytest.approx(wanted["clearance_deg"], abs=tolerance["angle_deg"])
                assert visible is wanted["visible"]

    event_expected = _case(payload, "shackleton_ridge_sun_event_consistency_30d_10m")["expected"]
    start_et, end_et = (_ephemeris_et(ephemeris, ephemeris_metadata, timestamp) for timestamp in EVENT_RANGE_UTC)
    horizon = horizons[-1]

    def visible_at(et):
        geometry = ephemeris.body_at("sun", et, LATITUDE_DEG, LONGITUDE_DEG_EAST)
        return availability(
            "sun", geometry.elevation_deg, geometry.azimuth_deg, geometry.distance_km, horizon, disk_threshold=0.5
        )[2]

    times = sample_times(start_et, end_et)
    events = detect_events(start_et, end_et, visible_at, down="sunset", up="shadowExit")
    assert len(times) == 30 * 24 * 30 + 1
    assert times[-1] == end_et
    assert len(times) == event_expected["sample_count"]
    assert sum(bool(visible_at(time)) for time in times) == event_expected["sample_visible_count"]
    assert events == []
