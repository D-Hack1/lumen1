import numpy as np
import pytest

from lumen_pipeline.reference.events import EnvelopeBounds, detect_events, sample_times_guarded
from lumen_pipeline.reference.visibility import Horizon, angular_radius_deg


def _bounds(
    min_elevation_deg: float,
    max_elevation_deg: float,
    azimuth_centre_deg: float,
    azimuth_half_width_deg: float,
    max_disk_radius_deg: float,
    proven_state: bool,
) -> EnvelopeBounds:
    return EnvelopeBounds(
        min_elevation_deg,
        max_elevation_deg,
        azimuth_centre_deg,
        azimuth_half_width_deg,
        max_disk_radius_deg,
        proven_state,
    )


def test_guarded_sampling_finds_narrow_spike_hidden_between_visible_endpoints():
    mask = np.zeros(1200)
    mask[100] = 100.0
    horizon = Horizon(mask, bin_width_deg=0.3)
    azimuth = lambda et: 29.7 + et / 3600.0
    predicate = lambda et: 0.5 >= horizon.effective_at(azimuth(et))
    envelope = lambda _left, _right: _bounds(0.5, 0.5, 30.2, 1.0, 0.0, True)

    times = sample_times_guarded(0.0, 3600.0, horizon, envelope)
    events = detect_events(0.0, 3600.0, predicate, down="sunset", up="shadowExit", horizon=horizon, envelope_bounds=envelope)

    assert predicate(0.0) and predicate(3600.0)
    assert len(times) == 31
    assert [event.type for event in events] == ["sunset", "shadowExit"]
    assert events[1].et - events[0].et == pytest.approx(35.0 * 60.0, abs=90.0)


def test_guarded_sampling_keeps_proven_visible_and_hidden_intervals_coarse_for_sun_and_earth():
    horizon = Horizon(np.zeros(3600))
    sun_radius = angular_radius_deg("sun", 149_597_870.7)
    earth_radius = angular_radius_deg("earth", 384_400.0)

    visible = lambda _left, _right: _bounds(10.0, 10.0, 0.0, 0.0, sun_radius, True)
    hidden = lambda _left, _right: _bounds(-10.0, -10.0, 0.0, 0.0, earth_radius, False)

    assert sample_times_guarded(0.0, 7200.0, horizon, visible) == [0.0, 3600.0, 7200.0]
    assert sample_times_guarded(0.0, 7200.0, horizon, hidden) == [0.0, 3600.0, 7200.0]


def test_guarded_sampling_uses_full_sun_and_earth_disk_radii():
    horizon = Horizon(np.zeros(3600))

    for body, distance_km in (("sun", 149_597_870.7), ("earth", 384_400.0)):
        radius = angular_radius_deg(body, distance_km)
        safely_visible = lambda _left, _right, radius=radius: _bounds(
            radius + 1.0, radius + 1.0, 180.0, 0.0, radius, True
        )
        grazing = lambda _left, _right, radius=radius: _bounds(
            radius + 0.25, radius + 0.25, 180.0, 0.0, radius, True
        )
        safely_hidden = lambda _left, _right, radius=radius: _bounds(
            -radius - 1.0, -radius - 1.0, 180.0, 0.0, radius, False
        )

        assert sample_times_guarded(0.0, 3600.0, horizon, safely_visible) == [0.0, 3600.0]
        assert len(sample_times_guarded(0.0, 3600.0, horizon, grazing)) == 31
        assert sample_times_guarded(0.0, 3600.0, horizon, safely_hidden) == [0.0, 3600.0]


def test_guarded_sampling_includes_near_zone_terrain_in_span_extrema():
    horizon = Horizon(
        np.zeros(3600),
        slope_deg=5.0,
        uphill_azimuth_deg=0.0,
        d_min_m=10.0,
    )
    bounds = lambda _left, _right: _bounds(2.5, 2.5, 0.0, 0.1, 0.0, True)

    assert horizon.extrema(0.0, 0.1)[1] > 2.5
    assert len(sample_times_guarded(0.0, 3600.0, horizon, bounds)) == 31


def test_guarded_sampling_refines_at_both_grazing_threshold_equalities():
    horizon = Horizon(np.zeros(3600))
    visible_equality = lambda _left, _right: _bounds(0.25, 0.25, 90.0, 0.0, 0.0, True)
    hidden_equality = lambda _left, _right: _bounds(-0.25, -0.25, 90.0, 0.0, 0.0, False)

    assert len(sample_times_guarded(0.0, 3600.0, horizon, visible_equality)) == 31
    assert len(sample_times_guarded(0.0, 3600.0, horizon, hidden_equality)) == 31


def test_guarded_sampling_queries_wraparound_spans_and_keeps_grazing_threshold_fine():
    mask = np.zeros(36)
    mask[0] = 5.0
    horizon = Horizon(mask, bin_width_deg=10.0)
    wraparound = lambda _left, _right: _bounds(1.0, 1.0, 0.0, 5.0, 0.0, True)
    grazing = lambda _left, _right: _bounds(0.25, 0.25, 180.0, 0.0, 0.0, True)

    assert len(sample_times_guarded(0.0, 3600.0, horizon, wraparound)) == 31
    assert len(sample_times_guarded(0.0, 3600.0, Horizon(np.zeros(36), bin_width_deg=10.0), grazing)) == 31


def test_guarded_sampling_widens_mask_span_by_one_bin_across_wraparound():
    mask = np.zeros(36)
    mask[-1] = 1.5
    horizon = Horizon(mask, bin_width_deg=10.0)
    bounds = lambda _left, _right: _bounds(1.6, 1.6, 0.0, 0.0, 0.0, True)

    assert horizon.extrema(0.0, 0.0) == (0.0, 0.0)
    assert horizon.extrema(0.0, horizon.bin_width_deg) == (0.0, 1.5)
    assert len(sample_times_guarded(0.0, 3600.0, horizon, bounds)) == 31


def test_guarded_sampling_bounds_continuous_near_zone_peak_between_mask_centres():
    horizon = Horizon(
        np.zeros(36),
        bin_width_deg=10.0,
        slope_deg=5.0,
        uphill_azimuth_deg=0.0,
        d_min_m=10.0,
    )
    bounds = lambda _left, _right: _bounds(5.2, 5.2, 0.0, 0.0, 0.0, True)

    minimum, maximum = horizon.extrema(0.0, horizon.bin_width_deg)
    assert maximum >= horizon.effective_at(0.0)
    assert maximum == pytest.approx(5.0)
    assert minimum <= horizon.effective_at(0.0)
    assert len(sample_times_guarded(0.0, 3600.0, horizon, bounds)) == 31
