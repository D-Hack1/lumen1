"""Generate one explicit Tier-B tile; no full regional batch is implicit."""

from __future__ import annotations

import argparse
from pathlib import Path

from lumen_pipeline.terrain.dem_io import DemReader, load_products
from lumen_pipeline.terrain.tierb import (
    TileSpec,
    generate_tile_multires,
    read_multires_windows,
    write_index,
    write_tile,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("origin_x_m", type=int)
    parser.add_argument("origin_y_m", type=int)
    parser.add_argument("spacing_m", type=int, choices=(2000, 4000))
    parser.add_argument("--output-root", type=Path, default=Path("../web/public/data/terrain"))
    args = parser.parse_args()
    products = load_products()
    reader = DemReader(products=products)
    spec = TileSpec(args.origin_x_m, args.origin_y_m, args.spacing_m)
    near, far = read_multires_windows(spec, reader, products)
    tile = generate_tile_multires(spec, near, far)
    entry = write_tile(tile, args.output_root)
    write_index([entry], args.output_root)
    print(entry["id"])
