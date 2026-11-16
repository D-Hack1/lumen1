# Owner: Gowri
# Daily sunlit%/DTE% sparklines per curated site.

"""Build deterministic daily Sun and Earth-visibility catalog series.

The catalog is deliberately a small, daily product.  It evaluates only the
requested UTC days, rather than regenerating an annual cache for each site.
"""

from __future__ import annotations

import json
import os
import struct
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import yaml

from lumen_pipeline.common.binio import read_array, write_array
from lumen_pipeline.common.frames import site_position_km, site_rotation_matrix
from lumen_pipeline.common.timeutil import format_utc, parse_utc
from lumen_pipeline.ephem.ephemeris import STEP_SECONDS
from lumen_pipeline.reference.interp import Ephemeris
from lumen_pipeline.reference.visibility import FiniteSegmentTree, Horizon, availability
from lumen_pipeline.terrain.masks import _site_coordinates

DEFAULT_START_UTC = "2023-01-01T00:00:00Z"
# The published catalog contract covers three full UTC years. Extending this
# range requires an intentional artifact update, rather than invalidating its
# deterministic rows during a routine catalog rebuild.
DEFAULT_END_UTC = "2026-01-01T00:00:00Z"
COORDINATE_FRAME = "MOON_ME_DE421"
OBSERVER_HEIGHT_M = 2.0
SAMPLE_SECONDS = 120
SUN_DISK_THRESHOLD = 0.5
EARTH_DISK_THRESHOLD = 0.5
EARTH_MARGIN_DEG = 1.0
FIELDS = ["sunlit_pct", "link_pct"]


def default_sites_path() -> Path:
    return Path(__file__).resolve().parents[2] / "config" / "sites.yaml"


def default_ephemeris_path() -> Path:
    return Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "ephem" / "ephem.bin"


def default_terrain_root() -> Path:
    return Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "terrain"


def default_output_path() -> Path:
    return (
        Path(__file__).resolve().parents[3]
        / "web"
        / "public"
        / "data"
        / "catalog"
        / "sparklines.bin"
    )


def _utc_day(value: str) -> datetime:
    instant = parse_utc(value)
    if instant.time() != datetime.min.time():
        raise ValueError("sparkline bounds must be UTC midnight")
    return instant


def _mask_horizon(
    site: dict[str, Any], terrain_root: Path, latitude_deg: float, longitude_deg_east: float
) -> Horizon | None:
    """Load the 2 m row only from a site-bound, complete Tier-A artifact."""
    site_id = str(site["id"])
    # The available Shackleton handoff is explicitly preliminary.  Do not turn
    # it into a final catalog product while the target-coordinate issue remains.
    if site_id == "shackleton_ridge":
        return None
    sidecar = terrain_root / "masks" / f"{site_id}.json"
    binary = terrain_root / "masks" / f"{site_id}.bin"
    if not sidecar.is_file() or not binary.is_file():
        return None
    metadata = json.loads(sidecar.read_text(encoding="utf-8"))
    if not isinstance(metadata, dict):
        return None
    required = {
        "site_id",
        "latitude_deg",
        "longitude_deg_east",
        "coordinate_frame",
        "heights_m",
        "azimuth_count",
        "bin_width_deg",
        "slope_deg",
        "uphill_azimuth_deg",
        "d_min_m",
    }
    if not required <= metadata.keys() or metadata["site_id"] != site_id:
        return None
    try:
        latitude = float(metadata["latitude_deg"])
        longitude = float(metadata["longitude_deg_east"])
        bin_width = float(metadata["bin_width_deg"])
        numeric_metadata = tuple(
            float(metadata[key]) for key in ("slope_deg", "uphill_azimuth_deg", "d_min_m")
        )
    except (TypeError, ValueError):
        return None
    if metadata["coordinate_frame"] != COORDINATE_FRAME:
        return None
    if not np.isclose(latitude, latitude_deg, rtol=0.0, atol=1e-9):
        return None
    if not np.isclose(longitude, longitude_deg_east, rtol=0.0, atol=1e-9):
        return None
    heights = metadata.get("heights_m")
    if not isinstance(heights, list) or len(heights) != 4 or OBSERVER_HEIGHT_M not in heights:
        return None
    if metadata["azimuth_count"] != 3600 or not np.isclose(bin_width, 0.1):
        return None
    if not all(np.isfinite(value) for value in numeric_metadata):
        return None
    payload = binary.read_bytes()
    if len(payload) != 115264:
        return None
    header = struct.unpack("<8sHHIIfffIIIIIIQ", payload[:64])
    if header[:5] != (b"LUMENMSK", 1, 64, len(heights), metadata["azimuth_count"]):
        return None
    if not np.isclose(header[5], bin_width, rtol=0.0, atol=1e-6):
        return None
    elevation = np.frombuffer(payload, dtype="<f4", count=4 * 3600, offset=64).reshape(4, 3600)
    row = np.asarray(elevation[heights.index(OBSERVER_HEIGHT_M)], dtype=float)
    if not np.any(np.isfinite(row)):
        return None
    return Horizon(
        row,
        bin_width_deg=float(metadata["bin_width_deg"]),
        slope_deg=metadata.get("slope_deg"),
        uphill_azimuth_deg=metadata.get("uphill_azimuth_deg"),
        d_min_m=metadata.get("d_min_m"),
        observer_height_m=OBSERVER_HEIGHT_M,
        range_extrema=FiniteSegmentTree.from_elevations(row),
    )


