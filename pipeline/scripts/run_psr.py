# Owner: Shiva Shakthi
# Entry point for run_psr stage (S-7).
#
# Generates the PSR mask layer (PNG + sidecar) and the PSR distance-to-
# nearest-qualifying-PSR raster (binary + sidecar) for both required
# extents, then folds the mask layer into layers.json and the terrain
# manifest.
#
# Usage:
#   python scripts/run_psr.py [extent ...]
# With no arguments, runs both required extents.

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lumen_pipeline.terrain.layers import (
    LayerUnavailable,
    update_terrain_manifest_layers,
    write_layers_index,
)
from lumen_pipeline.terrain.psr import generate_psr_distance_layer, generate_psr_layer

DEFAULT_EXTENTS = ("80_90S", "85_90S")


def main(extents: tuple[str, ...] = DEFAULT_EXTENTS) -> None:
    artifacts = []
    for extent in extents:
        try:
            artifact = generate_psr_layer(extent)
        except LayerUnavailable as exc:
            print(f"[psr:{extent}] S-7 BLOCKED: {exc}")
            continue
        print(f"[psr:{extent}] mask written to {artifact.png_path}")
        artifacts.append(artifact)

        distance_path = generate_psr_distance_layer(extent)
        print(f"[psr:{extent}] distance raster written to {distance_path}")

    if artifacts:
        write_layers_index(artifacts)
        update_terrain_manifest_layers(artifacts)
        print(f"layers.json and manifest.json updated with {len(artifacts)} PSR layer artifact(s)")


if __name__ == "__main__":
    main(tuple(sys.argv[1:]) or DEFAULT_EXTENTS)
