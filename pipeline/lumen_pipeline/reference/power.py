"""Generic R3 solar generation and battery state-of-charge reference model."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

import numpy as np

from lumen_pipeline.common.constants import AU_KM, SOLAR_CONSTANT_W_M2

UP = np.array([0.0, 0.0, 1.0])
PanelPreset = Literal["fourSide", "singleHeading", "horizontalDeck", "trackingMast"]


@dataclass(frozen=True)
class Panel:
    """One configured panel; its normal is expressed in the site frame."""

    normal: np.ndarray
    area_m2: float
    efficiency: float


@dataclass(frozen=True)
class PowerSeries:
    """Per-sample generation, load, and battery outputs for one time grid."""

    generation_w: np.ndarray
    load_w: np.ndarray
    net_w: np.ndarray
    soc_fraction: np.ndarray
    stored_energy_wh: np.ndarray
    curtailed_generation_wh: np.ndarray
    unserved_load_wh: np.ndarray


def _unit_vector(vector: np.ndarray, name: str) -> np.ndarray:
    candidate = np.asarray(vector, dtype=float)
    if candidate.shape != (3,) or not np.all(np.isfinite(candidate)):
        raise ValueError(f"{name} must be a finite vector with shape (3,)")
    norm = float(np.linalg.norm(candidate))
    if not math.isclose(norm, 1.0, rel_tol=0.0, abs_tol=1e-12):
        raise ValueError(f"{name} must be a unit vector")
    return candidate


def _rotation_about(axis: np.ndarray, angle_deg: float) -> np.ndarray:
    if not math.isfinite(angle_deg):
        raise ValueError("rotation angle must be finite")
    x, y, z = _unit_vector(axis, "rotation axis")
    angle = math.radians(angle_deg)
    cosine = math.cos(angle)
    sine = math.sin(angle)
    return np.array(
        [
            [cosine + x * x * (1.0 - cosine), x * y * (1.0 - cosine) - z * sine, x * z * (1.0 - cosine) + y * sine],
            [y * x * (1.0 - cosine) + z * sine, cosine + y * y * (1.0 - cosine), y * z * (1.0 - cosine) - x * sine],
            [z * x * (1.0 - cosine) - y * sine, z * y * (1.0 - cosine) + x * sine, cosine + z * z * (1.0 - cosine)],
        ]
    )


def _rotation_from_up(ground_normal: np.ndarray) -> np.ndarray:
    ground = _unit_vector(ground_normal, "ground_normal")
    cosine = float(np.dot(UP, ground))
    if math.isclose(cosine, 1.0, rel_tol=0.0, abs_tol=1e-12):
        return np.eye(3)
    if math.isclose(cosine, -1.0, rel_tol=0.0, abs_tol=1e-12):
        return _rotation_about(np.array([1.0, 0.0, 0.0]), 180.0)
    axis = np.cross(UP, ground)
    return _rotation_about(axis / np.linalg.norm(axis), math.degrees(math.acos(cosine)))


def _horizontal_direction(azimuth_deg: float) -> np.ndarray:
    if not math.isfinite(azimuth_deg):
        raise ValueError("azimuth_deg must be finite")
    azimuth = math.radians(azimuth_deg)
    # Site-frame axes are east, reference-north, up; azimuth is east of north.
    return np.array([math.sin(azimuth), math.cos(azimuth), 0.0])


def generic_panel_preset(
    preset: PanelPreset,
    *,
    panel_area_m2: float,
    efficiency: float,
    heading_deg: float | None = None,
    tracking_azimuth_deg: float | None = None,
) -> tuple[Panel, ...]:
    """Build an R3 generic preset from caller-supplied panel physical parameters.

    ``heading_deg`` is required by ``singleHeading``.  ``tracking_azimuth_deg``
    is required by ``trackingMast`` and should be updated for each Sun azimuth.
    No panel dimensions or efficiency defaults are assumed.
    """
    if preset == "fourSide":
        normals = tuple(_horizontal_direction(heading) for heading in (0.0, 90.0, 180.0, 270.0))
    elif preset == "singleHeading":
        if heading_deg is None:
            raise ValueError("singleHeading requires heading_deg")
        normals = (_horizontal_direction(heading_deg),)
    elif preset == "horizontalDeck":
        normals = (UP,)
    elif preset == "trackingMast":
        if tracking_azimuth_deg is None:
            raise ValueError("trackingMast requires tracking_azimuth_deg")
        normals = (_horizontal_direction(tracking_azimuth_deg),)
    else:
        raise ValueError(f"unsupported panel preset: {preset}")
    return tuple(Panel(normal, panel_area_m2, efficiency) for normal in normals)


def attitude_matrix(
    ground_normal: np.ndarray,
    yaw_deg: float,
    off_nominal_tilt_deg: float,
    off_nominal_tilt_direction_deg: float,
) -> np.ndarray:
    """Return R3 attitude = tilt-onto-ground * yaw * off-nominal tilt.

    Positive yaw increases site-frame azimuth.  The off-nominal tilt direction
    is the site-frame azimuth toward which a nominal up-facing panel tilts.
    """
    if not math.isfinite(yaw_deg) or not math.isfinite(off_nominal_tilt_deg):
        raise ValueError("yaw_deg and off_nominal_tilt_deg must be finite")
    tilt_direction = _horizontal_direction(off_nominal_tilt_direction_deg)
    tilt_axis = np.cross(UP, tilt_direction)
    return _rotation_from_up(ground_normal) @ _rotation_about(UP, -yaw_deg) @ _rotation_about(tilt_axis, off_nominal_tilt_deg)


def orient_panels(
    panels: Sequence[Panel],
    ground_normal: np.ndarray,
    yaw_deg: float,
    off_nominal_tilt_deg: float,
    off_nominal_tilt_direction_deg: float,
) -> tuple[Panel, ...]:
    """Rotate preset/configured panel normals by the R3 attitude composition."""
    attitude = attitude_matrix(ground_normal, yaw_deg, off_nominal_tilt_deg, off_nominal_tilt_direction_deg)
    return tuple(Panel(attitude @ _unit_vector(panel.normal, "panel normal"), panel.area_m2, panel.efficiency) for panel in panels)


def best_yaw_deg(
    panels: Sequence[Panel],
    sun_direction: np.ndarray,
    ground_normal: np.ndarray,
    off_nominal_tilt_deg: float,
    off_nominal_tilt_direction_deg: float,
) -> float:
    """Return the first maximum from R3's required 15-degree yaw sweep."""
    direction = _unit_vector(sun_direction, "sun_direction")
    best_yaw = 0.0
    best_projection = -math.inf
    for yaw in range(0, 360, 15):
        oriented = orient_panels(panels, ground_normal, float(yaw), off_nominal_tilt_deg, off_nominal_tilt_direction_deg)
        projection = sum(panel.area_m2 * panel.efficiency * max(0.0, float(np.dot(panel.normal, direction))) for panel in oriented)
        if projection > best_projection:
            best_yaw = float(yaw)
            best_projection = projection
    return best_yaw


