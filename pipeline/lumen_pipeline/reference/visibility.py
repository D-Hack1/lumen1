"""R3 horizon interpolation, near-zone occlusion, and disk visibility."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from lumen_pipeline.common.constants import (
    EARTH_RADIUS_KM,
    LUNAR_RADIUS_KM,
    SUN_ANGULAR_RADIUS_DEG_AT_1_AU,
)


@dataclass(frozen=True)
class FiniteSegmentTree:
    """Finite-only min/max queries over the mask contract's half-open bins."""

    count: int
    size: int
    minimum: np.ndarray
    maximum: np.ndarray

    @classmethod
    def from_elevations(cls, elevations_deg: Sequence[float] | np.ndarray) -> FiniteSegmentTree:
        values = np.asarray(elevations_deg, dtype=float)
        if values.ndim != 1 or len(values) == 0:
            raise ValueError("range-extrema values must be a non-empty one-dimensional array")
        size = 1
        while size < len(values):
            size *= 2
        minimum = np.full(2 * size, math.inf)
        maximum = np.full(2 * size, -math.inf)
        finite = np.isfinite(values)
        minimum[size : size + len(values)][finite] = values[finite]
        maximum[size : size + len(values)][finite] = values[finite]
        for index in range(size - 1, 0, -1):
            minimum[index] = min(minimum[2 * index], minimum[2 * index + 1])
            maximum[index] = max(maximum[2 * index], maximum[2 * index + 1])
        return cls(len(values), size, minimum, maximum)

    def query(self, start: int, end: int) -> tuple[float, float]:
        """Return finite-only ``(min, max)`` for the half-open range ``[start, end)``."""
        if not 0 <= start < end <= self.count:
            raise ValueError("range-extrema query must be within the source bins")
        minimum = math.inf
        maximum = -math.inf
        left, right = start + self.size, end + self.size
        while left < right:
            if left % 2:
                minimum = min(minimum, self.minimum[left])
                maximum = max(maximum, self.maximum[left])
                left += 1
            if right % 2:
                right -= 1
                minimum = min(minimum, self.minimum[right])
                maximum = max(maximum, self.maximum[right])
            left //= 2
            right //= 2
        return (math.nan, math.nan) if minimum == math.inf else (minimum, maximum)


@dataclass(frozen=True)
class Horizon:
    elevations_deg: np.ndarray | None = None
    bin_width_deg: float = 0.1
    slope_deg: float | None = None
    uphill_azimuth_deg: float | None = None
    d_min_m: float | None = None
    observer_height_m: float = 0.0
    range_extrema: FiniteSegmentTree | None = None

    def elevation_at(self, azimuth_deg: float) -> float:
        if self.elevations_deg is None:
            return -math.degrees(math.acos(LUNAR_RADIUS_KM / (LUNAR_RADIUS_KM + self.observer_height_m / 1000.0)))
        values = self.elevations_deg
        count = len(values)
        coordinate = (azimuth_deg % 360.0) / self.bin_width_deg - 0.5
        left = math.floor(coordinate) % count
        fraction = coordinate - math.floor(coordinate)
        right = (left + 1) % count
        return float((1.0 - fraction) * values[left] + fraction * values[right])

    def effective_at(self, azimuth_deg: float) -> float:
        terrain = self.elevation_at(azimuth_deg)
        if self.slope_deg is None or self.uphill_azimuth_deg is None or self.d_min_m is None:
            return terrain
        slope = math.radians(self.slope_deg)
        near = math.degrees(
            math.atan(
                math.tan(slope) * math.cos(math.radians(azimuth_deg - self.uphill_azimuth_deg))
                - self.observer_height_m / self.d_min_m
            )
        )
        near_positive = max(0.0, near)
        return terrain if near_positive == 0.0 else max(terrain, near_positive)

    def _span_ranges(self, centre_azimuth_deg: float, half_width_deg: float) -> tuple[tuple[int, int], ...]:
        """Return exact half-open bin ranges intersecting a closed azimuth span."""
        if not math.isfinite(centre_azimuth_deg) or not math.isfinite(half_width_deg) or half_width_deg < 0.0:
            raise ValueError("azimuth centre and half-width must be finite, with non-negative half-width")
        if self.elevations_deg is None:
            return ()
        count = len(self.elevations_deg)
        if count == 0 or not math.isclose(count * self.bin_width_deg, 360.0, rel_tol=0.0, abs_tol=1e-9):
            raise ValueError("horizon bins must cover exactly one 360-degree circle")
        if 2.0 * half_width_deg >= 360.0:
            return ((0, count),)

        first = math.floor((centre_azimuth_deg - half_width_deg) / self.bin_width_deg)
        last = math.floor((centre_azimuth_deg + half_width_deg) / self.bin_width_deg)
        span_count = last - first + 1
        if span_count >= count:
            return ((0, count),)
        start = first % count
        end = start + span_count
        if end <= count:
            return ((start, end),)
        return ((start, count), (0, end - count))

    def _raw_extrema(self, ranges: Sequence[tuple[int, int]]) -> tuple[float, float]:
        if self.elevations_deg is None:
            raise ValueError("smooth horizons have no raw terrain bins")
        if self.range_extrema is not None:
            if self.range_extrema.count != len(self.elevations_deg):
                raise ValueError("range-extrema lookup must match the horizon bin count")
            results = [self.range_extrema.query(start, end) for start, end in ranges]
            finite = [(minimum, maximum) for minimum, maximum in results if math.isfinite(minimum) and math.isfinite(maximum)]
            return (math.nan, math.nan) if not finite else (min(value[0] for value in finite), max(value[1] for value in finite))

        values = np.concatenate([self.elevations_deg[start:end] for start, end in ranges])
        finite = values[np.isfinite(values)]
        return (math.nan, math.nan) if len(finite) == 0 else (float(np.min(finite)), float(np.max(finite)))

    def _near_zone_max(self, centre_azimuth_deg: float, half_width_deg: float) -> float:
        if self.slope_deg is None or self.uphill_azimuth_deg is None or self.d_min_m is None:
            return -math.inf
        if not math.isfinite(centre_azimuth_deg) or not math.isfinite(half_width_deg) or half_width_deg < 0.0:
            raise ValueError("azimuth centre and half-width must be finite, with non-negative half-width")

        uphill_offset = (self.uphill_azimuth_deg - centre_azimuth_deg + 180.0) % 360.0 - 180.0
        if half_width_deg >= 180.0 or abs(uphill_offset) <= half_width_deg:
            maximum_cosine = 1.0
        else:
            slope_azimuth = math.radians(self.uphill_azimuth_deg)
            endpoints = (
                math.radians(centre_azimuth_deg - half_width_deg) - slope_azimuth,
                math.radians(centre_azimuth_deg + half_width_deg) - slope_azimuth,
            )
            maximum_cosine = max(math.cos(value) for value in endpoints)
        near_max = math.degrees(
            math.atan(
                math.tan(math.radians(self.slope_deg)) * maximum_cosine
                - self.observer_height_m / self.d_min_m
            )
        )
        return near_max if near_max > 0.0 else -math.inf

    def extrema(self, centre_azimuth_deg: float, half_width_deg: float) -> tuple[float, float]:
        """Return conservative effective-mask extrema across a circular span.

        Terrain extrema use finite mask bins. The near-zone upper bound is
        maximized continuously over the span; the raw terrain minimum remains
        a conservative lower bound for the maximum of terrain and near-zone.
        """
        if self.elevations_deg is None:
            terrain = self.elevation_at(centre_azimuth_deg)
            return terrain, max(terrain, self._near_zone_max(centre_azimuth_deg, half_width_deg))
        ranges = self._span_ranges(centre_azimuth_deg, half_width_deg)
        if self.slope_deg is None or self.uphill_azimuth_deg is None or self.d_min_m is None:
            return self._raw_extrema(ranges)
        minimum, maximum = self._raw_extrema(ranges)
        if not math.isfinite(minimum) or not math.isfinite(maximum):
            return (math.nan, math.nan)
        return minimum, max(maximum, self._near_zone_max(centre_azimuth_deg, half_width_deg))


