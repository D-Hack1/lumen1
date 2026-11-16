import json

import numpy as np

from lumen_pipeline.ephem.ephemeris import hermite_position
from lumen_pipeline.reference.events import Event, detect_events
from lumen_pipeline.reference.interp import Ephemeris
from lumen_pipeline.reference.visibility import Horizon, availability
from lumen_pipeline.reference.windows import merge_windows, windows_from_events
from lumen_pipeline.validation.golden import (
    build_golden_set,
    default_ephemeris_path,
    default_output_path,
)


def test_hermite_interpolation_recovers_constant_velocity_motion():
    nodes = np.zeros((2, 12), dtype=np.float32)
    nodes[0, 0:3] = [0.0, 0.0, 0.0]
    nodes[1, 0:3] = [3600.0, 0.0, 0.0]
    nodes[:, 3] = 1.0
    nodes[0, 6:9] = [0.0, 10.0, 0.0]
    nodes[1, 6:9] = [0.0, 3610.0, 0.0]
    nodes[:, 10] = 1.0

    positions = hermite_position(nodes, 0.0, 900.0)

    np.testing.assert_allclose(positions, [[900.0, 0.0, 0.0], [0.0, 910.0, 0.0]])


def test_ephemeris_loader_reports_git_lfs_pointer_before_reshape(tmp_path):
    binary = tmp_path / "ephem.bin"
    binary.write_text("version https://git-lfs.github.com/spec/v1\noid sha256:deadbeef\nsize 3366144\n")
    binary.with_suffix(".json").write_text(
        json.dumps({"frame": "MOON_ME", "spice_frame": "MOON_ME_DE421", "step_seconds": 3600, "cadence_s": 3600, "shape": [70128, 12], "start_et_tdb": 0})
    )

    with np.testing.assert_raises_regex(ValueError, "Git LFS pointer"):
        Ephemeris.from_file(binary)


def test_flat_horizon_visibility_boundaries_are_not_invented():
    horizon = Horizon(np.zeros(3600, dtype=float))
    above = availability("sun", 5.0, 0.0, 149_597_870.7, horizon, disk_threshold=0.5)
    below = availability("sun", -5.0, 0.0, 149_597_870.7, horizon, disk_threshold=0.5)

    assert above[0] == 1.0 and above[2]
    assert below[0] == 0.0 and not below[2]


def test_event_refinement_and_window_merging_use_explicit_endpoints():
    events = detect_events(0.0, 240.0, lambda et: et < 55.0, down="sunset", up="shadowExit")
    windows = merge_windows("sun", [0.0, 10.0, 20.0, 30.0], [False, True, True, False], [-1.0, 1.0, 2.0, -1.0])

    assert len(events) == 1
    assert events[0].type == "sunset"
    assert abs(events[0].et - 55.0) <= 10.0
    assert [(window.start_et, window.end_et, window.peak_elevation_deg) for window in windows] == [(10.0, 30.0, 2.0)]


def test_refined_windows_use_start_and_end_transition_times():
    windows = windows_from_events(
        "sun",
        0.0,
        100.0,
        False,
        [Event("shadowExit", 0.0), Event("sunset", 100.0)],
        down_event="sunset",
        up_event="shadowExit",
        peak_elevation_deg=lambda start, end: end - start,
    )

    assert [(window.start_et, window.end_et, window.duration_seconds, window.duration_hours) for window in windows] == [
        (0.0, 100.0, 100.0, 100.0 / 3600.0)
    ]
    assert not windows[0].partial_start
    assert not windows[0].partial_end


def test_refined_windows_preserve_short_refined_windows():
    windows = windows_from_events(
        "earth",
        0.0,
        120.0,
        False,
        [Event("earthrise", 50.25), Event("earthset", 55.75)],
        down_event="earthset",
        up_event="earthrise",
        peak_elevation_deg=lambda _start, _end: 1.5,
    )

    assert [(window.start_et, window.end_et, window.peak_elevation_deg) for window in windows] == [(50.25, 55.75, 1.5)]


