# Owner: Shiva Shakthi
# Entry point for run_dispersion stage (S-9): the 11 x 11 slope micro-grid for each Tier-A site.
#
# Usage:  python scripts/run_dispersion.py [site_id ...]
# With no arguments: im2_athena, cy3_shiv_shakti, shackleton_rim_ridge. (shackleton_ridge's catalogue coordinates are under review.)
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lumen_pipeline.terrain.crops import build_crops
from lumen_pipeline.terrain.dem_io import DemReader, load_products
from lumen_pipeline.terrain.dispersion import generate_dispersion, write_dispersion
from lumen_pipeline.terrain.masks import _site, _site_coordinates
from lumen_pipeline.terrain.pad import PadStatisticsUnavailable

DEFAULT_SITE_IDS = ("im2_athena", "cy3_shiv_shakti", "shackleton_rim_ridge")


def run_site(site_id: str, *, reader: DemReader, products: dict, output_root: Path | None = None) -> bool:
    latitude, longitude = _site_coordinates(site_id, _site(site_id))
    crops = build_crops(site_id, latitude_deg=latitude, longitude_deg_east=longitude, reader=reader, products=products)
    try:
        payload, sidecar = generate_dispersion(site_id, crops, latitude_deg=latitude, longitude_deg_east=longitude)
    except PadStatisticsUnavailable as exc:
        print(f"[{site_id}] dispersion BLOCKED: {exc}")
        return False
    path = write_dispersion(site_id, payload, sidecar, output_root=output_root)
    print(f"[{site_id}] dispersion grid written to {path} (slope {sidecar['slope_deg_min']:.2f}-{sidecar['slope_deg_max']:.2f} deg, {sidecar['dem_source']})")
    return True


def main(site_ids: tuple[str, ...] = DEFAULT_SITE_IDS) -> None:
    products = load_products()
    reader = DemReader(products=products)
    for site_id in site_ids:
        run_site(site_id, reader=reader, products=products)


if __name__ == "__main__":
    main(tuple(sys.argv[1:]) or DEFAULT_SITE_IDS)
