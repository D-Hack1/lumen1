"""R3 three-pass scenario bounds using refined event-driven windows.

The caller supplies each visibility predicate. The default event-pairing
policy keeps DSN/link and mission-specific definitions outside the generic
terrain-mask uncertainty mechanics.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

import numpy as np

from lumen_pipeline.reference.events import EnvelopeBounds, Event, detect_events
from lumen_pipeline.reference.metrics import (
    longest_window_gap_hours,
    window_duration_seconds,
    window_percentage,
)
from lumen_pipeline.reference.uncertainty import (
    EventUncertainty,
    annotate_event,
    exact_event_uncertainty,
    fast_uncertainty_for_event,
    three_pass_bounds,
)
from lumen_pipeline.reference.visibility import Horizon
from lumen_pipeline.reference.windows import (
    Window,
    resolve_min_sun_elevation_ops,
    windows_from_events,
)

WindowPredicate = Callable[[float, Horizon], bool]
PeakElevation = Callable[[float, float, Horizon], float]
EventPairer = Callable[[Event, Sequence[Event]], Event | None]
EnvelopeBoundsProvider = Callable[[float, float, Horizon], EnvelopeBounds]
DiskFractionAt = Callable[[float, Horizon], float]
GeometryAt = Callable[[float, Horizon], tuple[float, float]]
AngularRadiusAt = Callable[[float, Horizon], float]
SigmaAtAzimuth = Callable[[float], float]
WINDOW_TYPES = frozenset(("sun", "earth", "link", "ops"))
PAIR_WINDOW_SECONDS = 36 * 3600.0


@dataclass(frozen=True)
class WindowSpec:
    """One visibility predicate and its transition labels for a scenario pass."""

    type: str
    down_event: str
    up_event: str
    visible_at: WindowPredicate
    peak_elevation_deg: PeakElevation
    envelope_bounds: EnvelopeBoundsProvider | None = None
    disk_fraction_at: DiskFractionAt | None = None
    disk_fraction_threshold: float | None = None
    geometry_at: GeometryAt | None = None
    angular_radius_at: AngularRadiusAt | None = None
    fast_sigma_at_azimuth_deg: SigmaAtAzimuth | None = None
    uncertainty_mode: str = "exact"
    sun_elevation_deg: Callable[[float, Horizon], float] | None = None
    min_sun_elevation_ops_deg: float = 0.0
    definitions_preset: str | None = None


def disk_fraction_visible(fraction: float, threshold: float) -> bool:
    """Return the R3 state predicate for a 0, 50, or 100 percent disk event."""
    if threshold not in (0.0, 0.5, 1.0):
        raise ValueError("disk_fraction_threshold must be exactly 0.0, 0.5, or 1.0")
    return fraction > 0.0 if threshold == 0.0 else fraction >= threshold


def fast_disk_event_uncertainty(
    event: Event,
    spec: WindowSpec,
    horizon: Horizon,
    sigma_at_azimuth_deg: SigmaAtAzimuth,
) -> EventUncertainty:
    """Apply R3's event-specific limb when stage-1 uses fast timing uncertainty."""
    if spec.disk_fraction_threshold is None or spec.geometry_at is None or spec.angular_radius_at is None:
        raise ValueError("disk event fast uncertainty requires threshold, geometry_at, and angular_radius_at")
    return fast_uncertainty_for_event(
        event,
        lambda et: spec.geometry_at(et, horizon),
        horizon,
        sigma_at_azimuth_deg,
        disk_fraction=spec.disk_fraction_threshold,
        angular_radius_deg=spec.angular_radius_at(event.et, horizon),
    )


@dataclass(frozen=True)
class BoundedValue:
    """Contract-shaped nominal value with an inclusive three-pass range."""

    value: float | None
    lo: float | None
    hi: float | None


@dataclass(frozen=True)
class BoundedWindow:
    """A nominal refined window and independent three-pass endpoint ranges."""

    nominal: Window
    start_et: BoundedValue
    end_et: BoundedValue
    duration_hours: BoundedValue


@dataclass(frozen=True)
class ScenarioPass:
    """One independently evaluated terrain-mask pass."""

    events: dict[str, tuple[Event, ...]]
    windows: dict[str, tuple[Window, ...]]
    metrics: dict[str, float | None]


@dataclass(frozen=True)
class ScenarioBounds:
    """Nominal result, shifted passes, exact event uncertainty, and bounds."""

    lower: ScenarioPass
    nominal: ScenarioPass
    upper: ScenarioPass
    events: dict[str, tuple[Event, ...]]
    windows: dict[str, tuple[BoundedWindow, ...]]
    metrics: dict[str, BoundedValue]
    sunlit_duration_hours: BoundedValue