def test_refined_windows_keep_adjacent_windows_separate():
    windows = windows_from_events(
        "ops",
        0.0,
        40.0,
        False,
        [Event("ops_start", 10.0), Event("ops_end", 20.0), Event("ops_start", 20.0), Event("ops_end", 30.0)],
        down_event="ops_end",
        up_event="ops_start",
        peak_elevation_deg=lambda _start, _end: 2.0,
    )

    assert [(window.start_et, window.end_et) for window in windows] == [(10.0, 20.0), (20.0, 30.0)]


def test_refined_windows_flag_partial_range_boundaries():
    windows = windows_from_events(
        "sun",
        0.0,
        100.0,
        True,
        [Event("sunset", 30.0), Event("shadowExit", 70.0)],
        down_event="sunset",
        up_event="shadowExit",
        peak_elevation_deg=lambda _start, _end: 3.0,
    )

    assert [(window.start_et, window.end_et, window.partial_start, window.partial_end) for window in windows] == [
        (0.0, 30.0, True, False),
        (70.0, 100.0, False, True),
    ]


def test_refined_link_windows_recover_while_earth_stays_visible():
    windows = windows_from_events(
        "link",
        0.0,
        120.0,
        True,
        [Event("link_down", 30.0), Event("link_recovery", 60.0)],
        down_event="link_down",
        up_event="link_recovery",
        peak_elevation_deg=lambda _start, _end: 10.0,
    )

    assert [(window.start_et, window.end_et, window.partial_start, window.partial_end) for window in windows] == [
        (0.0, 30.0, True, False),
        (60.0, 120.0, False, True),
    ]


def test_golden_set_is_reproducible_and_declares_missing_dependencies(tmp_path):
    first_path = tmp_path / "first.json"
    second_path = tmp_path / "second.json"
    first = build_golden_set(first_path, default_ephemeris_path())
    build_golden_set(second_path, default_ephemeris_path())

    assert json.loads(first_path.read_text(encoding="utf-8")) == first
    assert first_path.read_bytes() == second_path.read_bytes()
    assert first_path.read_bytes() == default_output_path().read_bytes()
    case = first["cases"][0]
    assert case["input"]["terrain_mode"] == "smooth_sphere_pending_im2_mask"
    assert "dsn" in case["unavailable"]
    assert case["metrics"]["energyPerDayWh"]["value"] is None


def test_golden_set_v2_has_refined_metrics_and_explicit_no_dsn_fallback():
    payload = json.loads(default_output_path().read_text(encoding="utf-8"))
    case = payload["cases"][0]

    assert payload["version"] == "2.0.0"
    assert payload["metric_method"] == "event_refined_windows"
    assert payload["tolerances"] == {
        "elevation_deg": 0.005,
        "azimuth_deg": 0.005,
        "event_time_s": 60,
        "metric_percent": 1.0,
    }
    assert len(case["render_samples_hourly"]) == 721
    assert {window["type"] for window in case["windows"]} == {"sun", "earth", "ops"}
    assert case["ops_events"]
    assert case["link_metric_source"] == "earth_visibility_fallback_no_dsn"
    assert "dsn" in case["unavailable"]
    assert "link_windows" in case["unavailable"]

    metrics = case["metrics"]
    assert abs(metrics["sunlitPct"]["value"] - 49.2931) < 0.0001
    assert abs(metrics["earthVisiblePct"]["value"] - 67.2086) < 0.0001
    assert metrics["linkPct"]["value"] == metrics["earthVisiblePct"]["value"]
    assert metrics["longestCommGapH"]["value"] is not None
    ops_window_hours = sum(window["duration_h"] for window in case["windows"] if window["type"] == "ops")
    assert abs(metrics["opsHours"]["value"] - ops_window_hours) < 1e-10
