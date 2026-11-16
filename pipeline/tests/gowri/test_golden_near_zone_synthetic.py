import hashlib
import json
import math

import numpy as np
import pytest

from lumen_pipeline.terrain.masks import _apply_near_zone
from lumen_pipeline.validation.golden_near_zone_synthetic import (
    BIN_WIDTH_DEG,
    HEIGHTS_M,
    _near,
    build_synthetic_near_zone_golden_set,
    default_synthetic_output_path,
    synthetic_near_zone_payload,
)


def _fixture() -> dict[str, object]:
    return _strict_json_loads(default_synthetic_output_path().read_bytes())


def _strict_json_loads(payload):
    def reject_constant(value):
        raise ValueError(f"non-standard JSON constant: {value}")

    return json.loads(payload, parse_constant=reject_constant)


def _finite_projection(payload):
    return [
        [case["id"], item["azimuth_bin"], item["observer_height_m"], key, item[key]]
        for case in payload["cases"]
        for item in case["selected_bins"]
        for key in ("expected_elevation_deg", "expected_distance_km")
        if item[key] is not None
    ]


def test_near_zone_synthetic_fixture_is_deterministic_and_committed(tmp_path):
    first = tmp_path / "first.json"
    second = tmp_path / "second.json"

    payload = build_synthetic_near_zone_golden_set(first)
    build_synthetic_near_zone_golden_set(second)

    # Repeated generation must produce identical bytes.
    assert first.read_bytes() == second.read_bytes()

    # Normalize line endings for cross-platform comparison.
    generated_bytes = first.read_bytes().replace(b"\r\n", b"\n")
    committed_bytes = default_synthetic_output_path().read_bytes().replace(
        b"\r\n", b"\n"
    )

    assert generated_bytes == committed_bytes

    # Verify canonical JSON serialization with an LF terminator.
    expected_bytes = (
        json.dumps(
            synthetic_near_zone_payload(),
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")

    assert generated_bytes == expected_bytes

    generated = _strict_json_loads(first.read_bytes())
    committed = _strict_json_loads(committed_bytes)
    assert generated == committed == payload == synthetic_near_zone_payload()
    assert json.dumps(payload, allow_nan=False)

    assert payload["array_initialization"] == {
        "shape": [4, 3600],
        "order": "height_major",
        "unselected_elevation_deg": "NaN",
        "unselected_distance_km": "NaN",
        "json_null": "null",
        "selected_bins": "override defaults with distant inputs",
    }

    assert payload["azimuth_bins"]["center_deg"] == (
        "(azimuth_bin + 0.5) * 0.1"
    )
    assert payload["observer_heights_m"] == list(HEIGHTS_M)


def test_near_zone_synthetic_fixture_preserves_null_positions_and_finite_values():
    payload = _fixture()
    expected_nulls = {
        (case_id, bin_index, height_m, key)
        for case_id, bin_index, heights in (
            ("flat_retention_nan_and_negative_replacement", 1800, HEIGHTS_M),
            ("twenty_degree_cardinal_and_wraparound", 900, (5.0,)),
            ("twenty_degree_cardinal_and_wraparound", 2700, (5.0,)),
        )
        for height_m in heights
        for key in ("expected_elevation_deg", "expected_distance_km")
    }
    actual_nulls = {
        (case["id"], item["azimuth_bin"], item["observer_height_m"], key)
        for case in payload["cases"]
        for item in case["selected_bins"]
        for key in ("expected_elevation_deg", "expected_distance_km")
        if item[key] is None
    }
    finite_values = _finite_projection(payload)
    digest = hashlib.sha256(
        json.dumps(
            finite_values,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode()
    ).hexdigest()

    assert actual_nulls == expected_nulls
    assert len(finite_values) == 52
    assert digest == "1a52507de71a594ac1747138966858ad169936ffc9df1b3d7ac87a61ca0d0458"


def test_near_zone_synthetic_fixture_replays_production_helper():
    payload = _fixture()
    tolerance = payload["tolerances"]

    azimuth = (
        np.arange(3600, dtype=np.float64) + 0.5
    ) * BIN_WIDTH_DEG

    for case in payload["cases"]:
        elevation = np.full((4, 3600), np.nan, dtype=np.float64)
        distance = np.full((4, 3600), np.nan, dtype=np.float64)

        for item in case["selected_bins"]:
            height_index = HEIGHTS_M.index(item["observer_height_m"])

            elevation[height_index, item["azimuth_bin"]] = (
                item["distant_elevation_deg"]
            )
            distance[height_index, item["azimuth_bin"]] = (
                item["distant_distance_km"]
            )

        _apply_near_zone(
            elevation,
            distance,
            _near(case["slope_deg"], case["uphill_azimuth_deg"]),
            HEIGHTS_M,
            azimuth,
        )

        for item in case["selected_bins"]:
            height_index = HEIGHTS_M.index(item["observer_height_m"])
            bin_index = item["azimuth_bin"]

            expected_elevation = item["expected_elevation_deg"]
            expected_distance = item["expected_distance_km"]

            if expected_elevation is None or (
                isinstance(expected_elevation, float)
                and math.isnan(expected_elevation)
            ):
                assert math.isnan(elevation[height_index, bin_index])
            else:
                assert elevation[height_index, bin_index] == pytest.approx(
                    expected_elevation,
                    abs=tolerance["elevation_deg"],
                )

            if expected_distance is None or (
                isinstance(expected_distance, float)
                and math.isnan(expected_distance)
            ):
                assert math.isnan(distance[height_index, bin_index])
            else:
                assert distance[height_index, bin_index] == pytest.approx(
                    expected_distance,
                    abs=tolerance["distance_km"],
                )


def test_near_zone_synthetic_fixture_matches_independent_plane_analytic():
    payload = _fixture()
    tolerance = payload["tolerances"]

    for case in payload["cases"]:
        slope = math.radians(case["slope_deg"])
        uphill = math.radians(case["uphill_azimuth_deg"])
        d_min_m = case["d_min_m"]

        for item in case["selected_bins"]:
            plane_elevation = max(
                0.0,
                math.degrees(
                    math.atan(
                        math.tan(slope)
                        * math.cos(
                            math.radians(item["azimuth_deg"]) - uphill
                        )
                        - item["observer_height_m"] / d_min_m
                    )
                ),
            )

            distant_elevation = item["distant_elevation_deg"]

            replaces_distant = plane_elevation > 0.0 and (
                distant_elevation is None
                or plane_elevation > distant_elevation
            )

            expected_elevation = (
                plane_elevation
                if replaces_distant
                else distant_elevation
            )

            expected_distance = (
                d_min_m / 1000.0
                if replaces_distant
                else item["distant_distance_km"]
            )

            if expected_elevation is None:
                assert item["expected_elevation_deg"] is None
            else:
                assert item["expected_elevation_deg"] == pytest.approx(
                    expected_elevation,
                    abs=tolerance["elevation_deg"],
                )

            if expected_distance is None:
                assert item["expected_distance_km"] is None
            else:
                assert item["expected_distance_km"] == pytest.approx(
                    expected_distance,
                    abs=tolerance["distance_km"],
                )

    # Regression: a zero near-zone occluder must preserve
    # the negative distant DEM horizon.
    slope_case = next(
        case
        for case in payload["cases"]
        if case["slope_deg"] == 20.0
    )

    downhill_negative = next(
        item
        for item in slope_case["selected_bins"]
        if item["azimuth_bin"] == 1800
        and item["observer_height_m"] == 1.0
    )

    assert downhill_negative["distant_elevation_deg"] < 0.0
    assert downhill_negative["expected_elevation_deg"] == -1.0
    assert downhill_negative["expected_distance_km"] == 1.0
