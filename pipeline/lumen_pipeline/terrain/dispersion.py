# Owner: Shiva Shakthi
# 11x11 dispersion micro-grid per Tier-A site.
"""Slope on an 11 x 11 grid of nodes, 50 m apart, centred on a Tier-A site.

PLAN_FINAL P7: the grid shows how much the ground slope changes if the lander does not touch down exactly on target. Each node's slope is the
same R3 7 x 7 plane-fit slope the pad statistics use, evaluated at that node, on the site's near-field DEM crop.

File layout (matches web/src/engine/data/dispersion.ts):
    terrain/dispersion/<site_id>.bin   121 uint8 values, slope in units of 0.1 deg (clipped to 25.5 deg), row-major [row j][col i],
                                       j increases north and i increases east; node (5, 5) is the site.
    terrain/dispersion/<site_id>.json  version, site_id, nodes, spacing_m, dtype, unit_deg, plus provenance.
"""

from __future__ import annotations

import json
import math
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from ..common.frames import site_rotation_matrix, site_up_vector
from .crops import TerrainCrops
from .dem_io import SPHERE_RADIUS_M, DemWindow
from .pad import PadStatisticsUnavailable, fit_ground_plane

GRID_NODES = 11
SPACING_M = 50.0
UNIT_DEG = 0.1
MAX_CODE = 255
VERSION = "0.1.0"


def node_coordinates(latitude_deg: float, longitude_deg_east: float, east_m: float, north_m: float) -> tuple[float, float]:
    """Latitude and east longitude of the point `east_m`, `north_m` from the site in its local tangent frame."""
    rotation = site_rotation_matrix(latitude_deg, longitude_deg_east)
    radius_km = SPHERE_RADIUS_M / 1000.0
    site = radius_km * site_up_vector(latitude_deg, longitude_deg_east)
    point = site + rotation.T @ np.array([east_m / 1000.0, north_m / 1000.0, 0.0])
    return (
        math.degrees(math.asin(point[2] / np.linalg.norm(point))),
        math.degrees(math.atan2(point[1], point[0])) % 360.0,
    )


def dispersion_slopes(dem: DemWindow, *, latitude_deg: float, longitude_deg_east: float) -> np.ndarray:
    """Slope (deg) at every node, shape (11, 11) indexed [north row j][east column i]; NaN where the 7 x 7 window is not on valid data."""
    half = GRID_NODES // 2
    slopes = np.full((GRID_NODES, GRID_NODES), np.nan)
    for j in range(GRID_NODES):
        for i in range(GRID_NODES):
            lat, lon = node_coordinates(latitude_deg, longitude_deg_east, (i - half) * SPACING_M, (j - half) * SPACING_M)
            try:
                slopes[j, i] = fit_ground_plane(dem, latitude_deg=lat, longitude_deg_east=lon).slope_deg
            except PadStatisticsUnavailable:
                continue
    return slopes


def generate_dispersion(site_id: str, crops: TerrainCrops, *, latitude_deg: float, longitude_deg_east: float) -> tuple[bytes, dict]:
    """Build the .bin payload and .json sidecar. Refuses (raises) if any node has no valid slope: a hole is never filled in."""
    if crops.near is None:
        raise PadStatisticsUnavailable(f"{site_id}: near-field DEM is unavailable")
    slopes = dispersion_slopes(crops.near.dem, latitude_deg=latitude_deg, longitude_deg_east=longitude_deg_east)
    if not np.isfinite(slopes).all():
        raise PadStatisticsUnavailable(f"{site_id}: {int((~np.isfinite(slopes)).sum())} of 121 dispersion nodes have no valid DEM window")
    codes = np.clip(np.rint(slopes / UNIT_DEG), 0, MAX_CODE).astype(np.uint8)
    clipped = int((slopes / UNIT_DEG > MAX_CODE).sum())
    sidecar = {
        "version": VERSION,
        "producer": "lumen_pipeline.terrain.dispersion",
        "created_utc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "site_id": site_id,
        "nodes": [GRID_NODES, GRID_NODES],
        "spacing_m": SPACING_M,
        "dtype": "uint8",
        "unit_deg": UNIT_DEG,
        "order": "row-major [north row j][east column i]; j increases north, i increases east; node (5, 5) is the site",
        "latitude_deg": latitude_deg,
        "longitude_deg_east": longitude_deg_east,
        "dem_source": crops.near.source_key,
        "near_field_resolution_m": crops.near.achieved_resolution_m,
        "method": "R3 7x7 plane-fit slope evaluated at each node (pad.fit_ground_plane)",
        "clipped_nodes": clipped,
        "slope_deg_min": float(slopes.min()),
        "slope_deg_max": float(slopes.max()),
    }
    return codes.tobytes(), sidecar


def write_dispersion(site_id: str, payload: bytes, sidecar: dict, *, output_root: Path | None = None) -> Path:
    root = Path(output_root) if output_root is not None else Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "terrain"
    folder = root / "dispersion"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{site_id}.bin").write_bytes(payload)
    (folder / f"{site_id}.json").write_text(json.dumps(sidecar, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return folder / f"{site_id}.json"