def flat_ground_baseline_w(
    sun_direction: np.ndarray,
    sun_distance_km: float,
    disk_fraction: float,
    panels: Sequence[Panel],
    yaw_deg: float,
    off_nominal_tilt_deg: float,
    off_nominal_tilt_direction_deg: float,
) -> float:
    """Evaluate the same configured panels and controls on a flat local ground plane."""
    flat_panels = orient_panels(panels, UP, yaw_deg, off_nominal_tilt_deg, off_nominal_tilt_direction_deg)
    return solar_generation_w(sun_direction, sun_distance_km, disk_fraction, flat_panels)


def solar_irradiance_w_m2(sun_distance_km: float) -> float:
    """Return solar irradiance scaled from the declared 1 AU solar constant."""
    if not math.isfinite(sun_distance_km) or sun_distance_km <= 0.0:
        raise ValueError("sun_distance_km must be finite and positive")
    return SOLAR_CONSTANT_W_M2 * (AU_KM / sun_distance_km) ** 2


def solar_generation_w(
    sun_direction: np.ndarray,
    sun_distance_km: float,
    disk_fraction: float,
    panels: Sequence[Panel],
) -> float:
    """Apply R3's panel cosine law and disk fraction to configured panels."""
    direction = np.asarray(sun_direction, dtype=float)
    if direction.shape != (3,) or not np.all(np.isfinite(direction)) or not math.isclose(float(np.linalg.norm(direction)), 1.0, rel_tol=0.0, abs_tol=1e-12):
        raise ValueError("sun_direction must be a finite unit vector with shape (3,)")
    if not math.isfinite(disk_fraction) or not 0.0 <= disk_fraction <= 1.0:
        raise ValueError("disk_fraction must be finite and within [0, 1]")

    projected_area_efficiency = 0.0
    for panel in panels:
        normal = np.asarray(panel.normal, dtype=float)
        if normal.shape != (3,) or not np.all(np.isfinite(normal)) or not math.isclose(float(np.linalg.norm(normal)), 1.0, rel_tol=0.0, abs_tol=1e-12):
            raise ValueError("panel normals must be finite unit vectors with shape (3,)")
        if not math.isfinite(panel.area_m2) or panel.area_m2 < 0.0:
            raise ValueError("panel area_m2 must be finite and non-negative")
        if not math.isfinite(panel.efficiency) or not 0.0 <= panel.efficiency <= 1.0:
            raise ValueError("panel efficiency must be finite and within [0, 1]")
        projected_area_efficiency += panel.area_m2 * panel.efficiency * max(0.0, float(np.dot(normal, direction)))
    return solar_irradiance_w_m2(sun_distance_km) * projected_area_efficiency * disk_fraction


