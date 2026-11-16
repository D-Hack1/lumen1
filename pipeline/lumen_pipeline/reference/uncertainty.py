"""R3 terrain-mask uncertainty propagation for the Python reference evaluator.

All event times are ET seconds and all angular values are degrees.  This
module intentionally consumes geometry callbacks rather than browser output.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from typing import TypeVar

import numpy as np

from lumen_pipeline.reference.events import Event
from lumen_pipeline.reference.visibility import FiniteSegmentTree, Horizon

RATE_INTERVAL_SECONDS = 120.0
GRAZING_RATE_DEG_PER_HOUR = 0.005
GRAZING_DT_SECONDS = 12.0 * 3600.0

GeometryAt = Callable[[float], tuple[float, float]]
T = TypeVar("T")


@dataclass(frozen=True)
class EventUncertainty:
    """Uncertainty attached to one event; ``delta_t_seconds`` is a half-width."""

    delta_t_seconds: float | None
    clearance_rate_deg_per_hour: float | None
    dt_method: str
    grazing_reason: str | None = None


@dataclass(frozen=True)
class ThreePassBounds:
    """Results from terrain masks shifted by -sigma, nominal, and +sigma."""

    lower_mask: T
    nominal: T
    upper_mask: T


def limb_offset_deg(disk_fraction: float, angular_radius_deg: float) -> float:
    """Return the R3 clearance offset for a 0, 50, or 100 percent disk event."""
    if not math.isfinite(angular_radius_deg) or angular_radius_deg < 0.0:
        raise ValueError("angular_radius_deg must be finite and non-negative")
    if disk_fraction == 0.0:
        return angular_radius_deg
    if disk_fraction == 0.5:
        return 0.0
    if disk_fraction == 1.0:
        return -angular_radius_deg
    raise ValueError("disk_fraction event must be exactly 0.0, 0.5, or 1.0")


def clearance_deg(
    et: float, geometry_at: GeometryAt, horizon: Horizon, *, limb_offset_deg: float = 0.0
) -> float:
    """Return R3 C(t): elevation minus effective mask, plus a selected limb offset."""
    elevation_deg, azimuth_deg = geometry_at(et)
    return elevation_deg - horizon.effective_at(azimuth_deg) + limb_offset_deg


def _mask_bin(azimuth_deg: float, horizon: Horizon) -> int | None:
    if horizon.elevations_deg is None:
        return None
    coordinate = (azimuth_deg % 360.0) / horizon.bin_width_deg - 0.5
    return math.floor(coordinate) % len(horizon.elevations_deg)


def total_clearance_rate_deg_per_hour(
    event_et: float,
    geometry_at: GeometryAt,
    horizon: Horizon,
    *,
    limb_offset_deg: float = 0.0,
    bracketing_interval: tuple[float, float] | None = None,
) -> float:
    """Evaluate R3's total dC/dt using a +/- two-minute mask-aware difference.

    ``geometry_at`` returns ``(elevation_deg, azimuth_deg)``.  When the
    two-minute stencil crosses a piecewise-linear mask-bin boundary, the rate
    is one-sided.  ``bracketing_interval`` is the detector's transition
    bracket and selects its side of the event; it must contain ``event_et``.
    """
    if bracketing_interval is not None:
        left, right = bracketing_interval
        if left > event_et or right < event_et or right <= left:
            raise ValueError("bracketing_interval must be ordered and contain event_et")

    before_et = event_et - RATE_INTERVAL_SECONDS
    after_et = event_et + RATE_INTERVAL_SECONDS
    event_azimuth = geometry_at(event_et)[1]
    before_azimuth = geometry_at(before_et)[1]
    after_azimuth = geometry_at(after_et)[1]
    before = clearance_deg(before_et, geometry_at, horizon, limb_offset_deg=limb_offset_deg)
    event = clearance_deg(event_et, geometry_at, horizon, limb_offset_deg=limb_offset_deg)
    after = clearance_deg(after_et, geometry_at, horizon, limb_offset_deg=limb_offset_deg)

    bins = (_mask_bin(before_azimuth, horizon), _mask_bin(event_azimuth, horizon), _mask_bin(after_azimuth, horizon))
    if bins[0] == bins[1] == bins[2]:
        rate_deg_per_second = (after - before) / (2.0 * RATE_INTERVAL_SECONDS)
    else:
        # Keep the difference on the event's mask-bin side of the crossed
        # boundary: a boundary before the event requires the post-event
        # stencil, while one after it requires the pre-event stencil.
        if bins[0] != bins[1] and bins[1] == bins[2]:
            use_before = False
        elif bins[0] == bins[1] and bins[1] != bins[2]:
            use_before = True
        elif bracketing_interval is not None:
            bracket_bins = {
                _mask_bin(geometry_at(bracketing_interval[0])[1], horizon),
                _mask_bin(geometry_at(bracketing_interval[1])[1], horizon),
            }
            use_before = bins[0] in bracket_bins and bins[2] not in bracket_bins
        else:
            use_before = bins[0] == bins[1]
        rate_deg_per_second = (event - before) / RATE_INTERVAL_SECONDS if use_before else (after - event) / RATE_INTERVAL_SECONDS
    return rate_deg_per_second * 3600.0


def fast_event_uncertainty(
    event_et: float,
    geometry_at: GeometryAt,
    horizon: Horizon,
    sigma_at_azimuth_deg: Callable[[float], float],
    *,
    disk_fraction: float = 0.5,
    angular_radius_deg: float = 0.0,
    bracketing_interval: tuple[float, float] | None = None,
) -> EventUncertainty:
    """Return R3 fast-path sigma/|total clearance rate| timing uncertainty."""
    azimuth_deg = geometry_at(event_et)[1]
    sigma_deg = sigma_at_azimuth_deg(azimuth_deg)
    if not math.isfinite(sigma_deg) or sigma_deg < 0.0:
        raise ValueError("sigma_at_azimuth_deg must return a finite non-negative value")
    rate = total_clearance_rate_deg_per_hour(
        event_et,
        geometry_at,
        horizon,
        limb_offset_deg=limb_offset_deg(disk_fraction, angular_radius_deg),
        bracketing_interval=bracketing_interval,
    )
    delta_t_seconds = math.inf if rate == 0.0 else sigma_deg / abs(rate) * 3600.0
    grazing_reason = "rate" if abs(rate) < GRAZING_RATE_DEG_PER_HOUR else None
    if grazing_reason is None and delta_t_seconds > GRAZING_DT_SECONDS:
        grazing_reason = "dt_limit"
    return EventUncertainty(delta_t_seconds, rate, "fast", grazing_reason)


def fast_uncertainty_for_event(
    event: Event,
    geometry_at: GeometryAt,
    horizon: Horizon,
    sigma_at_azimuth_deg: Callable[[float], float],
    *,
    disk_fraction: float = 0.5,
    angular_radius_deg: float = 0.0,
) -> EventUncertainty:
    """Evaluate fast uncertainty using the event detector's retained refinement bracket."""
    bracket = None
    if event.bracket_start_et is not None and event.bracket_end_et is not None:
        bracket = event.bracket_start_et, event.bracket_end_et
    return fast_event_uncertainty(
        event.et,
        geometry_at,
        horizon,
        sigma_at_azimuth_deg,
        disk_fraction=disk_fraction,
        angular_radius_deg=angular_radius_deg,
        bracketing_interval=bracket,
    )


