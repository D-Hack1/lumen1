# Owner: Shiva Shakthi
# Entry point for run_masks stage.
#
# Builds the full near/mid/far DEM crops for a Tier-A site and publishes a
# validated Tier-A horizon mask (web/public/data/terrain/masks/<site_id>.*),
# then refreshes its terrain summary and the shared manifest. Reuses the
# existing generate_tier_a_mask/write_terrain_summary pipeline (masks.py,
# summaries.py) -- this script only wires them to real site data, the same
# way run_pad.py does for S-6.
#
# Usage:
#   python scripts/run_masks.py [site_id ...]
# With no arguments, runs the sites whose sites.yaml tier is "A" and that
# require complete near/mid/far crops under the existing pipeline rule
# (currently: shackleton_ridge, cy3_shiv_shakti).

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import yaml

from lumen_pipeline.terrain.crops import CropCoverageError, build_crops
from lumen_pipeline.terrain.dem_io import DemReader, load_products
from lumen_pipeline.terrain.masks import (
    NearFieldUnavailable,
    _site,
    _site_coordinates,
    generate_tier_a_mask,
)
from lumen_pipeline.terrain.summaries import write_terrain_summary

DEFAULT_SITE_IDS = ("shackleton_ridge",)


def _geometric_growth_factor(config_path: Path | None = None) -> float:
    path = (
        Path(config_path)
        if config_path is not None
        else Path(__file__).resolve().parents[1] / "config" / "terrain.yaml"
    )
    config = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    try:
        return float(config["tier_a"]["raycaster"]["geometric_growth_factor"])
    except (KeyError, TypeError, ValueError) as exc:
        raise RuntimeError(
            "tier_a.raycaster.geometric_growth_factor is not set in terrain.yaml; "
            "refusing to invent a value"
        ) from exc


def run_site(
    site_id: str,
    *,
    reader: DemReader,
    products: dict,
    growth_factor: float,
    output_root: Path | None = None,
) -> None:
    site = _site(site_id)
    latitude_deg, longitude_deg_east = _site_coordinates(site_id, site)

    crops = build_crops(
        site_id,
        latitude_deg=latitude_deg,
        longitude_deg_east=longitude_deg_east,
        reader=reader,
        products=products,
    )

    try:
        artifact = generate_tier_a_mask(
            site_id,
            crops,
            geometric_growth_factor=growth_factor,
            output_root=output_root,
        )
    except (CropCoverageError, NearFieldUnavailable, ValueError) as exc:
        print(f"[{site_id}] S-5 BLOCKED: {type(exc).__name__}: {exc}")
        write_terrain_summary(site_id, crops, output_root=output_root)
        return

    print(
        f"[{site_id}] Tier-A mask written to {artifact.binary_path} "
        f"(dem_source={artifact.metadata['dem_source']}, "
        f"near_field_resolution_m={artifact.metadata['near_field_resolution_m']})"
    )
    write_terrain_summary(site_id, crops, mask=artifact, output_root=output_root)


def main(site_ids: tuple[str, ...] = DEFAULT_SITE_IDS, *, output_root: Path | None = None) -> None:
    products = load_products()
    reader = DemReader(products=products)
    growth_factor = _geometric_growth_factor()
    for site_id in site_ids:
        run_site(
            site_id,
            reader=reader,
            products=products,
            growth_factor=growth_factor,
            output_root=output_root,
        )


if __name__ == "__main__":
    main(tuple(sys.argv[1:]) or DEFAULT_SITE_IDS)
