"""JPL Horizons fixture cache and offline G3 smooth-sphere validation."""

from __future__ import annotations

import csv
import io
import json
import math
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import requests
import yaml

from lumen_pipeline.common.binio import sidecar_path
from lumen_pipeline.common.constants import AU_KM
from lumen_pipeline.common.frames import site_position_km, site_up_vector, true_north_vector
from lumen_pipeline.common.timeutil import utc_to_et
from lumen_pipeline.ephem.dsn import STATIONS, Station, station_elevations_deg
from lumen_pipeline.ephem.dsn import default_output_path as default_dsn_path
from lumen_pipeline.ephem.ephemeris import ABERRATION_CORRECTION
from lumen_pipeline.ephem.kernels import MOON_FRAME, loaded_kernels
from lumen_pipeline.reference.dsn import DsnSeries

HORIZONS_API_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"
START_TIME = "2023-01-01"
STOP_TIME = "2030-12-31"
STEP_SIZE = "150d"
EPOCHS_PER_SITE = 20
ELEVATION_TOLERANCE_DEG = 0.01
AZIMUTH_TOLERANCE_DEG = 0.01
RANGE_TOLERANCE_KM = 1.0
DSN_ELEVATION_TOLERANCE_DEG = 0.1
DSN_QUANTIZATION_HALF_STEP_DEG = 0.25
# This applies only to decoded half-degree artifact samples, not the locked
# direct-geometry G3b criterion above.
DSN_ARTIFACT_TOLERANCE_PROPOSAL_DEG = DSN_ELEVATION_TOLERANCE_DEG + DSN_QUANTIZATION_HALF_STEP_DEG


@dataclass(frozen=True)
class SiteCase:
    id: str
    latitude_deg: float
    longitude_deg_east: float


SITE_CASES = (
    SiteCase("im2_athena", -84.7906, 29.1957),
    SiteCase("cy3_shiv_shakti", -69.373, 32.319),
    SiteCase("shackleton_ridge", -89.54, 129.0),
    SiteCase("blue_ghost_m1", 18.56, 61.81),
    SiteCase("equator_zero", 0.0, 0.0),
)
SYNTHETIC_SITE_CASE_REASONS = {
    "equator_zero": "synthetic longitude-sign sanity control; no catalog site is intended at this coordinate",
}


@dataclass(frozen=True)
class HorizonsRecord:
    utc: str
    azimuth_deg: float
    elevation_deg: float
    range_km: float


@dataclass(frozen=True)
class Comparison:
    site_id: str
    body: str
    utc: str
    elevation_error_deg: float
    azimuth_error_deg: float | None
    range_error_km: float


@dataclass(frozen=True)
class DsnEpochWindow:
    label: str
    start_time: str
    stop_time: str
    step_size: str
    expected_records: int


# Ten historical and five future samples. The endpoint is aligned to the
# requested cadence so each cached Horizons response has a fixed record count.
DSN_EPOCH_WINDOWS = (
    DsnEpochWindow("historical_2023_2024", "2023-01-01", "2024-09-22", "70d", 10),
    DsnEpochWindow("future_2029_2030", "2029-01-01", "2030-08-24", "150d", 5),
)


@dataclass(frozen=True)
class DsnComparison:
    station_id: str
    utc: str
    elevation_error_deg: float


@dataclass(frozen=True)
class DsnArtifactComparison:
    station_id: str
    utc: str
    direct_elevation_error_deg: float
    decoded_elevation_error_deg: float
    quantization_error_deg: float


def default_fixture_dir() -> Path:
    """Return the checked-in, offline G3 fixture directory."""
    return Path(__file__).resolve().parents[2] / "tests" / "gowri" / "fixtures" / "horizons"


def default_sites_path() -> Path:
    return Path(__file__).resolve().parents[2] / "config" / "sites.yaml"


