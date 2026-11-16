import numpy as np
import pytest

from lumen_pipeline.reference import bounds
from lumen_pipeline.reference.bounds import (
    PAIR_WINDOW_SECONDS,
    WindowSpec,
    disk_fraction_visible,
    evaluate_with_bounds,
    fast_disk_event_uncertainty,
    pair_nearest_event,
)
from lumen_pipeline.reference.events import EnvelopeBounds, Event
from lumen_pipeline.reference.uncertainty import EventUncertainty
from lumen_pipeline.reference.visibility import Horizon
from lumen_pipeline.reference.windows import (
    ISRO_VIKRAM_OPS_ELEVATION_DEG,
    ISRO_VIKRAM_OPS_PRESET,
    resolve_min_sun_elevation_ops,
)


def _pair_nearest(event: Event, candidates: tuple[Event, ...]) -> Event | None:
    matches = [candidate for candidate in candidates if candidate.type == event.type]
    return min(matches, key=lambda candidate: abs(candidate.et - event.et), default=None)


def _triangle_spec(type: str = "sun") -> WindowSpec:
    return WindowSpec(
        type,
        f"{type}_down",
        f"{type}_up",
        lambda et, horizon: 1.0 - abs(et - 360.0) / 120.0 >= horizon.effective_at(0.0),
        lambda _start, _end, _horizon: 1.0,
    )


def test_pair_nearest_event_matches_type_ties_boundary_and_vanished():
    nominal = Event("sunset", 100.0)
    first_tie = Event("sunset", 90.0)
    assert pair_nearest_event(nominal, (Event("shadowExit", 100.0), Event("sunset", 130.0), first_tie, Event("sunset", 110.0))) is first_tie
    assert pair_nearest_event(nominal, (Event("sunset", 100.0 + PAIR_WINDOW_SECONDS),)).et == 100.0 + PAIR_WINDOW_SECONDS
    assert pair_nearest_event(nominal, (Event("sunset", 100.0 + PAIR_WINDOW_SECONDS + 0.1),)) is None


def test_three_pass_bounds_use_independent_refined_windows_and_metrics():
    result = evaluate_with_bounds(
        0.0,
        720.0,
        Horizon(np.zeros(3600)),
        0.5,
        [_triangle_spec(), _triangle_spec("earth"), _triangle_spec("link"), _triangle_spec("ops")],
        pair_event=_pair_nearest,
    )

    assert result.metrics["sunlitPct"].value == pytest.approx(100.0 / 3.0, abs=3.0)
    assert result.metrics["sunlitPct"].lo < result.metrics["sunlitPct"].value < result.metrics["sunlitPct"].hi
    assert result.metrics["linkPct"].lo < result.metrics["linkPct"].value < result.metrics["linkPct"].hi
    assert result.metrics["longestNightH"].lo < result.metrics["longestNightH"].value < result.metrics["longestNightH"].hi
    assert result.metrics["opsHours"].lo < result.metrics["opsHours"].value < result.metrics["opsHours"].hi
    assert result.sunlit_duration_hours.value == pytest.approx(1.0 / 15.0, abs=0.01)

    window = result.windows["sun"][0]
    assert window.start_et.lo < window.start_et.value < window.start_et.hi
    assert window.end_et.lo < window.end_et.value < window.end_et.hi
    assert window.duration_hours.lo < window.duration_hours.value < window.duration_hours.hi
    assert {event.dt_method for event in result.events["sun"]} == {"exact"}
    assert all(event.dt_seconds == pytest.approx(60.0, abs=5.0) for event in result.events["sun"])


