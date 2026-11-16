"""First-pass geometry-only metrics; unavailable downstream products stay null."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from lumen_pipeline.reference.power import PowerSeries
from lumen_pipeline.reference.windows import Window


def bounded(value: float | None) -> dict[str, float | None]:
    """Use null bounds until the R3 three-mask uncertainty passes are available."""
    return {"value": value, "lo": None, "hi": None}


def _longest_false_run_hours(times: Sequence[float], values: Sequence[bool]) -> float:
    longest = 0.0
    start: float | None = None
    for index, value in enumerate(values):
        if not value and start is None:
            start = times[index]
        if start is not None and (value or index == len(values) - 1):
            end = times[index]
            longest = max(longest, (end - start) / 3600.0)
            start = None
    return longest


def window_duration_seconds(windows: Sequence[Window]) -> float:
    """Return the total duration of disjoint refined visibility windows."""
    return sum(window.duration_seconds for window in windows)


def window_percentage(start_et: float, end_et: float, windows: Sequence[Window]) -> float:
    """Return the percentage of a scenario range covered by refined windows."""
    if not start_et < end_et:
        raise ValueError("metric range must have positive duration")
    return 100.0 * window_duration_seconds(windows) / (end_et - start_et)


def longest_window_gap_hours(start_et: float, end_et: float, windows: Sequence[Window]) -> float:
    """Return the longest unavailable gap around ordered refined windows."""
    if not start_et < end_et:
        raise ValueError("metric range must have positive duration")
    latest = start_et
    longest = 0.0
    for window in windows:
        longest = max(longest, window.start_et - latest)
        latest = window.end_et
    return max(longest, end_et - latest) / 3600.0


@dataclass(frozen=True)
class PowerMetrics:
    """Scenario energy and state-of-charge summaries from one PowerSeries."""

    generated_energy_wh: float
    generated_energy_per_day_wh: float
    load_energy_wh: float
    net_energy_wh: float
    curtailed_energy_wh: float
    unserved_energy_wh: float
    initial_soc_fraction: float
    final_soc_fraction: float
    minimum_soc_fraction: float
    maximum_soc_fraction: float
    operating_hours: float | None


def _trapezoid_energy_wh(times_et: np.ndarray, power_w: np.ndarray) -> float:
    """Integrate sample power over irregular ET intervals in watt-hours."""
    return float(np.sum((power_w[:-1] + power_w[1:]) * np.diff(times_et) / 7200.0))


def _operating_hours(start_et: float, end_et: float, windows: Sequence[Window]) -> float:
    """Return the non-overlapping in-range duration of caller-defined ops windows."""
    total_seconds = 0.0
    previous_end = start_et
    for window in windows:
        if window.end_et <= window.start_et:
            raise ValueError("operating windows must have positive duration")
        start = max(start_et, window.start_et)
        end = min(end_et, window.end_et)
        if end <= start:
            continue
        if start < previous_end:
            raise ValueError("operating windows must be ordered and non-overlapping")
        total_seconds += end - start
        previous_end = end
    return total_seconds / 3600.0


def power_series_metrics(
    times_et: Sequence[float], power: PowerSeries, *, operating_windows: Sequence[Window] | None = None
) -> PowerMetrics:
    """Summarize configured generation/load/SOC without changing battery physics.

    ``operating_windows`` is optional because R3 does not define an operating
    load policy.  When supplied, its refined intervals are clipped to the
    power-series range before their duration is reported.
    """
    times = np.asarray(times_et, dtype=float)
    series = (
        power.generation_w,
        power.load_w,
        power.net_w,
        power.soc_fraction,
        power.stored_energy_wh,
        power.curtailed_generation_wh,
        power.unserved_load_wh,
    )
    if times.ndim != 1 or len(times) < 2 or not np.all(np.isfinite(times)) or not np.all(np.diff(times) > 0.0):
        raise ValueError("times_et must be finite and strictly increasing with length >= 2")
    if any(len(values) != len(times) for values in series):
        raise ValueError("PowerSeries arrays must match times_et")
    if any(not np.all(np.isfinite(values)) for values in series):
        raise ValueError("PowerSeries arrays must be finite")
    if np.any(power.generation_w < 0.0) or np.any(power.load_w < 0.0):
        raise ValueError("generation and load powers must be non-negative")
    if np.any(power.curtailed_generation_wh < 0.0) or np.any(power.unserved_load_wh < 0.0):
        raise ValueError("curtailed and unserved energy must be non-negative")

    duration_days = (times[-1] - times[0]) / 86_400.0
    generated = _trapezoid_energy_wh(times, power.generation_w)
    load = _trapezoid_energy_wh(times, power.load_w)
    return PowerMetrics(
        generated_energy_wh=generated,
        generated_energy_per_day_wh=generated / duration_days,
        load_energy_wh=load,
        net_energy_wh=_trapezoid_energy_wh(times, power.net_w),
        curtailed_energy_wh=float(np.sum(power.curtailed_generation_wh)),
        unserved_energy_wh=float(np.sum(power.unserved_load_wh)),
        initial_soc_fraction=float(power.soc_fraction[0]),
        final_soc_fraction=float(power.soc_fraction[-1]),
        minimum_soc_fraction=float(np.min(power.soc_fraction)),
        maximum_soc_fraction=float(np.max(power.soc_fraction)),
        operating_hours=None if operating_windows is None else _operating_hours(times[0], times[-1], operating_windows),
    )


def first_pass_metrics(
    times: Sequence[float], sun_visible: Sequence[bool], earth_visible: Sequence[bool], sun_elevation_deg: Sequence[float],
    earth_elevation_deg: Sequence[float], sun_clearance_deg: Sequence[float], earth_clearance_deg: Sequence[float], sun_disk_fraction: Sequence[float],
    *, power: PowerSeries | None = None, operating_windows: Sequence[Window] | None = None,
) -> dict[str, object]:
    """Return geometry metrics plus explicitly supplied power/SOC summaries."""
    duration = times[-1] - times[0]
    if duration <= 0:
        raise ValueError("metric range must have positive duration")
    sun_seconds = sum((times[index + 1] - times[index]) for index in range(len(times) - 1) if sun_visible[index])
    earth_seconds = sum((times[index + 1] - times[index]) for index in range(len(times) - 1) if earth_visible[index])
    power_summary = power_series_metrics(times, power, operating_windows=operating_windows) if power is not None else None
    return {
        "sunElevationDeg": bounded(sun_elevation_deg[0]),
        "sunClearanceDeg": bounded(sun_clearance_deg[0]),
        "sunDiskPct": bounded(100.0 * sun_disk_fraction[0]),
        "earthElevationDeg": bounded(earth_elevation_deg[0]),
        "dteMarginDeg": bounded(earth_clearance_deg[0]),
        "sunlitPct": bounded(100.0 * sun_seconds / duration),
        "earthVisiblePct": bounded(100.0 * earth_seconds / duration),
        "linkPct": bounded(None),
        "longestNightH": bounded(_longest_false_run_hours(times, sun_visible)),
        "longestCommGapH": bounded(None),
        "opsHours": bounded(None if power_summary is None else power_summary.operating_hours),
        "energyPerDayWh": bounded(None if power_summary is None else power_summary.generated_energy_per_day_wh),
        "sunElevationAtTouchdownDeg": bounded(sun_elevation_deg[0]),
        "padSlopeDeg": None,
        "psrDistanceKm": None,
    }
