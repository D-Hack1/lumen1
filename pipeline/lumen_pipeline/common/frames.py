"""Singularity-free local frames in the east-positive MOON_ME frame."""

from __future__ import annotations

import math

import numpy as np

from .constants import LUNAR_RADIUS_KM, POLAR_REFERENCE_LATITUDE_DEG


def _unit(vector: np.ndarray) -> np.ndarray:
    length = float(np.linalg.norm(vector))
    if length == 0.0:
        raise ValueError("cannot normalize a zero-length vector")
    return vector / length


def site_up_vector(latitude_deg: float, longitude_deg_east: float) -> np.ndarray:
    """Return the radial MOON_ME up vector for east-positive coordinates."""
    latitude = math.radians(latitude_deg)
    longitude = math.radians(longitude_deg_east)
    return np.array(
        [
            math.cos(latitude) * math.cos(longitude),
            math.cos(latitude) * math.sin(longitude),
            math.sin(latitude),
        ],
        dtype=float,
    )


def reference_axis(latitude_deg: float) -> np.ndarray:
    """Use +X at polar sites and +Z elsewhere to avoid a polar singularity."""
    if abs(latitude_deg) >= POLAR_REFERENCE_LATITUDE_DEG:
        return np.array([1.0, 0.0, 0.0])
    return np.array([0.0, 0.0, 1.0])


def site_rotation_matrix(latitude_deg: float, longitude_deg_east: float) -> np.ndarray:
    """Return rows mapping MOON_ME vectors to east, north-reference, up."""
    up = site_up_vector(latitude_deg, longitude_deg_east)
    reference = reference_axis(latitude_deg)
    east = _unit(np.cross(reference, up))
    north_reference = _unit(np.cross(up, east))
    return np.vstack((east, north_reference, up))


def site_position_km(
    latitude_deg: float,
    longitude_deg_east: float,
    height_m: float = 0.0,
    surface_elevation_m: float = 0.0,
) -> np.ndarray:
    """Return the site centre position on the 1737.4 km reference sphere."""
    radius_km = LUNAR_RADIUS_KM + (height_m + surface_elevation_m) / 1000.0
    return radius_km * site_up_vector(latitude_deg, longitude_deg_east)


def direction_to_az_el(vector_in_site_frame: np.ndarray) -> tuple[float, float]:
    """Convert an east/north-reference/up direction to azimuth and elevation."""
    east, north_reference, up = _unit(np.asarray(vector_in_site_frame, dtype=float))
    azimuth_deg = math.degrees(math.atan2(east, north_reference)) % 360.0
    elevation_deg = math.degrees(math.asin(up))
    return azimuth_deg, elevation_deg


def az_el_to_direction(azimuth_deg: float, elevation_deg: float) -> np.ndarray:
    """Return a unit east/north-reference/up direction from azimuth/elevation."""
    azimuth = math.radians(azimuth_deg)
    elevation = math.radians(elevation_deg)
    horizontal = math.cos(elevation)
    return np.array(
        [horizontal * math.sin(azimuth), horizontal * math.cos(azimuth), math.sin(elevation)]
    )


def true_north_vector(latitude_deg: float, longitude_deg_east: float) -> np.ndarray:
    """Return geographic true north; it is undefined exactly at either pole."""
    if abs(abs(latitude_deg) - 90.0) < 1e-12:
        raise ValueError("true north is undefined at the poles")
    latitude = math.radians(latitude_deg)
    longitude = math.radians(longitude_deg_east)
    return np.array(
        [
            -math.sin(latitude) * math.cos(longitude),
            -math.sin(latitude) * math.sin(longitude),
            math.cos(latitude),
        ]
    )


def earth_ref_to_true_azimuth(
    azimuth_deg: float, latitude_deg: float, longitude_deg_east: float
) -> float:
    """Convert site-frame azimuth to true-north azimuth where true north exists."""
    rotation = site_rotation_matrix(latitude_deg, longitude_deg_east)
    direction_me = rotation.T @ az_el_to_direction(azimuth_deg, 0.0)
    east = np.array(
        [-math.sin(math.radians(longitude_deg_east)), math.cos(math.radians(longitude_deg_east)), 0.0]
    )
    north = true_north_vector(latitude_deg, longitude_deg_east)
    return math.degrees(math.atan2(float(direction_me @ east), float(direction_me @ north))) % 360.0