def shift_horizon_mask(horizon: Horizon, sigma_deg: float | Sequence[float] | np.ndarray, *, direction: int) -> Horizon:
    """Return a horizon whose terrain mask is shifted by ``direction * sigma``.

    Near-zone geometry is preserved: R3's correlated +/- passes shift only
    the terrain mask, not the fitted local plane.
    """
    if horizon.elevations_deg is None:
        raise ValueError("Tier-C smooth horizons have no terrain mask to shift")
    if direction not in (-1, 1):
        raise ValueError("direction must be -1 or 1")
    sigma = np.asarray(sigma_deg, dtype=float)
    try:
        shifted = np.asarray(horizon.elevations_deg, dtype=float) + direction * sigma
    except ValueError as error:
        raise ValueError("sigma_deg must be scalar or match the horizon mask shape") from error
    if not np.all(np.isfinite(sigma)) or np.any(sigma < 0.0):
        raise ValueError("sigma_deg must be finite and non-negative")
    range_extrema = FiniteSegmentTree.from_elevations(shifted) if horizon.range_extrema is not None else None
    return replace(horizon, elevations_deg=shifted, range_extrema=range_extrema)


def three_pass_bounds(
    horizon: Horizon, sigma_deg: float | Sequence[float] | np.ndarray, evaluate: Callable[[Horizon], T]
) -> ThreePassBounds[T]:
    """Evaluate an arbitrary metric/window result on R3's -sigma/nominal/+sigma masks."""
    return ThreePassBounds(evaluate(shift_horizon_mask(horizon, sigma_deg, direction=-1)), evaluate(horizon), evaluate(shift_horizon_mask(horizon, sigma_deg, direction=1)))


def numeric_bounds(passes: ThreePassBounds[float]) -> tuple[float, float, float]:
    """Return ``(low, nominal, high)`` for a scalar three-pass result."""
    return min(passes.lower_mask, passes.nominal, passes.upper_mask), passes.nominal, max(passes.lower_mask, passes.nominal, passes.upper_mask)


def exact_event_uncertainty(
    nominal_event: Event,
    lower_mask_event: Event | None,
    upper_mask_event: Event | None,
) -> EventUncertainty:
    """Return R3 exact timing uncertainty from corresponding shifted-mask events."""
    if lower_mask_event is None or upper_mask_event is None:
        return EventUncertainty(None, None, "exact", "vanishes")
    event_times = (lower_mask_event.et, nominal_event.et, upper_mask_event.et)
    delta_t_seconds = (max(event_times) - min(event_times)) / 2.0
    grazing_reason = "dt_limit" if delta_t_seconds > GRAZING_DT_SECONDS else None
    return EventUncertainty(delta_t_seconds, None, "exact", grazing_reason)


def exact_event_uncertainty_from_masks(
    nominal_event: Event,
    horizon: Horizon,
    sigma_deg: float | Sequence[float] | np.ndarray,
    resolve_event: Callable[[Horizon], Event | None],
) -> EventUncertainty:
    """Re-solve an event on R3's shifted terrain masks, then return its exact uncertainty.

    ``resolve_event`` must use the same event type, threshold, geometry, and
    bisection rules as the nominal evaluation.  Returning ``None`` denotes an
    event which disappears in that shifted pass.
    """
    lower = resolve_event(shift_horizon_mask(horizon, sigma_deg, direction=-1))
    upper = resolve_event(shift_horizon_mask(horizon, sigma_deg, direction=1))
    return exact_event_uncertainty(nominal_event, lower, upper)


def annotate_event(event: Event, uncertainty: EventUncertainty) -> Event:
    """Return an event record with the uncertainty fields required by the artifact contract."""
    return replace(
        event,
        dt_seconds=uncertainty.delta_t_seconds,
        dt_method=uncertainty.dt_method,
        grazing_reason=uncertainty.grazing_reason,
    )
