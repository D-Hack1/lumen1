# Owner: Gowri
# Entry point for run_sparklines stage.

"""Build deterministic catalog sparklines from a bounded ephemeris interval."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Prefer this checkout over an editable install from another worktree.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lumen_pipeline.catalog.sparklines import (
    DEFAULT_END_UTC,
    DEFAULT_START_UTC,
    build_sparklines,
    default_ephemeris_path,
    default_output_path,
    default_sites_path,
    default_terrain_root,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sites", type=Path, default=default_sites_path())
    parser.add_argument("--ephemeris", type=Path, default=default_ephemeris_path())
    parser.add_argument("--terrain-root", type=Path, default=default_terrain_root())
    parser.add_argument("--output", type=Path, default=default_output_path())
    parser.add_argument("--start-utc", default=DEFAULT_START_UTC)
    parser.add_argument("--end-utc", default=DEFAULT_END_UTC)
    args = parser.parse_args()
    metadata = build_sparklines(
        args.sites,
        args.ephemeris,
        args.output,
        args.terrain_root,
        start_utc=args.start_utc,
        end_utc=args.end_utc,
    )
    print(f"wrote {args.output} ({metadata['shape']})")


if __name__ == "__main__":
    main()
