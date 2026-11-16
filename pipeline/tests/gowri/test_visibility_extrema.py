import math

import numpy as np
import pytest

from lumen_pipeline.reference.visibility import FiniteSegmentTree, Horizon


def test_exact_extrema_include_one_bin_spike_away_from_disk_centre():
    values = np.zeros(36)
    values[6] = 9.0
    horizon = Horizon(values, bin_width_deg=10.0)

    assert horizon.extrema(50.0, 15.0) == (0.0, 9.0)


def test_exact_extrema_handle_wraparound_and_exact_bin_boundaries():
    values = np.array([7.0] + [0.0] * 34 + [-2.0])
    horizon = Horizon(values, bin_width_deg=10.0)

    assert horizon.extrema(0.0, 5.0) == (-2.0, 7.0)

    boundary = Horizon(np.array([1.0, 2.0, 3.0, 4.0]), bin_width_deg=90.0)
    assert boundary.extrema(90.0, 0.0) == (2.0, 2.0)
    assert boundary.extrema(90.0, 90.0) == (1.0, 3.0)


def test_exact_extrema_support_full_circle_and_precomputed_lookup():
    values = np.array([1.0, math.nan, -3.0, 4.0])
    tree = FiniteSegmentTree.from_elevations(values)
    horizon = Horizon(values, bin_width_deg=90.0, range_extrema=tree)

    assert horizon.extrema(0.0, 180.0) == (-3.0, 4.0)
    assert horizon.extrema(0.0, 360.0) == (-3.0, 4.0)


def test_exact_extrema_preserve_near_zone_and_negative_downhill_terrain():
    terrain = np.full(4, -1.0)
    horizon = Horizon(
        terrain,
        bin_width_deg=90.0,
        slope_deg=10.0,
        uphill_azimuth_deg=0.0,
        d_min_m=15.0,
        observer_height_m=1.0,
    )

    minimum, maximum = horizon.extrema(0.0, 135.0)

    assert minimum == pytest.approx(-1.0)
    assert maximum == pytest.approx(horizon.effective_at(0.0))
    assert maximum >= max(horizon.effective_at(azimuth) for azimuth in range(136))
    assert Horizon(terrain, bin_width_deg=90.0).extrema(180.0, 0.0) == (-1.0, -1.0)
