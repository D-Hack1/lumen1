import hashlib
import json
import math

import numpy as np
import pytest

from lumen_pipeline.reference.bounds import WindowSpec, disk_fraction_visible, evaluate_with_bounds
from lumen_pipeline.reference.dsn import DsnSeries, evaluate_link_windows
from lumen_pipeline.reference.events import (
    EnvelopeBounds,
    Event,
    detect_events,
    sample_times_guarded,
)
from lumen_pipeline.reference.metrics import first_pass_metrics, power_series_metrics
from lumen_pipeline.reference.power import Panel, evaluate_power_series
from lumen_pipeline.reference.uncertainty import (
    exact_event_uncertainty,
    fast_event_uncertainty,
    limb_offset_deg,
    numeric_bounds,
    three_pass_bounds,
    total_clearance_rate_deg_per_hour,
)
from lumen_pipeline.reference.visibility import Horizon, availability, disk_fraction
from lumen_pipeline.reference.windows import (
    merge_windows,
    resolve_min_sun_elevation_ops,
    windows_from_events,
)
from lumen_pipeline.validation.golden_synthetic import (
    build_synthetic_golden_set,
    default_synthetic_output_path,
    synthetic_golden_payload,
)

EXPECTED_CASE_IDS = (
    "synthetic_flat_visibility_boundaries",
    "synthetic_terrain_mask_boundary",
    "synthetic_disk_limb_conventions",
    "synthetic_disk_span_extrema",
    "synthetic_nan_wraparound_extrema",
    "synthetic_event_at_window_start",
    "synthetic_refined_visibility_window",
    "synthetic_total_clearance_rate",
    "synthetic_three_pass_bounds",
    "synthetic_exact_event_uncertainty",
    "synthetic_disk_event_thresholds",
    "synthetic_grazing_rate",
    "synthetic_near_zone_slope_edges",
    "synthetic_guarded_span_spike",
    "synthetic_tier_c_smooth_moon",
    "synthetic_min_sun_elevation_ops",
    "synthetic_power_eclipse_soc",
    "synthetic_dsn_link_modes",
    "synthetic_dsn_out_of_coverage",
)
NEW_CASE_IDS = {
    "synthetic_disk_span_extrema",
    "synthetic_nan_wraparound_extrema",
    "synthetic_disk_event_thresholds",
}
EXISTING_CASE_IDS = tuple(case_id for case_id in EXPECTED_CASE_IDS if case_id not in NEW_CASE_IDS)
EXISTING_CASES_SHA256 = "54444f429f91259813f7bcc128a88cf287b388eceb1d1d6ad7fd6c5b8ee22154"


def _case(payload, case_id):
    return next(case for case in payload["cases"] if case["id"] == case_id)


def _reject_json_constant(value):
    raise ValueError(f"non-standard JSON constant: {value}")


def _pair_nearest(event, candidates):
    matching = (candidate for candidate in candidates if candidate.type == event.type)
    return min(matching, key=lambda candidate: abs(candidate.et - event.et), default=None)


def test_synthetic_golden_set_schema_and_determinism(tmp_path):
    first = tmp_path / "first.json"
    second = tmp_path / "second.json"
    payload = build_synthetic_golden_set(first)
    build_synthetic_golden_set(second)

    first_bytes = first.read_bytes()
    assert first_bytes == second.read_bytes()
    assert b"\r" not in first_bytes
    assert json.loads(first_bytes, parse_constant=_reject_json_constant) == payload
    committed = default_synthetic_output_path()
    committed_bytes = committed.read_bytes()
    assert first_bytes == committed_bytes.replace(b"\r\n", b"\n")
    assert json.loads(committed_bytes, parse_constant=_reject_json_constant) == payload
    assert payload["set"] == 2
    assert payload["provenance"]["synthetic"] is True
    assert payload["provenance"]["terrain_artifacts"] == "none"
    assert tuple(case["id"] for case in payload["cases"]) == EXPECTED_CASE_IDS
    assert json.dumps(payload, allow_nan=False)
    assert all(set(payload["case_schema"]["required"]) <= set(case) for case in payload["cases"])
    assert len({case["id"] for case in payload["cases"]}) == len(payload["cases"])


