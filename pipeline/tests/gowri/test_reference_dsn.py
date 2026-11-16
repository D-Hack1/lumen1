import json

import numpy as np
import pytest

from lumen_pipeline.common.binio import sidecar_path, write_array
from lumen_pipeline.reference.dsn import DsnSeries, evaluate_link_windows, link_available


def _series(values: list[list[int]]) -> DsnSeries:
    return DsnSeries(0.0, 600.0, ("DSS-14", "DSS-43", "DSS-63"), np.asarray(values, dtype=float) * 0.5)


def _write_dsn(path, values: list[list[int]]) -> None:
    metadata = write_array(
        path,
        np.asarray(values, dtype=np.int16),
        fields=["DSS-14", "DSS-43", "DSS-63"],
        units="deg",
        producer="test",
        scale=0.5,
        offset=0.0,
        created_utc="2023-01-01T00:00:00Z",
    )
    metadata.update(
        {"axis_order": ["station", "time"], "cadence_s": 600, "mode": "geometric_only", "start_utc": "2023-01-01T00:00:00Z"}
    )
    sidecar_path(path).write_text(json.dumps(metadata), encoding="utf-8")


def test_dsn_series_loads_station_major_quantised_data_and_interpolates(tmp_path):
    path = tmp_path / "dsn.bin"
    _write_dsn(path, [[20, 22], [0, 0], [-20, -20]])

    series = DsnSeries.from_file(path, start_et=1000.0)

    assert series.elevation_at("DSS-14", 1000.0, interpolation="linear") == 10.0
    assert series.elevation_at("DSS-14", 1300.0, interpolation="linear") == 10.5
    assert series.elevation_at("DSS-14", 1600.0, interpolation="linear") == 11.0
    with pytest.raises(ValueError, match="outside DSN coverage"):
        series.elevation_at("DSS-14", 999.0, interpolation="linear")


def test_link_availability_obeys_dsn_off_coverage_mask_and_threshold_equality():
    series = _series([[20, 20], [18, 18], [0, 0]])

    assert link_available(0.0, True, dsn_mode="off", dsn=None, dsn_mask_deg=10.0, interpolation="linear")
    assert not link_available(0.0, False, dsn_mode="off", dsn=None, dsn_mask_deg=10.0, interpolation="linear")
    assert link_available(0.0, True, dsn_mode="dsnAware", dsn=series, dsn_mask_deg=10.0, interpolation="linear")
    assert not link_available(0.0, True, dsn_mode="dsnAware", dsn=series, dsn_mask_deg=10.5, interpolation="linear")
    assert not link_available(
        0.0,
        True,
        dsn_mode="dsnAware",
        dsn=_series([[18, 18], [16, 16], [0, 0]]),
        dsn_mask_deg=10.0,
        interpolation="linear",
    )
    assert not link_available(-1.0, True, dsn_mode="dsnAware", dsn=series, dsn_mask_deg=10.0, interpolation="linear")
    assert not link_available(600.1, True, dsn_mode="dsnAware", dsn=series, dsn_mask_deg=10.0, interpolation="linear")


def test_link_windows_refine_dsn_recovery_and_comm_gap_with_continuous_earth_visibility():
    result = evaluate_link_windows(
        0.0,
        1200.0,
        lambda _et: True,
        lambda _start, _end: 20.0,
        dsn_mode="dsnAware",
        dsn=_series([[20, 0, 20], [0, 0, 0], [0, 0, 0]]),
        dsn_mask_deg=5.0,
        interpolation="linear",
        down_event="link_down",
        up_event="link_recovery",
    )

    assert [event.type for event in result.events] == ["link_down", "link_recovery"]
    assert [event.et for event in result.events] == pytest.approx([300.0, 900.0], abs=5.0)
    assert [window.start_et for window in result.windows] == pytest.approx([0.0, 900.0], abs=5.0)
    assert [window.end_et for window in result.windows] == pytest.approx([300.0, 1200.0], abs=5.0)
    assert [(window.partial_start, window.partial_end) for window in result.windows] == [(True, False), (False, True)]
    assert result.link_pct == pytest.approx(50.0, abs=1.0)
    assert result.longest_comm_gap_hours == pytest.approx(1.0 / 6.0, abs=0.01)


def test_link_windows_treat_dsn_out_of_coverage_as_unavailable():
    result = evaluate_link_windows(
        0.0,
        1800.0,
        lambda _et: True,
        lambda _start, _end: 20.0,
        dsn_mode="dsnAware",
        dsn=_series([[20, 0, 20], [0, 0, 0], [0, 0, 0]]),
        dsn_mask_deg=5.0,
        interpolation="linear",
        down_event="link_down",
        up_event="link_recovery",
    )

    assert [event.type for event in result.events] == ["link_down", "link_recovery", "link_down"]
    assert [event.et for event in result.events] == pytest.approx([300.0, 900.0, 1200.0], abs=5.0)
    assert result.link_pct == pytest.approx(33.958333333333336, abs=1.0)
    assert result.longest_comm_gap_hours == pytest.approx(1.0 / 6.0, abs=0.01)
