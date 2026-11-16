# Owner: Shiva Shakthi
# Entry point for run_regions stage (S-7).
#
# Writes web/public/data/terrain/regions.json listing the nine official
# USGS-identified Artemis III candidate landing regions, each explicitly
# marked unavailable (no centroid/boundary geometry) because the
# authoritative USGS boundary file could not be retrieved in this
# environment. See lumen_pipeline/terrain/regions.py's module docstring
# for the exact blocker and source needed.

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lumen_pipeline.terrain.regions import build_regions_index


def main(output_root: Path | None = None) -> Path:
    terrain_root = (
        Path(output_root)
        if output_root is not None
        else Path(__file__).resolve().parents[2] / "web" / "public" / "data" / "terrain"
    )
    index = build_regions_index()
    path = terrain_root / "regions.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(index, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"regions.json written to {path} (9 regions, all geometry_available=false)")
    return path


if __name__ == "__main__":
    main()