def test_typescript_parity_metadata_covers_each_case_once():
    payload = synthetic_golden_payload()
    parity = payload["typescript_parity"]
    classified = [*parity["full"], *parity["partial"], *parity["python_only"]]
    assert len(classified) == len(set(classified))
    assert set(classified) == set(EXPECTED_CASE_IDS)
    assert {
        "synthetic_disk_span_extrema",
        "synthetic_nan_wraparound_extrema",
        "synthetic_disk_event_thresholds",
        "synthetic_dsn_out_of_coverage",
    } <= set(parity["full"])
    assert set(_case(payload, "synthetic_dsn_out_of_coverage")["expected"]["dsn_aware"]) == {
        "event_types",
        "event_times_et",
        "link_pct",
        "longest_comm_gap_hours",
    }


def test_existing_golden_set2_cases_have_no_drift_and_all_set2_fixtures_are_strict():
    payload = synthetic_golden_payload()
    existing_cases = [case for case in payload["cases"] if case["id"] in EXISTING_CASE_IDS]
    assert tuple(case["id"] for case in existing_cases) == EXISTING_CASE_IDS
    digest = hashlib.sha256(
        json.dumps(existing_cases, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()
    assert digest == EXISTING_CASES_SHA256

    fixture_dir = default_synthetic_output_path().parent
    for path in fixture_dir.glob("golden_set2*.json"):
        json.loads(path.read_bytes(), parse_constant=_reject_json_constant)


def test_synthetic_golden_vectors_match_reference_primitives():
    payload = synthetic_golden_payload()
    flat = _case(payload, "synthetic_flat_visibility_boundaries")
    for expected in flat["expected"]["visibility"]:
        fraction, clearance, visible = availability("sun", expected["elevation_deg"], 0.0, 149597870.7, Horizon(np.zeros(3600)), disk_threshold=0.5)
        assert clearance == pytest.approx(expected["clearance_deg"])
        assert fraction == expected["disk_fraction"]
        assert visible is expected["visible"]

    terrain = _case(payload, "synthetic_terrain_mask_boundary")
    for expected in terrain["expected"]["visibility"]:
        _, clearance, visible = availability("sun", expected["elevation_deg"], 0.0, 149597870.7, Horizon(np.full(3600, 4.0)), disk_threshold=0.5)
        assert clearance == pytest.approx(expected["clearance_deg"])
        assert visible is expected["visible"]

    limbs = _case(payload, "synthetic_disk_limb_conventions")["expected"]["limb_clearance_offset_deg"]
    assert limb_offset_deg(0.0, 0.25) == limbs["disk_0_pct"]
    assert limb_offset_deg(0.5, 0.25) == limbs["disk_50_pct"]
    assert limb_offset_deg(1.0, 0.25) == limbs["disk_100_pct"]

    span = _case(payload, "synthetic_disk_span_extrema")
    span_input = span["input"]
    mask = np.zeros(3600)
    mask[-1] = span_input["spike_elevation_deg"]
    assert disk_fraction(
        "sun",
        span_input["sun_elevation_deg"],
        span_input["centre_azimuth_deg"],
        149597870.7,
        Horizon(mask),
    ) < span["expected"]["disk_fraction_lt"]

    nan_wrap = _case(payload, "synthetic_nan_wraparound_extrema")
    nan_input = nan_wrap["input"]
    elevations = np.array([np.nan if value is None else value for value in nan_input["elevations_deg"]])
    assert Horizon(elevations, bin_width_deg=nan_input["bin_width_deg"]).extrema(0.0, 180.0) == pytest.approx(
        (nan_wrap["expected"]["minimum_deg"], nan_wrap["expected"]["maximum_deg"])
    )

    thresholds = _case(payload, "synthetic_disk_event_thresholds")["expected"]
    assert disk_fraction_visible(0.0, 0.0) is thresholds["zero_visible_at_zero"]
    assert disk_fraction_visible(0.5, 0.5) is thresholds["half_visible_at_half"]
    assert disk_fraction_visible(1.0, 1.0) is thresholds["full_visible_at_full"]


def test_synthetic_golden_events_uncertainty_and_slope_edges():
    payload = synthetic_golden_payload()
    events = detect_events(0.0, 240.0, lambda et: et >= 0.0, down="sunset", up="shadowExit")
    window = merge_windows("sun", [0.0, 120.0, 240.0], [True, True, True], [1.0, 1.0, 1.0])[0]
    expected_window = _case(payload, "synthetic_event_at_window_start")["expected"]
    assert events == expected_window["events"]
    assert window.partial_start is expected_window["window"]["partial_start"]

    horizon = Horizon(np.arange(3600, dtype=float) * 0.01)
    rate = total_clearance_rate_deg_per_hour(100.0, lambda et: (5.0 + 0.001 * et, 10.0 + 0.1 * et), horizon)
    assert rate == pytest.approx(_case(payload, "synthetic_total_clearance_rate")["expected"]["clearance_rate_deg_per_hour"])

    bounds_case = _case(payload, "synthetic_three_pass_bounds")
    bounds_input = bounds_case["input"]
    sigma_horizon = Horizon(np.full(3600, bounds_input["mask_deg"]))
    bounds = numeric_bounds(
        three_pass_bounds(
            sigma_horizon,
            bounds_input["sigma_deg"],
            lambda current: current.elevation_at(0.0),
        )
    )
    assert bounds == pytest.approx(bounds_case["expected"]["numeric_bounds"])

    exact = exact_event_uncertainty(Event("sunset", 100.0), Event("sunset", 80.0), Event("sunset", 120.0))
    assert exact.delta_t_seconds == _case(payload, "synthetic_exact_event_uncertainty")["expected"]["delta_t_seconds"]

    grazing = fast_event_uncertainty(0.0, lambda _: (0.0, 0.0), Horizon(np.zeros(3600)), lambda _: 0.2)
    assert math.isinf(grazing.delta_t_seconds)
    assert grazing.grazing_reason == _case(payload, "synthetic_grazing_rate")["expected"]["grazing_reason"]

    slope = Horizon(np.full(3600, -1.0), slope_deg=10.0, uphill_azimuth_deg=0.0, d_min_m=15.0, observer_height_m=1.0)
    expected_slope = _case(payload, "synthetic_near_zone_slope_edges")["expected"]
    assert slope.effective_at(180.0) == pytest.approx(expected_slope["flat_or_downhill_effective_deg"])
    assert slope.effective_at(90.0) == pytest.approx(expected_slope["cross_slope_effective_deg"])
    assert slope.effective_at(0.0) == pytest.approx(expected_slope["uphill_effective_deg"], abs=0.005)


def test_synthetic_golden_ops_elevation_definition():
    expected = _case(synthetic_golden_payload(), "synthetic_min_sun_elevation_ops")["expected"]
    _, _, visible = availability("sun", 5.0, 0.0, 149597870.7, Horizon(np.zeros(3600)), disk_threshold=0.5, min_sun_elevation_ops_deg=6.0)
    assert visible is expected["visible"]
    assert resolve_min_sun_elevation_ops(0.0, expected["definitions_preset"]) == 6.0


def test_synthetic_golden_power_eclipse_soc_vector():
    case = _case(synthetic_golden_payload(), "synthetic_power_eclipse_soc")
    input_data = case["input"]
    expected = case["expected"]
    result = evaluate_power_series(
        input_data["times_et"],
        [np.array([0.0, 0.0, 1.0]), np.array([0.0, 0.0, 1.0])],
        [input_data["sun_distance_km"]] * 2,
        input_data["disk_fractions"],
        [Panel(np.array(input_data["panel_normal"]), input_data["panel_area_m2"], input_data["panel_efficiency"])],
        input_data["load_w"],
        battery_capacity_wh=input_data["battery_capacity_wh"],
        usable_depth_of_discharge=input_data["usable_depth_of_discharge"],
        initial_soc_fraction=input_data["initial_soc_fraction"],
    )
    assert result.generation_w.tolist() == pytest.approx(expected["generation_w"])
    assert result.net_w.tolist() == pytest.approx(expected["net_w"])
    assert result.stored_energy_wh.tolist() == pytest.approx(expected["stored_energy_wh"])
    assert power_series_metrics(input_data["times_et"], result).generated_energy_per_day_wh == pytest.approx(
        expected["energyPerDayWh"]
    )
    metrics = first_pass_metrics(
        input_data["times_et"],
        [True, False],
        [True, True],
        [1.0, 1.0],
        [1.0, 1.0],
        [1.0, 1.0],
        [1.0, 1.0],
        input_data["disk_fractions"],
        power=result,
    )
    assert metrics["energyPerDayWh"]["value"] == pytest.approx(expected["energyPerDayWh"])


def test_synthetic_golden_refined_windows_and_three_pass_bounds():
    payload = synthetic_golden_payload()
    refined = _case(payload, "synthetic_refined_visibility_window")
    expected_window = refined["expected"]["window"]
    predicate = lambda et: 120.0 <= et < 480.0
    events = detect_events(0.0, 600.0, predicate, down="sunset", up="shadowExit")
    windows = windows_from_events(
        "sun",
        0.0,
        600.0,
        False,
        events,
        down_event="sunset",
        up_event="shadowExit",
        peak_elevation_deg=lambda _start, _end: 1.0,
    )

    assert [event.type for event in events] == refined["expected"]["event_types"]
    assert [event.et for event in events] == pytest.approx(
        [expected_window["start_et"], expected_window["end_et"]], abs=10.0
    )
    assert len(windows) == 1
    assert windows[0].start_et == pytest.approx(expected_window["start_et"], abs=10.0)
    assert windows[0].end_et == pytest.approx(expected_window["end_et"], abs=10.0)
    assert (windows[0].partial_start, windows[0].partial_end) == (
        expected_window["partial_start"],
        expected_window["partial_end"],
    )

    bounds_case = _case(payload, "synthetic_three_pass_bounds")
    bounds_expected = bounds_case["expected"]
    bounds_input = bounds_case["input"]
    horizon = Horizon(np.full(3600, bounds_input["mask_deg"]))
    spec = WindowSpec(
        "sun",
        "sun_down",
        "sun_up",
        lambda et, shifted: 1.5 - abs(et - 360.0) / 120.0 >= shifted.effective_at(0.0),
        lambda _start, _end, _horizon: 1.0,
    )
    result = evaluate_with_bounds(
        *bounds_input["range_et"],
        horizon,
        bounds_input["sigma_deg"],
        [spec],
        pair_event=_pair_nearest,
    )
    bounded_window = result.windows["sun"][0]

    assert result.lower.events["sun"][0].et == pytest.approx(270.0, abs=10.0)
    assert bounded_window.start_et.lo == pytest.approx(bounds_expected["window_start_et"]["lo"], abs=10.0)
    assert bounded_window.start_et.value == pytest.approx(bounds_expected["window_start_et"]["value"], abs=10.0)
    assert bounded_window.start_et.hi == pytest.approx(bounds_expected["window_start_et"]["hi"], abs=10.0)
    assert bounded_window.end_et.lo == pytest.approx(bounds_expected["window_end_et"]["lo"], abs=10.0)
    assert bounded_window.end_et.value == pytest.approx(bounds_expected["window_end_et"]["value"], abs=10.0)
    assert bounded_window.end_et.hi == pytest.approx(bounds_expected["window_end_et"]["hi"], abs=10.0)
    assert bounded_window.duration_hours.lo == pytest.approx(bounds_expected["window_duration_hours"]["lo"], abs=20.0 / 3600.0)
    assert bounded_window.duration_hours.value == pytest.approx(bounds_expected["window_duration_hours"]["value"], abs=20.0 / 3600.0)
    assert bounded_window.duration_hours.hi == pytest.approx(bounds_expected["window_duration_hours"]["hi"], abs=20.0 / 3600.0)
    for key, expected in bounds_expected["sunlit_pct"].items():
        assert getattr(result.metrics["sunlitPct"], key) == pytest.approx(expected, abs=3.0)


def test_synthetic_golden_dsn_modes_and_guarded_span_spike():
    payload = synthetic_golden_payload()
    dsn_case = _case(payload, "synthetic_dsn_link_modes")
    dsn_input = dsn_case["input"]
    series = DsnSeries(
        0.0,
        dsn_input["cadence_s"],
        tuple(dsn_input["station_order"]),
        np.asarray(dsn_input["station_elevations_deg"], dtype=float),
    )
    off = evaluate_link_windows(
        *dsn_input["range_et"],
        lambda _et: dsn_input["earth_visible"],
        lambda _start, _end: 0.0,
        dsn_mode="off",
        dsn=None,
        dsn_mask_deg=dsn_input["dsn_mask_deg"],
        interpolation=dsn_input["interpolation"],
        down_event="link_down",
        up_event="link_recovery",
    )
    on = evaluate_link_windows(
        *dsn_input["range_et"],
        lambda _et: dsn_input["earth_visible"],
        lambda _start, _end: 0.0,
        dsn_mode="dsnAware",
        dsn=series,
        dsn_mask_deg=dsn_input["dsn_mask_deg"],
        interpolation=dsn_input["interpolation"],
        down_event="link_down",
        up_event="link_recovery",
    )
    expected = dsn_case["expected"]

    assert off.link_pct == pytest.approx(expected["dsn_off"]["link_pct"])
    assert off.longest_comm_gap_hours == pytest.approx(expected["dsn_off"]["longest_comm_gap_hours"])
    assert [event.type for event in on.events] == expected["dsn_aware"]["event_types"]
    assert [event.et for event in on.events] == pytest.approx(expected["dsn_aware"]["event_times_et"], abs=10.0)
    assert on.link_pct == pytest.approx(expected["dsn_aware"]["link_pct"], abs=1.0)
    assert on.longest_comm_gap_hours == pytest.approx(
        expected["dsn_aware"]["longest_comm_gap_hours"], abs=10.0 / 3600.0
    )

    coverage_case = _case(payload, "synthetic_dsn_out_of_coverage")
    coverage_input = coverage_case["input"]
    coverage = evaluate_link_windows(
        *coverage_input["range_et"],
        lambda _et: coverage_input["earth_visible"],
        lambda _start, _end: 0.0,
        dsn_mode="dsnAware",
        dsn=DsnSeries(0.0, coverage_input["cadence_s"], tuple(coverage_input["station_order"]), np.asarray(coverage_input["station_elevations_deg"], dtype=float)),
        dsn_mask_deg=coverage_input["dsn_mask_deg"],
        interpolation=coverage_input["interpolation"],
        down_event="link_down",
        up_event="link_recovery",
    )
    coverage_expected = coverage_case["expected"]["dsn_aware"]
    assert [event.type for event in coverage.events] == coverage_expected["event_types"]
    assert [event.et for event in coverage.events] == pytest.approx(coverage_expected["event_times_et"], abs=10.0)
    assert coverage.link_pct == pytest.approx(coverage_expected["link_pct"], abs=1.0)
    assert coverage.longest_comm_gap_hours == pytest.approx(coverage_expected["longest_comm_gap_hours"], abs=10.0 / 3600.0)

    spike_case = _case(payload, "synthetic_guarded_span_spike")
    spike_input = spike_case["input"]
    mask = np.zeros(1200)
    mask[spike_input["spike_bin"]] = spike_input["spike_elevation_deg"]
    horizon = Horizon(mask, bin_width_deg=spike_input["mask_bin_width_deg"])
    envelope = lambda _left, _right: EnvelopeBounds(
        0.5,
        0.5,
        spike_input["envelope_azimuth_centre_deg"],
        spike_input["envelope_azimuth_half_width_deg"],
        0.0,
        True,
    )
    azimuth_at = lambda et: 29.7 + et / 3600.0
    visible_at = lambda et: 0.5 >= horizon.effective_at(azimuth_at(et))
    sample_times = sample_times_guarded(*spike_input["range_et"], horizon, envelope)
    events = detect_events(
        *spike_input["range_et"],
        visible_at,
        down="sunset",
        up="shadowExit",
        horizon=horizon,
        envelope_bounds=envelope,
    )

    assert len(sample_times) == spike_case["expected"]["sample_count"]
    assert visible_at(sample_times[0]) is visible_at(sample_times[-1]) is spike_case["expected"]["endpoint_states_equal"]
    assert [event.type for event in events] == spike_case["expected"]["event_types"]