def test_zero_sigma_collapses_bounds_and_partial_endpoints_are_fixed():
    result = evaluate_with_bounds(
        0.0,
        720.0,
        Horizon(np.zeros(3600)),
        0.0,
        [
            WindowSpec(
                "sun",
                "sun_down",
                "sun_up",
                lambda _et, horizon: 1.0 >= horizon.effective_at(0.0),
                lambda _start, _end, _horizon: 1.0,
            )
        ],
        pair_event=_pair_nearest,
    )

    for value in [result.metrics["sunlitPct"], result.metrics["longestNightH"], result.sunlit_duration_hours]:
        assert value.lo == value.value == value.hi
    window = result.windows["sun"][0]
    assert window.nominal.partial_start and window.nominal.partial_end
    assert window.start_et.lo == window.start_et.value == window.start_et.hi == 0.0
    assert window.end_et.lo == window.end_et.value == window.end_et.hi == 720.0


def test_vanished_shifted_event_keeps_nominal_window_but_omits_its_range():
    result = evaluate_with_bounds(
        0.0,
        720.0,
        Horizon(np.zeros(3600)),
        0.5,
        [
            WindowSpec(
                "sun",
                "sun_down",
                "sun_up",
                lambda et, horizon: 0.25 - abs(et - 360.0) / 120.0 >= horizon.effective_at(0.0),
                lambda _start, _end, _horizon: 0.25,
            )
        ],
        pair_event=_pair_nearest,
    )

    assert result.events["sun"]
    assert {event.grazing_reason for event in result.events["sun"]} == {"vanishes"}
    window = result.windows["sun"][0]
    assert window.start_et.lo is None and window.end_et.hi is None
    assert window.duration_hours.lo is None and window.duration_hours.hi is None


def test_bounds_use_validated_envelope_guard_when_a_spec_provides_one():
    calls = 0

    def visible(_et, _horizon):
        nonlocal calls
        calls += 1
        return True

    result = evaluate_with_bounds(
        0.0,
        7200.0,
        Horizon(np.zeros(3600)),
        0.0,
        [
            WindowSpec(
                "sun",
                "sun_down",
                "sun_up",
                visible,
                lambda _start, _end, _horizon: 1.0,
                envelope_bounds=lambda _left, _right, _horizon: EnvelopeBounds(
                    10.0, 10.0, 0.0, 0.0, 0.0, True
                ),
            )
        ],
    )

    assert calls == 12  # Three coarse samples and one initial-state check per mask pass.
    assert result.windows["sun"][0].duration_hours.value == pytest.approx(2.0)


def test_ops_window_resolves_isro_preset_and_disk_event_thresholds():
    assert resolve_min_sun_elevation_ops() == 0.0
    assert resolve_min_sun_elevation_ops(1.5) == 1.5
    assert resolve_min_sun_elevation_ops(0.0, ISRO_VIKRAM_OPS_PRESET) == ISRO_VIKRAM_OPS_ELEVATION_DEG
    assert not disk_fraction_visible(0.0, 0.0)
    assert disk_fraction_visible(0.5, 0.5)
    assert disk_fraction_visible(1.0, 1.0)

    ops = WindowSpec(
        "ops",
        "ops_down",
        "ops_up",
        lambda _et, _horizon: True,
        lambda _start, _end, _horizon: 7.0,
        sun_elevation_deg=lambda et, _horizon: 5.0 + et / 3600.0,
        definitions_preset=ISRO_VIKRAM_OPS_PRESET,
    )
    result = evaluate_with_bounds(0.0, 7200.0, Horizon(np.zeros(3600)), 0.0, [ops])

    assert result.windows["ops"][0].start_et.value == pytest.approx(3600.0, abs=10.0)


def test_disk_event_specs_re_solve_their_threshold_on_each_shifted_mask():
    spec = WindowSpec(
        "sun",
        "sun_down",
        "sun_up",
        lambda _et, _horizon: True,
        lambda _start, _end, _horizon: 1.0,
        disk_fraction_at=lambda et, horizon: et / 3600.0 - horizon.effective_at(0.0),
        disk_fraction_threshold=0.5,
    )
    result = evaluate_with_bounds(0.0, 3600.0, Horizon(np.zeros(3600)), 0.1, [spec])

    event = result.events["sun"][0]
    assert event.type == "sun_up"
    assert event.et == pytest.approx(1800.0, abs=10.0)
    assert event.dt_method == "exact"
    assert event.dt_seconds == pytest.approx(360.0, abs=10.0)


