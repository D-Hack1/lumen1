"""Compute G7 geometry while preserving unresolved mission-evidence limits."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import yaml

from lumen_pipeline.catalog.build_catalog import default_sites_path
from lumen_pipeline.common.timeutil import et_to_utc, utc_to_et
from lumen_pipeline.ephem.kernels import loaded_kernels
from lumen_pipeline.reference.events import detect_events
from lumen_pipeline.reference.interp import Ephemeris
from lumen_pipeline.validation.golden import default_ephemeris_path

SITE_ID = "cy3_shiv_shakti"
IM2_SITE_ID = "im2_athena"
REFERENCE_ELEVATION_DEG = 8.75
TOLERANCE_DEG = 0.25
OPS_ELEVATION_DEG = 6.0
SHUTDOWN_WINDOW_START_UTC = "2023-09-02T00:00:00Z"
SHUTDOWN_WINDOW_END_UTC = "2023-09-05T00:00:00Z"

# R3 retains this planned comparison value, but D-16 requires a primary source
# before it can be represented as an independently verified mission result.
REFERENCE_SOURCE = {
    "status": "SOURCE_UNVERIFIED",
    "reported_sun_elevation_deg": REFERENCE_ELEVATION_DEG,
    "reported_uncertainty_deg": TOLERANCE_DEG,
    "source_url": None,
    "document_title": None,
    "publication_date": None,
    "page_or_section": None,
    "quoted_numerical_claim": None,
    "research_note": (
        "No ISRO mission document or primary mission publication located during the R3 "
        "source review states a Chandrayaan-3 landing Sun elevation of 8.75 degrees, "
        "an uncertainty of +/-0.25 degrees, or its limb convention. The value must not "
        "be used as a quantitative pass criterion."
    ),
    "sources_examined": [
        {
            "url": "https://www.isro.gov.in/Chandrayaan3.html",
            "document_title": "Chandrayaan-3",
            "publication_date": "not stated; dated mission updates span 2023-07-06 to 2023-09-22",
            "page_or_section": "August 23, 2023 update",
            "quoted_claim": "Chandrayaan-3 has successfully soft-landed on the moon.",
            "supports_8_75_degree_claim": False,
        },
        {
            "url": "https://www.isro.gov.in/Chandrayaan3_Details.html",
            "document_title": "Chandrayaan-3 Details",
            "publication_date": "not stated",
            "page_or_section": "Overall specifications, Landing Site (Prime)",
            "quoted_claim": "4 km x 2.4 km 69.367621 S, 32.348126 E",
            "supports_8_75_degree_claim": False,
        },
    ],
}
IM2_TOUCHDOWN_SOURCE = {
    "status": "SOURCE_UNVERIFIED",
    "research_note": (
        "The catalog records the documented IM-2 touchdown timestamp and landing coordinates, "
        "but this report has no independent primary source for a touchdown Sun or Earth condition."
    ),
}
CY3_OBSERVED_LANDING_FIX = {
    "latitude_deg": -69.3741,
    "longitude_deg_east": 32.32,
    "source": "NASA/LROC image annotation",
    "source_url": "https://lroc.im-ldi.com/images/1314",
    "status": "OBSERVED_APPROXIMATE",
}
CY3_PLANNED_TARGET = {
    "latitude_deg": -69.367621,
    "longitude_deg_east": 32.348126,
    "source": "ISRO Chandrayaan-3 Details, Landing Site (Prime)",
    "source_url": "https://www.isro.gov.in/Chandrayaan3_Details.html",
    "status": "PLANNED_TARGET_NOT_LANDING_FIX",
}


def default_output_path() -> Path:
    """Return the standalone G7 report path."""
    return Path(__file__).resolve().parents[2] / "reports" / "g7_cy3.json"


def _report_path(path: Path) -> str:
    root = Path(__file__).resolve().parents[3]
    try:
        return path.resolve().relative_to(root).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def build_g7_report(
    ephemeris_path: str | Path | None = None,
    sites_path: str | Path | None = None,
) -> dict[str, Any]:
    """Compute G7 geometry without treating unsupported claims as validation criteria."""
    ephem_path = Path(ephemeris_path) if ephemeris_path is not None else default_ephemeris_path()
    site_path = Path(sites_path) if sites_path is not None else default_sites_path()
    site_rows = yaml.safe_load(site_path.read_text(encoding="utf-8"))["sites"]
    site = next((row for row in site_rows if row["id"] == SITE_ID), None)
    im2_site = next((row for row in site_rows if row["id"] == IM2_SITE_ID), None)
    if site is None:
        raise ValueError(f"G7 site {SITE_ID!r} is missing from {site_path}")
    if im2_site is None:
        raise ValueError(f"G7 site {IM2_SITE_ID!r} is missing from {site_path}")
    if site.get("touchdown_precision") != "minute":
        raise ValueError("G7 touchdown reference must retain its documented minute precision")
    landing = site.get("landing_coords")
    if landing is None:
        raise ValueError("G7 requires published landing coordinates, not target coordinates")
    im2_landing = im2_site.get("landing_coords")
    if im2_landing is None:
        raise ValueError("G7 IM-2 evaluation requires landing coordinates")
    if im2_site.get("touchdown_utc") != "2025-03-06T17:28:50Z":
        raise ValueError("G7 IM-2 evaluation requires the documented touchdown timestamp")

    metadata_path = ephem_path.with_suffix(".json")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    ephem_hash = hashlib.sha256(ephem_path.read_bytes()).hexdigest()
    ephem_hash_matches = ephem_hash == metadata.get("sha256")
    ephemeris = Ephemeris.from_file(ephem_path)
    touchdown_utc = site["touchdown_utc"]
    latitude = float(landing["latitude_deg"])
    longitude = float(landing["longitude_deg_east"])
    im2_latitude = float(im2_landing["latitude_deg"])
    im2_longitude = float(im2_landing["longitude_deg_east"])
    im2_touchdown_utc = str(im2_site["touchdown_utc"])

    with loaded_kernels() as kernel_paths:
        kernel_provenance = [
            {"filename": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
            for path in kernel_paths
        ]
        ephem_kernel_provenance = metadata.get("kernel_provenance", [])
        kernel_hashes_match = kernel_provenance == ephem_kernel_provenance
        touchdown_et = utc_to_et(touchdown_utc)
        sun = ephemeris.body_at("sun", touchdown_et, latitude, longitude, 0.0)
        im2_touchdown_et = utc_to_et(im2_touchdown_utc)
        im2_sun = ephemeris.body_at("sun", im2_touchdown_et, im2_latitude, im2_longitude, 0.0)
        im2_earth = ephemeris.body_at("earth", im2_touchdown_et, im2_latitude, im2_longitude, 0.0)
        shutdown_start_et = utc_to_et(SHUTDOWN_WINDOW_START_UTC)
        shutdown_end_et = utc_to_et(SHUTDOWN_WINDOW_END_UTC)
        timeline_events = detect_events(
            shutdown_start_et,
            shutdown_end_et,
            lambda et: ephemeris.body_at("sun", et, latitude, longitude, 0.0).elevation_deg
            >= OPS_ELEVATION_DEG,
            down="sun_below_ops",
            up="sun_above_ops",
        )
        below_ops_event = next((event for event in timeline_events if event.type == "sun_below_ops"), None)
        timeline_pass = below_ops_event is not None
        below_ops_utc = (
            et_to_utc(below_ops_event.et, precision=0) if below_ops_event is not None else None
        )

    absolute_error = abs(sun.elevation_deg - REFERENCE_ELEVATION_DEG)
    provenance_pass = ephem_hash_matches and kernel_hashes_match
    provenance_failures = []
    if not ephem_hash_matches:
        provenance_failures.append("ephemeris_sha256_mismatch")
    if not kernel_hashes_match:
        provenance_failures.append("kernel_sha256_mismatch")
    timeline_failures = [] if timeline_pass else ["sun_below_ops_event_not_found"]
    return {
        "id": "G7",
        "check": "CY-3 Sun elevation at touchdown",
        "status": "BLOCKED",
        "calculation_status": "COMPUTED",
        "timestamp_utc": touchdown_utc,
        "timestamp_precision": site["touchdown_precision"],
        "coordinates": {
            "latitude_deg": latitude,
            "longitude_deg_east": longitude,
            "source": "catalog/model assumption",
            "source_url": None,
            "status": "SOURCE_UNVERIFIED",
            "coordinate_frame": metadata["spice_frame"],
            "height_m": 0.0,
            "observed_landing_fix": CY3_OBSERVED_LANDING_FIX,
            "planned_target": CY3_PLANNED_TARGET,
        },
        "ephemeris": {
            "path": _report_path(ephem_path),
            "sha256": ephem_hash,
            "sidecar_path": _report_path(metadata_path),
            "start_et_tdb": metadata["start_et_tdb"],
            "aberration_correction": metadata["aberration_correction"],
            "interpolation": "cubic Hermite",
            "ephemeris_hash_matches_sidecar": ephem_hash_matches,
            "kernel_provenance": ephem_kernel_provenance,
            "loaded_kernel_provenance": kernel_provenance,
            "kernel_hashes_match_sidecar": kernel_hashes_match,
        },
        "computed": {
            "sun_elevation_deg": sun.elevation_deg,
            "sun_azimuth_deg": sun.azimuth_deg,
            "et_seconds": touchdown_et,
        },
        "reference": {
            "sun_elevation_deg": REFERENCE_SOURCE["reported_sun_elevation_deg"],
            "source": "PLAN_FINAL_R3_DELTA.md D-13 planned comparison input",
            "primary_source_status": REFERENCE_SOURCE["status"],
            "recorded_tolerance_deg": TOLERANCE_DEG,
            "source_metadata": REFERENCE_SOURCE,
        },
        "absolute_error_deg": absolute_error,
        "numerical_result": "NOT_EVALUATED",
        "source_provenance_result": "BLOCKED",
        "provenance_result": "PASS" if provenance_pass else "FAIL",
        "failure_reasons": {
            "numerical": ["unverified_mission_reference_not_a_pass_criterion"],
            "provenance": provenance_failures,
            "timeline": [
                "unverified_operations_threshold_not_a_pass_criterion",
                *timeline_failures,
            ],
        },
        "qualitative_timeline_check": {
            "status": "SOURCE_UNVERIFIED",
            "sun_below_6_deg_utc": below_ops_utc,
            "expected_window_start_utc": SHUTDOWN_WINDOW_START_UTC,
            "expected_window_end_exclusive_utc": SHUTDOWN_WINDOW_END_UTC,
            "criterion": "Recorded 6-degree crossing under an unverified operations threshold; not a pass criterion.",
        },
        "im2_touchdown_conditions": {
            "status": IM2_TOUCHDOWN_SOURCE["status"],
            "timestamp_utc": im2_touchdown_utc,
            "timestamp_precision": im2_site["touchdown_precision"],
            "coordinates": {
                "latitude_deg": im2_latitude,
                "longitude_deg_east": im2_longitude,
                "source": "catalog/model assumption",
                "status": "SOURCE_UNVERIFIED",
                "coordinate_frame": metadata["spice_frame"],
                "height_m": 0.0,
            },
            "computed": {
                "sun_elevation_deg": im2_sun.elevation_deg,
                "sun_azimuth_deg": im2_sun.azimuth_deg,
                "earth_elevation_deg": im2_earth.elevation_deg,
                "earth_azimuth_deg": im2_earth.azimuth_deg,
                "et_seconds": im2_touchdown_et,
            },
            "limitation": IM2_TOUCHDOWN_SOURCE["research_note"],
        },
        "calculation_assumptions": {
            "touchdown_time": {
                "value_utc": touchdown_utc,
                "precision": site["touchdown_precision"],
                "status": "SOURCE_UNVERIFIED",
                "basis": "PLAN_FINAL_R3_DELTA.md D-12; no primary seconds-level source located.",
            },
            "landing_location": {
                "latitude_deg": latitude,
                "longitude_deg_east": longitude,
                "height_m": 0.0,
                "status": "SOURCE_UNVERIFIED",
                "basis": "PLAN_FINAL_R3_DELTA.md D-12 landing-coordinate input; the NASA/LROC observed fix and ISRO planned target are recorded separately.",
            },
            "reference_frame": {
                "value": metadata["spice_frame"],
                "status": "VERIFIED_COMPUTATION_CONFIGURATION",
                "basis": "R3 D-3 locked MOON_ME_DE421 frame; ephemeris sidecar requires this frame.",
            },
            "sun_elevation_definition": {
                "calculated_value": "Sun-centre apparent topocentric elevation above the local spherical horizontal",
                "calculation_status": "VERIFIED_IMPLEMENTATION",
                "reported_claim_limb_convention": "SOURCE_UNVERIFIED",
                "basis": "Ephemeris.body_at subtracts the site vector from the interpolated Sun-centre vector before site-frame elevation conversion.",
            },
            "observation_geometry": {
                "observer": "spherical lunar surface site at 0 m height",
                "topocentric_direction": "LT+S apparent Moon-centred Sun vector minus site vector",
                "terrain_horizon": "not applied",
                "status": "VERIFIED_COMPUTATION_CONFIGURATION",
                "basis": "R3 D-3 and D-8 smooth-sphere geometry lock.",
            },
        },
    }


def write_g7_report(
    output_path: str | Path | None = None,
    ephemeris_path: str | Path | None = None,
    sites_path: str | Path | None = None,
) -> dict[str, Any]:
    """Write and return the deterministic G7 report."""
    destination = Path(output_path) if output_path is not None else default_output_path()
    report = build_g7_report(ephemeris_path, sites_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    print(json.dumps(write_g7_report(), sort_keys=True))
