"""Build the initial source-verified lunar site catalog (G-6)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import yaml

from lumen_pipeline.common.frames import reference_axis, site_rotation_matrix
from lumen_pipeline.ephem.kernels import MOON_FRAME

EXPECTED_SITE_IDS = (
    "im2_athena",
    "cy3_shiv_shakti",
    "shackleton_ridge",
    "blue_ghost_m1",
    "apollo_11",
    "apollo_12",
    "apollo_14",
    "apollo_15",
    "apollo_16",
    "apollo_17",
    "slim_shioli",
    "change6_apollo_basin",
    "shackleton_rim_ridge",
)
CATALOG_VERSION = 1


def default_sites_path() -> Path:
    """Return the G-6 source table owned by this pipeline."""
    return Path(__file__).resolve().parents[2] / "config" / "sites.yaml"


def default_output_path() -> Path:
    """Return the sole catalog artifact written by this module."""
    return Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "catalog" / "sites.json"


def _coordinates(value: dict[str, Any] | None) -> dict[str, Any] | None:
    """Use the R3 `lat`/`lon` coordinate object names in the public catalog."""
    if value is None:
        return None
    return {
        "lat": float(value["latitude_deg"]),
        "lon": float(value["longitude_deg_east"]),
        "source": value["source"],
    }


def _pending_terrain() -> dict[str, Any]:
    """Represent unavailable terrain outputs without publishing invented values."""
    return {
        "status": "pending",
        "near_field_res_m": None,
        "mask": None,
        "sigma": None,
        "pad": None,
        "dispersion_file": None,
        "psr": None,
    }


def _catalog_site(site: dict[str, Any]) -> dict[str, Any]:
    latitude = float(site["latitude_deg"])
    longitude = float(site["longitude_deg_east"])
    rotation = site_rotation_matrix(latitude, longitude)
    if not np.allclose(rotation @ rotation.T, np.eye(3), atol=1e-12) or np.linalg.det(rotation) <= 0:
        raise ValueError(f"site rotation is invalid for {site['id']}")
    axis = reference_axis(latitude)
    return {
        "id": site["id"],
        "name": site["name"],
        "category": site["category"],
        "agency": site["agency"],
        "program": site["program"],
        "latitude_deg": latitude,
        "longitude_deg_east": longitude,
        "coordinate_frame": MOON_FRAME,
        "landing_coords": _coordinates(site.get("landing_coords")),
        "target_coords": _coordinates(site.get("target_coords")),
        "coord_note": site["coord_note"],
        "touchdown_utc": site.get("touchdown_utc"),
        "touchdown_precision": site.get("touchdown_precision"),
        "last_contact_utc": site.get("last_contact_utc"),
        "reference_axis": "+X_ME" if axis[0] else "+Z_ME",
        "rotation_matrix": rotation.tolist(),
        "tier": "pending",
        "terrain": _pending_terrain(),
        "source_url": site["source_url"],
        "source_type": site["source_type"],
        "verification_status": site["verification_status"],
        "verified_by": site["verified_by"],
        "notes": site["coord_note"],
    }


def build_catalog(
    sites_path: str | Path | None = None, output_path: str | Path | None = None
) -> dict[str, Any]:
    """Write the deterministic initial catalog; terrain-derived fields remain pending."""
    source_path = Path(sites_path) if sites_path is not None else default_sites_path()
    destination = Path(output_path) if output_path is not None else default_output_path()
    source = yaml.safe_load(source_path.read_text(encoding="utf-8"))
    sites_by_id = {site["id"]: site for site in source["sites"]}
    if set(sites_by_id) != set(EXPECTED_SITE_IDS):
        raise ValueError(f"G-6 requires exactly these sites: {EXPECTED_SITE_IDS}")
    sites = [sites_by_id[site_id] for site_id in EXPECTED_SITE_IDS]
    catalog = {
        "schema": "catalog",
        "version": CATALOG_VERSION,
        "coordinate_frame": MOON_FRAME,
        "sites": [_catalog_site(site) for site in sites],
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(catalog, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return catalog


if __name__ == "__main__":
    build_catalog()