def assert_site_cases_match_config(sites_path: str | Path | None = None) -> None:
    """Ensure real Horizons cases retain the approved catalog coordinates."""
    source = yaml.safe_load(Path(sites_path or default_sites_path()).read_text(encoding="utf-8"))
    sites = source.get("sites") if isinstance(source, dict) else None
    if not isinstance(sites, list):
        raise TypeError("sites configuration must contain a sites list")
    configured = {site.get("id"): site for site in sites if isinstance(site, dict)}
    real_cases = [site for site in SITE_CASES if site.id not in SYNTHETIC_SITE_CASE_REASONS]
    missing = [site.id for site in real_cases if site.id not in configured]
    if missing:
        raise ValueError(f"G3 site cases are missing from sites configuration: {missing}")
    for site in real_cases:
        configured_site = configured[site.id]
        try:
            latitude = float(configured_site["latitude_deg"])
            longitude = float(configured_site["longitude_deg_east"])
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError(f"G3 site {site.id} lacks numeric configured coordinates") from error
        if not math.isclose(site.latitude_deg, latitude, rel_tol=0.0, abs_tol=1e-12) or not math.isclose(
            site.longitude_deg_east, longitude, rel_tol=0.0, abs_tol=1e-12
        ):
            raise ValueError(f"G3 site coordinates differ from sites configuration: {site.id}")


def horizons_parameters(site: SiteCase, body: str) -> dict[str, str]:
    """Build the R3-locked Horizons observer request for one body and site."""
    command = {"sun": "10", "earth": "399"}[body]
    return {
        "format": "text",
        "COMMAND": f"'{command}'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "SITE_COORD": f"'{site.longitude_deg_east},{site.latitude_deg},0'",
        "START_TIME": f"'{START_TIME}'",
        "STOP_TIME": f"'{STOP_TIME}'",
        "STEP_SIZE": f"'{STEP_SIZE}'",
        "QUANTITIES": "'4,20'",
        "CSV_FORMAT": "'YES'",
        "ANG_FORMAT": "'DEG'",
        "APPARENT": "'AIRLESS'",
        "EXTRA_PREC": "'YES'",
    }


def dsn_horizons_parameters(station: Station, window: DsnEpochWindow) -> dict[str, str]:
    """Build the R3 G3b Horizons request for Moon-centre elevation at one DSS station."""
    return {
        "format": "text",
        "COMMAND": "'301'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": f"'{station.id}'",
        "START_TIME": f"'{window.start_time}'",
        "STOP_TIME": f"'{window.stop_time}'",
        "STEP_SIZE": f"'{window.step_size}'",
        "QUANTITIES": "'4,20'",
        "CSV_FORMAT": "'YES'",
        "ANG_FORMAT": "'DEG'",
        "APPARENT": "'AIRLESS'",
        "EXTRA_PREC": "'YES'",
    }


def parse_horizons_response(response: str) -> tuple[HorizonsRecord, ...]:
    """Extract airless apparent azimuth, elevation, and apparent range from CSV output."""
    try:
        table = response.split("$$SOE", maxsplit=1)[1].split("$$EOE", maxsplit=1)[0]
    except IndexError as error:
        raise ValueError("Horizons response did not contain an ephemeris table") from error
    records: list[HorizonsRecord] = []
    for row in csv.reader(io.StringIO(table.strip())):
        if len(row) < 6:
            continue
        records.append(
            HorizonsRecord(
                utc=datetime.strptime(row[0].strip(), "%Y-%b-%d %H:%M")
                .replace(tzinfo=UTC)
                .isoformat()
                .replace("+00:00", "Z"),
                azimuth_deg=float(row[3]),
                elevation_deg=float(row[4]),
                range_km=float(row[5]) * AU_KM,
            )
        )
    if not records:
        raise ValueError("Horizons response contained no records")
    return tuple(records)


def fixture_path(site: SiteCase, body: str, directory: str | Path | None = None) -> Path:
    """Return the traceable cache path for one Horizons request."""
    base = Path(directory) if directory is not None else default_fixture_dir()
    return base / f"{site.id}_{body}.json"