def test_fast_disk_event_uncertainty_forwards_the_matching_limb(monkeypatch):
    captured: list[tuple[float, float]] = []

    def fake_fast_uncertainty(_event, _geometry, _horizon, _sigma, *, disk_fraction, angular_radius_deg):
        captured.append((disk_fraction, angular_radius_deg))
        return EventUncertainty(1.0, 1.0, "fast")

    monkeypatch.setattr(bounds, "fast_uncertainty_for_event", fake_fast_uncertainty)
    horizon = Horizon(np.zeros(3600))
    for threshold in (0.0, 0.5, 1.0):
        spec = WindowSpec(
            "sun",
            "sun_down",
            "sun_up",
            lambda _et, _horizon: True,
            lambda _start, _end, _horizon: 1.0,
            disk_fraction_at=lambda _et, _horizon, threshold=threshold: threshold,
            disk_fraction_threshold=threshold,
            geometry_at=lambda et, _horizon: (et, 0.0),
            angular_radius_at=lambda _et, _horizon: 0.25,
        )
        assert fast_disk_event_uncertainty(Event("sun_up", 1.0), spec, horizon, lambda _azimuth: 0.2).dt_method == "fast"

    assert captured == [(0.0, 0.25), (0.5, 0.25), (1.0, 0.25)]


def test_fast_mode_annotates_disk_events_and_rejects_missing_inputs():
    horizon = Horizon(np.zeros(3600))
    fast = WindowSpec(
        "sun",
        "sun_down",
        "sun_up",
        lambda _et, _horizon: True,
        lambda _start, _end, _horizon: 1.0,
        disk_fraction_at=lambda et, _horizon: et / 3600.0,
        disk_fraction_threshold=0.5,
        geometry_at=lambda et, _horizon: ((et - 1800.0) * 0.1 / 3600.0, 0.0),
        angular_radius_at=lambda _et, _horizon: 0.25,
        fast_sigma_at_azimuth_deg=lambda _azimuth: 0.2,
        uncertainty_mode="fast",
    )
    result = evaluate_with_bounds(0.0, 3600.0, horizon, 0.1, [fast])
    event = result.events["sun"][0]

    assert event.dt_method == "fast"
    assert event.dt_seconds == pytest.approx(7200.0)
    assert event.grazing_reason is None

    grazing = WindowSpec(
        "sun",
        "sun_down",
        "sun_up",
        lambda _et, _horizon: True,
        lambda start, _end, _horizon: start,
        disk_fraction_at=lambda et, _horizon: et / 3600.0,
        disk_fraction_threshold=0.5,
        geometry_at=lambda _et, _horizon: (0.0, 0.0),
        angular_radius_at=lambda _et, _horizon: 0.25,
        fast_sigma_at_azimuth_deg=lambda _azimuth: 0.2,
        uncertainty_mode="fast",
    )
    grazing_event = evaluate_with_bounds(0.0, 3600.0, horizon, 0.1, [grazing]).events["sun"][0]
    assert grazing_event.dt_method == "fast"
    assert grazing_event.dt_seconds == np.inf
    assert grazing_event.grazing_reason == "rate"

    with pytest.raises(ValueError, match="fast uncertainty requires"):
        evaluate_with_bounds(
            0.0,
            3600.0,
            horizon,
            0.1,
            [
                WindowSpec(
                    "sun",
                    "sun_down",
                    "sun_up",
                    lambda _et, _horizon: True,
                    lambda _start, _end, _horizon: 1.0,
                    uncertainty_mode="fast",
                )
            ],
        )