def pair_nearest_event(event: Event, candidates: Sequence[Event]) -> Event | None:
    """Return the nearest same-type event within the 36-hour pairing window."""
    matches = (candidate for candidate in candidates if candidate.type == event.type and abs(candidate.et - event.et) <= PAIR_WINDOW_SECONDS)
    return min(matches, key=lambda candidate: abs(candidate.et - event.et), default=None)


def _pass_metrics(start_et: float, end_et: float, windows: dict[str, tuple[Window, ...]]) -> dict[str, float | None]:
    def percentage(type: str) -> float | None:
        if type not in windows:
            return None
        return window_percentage(start_et, end_et, windows[type])

    return {
        "sunlitPct": percentage("sun"),
        "earthVisiblePct": percentage("earth"),
        "linkPct": percentage("link"),
        "longestNightH": longest_window_gap_hours(start_et, end_et, windows["sun"]) if "sun" in windows else None,
        "longestCommGapH": longest_window_gap_hours(start_et, end_et, windows["link"]) if "link" in windows else None,
        "opsHours": window_duration_seconds(windows["ops"]) / 3600.0 if "ops" in windows else None,
    }


def _evaluate_pass(start_et: float, end_et: float, horizon: Horizon, specs: Sequence[WindowSpec]) -> ScenarioPass:
    windows: dict[str, tuple[Window, ...]] = {}
    events: dict[str, tuple[Event, ...]] = {}
    for spec in specs:
        if (spec.disk_fraction_at is None) != (spec.disk_fraction_threshold is None):
            raise ValueError("disk event specifications require both disk_fraction_at and disk_fraction_threshold")
        ops_elevation = resolve_min_sun_elevation_ops(
            spec.min_sun_elevation_ops_deg, spec.definitions_preset
        )
        if spec.type == "ops" and ops_elevation > 0.0 and spec.sun_elevation_deg is None:
            raise ValueError("operations elevation requires sun_elevation_deg")

        def predicate(
            et: float, spec: WindowSpec = spec, ops_elevation: float = ops_elevation
        ) -> bool:
            visible = spec.visible_at(et, horizon)
            if spec.disk_fraction_at is not None:
                visible = visible and disk_fraction_visible(
                    spec.disk_fraction_at(et, horizon), spec.disk_fraction_threshold
                )
            if spec.type == "ops" and spec.sun_elevation_deg is not None:
                visible = visible and spec.sun_elevation_deg(et, horizon) >= ops_elevation
            return visible

        event_options: dict[str, object] = {}
        if spec.envelope_bounds is not None:
            event_options = {
                "horizon": horizon,
                "envelope_bounds": lambda left, right, spec=spec: spec.envelope_bounds(left, right, horizon),
            }
        transitions = tuple(
            detect_events(start_et, end_et, predicate, down=spec.down_event, up=spec.up_event, **event_options)
        )
        events[spec.type] = transitions
        windows[spec.type] = tuple(
            windows_from_events(
                spec.type,
                start_et,
                end_et,
                predicate(start_et),
                transitions,
                down_event=spec.down_event,
                up_event=spec.up_event,
                peak_elevation_deg=lambda start, end, spec=spec: spec.peak_elevation_deg(start, end, horizon),
            )
        )
    return ScenarioPass(events, windows, _pass_metrics(start_et, end_et, windows))


def _bounded(lower: float | None, nominal: float | None, upper: float | None) -> BoundedValue:
    if lower is None or nominal is None or upper is None:
        return BoundedValue(nominal, None, None)
    return BoundedValue(nominal, min(lower, nominal, upper), max(lower, nominal, upper))


def _event_at(events: Sequence[Event], type: str, et: float) -> Event | None:
    return next((event for event in events if event.type == type and event.et == et), None)


def _endpoint_times(
    event: Event | None,
    lower: Sequence[Event],
    upper: Sequence[Event],
    pair_event: EventPairer,
    fixed_et: float | None = None,
) -> tuple[float, float, float] | None:
    if fixed_et is not None:
        return fixed_et, fixed_et, fixed_et
    if event is None:
        raise ValueError("non-partial window endpoint must have a refined transition event")
    lower_event = pair_event(event, lower)
    upper_event = pair_event(event, upper)
    if lower_event is None or upper_event is None:
        return None
    return lower_event.et, event.et, upper_event.et


