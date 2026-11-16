"""Deterministic R3-safe event detection using a two-minute grid and bisection."""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass

from lumen_pipeline.reference.visibility import Horizon

FINE_STEP_SECONDS = 120.0
BISECTION_TOLERANCE_SECONDS = 10.0
COARSE_STEP_SECONDS = 3600.0
ENVELOPE_MARGIN_DEG = 0.25


@dataclass(frozen=True)
class Event:
    type: str
    et: float
    dt_method: str = "fast"
    grazing_reason: str | None = None
    bracket_start_et: float | None = None
    bracket_end_et: float | None = None
    dt_seconds: float | None = None


@dataclass(frozen=True)
class EnvelopeBounds:
    """Caller-validated envelope over one candidate coarse interval.

    Elevation bounds, azimuth span, and maximum disk radius must conservatively
    enclose the complete body disk throughout the interval. The guard adds one
    mask bin to the supplied azimuth half-width. ``proven_state`` must prove
    the non-terrain parts of the predicate hold (or fail) throughout the
    interval; endpoint samples alone are not a proof.
    """

    min_elevation_deg: float
    max_elevation_deg: float
    azimuth_centre_deg: float
    azimuth_half_width_deg: float
    max_disk_radius_deg: float
    proven_state: bool


EnvelopeProvider = Callable[[float, float], EnvelopeBounds]


def sample_times(start_et: float, end_et: float) -> list[float]:
    """Use the R3 fine cadence; coarse cadence requires unavailable mask extrema proof."""
    if end_et <= start_et:
        raise ValueError("event range must have positive duration")
    count = int((end_et - start_et) // FINE_STEP_SECONDS)
    times = [start_et + index * FINE_STEP_SECONDS for index in range(count + 1)]
    # ET magnitudes make repeated 120-second additions differ from an exact
    # endpoint by a few microseconds; that is not a partial sampling interval.
    if math.isclose(times[-1], end_et, rel_tol=0.0, abs_tol=1e-3):
        times[-1] = end_et
    else:
        times.append(end_et)
    return times


def _guarded_state(horizon: Horizon, bounds: EnvelopeBounds) -> bool | None:
    """Return a proven state only when R3's disk-span envelope is decisive."""
    values = (
        bounds.min_elevation_deg,
        bounds.max_elevation_deg,
        bounds.azimuth_centre_deg,
        bounds.azimuth_half_width_deg,
        bounds.max_disk_radius_deg,
    )
    if not all(math.isfinite(value) for value in values) or bounds.azimuth_half_width_deg < 0.0 or bounds.max_disk_radius_deg < 0.0:
        raise ValueError("envelope bounds must be finite with non-negative angular half-widths")
    if bounds.min_elevation_deg > bounds.max_elevation_deg:
        raise ValueError("envelope minimum elevation must not exceed its maximum")
    half_width = bounds.azimuth_half_width_deg
    if horizon.elevations_deg is not None:
        if not math.isfinite(horizon.bin_width_deg) or horizon.bin_width_deg <= 0.0:
            raise ValueError("masked horizons require a finite positive bin width")
        half_width += horizon.bin_width_deg
    minimum, maximum = horizon.extrema(bounds.azimuth_centre_deg, half_width)
    if not math.isfinite(minimum) or not math.isfinite(maximum):
        return None
    fully_visible = bounds.min_elevation_deg - bounds.max_disk_radius_deg - maximum > ENVELOPE_MARGIN_DEG
    fully_hidden = bounds.max_elevation_deg + bounds.max_disk_radius_deg - minimum < -ENVELOPE_MARGIN_DEG
    if fully_visible and bounds.proven_state:
        return True
    if fully_hidden and not bounds.proven_state:
        return False
    return None


def sample_times_guarded(
    start_et: float, end_et: float, horizon: Horizon, envelope_bounds: EnvelopeProvider
) -> list[float]:
    """Use R3 coarse steps only for caller-proven disk-span-safe intervals."""
    if end_et <= start_et:
        raise ValueError("event range must have positive duration")
    times = [start_et]
    left = start_et
    while left < end_et:
        right = min(left + COARSE_STEP_SECONDS, end_et)
        if _guarded_state(horizon, envelope_bounds(left, right)) is not None:
            times.append(right)
        else:
            fine = left + FINE_STEP_SECONDS
            while fine < right:
                times.append(fine)
                fine += FINE_STEP_SECONDS
            times.append(right)
        left = right
    return times


def _refine_transition(predicate: Callable[[float], bool], left: float, right: float) -> tuple[float, float, float]:
    left_value = predicate(left)
    if left_value == predicate(right):
        raise ValueError("bisection bracket does not contain a transition")
    while right - left > BISECTION_TOLERANCE_SECONDS:
        middle = (left + right) / 2.0
        if predicate(middle) == left_value:
            left = middle
        else:
            right = middle
    return (left + right) / 2.0, left, right


def detect_events(
    start_et: float,
    end_et: float,
    predicate: Callable[[float], bool],
    *,
    down: str,
    up: str,
    horizon: Horizon | None = None,
    envelope_bounds: EnvelopeProvider | None = None,
) -> list[Event]:
    """Detect false/true state transitions with half-open window endpoint semantics."""
    if horizon is None:
        if envelope_bounds is not None:
            raise ValueError("envelope-guarded sampling requires both horizon and envelope_bounds")
        times = sample_times(start_et, end_et)
    else:
        if envelope_bounds is None:
            raise ValueError("envelope-guarded sampling requires both horizon and envelope_bounds")
        times = sample_times_guarded(start_et, end_et, horizon, envelope_bounds)
    values = [predicate(time) for time in times]
    events: list[Event] = []
    for left, right, was_visible, is_visible in zip(times[:-1], times[1:], values[:-1], values[1:], strict=True):
        if was_visible != is_visible:
            event_et, bracket_start_et, bracket_end_et = _refine_transition(predicate, left, right)
            events.append(
                Event(
                    up if is_visible else down,
                    event_et,
                    bracket_start_et=bracket_start_et,
                    bracket_end_et=bracket_end_et,
                )
            )
    return events