def cache_fixture(site: SiteCase, body: str, directory: str | Path | None = None) -> Path:
    """Fetch and store a real Horizons response with its exact query provenance."""
    parameters = horizons_parameters(site, body)
    response = requests.get(HORIZONS_API_URL, params=parameters, timeout=60)
    response.raise_for_status()
    records = parse_horizons_response(response.text)
    if len(records) != EPOCHS_PER_SITE:
        raise ValueError(f"expected {EPOCHS_PER_SITE} Horizons epochs, received {len(records)}")
    path = fixture_path(site, body, directory)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": "NASA/JPL Horizons API",
        "fetched_utc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "site": asdict(site),
        "body": body,
        "request_url": response.url,
        "request_parameters": parameters,
        "response": response.text,
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path


def cache_all_fixtures(directory: str | Path | None = None) -> tuple[Path, ...]:
    """Fetch all 5 x 20 x 2 real Horizons fixture sets; never used by tests."""
    return tuple(cache_fixture(site, body, directory) for site in SITE_CASES for body in ("sun", "earth"))


def dsn_fixture_path(station: Station, directory: str | Path | None = None) -> Path:
    """Return the traceable offline G3b fixture path for one station."""
    base = Path(directory) if directory is not None else default_fixture_dir()
    return base / f"{station.id.lower()}_moon.json"


def cache_dsn_fixture(station: Station, directory: str | Path | None = None) -> Path:
    """Fetch G3b's genuine historical and future Moon-elevation reference records."""
    queries: list[dict[str, object]] = []
    for window in DSN_EPOCH_WINDOWS:
        parameters = dsn_horizons_parameters(station, window)
        response = requests.get(HORIZONS_API_URL, params=parameters, timeout=60)
        response.raise_for_status()
        records = parse_horizons_response(response.text)
        if len(records) != window.expected_records:
            raise ValueError(
                f"expected {window.expected_records} Horizons epochs for {station.id} {window.label}, got {len(records)}"
            )
        queries.append(
            {
                "window": asdict(window),
                "request_url": response.url,
                "request_parameters": parameters,
                "response": response.text,
            }
        )
    path = dsn_fixture_path(station, directory)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "source": "NASA/JPL Horizons API",
                "fetched_utc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
                "station": asdict(station),
                "target": "Moon centre (301)",
                "queries": queries,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    return path


def cache_all_dsn_fixtures(directory: str | Path | None = None) -> tuple[Path, ...]:
    """Fetch all G3b station fixtures; callers run this deliberately, never CI."""
    return tuple(cache_dsn_fixture(station, directory) for station in STATIONS)


def load_fixture(path: str | Path) -> tuple[SiteCase, str, tuple[HorizonsRecord, ...]]:
    """Load and validate a cached response without making a network request."""
    payload: dict[str, Any] = json.loads(Path(path).read_text(encoding="utf-8"))
    if payload.get("source") != "NASA/JPL Horizons API" or not payload.get("request_url") or not payload.get("fetched_utc"):
        raise ValueError(f"fixture lacks Horizons provenance: {path}")
    site = SiteCase(**payload["site"])
    body = payload["body"]
    if payload.get("request_parameters") != horizons_parameters(site, body):
        raise ValueError(f"fixture request does not match the R3 G3 query: {path}")
    if "Atmos refraction: NO (AIRLESS)" not in payload["response"]:
        raise ValueError(f"fixture is not airless apparent Horizons output: {path}")
    records = parse_horizons_response(payload["response"])
    if len(records) != EPOCHS_PER_SITE:
        raise ValueError(f"fixture has {len(records)} epochs instead of {EPOCHS_PER_SITE}: {path}")
    return site, body, records


