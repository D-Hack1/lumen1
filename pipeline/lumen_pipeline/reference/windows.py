"""Run-length encoding for visibility windows with explicit endpoint semantics."""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from lumen_pipeline.reference.events import Event

ISRO_VIKRAM_OPS_PRESET = "isroVikramOps"
ISRO_VIKRAM_OPS_ELEVATION_DEG = 6.0


def resolve_min_sun_elevation_ops(
    min_sun_elevation_ops_deg: float = 0.0, definitions_preset: str | None = None
) -> float:
    """Resolve the R3 operations elevation from explicit definitions or a preset."""
    if definitions_preset == ISRO_VIKRAM_OPS_PRESET:
        return ISRO_VIKRAM_OPS_ELEVATION_DEG
    if definitions_preset is not None:
        raise ValueError(f"unsupported definitions preset: {definitions_preset}")
    if not math.isfinite(min_sun_elevation_ops_deg) or min_sun_elevation_ops_deg < 0.0:
        raise ValueError("min_sun_elevation_ops_deg must be finite and non-negative")
    return min_sun_elevation_ops_deg


@dataclass(frozen=True)
class Window:
    type: str
    start_et: float
    end_et: float
    peak_elevation_deg: float
    partial_start: bool
    partial_end: bool

    @property
    def duration_hours(self) -> float:
        return (self.end_et - self.start_et) / 3600.0

    @property
    def duration_seconds(self) -> float:
        return self.end_et - self.start_et


def windows_from_events(
    type: str,
    start_et: float,
    end_et: float,
    initially_visible: bool,
    events: Sequence[Event],
    *,
    down_event: str,
    up_event: str,
    peak_elevation_deg: Callable[[float, float], float],
) -> list[Window]:
    """Build half-open visible windows from refined transition events.

    ``events`` must be chronological and use only the supplied down/up labels.
    The caller owns the definition of each predicate (sun, earth, link, or
    ops) and supplies the matching peak-elevation calculation.
    """
    if not start_et < end_et:
        raise ValueError("window range must have positive duration")

    visible = initially_visible
    window_start = start_et if visible else None
    window_partial_start = initially_visible
    windows: list[Window] = []
    previous_et = start_et

    def close_window(window_end: float, *, partial_end: bool) -> None:
        nonlocal window_start
        if window_start is None or window_end <= window_start:
            return
        peak = peak_elevation_deg(window_start, window_end)
        if not math.isfinite(peak):
            raise ValueError("peak_elevation_deg must return a finite value")
        windows.append(Window(type, window_start, window_end, peak, window_partial_start, partial_end))
        window_start = None

    for event in events:
        if event.type not in (down_event, up_event):
            raise ValueError(f"unexpected {type} event type: {event.type}")
        if not start_et <= event.et <= end_et or event.et < previous_et:
            raise ValueError("events must be chronological and within the window range")
        previous_et = event.et

        if event.type == down_event:
            if not visible:
                raise ValueError(f"{down_event} cannot follow an invisible state")
            close_window(event.et, partial_end=False)
            visible = False
        else:
            if visible:
                raise ValueError(f"{up_event} cannot follow a visible state")
            window_start = event.et
            window_partial_start = False
            visible = True

    if visible:
        close_window(end_et, partial_end=True)
    return windows


def merge_windows(
    type: str, times: Sequence[float], visible: Sequence[bool], elevations_deg: Sequence[float]
) -> list[Window]:
    """Merge true sample intervals; a true run uses [first sample, first false sample)."""
    if len(times) != len(visible) or len(times) != len(elevations_deg) or len(times) < 2:
        raise ValueError("times, visibility, and elevations must have matching length >= 2")
    windows: list[Window] = []
    start: int | None = None
    for index, value in enumerate(visible):
        if value and start is None:
            start = index
        if start is not None and (not value or index == len(visible) - 1):
            stop = index
            if stop > start:
                windows.append(
                    Window(
                        type,
                        times[start],
                        times[stop],
                        max(elevations_deg[start : stop + 1]),
                        start == 0,
                        stop == len(visible) - 1,
                    )
                )
            start = None
    return windows
