import numpy as np
import pytest

from lumen_pipeline.reference.events import Event, detect_events
from lumen_pipeline.reference.uncertainty import (
    GRAZING_DT_SECONDS,
    annotate_event,
    exact_event_uncertainty,
    exact_event_uncertainty_from_masks,
    fast_event_uncertainty,
    fast_uncertainty_for_event,
    limb_offset_deg,
    numeric_bounds,
    shift_horizon_mask,
    three_pass_bounds,
    total_clearance_rate_deg_per_hour,
)
from lumen_pipeline.reference.visibility import (
    FiniteSegmentTree,
    Horizon,
    availability,
    disk_fraction,
)


def test_total_clearance_rate_includes_mask_azimuth_motion():
    horizon = Horizon(np.arange(3600, dtype=float), bin_width_deg=1.0)

    def geometry(et):
        return 5.0 + 0.001 * et, 10.0 + 0.0001 * et

    # el changes 3.6 deg/h, while the time-varying mask contributes -0.36 deg/h.
    assert total_clearance_rate_deg_per_hour(100.0, geometry, horizon) == pytest.approx(3.24)


def test_rate_uses_post_event_stencil_when_boundary_is_before_event():
    values = np.zeros(3600, dtype=float)
    values[:3] = [0.0, 1.0, 100.0]
    horizon = Horizon(values, bin_width_deg=1.0)

    def geometry(et):
        return 0.01 * et, 1.59 + 0.001 * et

    rate = total_clearance_rate_deg_per_hour(10.0, geometry, horizon, bracketing_interval=(9.0, 10.0))
    assert rate == pytest.approx(-320.4)


def test_rate_uses_pre_event_stencil_when_boundary_is_after_event():
    values = np.zeros(3600, dtype=float)
    values[:3] = [0.0, 1.0, 100.0]
    horizon = Horizon(values, bin_width_deg=1.0)

    def geometry(et):
        return 0.01 * et, 1.39 + 0.001 * et

    rate = total_clearance_rate_deg_per_hour(10.0, geometry, horizon, bracketing_interval=(9.0, 10.0))
    assert rate == pytest.approx(32.4)


def test_fast_uncertainty_uses_limb_and_flags_grazing():
    horizon = Horizon(np.zeros(3600, dtype=float))

    def geometry(et):
        return et / 3600.0 * 0.1, 0.0

    result = fast_event_uncertainty(0.0, geometry, horizon, lambda _: 0.2, disk_fraction=0.0, angular_radius_deg=0.25)
    assert result.clearance_rate_deg_per_hour == pytest.approx(0.1)
    assert result.delta_t_seconds == pytest.approx(7200.0)
    assert result.grazing_reason is None
    assert limb_offset_deg(0.5, 0.25) == 0.0
    assert limb_offset_deg(1.0, 0.25) == -0.25

    grazing = fast_event_uncertainty(0.0, lambda _: (0.0, 0.0), horizon, lambda _: 0.2)
    assert grazing.delta_t_seconds == np.inf
    assert grazing.grazing_reason == "rate"

    from_event = fast_uncertainty_for_event(
        Event("sunset", 0.0, bracket_start_et=-1.0, bracket_end_et=1.0), geometry, horizon, lambda _: 0.2
    )
    assert from_event.delta_t_seconds == pytest.approx(7200.0)


def test_shifted_horizon_three_passes_and_numeric_bounds_preserve_near_zone():
    horizon = Horizon(np.array([1.0, 2.0]), bin_width_deg=180.0, slope_deg=5.0, uphill_azimuth_deg=0.0, d_min_m=15.0, observer_height_m=1.0)
    shifted = shift_horizon_mask(horizon, [0.1, 0.3], direction=1)
    np.testing.assert_allclose(shifted.elevations_deg, [1.1, 2.3])
    assert shifted.slope_deg == horizon.slope_deg

    passes = three_pass_bounds(horizon, [0.1, 0.3], lambda current: current.elevation_at(90.0))
    assert numeric_bounds(passes) == pytest.approx((0.9, 1.0, 1.1))
    with pytest.raises(ValueError, match="Tier-C"):
        shift_horizon_mask(Horizon(), 0.2, direction=1)