def load_dsn_fixture(path: str | Path) -> tuple[Station, tuple[HorizonsRecord, ...]]:
    """Load one genuine G3b fixture without making a network request."""
    payload: dict[str, Any] = json.loads(Path(path).read_text(encoding="utf-8"))
    if payload.get("source") != "NASA/JPL Horizons API" or not payload.get("fetched_utc"):
        raise ValueError(f"fixture lacks Horizons provenance: {path}")
    station = Station(**payload["station"])
    if station not in STATIONS or payload.get("target") != "Moon centre (301)":
        raise ValueError(f"fixture station or target does not match G3b: {path}")
    queries = payload.get("queries")
    if not isinstance(queries, list) or len(queries) != len(DSN_EPOCH_WINDOWS):
        raise ValueError(f"fixture lacks G3b query windows: {path}")
    records: list[HorizonsRecord] = []
    for query, window in zip(queries, DSN_EPOCH_WINDOWS, strict=True):
        if query.get("window") != asdict(window):
            raise ValueError(f"fixture window does not match G3b query: {path}")
        if query.get("request_parameters") != dsn_horizons_parameters(station, window):
            raise ValueError(f"fixture request does not match the R3 G3b query: {path}")
        if not query.get("request_url"):
            raise ValueError(f"fixture lacks Horizons request URL: {path}")
        response = query.get("response")
        if not isinstance(response, str) or "Atmos refraction: NO (AIRLESS)" not in response:
            raise ValueError(f"fixture is not airless apparent Horizons output: {path}")
        window_records = parse_horizons_response(response)
        if len(window_records) != window.expected_records:
            raise ValueError(f"fixture has wrong record count for {window.label}: {path}")
        records.extend(window_records)
    return station, tuple(records)


def _angular_difference_deg(left: float, right: float) -> float:
    return abs((left - right + 180.0) % 360.0 - 180.0)


def _spice_observation(site: SiteCase, body: str, utc: str) -> tuple[float, float, float]:
    import spiceypy as spice

    target = {"sun": "SUN", "earth": "EARTH"}[body]
    state, _ = spice.spkezr(target, utc_to_et(utc), MOON_FRAME, ABERRATION_CORRECTION, "MOON")
    vector = np.asarray(state[:3]) - site_position_km(site.latitude_deg, site.longitude_deg_east)
    direction = vector / np.linalg.norm(vector)
    up = site_up_vector(site.latitude_deg, site.longitude_deg_east)
    elevation = math.degrees(math.asin(float(np.clip(direction @ up, -1.0, 1.0))))
    if abs(abs(site.latitude_deg) - 90.0) < 1e-12:
        azimuth = math.nan
    else:
        longitude = math.radians(site.longitude_deg_east)
        east = np.array([-math.sin(longitude), math.cos(longitude), 0.0])
        north = true_north_vector(site.latitude_deg, site.longitude_deg_east)
        azimuth = math.degrees(math.atan2(float(direction @ east), float(direction @ north))) % 360.0
    return azimuth, elevation, float(np.linalg.norm(vector))


def run_g3(fixtures_dir: str | Path | None = None) -> tuple[Comparison, ...]:
    """Compare cached Horizons data with DE421 LT+S smooth-sphere geometry offline."""
    directory = Path(fixtures_dir) if fixtures_dir is not None else default_fixture_dir()
    assert_site_cases_match_config()
    comparisons: list[Comparison] = []
    with loaded_kernels():
        for site in SITE_CASES:
            for body in ("sun", "earth"):
                fixture_site, fixture_body, records = load_fixture(fixture_path(site, body, directory))
                if fixture_site != site or fixture_body != body:
                    raise ValueError(f"fixture identity mismatch for {site.id} {body}")
                for record in records:
                    azimuth, elevation, distance = _spice_observation(site, body, record.utc)
                    comparisons.append(
                        Comparison(
                            site.id,
                            body,
                            record.utc,
                            abs(elevation - record.elevation_deg),
                            None if math.isnan(azimuth) else _angular_difference_deg(azimuth, record.azimuth_deg),
                            abs(distance - record.range_km),
                        )
                    )
    return tuple(comparisons)


