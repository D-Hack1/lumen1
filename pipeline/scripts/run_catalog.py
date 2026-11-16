# Owner: Gowri
# Entry point for run_catalog stage.

"""Build the source-verified catalog without promoting unaccepted terrain."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Prefer this checkout over an editable install from another worktree.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lumen_pipeline.catalog.build_catalog import (
    build_catalog,
    default_output_path,
    default_sites_path,
    default_terrain_root,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sites", type=Path, default=default_sites_path())
    parser.add_argument("--output", type=Path, default=default_output_path())
    parser.add_argument("--terrain-root", type=Path, default=default_terrain_root())
    args = parser.parse_args()
    catalog = build_catalog(args.sites, args.output, args.terrain_root)
    print(f"wrote {args.output} ({len(catalog['sites'])} sites)")


if __name__ == "__main__":
    main()
