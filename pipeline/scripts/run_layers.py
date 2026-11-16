# Owner: Shiva Shakthi
# Entry point for run_layers stage (S-7).
#
# Generates the three non-PSR regional terrain layers (average illumination,
# Earth visibility, slope hazard) as PNG + sidecar for both required
# extents (80_90S, 85_90S), then updates layers.json and the terrain
# manifest. PSR is handled separately by run_psr.py since it has its own
# derivation pipeline (contract §4).
#
# Usage:
#   python scripts/run_layers.py [extent ...]
# With no arguments, runs both required extents.

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lumen_pipeline.terrain.layers import (
    LayerUnavailable,
    generate_earth_visibility_layer,
    generate_illumination_layer,
    generate_slope_hazard_layer,
    update_terrain_manifest_layers,
    write_layers_index,
)

DEFAULT_EXTENTS = ("80_90S", "85_90S")
GENERATORS = (
    ("slope_hazard", generate_slope_hazard_layer),
    ("average_illumination", generate_illumination_layer),
    ("earth_visibility", generate_earth_visibility_layer),
)


def main(extents: tuple[str, ...] = DEFAULT_EXTENTS) -> None:
    artifacts = []
    for extent in extents:
        for layer_id, generator in GENERATORS:
            try:
                artifact = generator(extent)
            except LayerUnavailable as exc:
                print(f"[{layer_id}:{extent}] S-7 BLOCKED: {exc}")
                continue
            print(f"[{layer_id}:{extent}] written to {artifact.png_path}")
            artifacts.append(artifact)
    if artifacts:
        write_layers_index(artifacts)
        update_terrain_manifest_layers(artifacts)
        print(f"layers.json and manifest.json updated with {len(artifacts)} layer artifact(s)")


if __name__ == "__main__":
    main(tuple(sys.argv[1:]) or DEFAULT_EXTENTS)