def run_g3b(fixtures_dir: str | Path | None = None) -> tuple[DsnComparison, ...]:
    """Compare offline Horizons station fixtures against R3's DSN geometry."""
    directory = Path(fixtures_dir) if fixtures_dir is not None else default_fixture_dir()
    comparisons: list[DsnComparison] = []
    with loaded_kernels():
        for station in STATIONS:
            fixture_station, records = load_dsn_fixture(dsn_fixture_path(station, directory))
            if fixture_station != station:
                raise ValueError(f"fixture identity mismatch for {station.id}")
            ets = np.asarray([utc_to_et(record.utc) for record in records])
            elevations = station_elevations_deg(ets, station)
            comparisons.extend(
                DsnComparison(station.id, record.utc, abs(float(elevation) - record.elevation_deg))
                for record, elevation in zip(records, elevations, strict=True)
            )
    return tuple(comparisons)


def run_g3b_artifact(
    fixtures_dir: str | Path | None = None, dsn_path: str | Path | None = None
) -> tuple[DsnArtifactComparison, ...]:
    """Compare decoded published DSN samples with Horizons at fixture epochs.

    The direct G3b comparison remains the locked sub-0.1-degree geometry gate.
    This records the separately expected half-degree quantization effect of the
    published artifact rather than treating it as a geometry regression.
    """
    directory = Path(fixtures_dir) if fixtures_dir is not None else default_fixture_dir()
    binary = Path(dsn_path) if dsn_path is not None else default_dsn_path()
    metadata = json.loads(sidecar_path(binary).read_text(encoding="utf-8"))
    start_utc = metadata.get("start_utc")
    if not isinstance(start_utc, str):
        raise TypeError("DSN sidecar lacks start_utc")
    comparisons: list[DsnArtifactComparison] = []
    with loaded_kernels():
        series = DsnSeries.from_file(binary, start_et=utc_to_et(start_utc))
        for station in STATIONS:
            fixture_station, records = load_dsn_fixture(dsn_fixture_path(station, directory))
            if fixture_station != station:
                raise ValueError(f"fixture identity mismatch for {station.id}")
            ets = np.asarray([utc_to_et(record.utc) for record in records])
            direct = station_elevations_deg(ets, station)
            for record, et, direct_elevation in zip(records, ets, direct, strict=True):
                decoded = series.elevation_at(station.id, float(et), interpolation="linear")
                comparisons.append(
                    DsnArtifactComparison(
                        station.id,
                        record.utc,
                        abs(float(direct_elevation) - record.elevation_deg),
                        abs(decoded - record.elevation_deg),
                        abs(decoded - float(direct_elevation)),
                    )
                )
    return tuple(comparisons)


def assert_g3_tolerances(comparisons: tuple[Comparison, ...]) -> None:
    """Raise when an offline G3 result reaches or exceeds its locked tolerance."""
    if not comparisons:
        raise ValueError("G3 comparisons are missing")
    if any(result.elevation_error_deg >= ELEVATION_TOLERANCE_DEG for result in comparisons):
        raise AssertionError("G3 elevation tolerance failed")
    if any(result.range_error_km >= RANGE_TOLERANCE_KM for result in comparisons if result.body == "earth"):
        raise AssertionError("G3 Earth-range tolerance failed")
    if any(
        result.azimuth_error_deg is not None and result.azimuth_error_deg >= AZIMUTH_TOLERANCE_DEG
        for result in comparisons
    ):
        raise AssertionError("G3 azimuth tolerance failed")


def assert_g3b_tolerances(comparisons: tuple[DsnComparison, ...]) -> None:
    """Raise when an offline G3b result reaches or exceeds its locked tolerance."""
    if not comparisons:
        raise ValueError("G3b comparisons are missing")
    if any(result.elevation_error_deg >= DSN_ELEVATION_TOLERANCE_DEG for result in comparisons):
        raise AssertionError("G3b station-elevation tolerance failed")