def angular_radius_deg(body: str, distance_km: float) -> float:
    if body == "sun":
        return SUN_ANGULAR_RADIUS_DEG_AT_1_AU * 149_597_870.7 / distance_km
    if body == "earth":
        return math.degrees(math.asin(EARTH_RADIUS_KM / distance_km))
    raise ValueError(f"unsupported body: {body}")


def disk_fraction(body: str, elevation_deg: float, azimuth_deg: float, distance_km: float, horizon: Horizon) -> float:
    """Return visible disk fraction using R3 span checks and 24/32 chord quadrature."""
    radius = angular_radius_deg(body, distance_km)
    cosine = max(math.cos(math.radians(min(abs(elevation_deg), 89.9))), math.cos(math.radians(89.9)))
    # The span check is symmetric in elevation (the cosine uses |elevation|): a disk within its radius of the zenith OR the nadir spans all
    # azimuths. Using the signed elevation here made sin(radius)/cosine exceed 1 near the nadir (equatorial sites at local midnight).
    half_width = 180.0 if radius >= 90.0 - abs(elevation_deg) else math.degrees(math.asin(min(1.0, math.sin(math.radians(radius)) / cosine)))
    minimum, maximum = horizon.extrema(azimuth_deg, half_width)
    if elevation_deg - 1.05 * radius > maximum:
        return 1.0
    if elevation_deg + 1.05 * radius < minimum:
        return 0.0
    chords = 24 if body == "sun" else 32
    radius_rad = math.radians(radius)
    visible_area = 0.0
    for index in range(chords):
        x = radius_rad * (2.0 * (index + 0.5) / chords - 1.0)
        half_chord = math.sqrt(max(0.0, radius_rad * radius_rad - x * x))
        azimuth_offset = math.degrees(math.asin(math.sin(x) / cosine))
        mask = horizon.effective_at(azimuth_deg + azimuth_offset)
        visible_lower = max(-half_chord, math.radians(mask - elevation_deg))
        visible_area += max(0.0, half_chord - visible_lower)
    return float(np.clip(visible_area * (2.0 * radius_rad / chords) / (math.pi * radius_rad**2), 0.0, 1.0))


def availability(
    body: str, elevation_deg: float, azimuth_deg: float, distance_km: float, horizon: Horizon,
    *, disk_threshold: float, margin_deg: float = 0.0, min_sun_elevation_ops_deg: float = 0.0,
) -> tuple[float, float, bool]:
    fraction = disk_fraction(body, elevation_deg, azimuth_deg, distance_km, horizon)
    clearance = elevation_deg - horizon.effective_at(azimuth_deg)
    visible = fraction >= disk_threshold and clearance >= margin_deg
    if body == "sun":
        visible = visible and elevation_deg >= min_sun_elevation_ops_deg
    return fraction, clearance, visible
