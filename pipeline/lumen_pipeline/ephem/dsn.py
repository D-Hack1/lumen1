"""Build the R3 DSN Moon-centre elevation series using the IAU_EARTH fallback."""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from lumen_pipeline.common.binio import sidecar_path, write_array
from lumen_pipeline.common.timeutil import parse_utc, utc_to_et
from lumen_pipeline.ephem.kernels import kernel_paths, loaded_kernels

START_UTC = "2023-01-01T00:00:00Z"
END_UTC = "2030-12-31T23:50:00Z"
CADENCE_SECONDS = 600
STATION_ORDER = ("DSS-14", "DSS-43", "DSS-63")


@dataclass(frozen=True)
class Station:
    id: str
    complex: str
    longitude_deg_east: float
    latitude_deg: float
    altitude_km: float


# Values are the geodetic coordinates reported by JPL Horizons for each DSS
# observer (queried with CENTER=DSS-14/DSS-43/DSS-63 on 2026-11-14). Horizons
# identifies the coordinate realization as ITRF93 but does not state an epoch.
STATIONS = (
    Station("DSS-14", "Goldstone", 243.1104618, 35.4259009, 1.00139),
    Station("DSS-43", "Canberra", 148.9812673, -35.4024242, 0.688867),
    Station("DSS-63", "Madrid", 355.7519915, 40.4312097, 0.86482),
)

STATION_COORDINATE_PROVENANCE = {
    "station_coordinate_source": "JPL Horizons DSS observer geodetic headers",
    "station_coordinate_realization": "ITRF93",
    "station_coordinate_epoch": "not specified by JPL Horizons DSS observer geodetic headers",
    "station_coordinate_retrieval": {
        "provider": "JPL Horizons",
        "endpoint": "https://ssd.jpl.nasa.gov/api/horizons.api",
        "observer_centers": list(STATION_ORDER),
        "query": "EPHEM_TYPE=OBSERVER; COMMAND=301 (Moon)",
        "retrieved_date": "2026-11-14",
    },
}


def default_output_path() -> Path:
    return Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "dsn" / "dsn.bin"


def dsn_ets(start_utc: str = START_UTC, end_utc: str = END_UTC) -> np.ndarray:
    """Return the contract coverage at an exact 600-second ET cadence."""
    elapsed = (parse_utc(end_utc) - parse_utc(start_utc)).total_seconds()
    count = round(elapsed / CADENCE_SECONDS) + 1
    if count < 1 or not np.isclose(elapsed, (count - 1) * CADENCE_SECONDS):
        raise ValueError("DSN bounds must align to the 600-second grid")
    return utc_to_et(start_utc) + np.arange(count, dtype=np.float64) * CADENCE_SECONDS


def station_elevations_deg(ets: np.ndarray, station: Station) -> np.ndarray:
    """Compute geometric Moon-centre elevations in R3's IAU_EARTH fallback frame."""
    import spiceypy as spice

    radii = np.asarray(spice.bodvrd("EARTH", "RADII", 3)[1], dtype=float)
    equatorial_radius, polar_radius = radii[0], radii[2]
    flattening = (equatorial_radius - polar_radius) / equatorial_radius
    longitude = math.radians(station.longitude_deg_east)
    latitude = math.radians(station.latitude_deg)
    position = np.asarray(spice.georec(longitude, latitude, station.altitude_km, equatorial_radius, flattening))
    up = np.array([math.cos(latitude) * math.cos(longitude), math.cos(latitude) * math.sin(longitude), math.sin(latitude)])
    moon, _ = spice.spkpos("MOON", ets, "IAU_EARTH", "LT+S", "EARTH")
    topocentric = np.asarray(moon, dtype=float) - position
    elevation = np.degrees(np.arcsin(np.clip(topocentric @ up / np.linalg.norm(topocentric, axis=1), -1.0, 1.0)))
    if not np.all(np.isfinite(elevation)) or np.any(np.abs(elevation) > 90.0):
        raise ValueError(f"invalid Moon elevations for {station.id}")
    return elevation


def encode_elevations(elevation_deg: np.ndarray) -> np.ndarray:
    """Quantise elevations exactly as the frozen Int16 DSN contract requires."""
    encoded = np.rint(np.asarray(elevation_deg, dtype=float) * 2.0)
    if np.any(encoded < -180) or np.any(encoded > 180):
        raise ValueError("quantised Moon elevations fall outside the Int16 contract range")
    return encoded.astype(np.int16)


def build_dsn(
    output_path: str | Path | None = None,
    *,
    kernel_dir: str | Path | None = None,
    start_utc: str = START_UTC,
    end_utc: str = END_UTC,
) -> dict[str, object]:
    """Write station-major [station, time] Int16 Moon elevation data and provenance."""
    output = Path(output_path) if output_path is not None else default_output_path()
    with loaded_kernels(kernel_dir):
        ets = dsn_ets(start_utc, end_utc)
        data = np.stack([encode_elevations(station_elevations_deg(ets, station)) for station in STATIONS])
        paths = kernel_paths(kernel_dir)
        metadata = write_array(
            output,
            data,
            fields=list(STATION_ORDER),
            units="deg",
            producer="lumen_pipeline.ephem.dsn",
            scale=0.5,
            offset=0.0,
        )
        metadata.update(
            {
                "start_utc": start_utc,
                "end_utc": end_utc,
                "cadence_s": CADENCE_SECONDS,
                "axis_order": ["station", "time"],
                "mode": "geometric_only",
                "frame": "IAU_EARTH",
                "earth_orientation": "IAU_EARTH fallback from pck00011.tpc",
                "aberration_correction": "LT+S",
                "target": "MOON centre",
                "station_complexes": {station.id: station.complex for station in STATIONS},
                "station_geodetic": [station.__dict__ for station in STATIONS],
                **STATION_COORDINATE_PROVENANCE,
                "kernel_provenance": [
                    {"filename": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in paths
                ],
            }
        )
        sidecar_path(output).write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return metadata