def test_shifted_indexed_horizon_rebuilds_extrema_with_nan_and_wraparound():
    elevations = np.array([0.0, np.nan, 2.0, -1.0])
    horizon = Horizon(elevations, bin_width_deg=90.0, range_extrema=FiniteSegmentTree.from_elevations(elevations))

    lower = shift_horizon_mask(horizon, 0.5, direction=-1)
    upper = shift_horizon_mask(horizon, 0.5, direction=1)

    assert lower.range_extrema is not horizon.range_extrema
    assert upper.range_extrema is not horizon.range_extrema
    assert np.isnan(lower.elevations_deg[1])
    assert lower.extrema(0.0, 90.0) == pytest.approx((-1.5, -0.5))
    assert upper.extrema(0.0, 90.0) == pytest.approx((-0.5, 0.5))


def test_shifted_indexed_horizon_uses_shifted_extrema_for_disk_short_circuits():
    elevations = np.zeros(360)
    horizon = Horizon(elevations, bin_width_deg=1.0, range_extrema=FiniteSegmentTree.from_elevations(elevations))

    lower = shift_horizon_mask(horizon, 1.0, direction=-1)
    upper = shift_horizon_mask(horizon, 1.0, direction=1)

    assert availability("sun", 0.0, 0.0, 149_597_870.7, lower, disk_threshold=0.5)[0] == 1.0
    assert availability("sun", 0.0, 0.0, 149_597_870.7, upper, disk_threshold=0.5)[0] == 0.0


def test_exact_event_time_half_spread_vanishing_and_annotation():
    nominal = Event("sunset", 1000.0)
    exact = exact_event_uncertainty(nominal, Event("sunset", 800.0), Event("sunset", 1300.0))
    assert exact.delta_t_seconds == 250.0
    assert exact.dt_method == "exact"
    annotated = annotate_event(nominal, exact)
    assert annotated.dt_seconds == 250.0
    assert annotated.dt_method == "exact"

    vanished = exact_event_uncertainty(nominal, None, Event("sunset", 1300.0))
    assert vanished.grazing_reason == "vanishes"
    assert vanished.delta_t_seconds is None

    wide = exact_event_uncertainty(nominal, Event("sunset", 0.0), Event("sunset", 2.0 * GRAZING_DT_SECONDS + 1000.0))
    assert wide.grazing_reason == "dt_limit"


def test_event_constructor_detection_and_annotation_preserve_compatibility():
    legacy = Event("sunset", 10.0, "exact", "rate")
    assert legacy.dt_method == "exact"
    assert legacy.grazing_reason == "rate"
    assert legacy.bracket_start_et is None
    assert legacy.bracket_end_et is None
    assert legacy.dt_seconds is None

    detected = detect_events(0.0, 240.0, lambda et: et < 55.0, down="sunset", up="shadowExit")[0]
    assert detected.bracket_start_et is not None
    assert detected.bracket_end_et is not None
    assert detected.bracket_start_et <= detected.et <= detected.bracket_end_et

    annotated = annotate_event(detected, exact_event_uncertainty(detected, Event("sunset", 40.0), Event("sunset", 60.0)))
    assert annotated.bracket_start_et == detected.bracket_start_et
    assert annotated.bracket_end_et == detected.bracket_end_et
    assert annotated.dt_seconds == 10.0


def test_exact_path_resolves_both_shifted_masks():
    horizon = Horizon(np.zeros(3600, dtype=float))
    nominal = Event("shadowExit", 100.0)

    def resolve(current):
        return Event("shadowExit", 100.0 + current.elevation_at(0.05) * 100.0)

    exact = exact_event_uncertainty_from_masks(nominal, horizon, 0.2, resolve)
    assert exact.delta_t_seconds == pytest.approx(20.0)
    assert exact.dt_method == "exact"


def test_exact_path_resolves_events_against_shifted_indexed_horizons():
    elevations = np.zeros(360)
    horizon = Horizon(elevations, bin_width_deg=1.0, range_extrema=FiniteSegmentTree.from_elevations(elevations))

    def resolve(current):
        events = detect_events(
            0.0,
            3600.0,
            lambda et: disk_fraction("sun", et / 3600.0 - 0.5, 0.0, 149_597_870.7, current) == 1.0,
            down="sunset",
            up="shadowExit",
        )
        return events[0] if events else None

    nominal = resolve(horizon)
    assert nominal is not None
    exact = exact_event_uncertainty_from_masks(nominal, horizon, 0.2, resolve)

    assert exact.delta_t_seconds == pytest.approx(720.0, abs=10.0)
    assert exact.dt_method == "exact"