def integrate_battery_soc(
    times_et: Sequence[float],
    generation_w: Sequence[float],
    operational_load_w: Sequence[float],
    *,
    battery_capacity_wh: float,
    usable_depth_of_discharge: float,
    initial_soc_fraction: float,
) -> PowerSeries:
    """Integrate battery SOC by trapezoidal interval energy with physical bounds.

    The configured usable depth of discharge sets the minimum retained SOC.
    Generation above full capacity is reported as curtailed; load below the
    retained minimum is reported as unserved rather than silently discharged.
    """
    times = np.asarray(times_et, dtype=float)
    generation = np.asarray(generation_w, dtype=float)
    load = np.asarray(operational_load_w, dtype=float)
    if times.ndim != 1 or len(times) < 2 or len(generation) != len(times) or len(load) != len(times):
        raise ValueError("times, generation_w, and operational_load_w must have matching length >= 2")
    if not np.all(np.isfinite(times)) or not np.all(np.diff(times) > 0.0):
        raise ValueError("times_et must be finite and strictly increasing")
    if not np.all(np.isfinite(generation)) or np.any(generation < 0.0):
        raise ValueError("generation_w must be finite and non-negative")
    if not np.all(np.isfinite(load)) or np.any(load < 0.0):
        raise ValueError("operational_load_w must be finite and non-negative")
    if not math.isfinite(battery_capacity_wh) or battery_capacity_wh <= 0.0:
        raise ValueError("battery_capacity_wh must be finite and positive")
    if not math.isfinite(usable_depth_of_discharge) or not 0.0 <= usable_depth_of_discharge <= 1.0:
        raise ValueError("usable_depth_of_discharge must be within [0, 1]")

    minimum_soc = 1.0 - usable_depth_of_discharge
    if not math.isfinite(initial_soc_fraction) or not minimum_soc <= initial_soc_fraction <= 1.0:
        raise ValueError("initial_soc_fraction must be within the usable battery range")

    net = generation - load
    stored = np.empty(len(times), dtype=float)
    soc = np.empty(len(times), dtype=float)
    curtailed = np.zeros(len(times), dtype=float)
    unserved = np.zeros(len(times), dtype=float)
    minimum_energy = minimum_soc * battery_capacity_wh
    stored[0] = initial_soc_fraction * battery_capacity_wh
    soc[0] = initial_soc_fraction

    for index, duration_hours in enumerate(np.diff(times) / 3600.0, start=1):
        requested_energy = stored[index - 1] + (net[index - 1] + net[index]) * duration_hours / 2.0
        curtailed[index] = max(0.0, requested_energy - battery_capacity_wh)
        unserved[index] = max(0.0, minimum_energy - requested_energy)
        stored[index] = min(battery_capacity_wh, max(minimum_energy, requested_energy))
        soc[index] = stored[index] / battery_capacity_wh

    return PowerSeries(generation, load, net, soc, stored, curtailed, unserved)


def evaluate_power_series(
    times_et: Sequence[float],
    sun_directions: Sequence[np.ndarray],
    sun_distances_km: Sequence[float],
    sun_disk_fractions: Sequence[float],
    panels: Sequence[Panel],
    operational_load_w: Sequence[float],
    *,
    battery_capacity_wh: float,
    usable_depth_of_discharge: float,
    initial_soc_fraction: float,
) -> PowerSeries:
    """Evaluate R3 generation, eclipse attenuation, loads, and battery SOC together."""
    if len(sun_directions) != len(times_et) or len(sun_distances_km) != len(times_et) or len(sun_disk_fractions) != len(times_et):
        raise ValueError("sun geometry series must match times_et")
    generation = [
        solar_generation_w(direction, distance, fraction, panels)
        for direction, distance, fraction in zip(sun_directions, sun_distances_km, sun_disk_fractions, strict=True)
    ]
    return integrate_battery_soc(
        times_et,
        generation,
        operational_load_w,
        battery_capacity_wh=battery_capacity_wh,
        usable_depth_of_discharge=usable_depth_of_discharge,
        initial_soc_fraction=initial_soc_fraction,
    )
