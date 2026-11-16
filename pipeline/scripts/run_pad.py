# Owner: Shiva Shakthi
# Entry point for run_pad stage (S-6).
#
# Builds the near-field DEM crop for each requested site and publishes
# validated pad statistics (pipeline/lumen_pipeline/terrain/pad.py) to
# web/public/data/terrain/pad/<site_id>.json, then refreshes the site
# terrain summary. A site whose near-field crop has no verified DEM source
# is reported explicitly and left unpublished; no DEM product or pad value
# is invented.
#
# Usage:
#   python scripts/run_pad.py [site_id ...]
#
# With no arguments, runs the Tier-A sites currently eligible for S-6
# integration: im2_athena and cy3_shiv_shakti. shackleton_ridge is
# intentionally excluded here (its authoritative target coordinates are
# unresolved) and must be run, if ever, by explicit site id.

from __future__ import annotations

import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lumen_pipeline.terrain.crops import build_crops
from lumen_pipeline.terrain.dem_io import DemReader, load_products
from lumen_pipeline.terrain.masks import _site, _site_coordinates
from lumen_pipeline.terrain.pad import (
    PadStatisticsUnavailable,
    generate_pad_statistics,
    write_pad_statistics,
)
from lumen_pipeline.terrain.summaries import write_terrain_summary

DEFAULT_SITE_IDS = ("im2_athena", "cy3_shiv_shakti")


def _pad_defaults() -> dict[str, float]:
    """The project-wide pad defaults from terrain.yaml; a missing value stays missing (never invented)."""
    config = yaml.safe_load((Path(__file__).resolve().parents[1] / "config" / "terrain.yaml").read_text(encoding="utf-8")) or {}
    section = config.get("pad_statistics") or {}
    names = {"dispersion_radius_m": "dispersion_radius_m", "slope_tolerance_deg": "slope_tolerance_deg", "footprint_m": "nominal_lander_footprint_m"}
    return {arg: float(section[key]) for arg, key in names.items() if isinstance(section.get(key), (int, float))}


def _pad_headline(statistics) -> dict[str, object]:
    plane = statistics.plane
    return {
        "slope_deg": plane.slope_deg,
        "downhill_aspect_deg": plane.downhill_aspect_deg,
        "uphill_az_deg": plane.uphill_azimuth_deg,
        "under_resolved": statistics.under_resolved,
    }


def run_site(
    site_id: str,
    *,
    reader: DemReader,
    products: dict,
    output_root: Path | None = None,
    sites_path: Path | None = None,
) -> None:
    site = _site(site_id, sites_path)
    latitude_deg, longitude_deg_east = _site_coordinates(site_id, site)

    crops = build_crops(
        site_id,
        latitude_deg=latitude_deg,
        longitude_deg_east=longitude_deg_east,
        reader=reader,
        products=products,
    )

    if crops.near is None:
        reason = crops.unavailable.get("near", "near-field DEM is unavailable")
        print(f"[{site_id}] S-6 BLOCKED: no verified near-field DEM crop. {reason}")
        write_terrain_summary(site_id, crops, output_root=output_root)
        return

    try:
        statistics = generate_pad_statistics(
            site_id,
            crops,
            latitude_deg=latitude_deg,
            longitude_deg_east=longitude_deg_east,
            **_pad_defaults(),
        )
    except PadStatisticsUnavailable as exc:
        print(f"[{site_id}] S-6 BLOCKED: {exc}")
        write_terrain_summary(site_id, crops, output_root=output_root)
        return

    path = write_pad_statistics(statistics, output_root=output_root)
    print(
        f"[{site_id}] pad statistics written to {path} "
        f"(source={statistics.source_key}, resolution={statistics.source_resolution_m} m, "
        f"slope={statistics.plane.slope_deg:.3f} deg)"
    )
    if statistics.slopes is None:
        print(
            f"[{site_id}] dispersion slope distribution unavailable: "
            f"{statistics.slopes_unavailable_reason}"
        )

    write_terrain_summary(
        site_id,
        crops,
        pad_headline=_pad_headline(statistics),
        pad_json_path=path,
        output_root=output_root,
    )


def main(site_ids: tuple[str, ...] = DEFAULT_SITE_IDS) -> None:
    products = load_products()
    reader = DemReader(products=products)
    for site_id in site_ids:
        run_site(site_id, reader=reader, products=products)


if __name__ == "__main__":
    main(tuple(sys.argv[1:]) or DEFAULT_SITE_IDS)