def _bounded_windows(
    spec: WindowSpec,
    start_et: float,
    end_et: float,
    lower: ScenarioPass,
    nominal: ScenarioPass,
    upper: ScenarioPass,
    pair_event: EventPairer,
) -> tuple[BoundedWindow, ...]:
    lower_events = lower.events[spec.type]
    nominal_events = nominal.events[spec.type]
    upper_events = upper.events[spec.type]
    bounded_windows: list[BoundedWindow] = []
    for window in nominal.windows[spec.type]:
        start_times = _endpoint_times(
            None if window.partial_start else _event_at(nominal_events, spec.up_event, window.start_et),
            lower_events,
            upper_events,
            pair_event,
            start_et if window.partial_start else None,
        )
        end_times = _endpoint_times(
            None if window.partial_end else _event_at(nominal_events, spec.down_event, window.end_et),
            lower_events,
            upper_events,
            pair_event,
            end_et if window.partial_end else None,
        )
        start = BoundedValue(window.start_et, None, None) if start_times is None else _bounded(*start_times)
        end = BoundedValue(window.end_et, None, None) if end_times is None else _bounded(*end_times)
        duration = BoundedValue(window.duration_hours, None, None)
        if start_times is not None and end_times is not None:
            duration = _bounded(
                (end_times[0] - start_times[0]) / 3600.0,
                window.duration_hours,
                (end_times[2] - start_times[2]) / 3600.0,
            )
        bounded_windows.append(BoundedWindow(window, start, end, duration))
    return tuple(bounded_windows)


def _annotate_events(
    spec: WindowSpec,
    horizon: Horizon,
    nominal: Sequence[Event],
    lower: Sequence[Event],
    upper: Sequence[Event],
    pair_event: EventPairer,
) -> tuple[Event, ...]:
    if spec.uncertainty_mode == "fast":
        if spec.fast_sigma_at_azimuth_deg is None:
            raise ValueError("fast uncertainty requires fast_sigma_at_azimuth_deg")
        return tuple(
            annotate_event(
                event,
                fast_disk_event_uncertainty(event, spec, horizon, spec.fast_sigma_at_azimuth_deg),
            )
            for event in nominal
        )
    return tuple(
        annotate_event(event, exact_event_uncertainty(event, pair_event(event, lower), pair_event(event, upper)))
        for event in nominal
    )


def evaluate_with_bounds(
    start_et: float,
    end_et: float,
    horizon: Horizon,
    sigma_deg: float | Sequence[float] | np.ndarray,
    specs: Sequence[WindowSpec],
    *,
    pair_event: EventPairer | None = None,
) -> ScenarioBounds:
    """Run R3's correlated -sigma, nominal, and +sigma passes.

    By default, shifted events pair to the nearest same-type event within 36
    hours. An unmatched event is reported as vanished.
    """
    if not start_et < end_et:
        raise ValueError("scenario range must have positive duration")
    types = [spec.type for spec in specs]
    if len(types) != len(set(types)) or any(type not in WINDOW_TYPES for type in types):
        raise ValueError("spec types must be unique members of sun, earth, link, ops")
    if not specs:
        raise ValueError("at least one window specification is required")
    for spec in specs:
        if spec.uncertainty_mode not in ("exact", "fast"):
            raise ValueError("uncertainty_mode must be 'exact' or 'fast'")
        if spec.uncertainty_mode == "fast" and (
            spec.disk_fraction_at is None
            or spec.disk_fraction_threshold is None
            or spec.geometry_at is None
            or spec.angular_radius_at is None
            or spec.fast_sigma_at_azimuth_deg is None
        ):
            raise ValueError(
                "fast uncertainty requires disk_fraction_at, disk_fraction_threshold, geometry_at, angular_radius_at, and fast_sigma_at_azimuth_deg"
            )
    pair_event = pair_nearest_event if pair_event is None else pair_event

    passes = three_pass_bounds(horizon, sigma_deg, lambda current: _evaluate_pass(start_et, end_et, current, specs))
    lower, nominal, upper = passes.lower_mask, passes.nominal, passes.upper_mask
    metrics = {
        key: _bounded(lower.metrics[key], nominal.metrics[key], upper.metrics[key])
        for key in nominal.metrics
    }
    events = {
        spec.type: _annotate_events(
            spec,
            horizon,
            nominal.events[spec.type],
            lower.events[spec.type],
            upper.events[spec.type],
            pair_event,
        )
        for spec in specs
    }
    windows = {
        spec.type: _bounded_windows(spec, start_et, end_et, lower, nominal, upper, pair_event)
        for spec in specs
    }
    sunlit_duration_hours = _bounded(
        window_duration_seconds(lower.windows.get("sun", ())) / 3600.0 if "sun" in lower.windows else None,
        window_duration_seconds(nominal.windows.get("sun", ())) / 3600.0 if "sun" in nominal.windows else None,
        window_duration_seconds(upper.windows.get("sun", ())) / 3600.0 if "sun" in upper.windows else None,
    )
    return ScenarioBounds(lower, nominal, upper, events, windows, metrics, sunlit_duration_hours)
