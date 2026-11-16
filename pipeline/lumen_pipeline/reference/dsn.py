"""R3 DSN geometric-coverage series and DSN-aware link windows.

The DSN artifact is elevation-only.  These helpers deliberately model no
signal margin, data rate, or link budget.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np

from lumen_pipeline.common.binio import read_array
from lumen_pipeline.ephem.dsn import CADENCE_SECONDS, STATION_ORDER
from lumen_pipeline.reference.events import Event, detect_events
from lumen_pipeline.reference.metrics import longest_window_gap_hours, window_percentage
from lumen_pipeline.reference.windows import Window, windows_from_events

Interpolation = Literal["linear"]
EarthVisibleAt = Callable[[float], bool]
PeakElevation = Callable[[float, float], float]


@dataclass(frozen=True)
class DsnSeries:
    """Decoded station-major geometric Moon-elevation series in ET seconds."""

    start_et: float
    cadence_seconds: float
    stations: tuple[str, ...]
    elevations_deg: np.ndarray

    @classmethod
    def from_file(cls, path: str | Path, *, start_et: float) -> DsnSeries:
        """Load the contract's station-major Int16 artifact at a supplied ET epoch.

        The sidecar supplies UTC but no ET/TDB epoch.  Callers must convert its
        ``start_utc`` with the same loaded leapseconds kernel as the scenario.
        """
        values, metadata = read_array(path)
        if metadata.get("dtype") != "int16" or values.ndim != 2:
            raise ValueError("DSN data must be a two-dimensional Int16 array")
        if metadata.get("axis_order") != ["station", "time"]:
            raise ValueError("DSN data must use station-major [station, time] layout")
        if tuple(metadata.get("fields", ())) != STATION_ORDER:
            raise ValueError(f"DSN stations must be {STATION_ORDER}")
        if values.shape[0] != len(STATION_ORDER) or values.shape[1] < 2:
            raise ValueError("DSN data must contain all stations and at least two time nodes")
        if metadata.get("scale") != 0.5 or metadata.get("offset") != 0.0:
            raise ValueError("DSN encoding must use scale 0.5 and offset 0")
        if metadata.get("cadence_s") != CADENCE_SECONDS:
            raise ValueError(f"DSN cadence must be {CADENCE_SECONDS} seconds")
        if metadata.get("mode") != "geometric_only" or metadata.get("units") != "deg":
            raise ValueError("DSN data must be geometric-only elevations in degrees")
        if not np.all(np.isfinite(values)) or np.any(values < -180) or np.any(values > 180):
            raise ValueError("DSN stored values must be within [-180, 180]")
        if not math.isfinite(start_et):
            raise ValueError("start_et must be finite")
        return cls(start_et, float(CADENCE_SECONDS), STATION_ORDER, values.astype(float) * 0.5)

    @property
    def end_et(self) -> float:
        return self.start_et + (self.elevations_deg.shape[1] - 1) * self.cadence_seconds

    def elevation_at(self, station: str, et: float, *, interpolation: Interpolation) -> float:
        """Return one station's decoded elevation using an explicit interpolation mode."""
        if interpolation != "linear":
            raise ValueError("unsupported DSN interpolation")
        if station not in self.stations:
            raise ValueError(f"unknown DSN station: {station}")
        if not math.isfinite(et) or et < self.start_et or et > self.end_et:
            raise ValueError("time is outside DSN coverage")
        position = (et - self.start_et) / self.cadence_seconds
        lower = math.floor(position)
        if lower == self.elevations_deg.shape[1] - 1:
            return float(self.elevations_deg[self.stations.index(station), lower])
        fraction = position - lower
        row = self.stations.index(station)
        return float((1.0 - fraction) * self.elevations_deg[row, lower] + fraction * self.elevations_deg[row, lower + 1])

    def any_station_above(self, et: float, mask_deg: float, *, interpolation: Interpolation) -> bool:
        """Return whether any station's geometric Moon elevation meets the mask."""
        if not math.isfinite(mask_deg):
            raise ValueError("DSN mask must be finite")
        return any(self.elevation_at(station, et, interpolation=interpolation) >= mask_deg for station in self.stations)


@dataclass(frozen=True)
class LinkEvaluation:
    """Refined DSN-aware link transitions, windows, and interval metrics."""

    events: tuple[Event, ...]
    windows: tuple[Window, ...]
    link_pct: float
    longest_comm_gap_hours: float


def link_available(
    et: float,
    earth_visible: bool,
    *,
    dsn_mode: Literal["off", "dsnAware"],
    dsn: DsnSeries | None,
    dsn_mask_deg: float,
    interpolation: Interpolation,
) -> bool:
    """Apply the R3 geometric link rule without making a link-budget claim."""
    if not earth_visible:
        return False
    if dsn_mode == "off":
        return True
    if dsn_mode != "dsnAware":
        raise ValueError("DSN mode must be off or dsnAware")
    if dsn is None:
        raise ValueError("DSN-aware link evaluation requires a DSN series")
    if et < dsn.start_et or et > dsn.end_et:
        return False
    return dsn.any_station_above(et, dsn_mask_deg, interpolation=interpolation)


def evaluate_link_windows(
    start_et: float,
    end_et: float,
    earth_visible_at: EarthVisibleAt,
    peak_elevation_deg: PeakElevation,
    *,
    dsn_mode: Literal["off", "dsnAware"],
    dsn: DsnSeries | None,
    dsn_mask_deg: float,
    interpolation: Interpolation,
    down_event: str,
    up_event: str,
) -> LinkEvaluation:
    """Build refined link windows from Earth visibility and DSN coverage."""
    predicate = lambda et: link_available(
        et,
        earth_visible_at(et),
        dsn_mode=dsn_mode,
        dsn=dsn,
        dsn_mask_deg=dsn_mask_deg,
        interpolation=interpolation,
    )
    events = tuple(detect_events(start_et, end_et, predicate, down=down_event, up=up_event))
    windows = tuple(
        windows_from_events(
            "link",
            start_et,
            end_et,
            predicate(start_et),
            events,
            down_event=down_event,
            up_event=up_event,
            peak_elevation_deg=peak_elevation_deg,
        )
    )
    return LinkEvaluation(
        events,
        windows,
        window_percentage(start_et, end_et, windows),
        longest_window_gap_hours(start_et, end_et, windows),
    )