def _daily_percentages(
    ephemeris: Ephemeris,
    latitude_deg: float,
    longitude_deg_east: float,
    horizon: Horizon,
    day_start: datetime,
    ephemeris_start: datetime,
) -> tuple[int, int]:
    samples = 86400 // SAMPLE_SECONDS
    start_et = ephemeris.start_et + (day_start - ephemeris_start).total_seconds()
    ets = start_et + np.arange(samples, dtype=float) * SAMPLE_SECONDS
    if isinstance(ephemeris, Ephemeris):
        # This is the same Hermite/topocentric computation as Ephemeris.body_at,
        # evaluated for a UTC day at once so the approved multi-year artifact is
        # practical to generate. Disk and horizon availability remain per sample.
        interval = (ets - ephemeris.start_et) / STEP_SECONDS
        indices = np.floor(interval).astype(int)
        fraction = interval - indices
        t2 = fraction * fraction
        t3 = t2 * fraction
        h00 = 2 * t3 - 3 * t2 + 1
        h10 = t3 - 2 * t2 + fraction
        h01 = -2 * t3 + 3 * t2
        h11 = t3 - t2
        positions = np.empty((samples, 2, 3), dtype=float)
        for body_index, offset in enumerate((0, 6)):
            positions[:, body_index] = (
                h00[:, None] * ephemeris.nodes[indices, offset : offset + 3]
                + h10[:, None] * STEP_SECONDS * ephemeris.nodes[indices, offset + 3 : offset + 6]
                + h01[:, None] * ephemeris.nodes[indices + 1, offset : offset + 3]
                + h11[:, None]
                * STEP_SECONDS
                * ephemeris.nodes[indices + 1, offset + 3 : offset + 6]
            )
        topocentric = positions - site_position_km(
            latitude_deg, longitude_deg_east, OBSERVER_HEIGHT_M
        )
        distance = np.linalg.norm(topocentric, axis=2)
        directions = (topocentric / distance[:, :, None]) @ site_rotation_matrix(
            latitude_deg, longitude_deg_east
        ).T
        azimuth = np.degrees(np.arctan2(directions[:, :, 0], directions[:, :, 1])) % 360.0
        elevation = np.degrees(np.arcsin(directions[:, :, 2]))
    else:
        distance = azimuth = elevation = None
    sun_up = 0
    earth_up = 0
    for index in range(samples):
        if distance is None or azimuth is None or elevation is None:
            et = float(ets[index])
            sun = ephemeris.body_at("sun", et, latitude_deg, longitude_deg_east, OBSERVER_HEIGHT_M)
            earth = ephemeris.body_at(
                "earth", et, latitude_deg, longitude_deg_east, OBSERVER_HEIGHT_M
            )
            sun_distance, sun_azimuth, sun_elevation = (
                sun.distance_km,
                sun.azimuth_deg,
                sun.elevation_deg,
            )
            earth_distance, earth_azimuth, earth_elevation = (
                earth.distance_km,
                earth.azimuth_deg,
                earth.elevation_deg,
            )
        else:
            sun_distance, sun_azimuth, sun_elevation = (
                distance[index, 0],
                azimuth[index, 0],
                elevation[index, 0],
            )
            earth_distance, earth_azimuth, earth_elevation = (
                distance[index, 1],
                azimuth[index, 1],
                elevation[index, 1],
            )
        sun_up += availability(
            "sun",
            sun_elevation,
            sun_azimuth,
            sun_distance,
            horizon,
            disk_threshold=SUN_DISK_THRESHOLD,
        )[2]
        earth_up += availability(
            "earth",
            earth_elevation,
            earth_azimuth,
            earth_distance,
            horizon,
            disk_threshold=EARTH_DISK_THRESHOLD,
            margin_deg=EARTH_MARGIN_DEG,
        )[2]
    # Integer half-up rounding keeps bytes deterministic and avoids banker's rounding.
    return ((sun_up * 100 + samples // 2) // samples, (earth_up * 100 + samples // 2) // samples)


def _checkpoint_paths(destination: Path) -> tuple[Path, Path]:
    return destination.with_suffix(".partial.npy"), destination.with_suffix(".partial.json")


def _save_checkpoint(destination: Path, rows: list[np.ndarray], metadata: dict[str, Any]) -> None:
    data_path, metadata_path = _checkpoint_paths(destination)
    temporary_data = data_path.with_name(data_path.name + ".tmp")
    temporary_metadata = metadata_path.with_name(metadata_path.name + ".tmp")
    with temporary_data.open("wb") as stream:
        np.save(
            stream, np.stack(rows) if rows else np.empty((0, 2, metadata["days"]), dtype=np.uint8)
        )
    temporary_metadata.write_text(
        json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    os.replace(temporary_data, data_path)
    os.replace(temporary_metadata, metadata_path)


def _load_checkpoint(
    destination: Path, *, start_utc: str, days: int
) -> tuple[list[np.ndarray], dict[str, Any]] | None:
    data_path, metadata_path = _checkpoint_paths(destination)
    if not data_path.is_file() or not metadata_path.is_file():
        return None
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        data = np.load(data_path, allow_pickle=False)
        if (
            metadata["start_utc"] != start_utc
            or metadata["days"] != days
            or data.shape != (len(metadata["sites"]), 2, days)
        ):
            return None
        return [np.asarray(row, dtype=np.uint8) for row in data], metadata
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None


def _existing_rows(
    destination: Path, *, start_utc: str, days: int
) -> tuple[list[np.ndarray], dict[str, str]]:
    try:
        data, metadata = read_array(destination)
        if (
            metadata.get("start_utc") != start_utc
            or metadata.get("days") != days
            or data.ndim != 3
            or data.shape[1:] != (2, days)
        ):
            return [], {}
        sites = metadata.get("sites")
        provenance = metadata.get("provenance")
        if (
            not isinstance(sites, list)
            or not isinstance(provenance, dict)
            or len(sites) != data.shape[0]
        ):
            return [], {}
        return [np.asarray(row, dtype=np.uint8) for row in data], {
            str(site): str(provenance[site]) for site in sites
        }
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return [], {}


def build_sparklines(
    sites_path: str | Path | None = None,
    ephemeris_path: str | Path | None = None,
    output_path: str | Path | None = None,
    terrain_root: str | Path | None = None,
    *,
    start_utc: str = DEFAULT_START_UTC,
    end_utc: str = DEFAULT_END_UTC,
    max_sites: int | None = None,
) -> dict[str, Any]:
    """Write daily UTC-boundary catalog series for the requested half-open range.

    Site rows without a verified, matching mask use smooth-sphere estimates;
    they are not terrain bounds. The
    Shackleton preliminary artifact is never included in a final publication.
    """
    start = _utc_day(start_utc)
    end = _utc_day(end_utc)
    if end <= start:
        raise ValueError("sparkline end must be after start")
    source = yaml.safe_load(Path(sites_path or default_sites_path()).read_text(encoding="utf-8"))
    ephemeris_binary = Path(ephemeris_path or default_ephemeris_path())
    ephemeris = Ephemeris.from_file(ephemeris_binary)
    ephemeris_metadata = json.loads(
        ephemeris_binary.with_suffix(".json").read_text(encoding="utf-8")
    )
    ephemeris_start = parse_utc(ephemeris_metadata["start_utc"])
    ephemeris_end = parse_utc(ephemeris_metadata["end_utc"])
    if start < ephemeris_start or end > ephemeris_end:
        raise ValueError("requested UTC days are outside the interpolable ephemeris range")

    days = (end - start).days
    terrain = Path(terrain_root or default_terrain_root())
    destination = Path(output_path or default_output_path())
    checkpoint = _load_checkpoint(destination, start_utc=format_utc(start), days=days)
    if checkpoint is None:
        rows, provenance = _existing_rows(destination, start_utc=format_utc(start), days=days)
        site_ids = list(provenance)
    else:
        rows, checkpoint_metadata = checkpoint
        site_ids = list(checkpoint_metadata["sites"])
        provenance = dict(checkpoint_metadata["provenance"])
    excluded_sites: dict[str, str] = {}
    sites = source.get("sites") if isinstance(source, dict) else None
    if not isinstance(sites, list):
        raise TypeError("sites source must contain a sites list")
    seen_ids: set[str] = set()
    completed = 0
    for site in sites:
        if not isinstance(site, dict) or not isinstance(site.get("id"), str):
            raise TypeError("each site must have a string id")
        site_id = str(site["id"])
        if site_id in seen_ids:
            raise ValueError(f"duplicate site id: {site_id}")
        seen_ids.add(site_id)
        latitude_deg, longitude_deg_east = _site_coordinates(site_id, site)
        if not -90.0 <= latitude_deg <= 90.0 or not -180.0 <= longitude_deg_east <= 360.0:
            raise ValueError(f"{site_id} has invalid computation coordinates")
        if site_id == "shackleton_ridge":
            excluded_sites[site_id] = (
                "not published: preliminary terrain and unresolved target coordinates"
            )
            continue
        if site_id in site_ids:
            continue
        if max_sites is not None and completed >= max_sites:
            break
        site_started = time.monotonic()
        horizon = _mask_horizon(site, terrain, latitude_deg, longitude_deg_east)
        if horizon is None:
            horizon = Horizon(observer_height_m=OBSERVER_HEIGHT_M)
            provenance[site_id] = "smooth-sphere estimate; terrain unavailable"
        else:
            provenance[site_id] = "verified site-matched terrain mask"
        row = np.empty((2, days), dtype=np.uint8)
        for day in range(days):
            sunlit, link = _daily_percentages(
                ephemeris,
                latitude_deg,
                longitude_deg_east,
                horizon,
                start + timedelta(days=day),
                ephemeris_start,
            )
            row[:, day] = (sunlit, link)
        site_ids.append(site_id)
        rows.append(row)
        completed += 1
        _save_checkpoint(
            destination,
            rows,
            {
                "sites": site_ids,
                "provenance": provenance,
                "start_utc": format_utc(start),
                "days": days,
            },
        )
        print(
            f"[{site_id}] sparkline complete in {time.monotonic() - site_started:.1f}s ({len(site_ids)} rows)"
        )

    expected_ids = [str(site["id"]) for site in sites if site["id"] != "shackleton_ridge"]
    if site_ids != expected_ids:
        return {
            "complete": False,
            "sites": site_ids,
            "remaining_sites": [site_id for site_id in expected_ids if site_id not in site_ids],
        }

    data = np.stack(rows) if rows else np.empty((0, 2, days), dtype=np.uint8)
    staging = destination.parent / ".sparklines-stage"
    staging.mkdir(parents=True, exist_ok=True)
    staged_destination = staging / destination.name
    metadata = write_array(
        staged_destination,
        data,
        fields=FIELDS,
        units="percent",
        producer="lumen_pipeline.catalog.sparklines",
        created_utc=format_utc(start),
    )
    metadata.update(
        {
            "sites": site_ids,
            "start_utc": format_utc(start),
            "days": days,
            "definitions": "2 m; Sun disk >=50%; Earth disk >=50% and margin >=1 deg",
            "provenance": provenance,
            "excluded_sites": excluded_sites,
        }
    )
    staged_destination.with_suffix(".json").write_text(
        json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    os.replace(staged_destination, destination)
    os.replace(staged_destination.with_suffix(".json"), destination.with_suffix(".json"))
    for path in _checkpoint_paths(destination):
        path.unlink(missing_ok=True)
    return metadata
