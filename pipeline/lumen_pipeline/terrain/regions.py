# Owner: Shiva Shakthi
# Artemis region shapefiles -> SVG + regions.json.
"""S-7 Artemis III candidate-region geometry.

Per contracts/data_terrain_misc.md §6, region geometry must come from
official USGS/NASA sources; nothing here invents a name, identifier,
coordinate, boundary or polygon.

What was verified (see docs/s7_artemis_regions_blocker in the S-7 final
report for the full trail): the authoritative USGS ScienceBase data
release "Down Selected Artemis III Candidate Landing Site Navigational
Grids" (item id 671a6fa8d34efed5620f89f8, DOI 10.5066/P1MEQ6UK,
https://www.sciencebase.gov/catalog/item/671a6fa8d34efed5620f89f8) lists
exactly nine per-region files, confirming the official region identifiers
used by USGS for the nine down-selected Artemis III candidate landing
regions. That item's own description also names a tenth file,
"A3_9regions-lonlat-simplified.zip", which is almost certainly the region
*boundary* geometry (as opposed to the fine-resolution navigational grid
lines bundled in each per-region zip, confirmed by inspecting
Mons_Mouton.zip's contents: only *_S_Grid.shp/.dbf/.shx/.prj navigation
grid files at 1 km/100 m/10 m, no boundary/footprint polygon).

That boundary file could not be retrieved in this environment: ScienceBase
serves it through an S3-backed "manager" API whose plain file/download
endpoints return only the manager's single-page-app HTML shell rather than
the file bytes; the usual secondary routes (the catalog's legacy
`__disk__` path convention used successfully for the per-region grid
zips, and the declared S3 bucket directly) were refused or did not serve
the file either, within this session's tooling and permissions. This is
reported as an explicit blocker (see the module-level `REGIONS` table and
the S-7 final report) rather than substituted with invented or
approximated geometry.
"""

from __future__ import annotations

import json
import math
from collections.abc import Sequence
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape, quoteattr

# Official region identifiers, verified directly against the file listing
# of USGS ScienceBase item 671a6fa8d34efed5620f89f8 (fetched and inspected
# live; see module docstring). Names use the exact per-region zip/file
# naming from that listing. No centroid, boundary or polygon is included:
# none was obtained from an authoritative source.
REGIONS: tuple[dict[str, object], ...] = (
    {"region_id": "de_gerlache_rim_2", "name": "de Gerlache Rim 2"},
    {"region_id": "haworth", "name": "Haworth"},
    {"region_id": "malapert_massif", "name": "Malapert Massif"},
    {"region_id": "mons_mouton", "name": "Mons Mouton"},
    {"region_id": "mons_mouton_plateau", "name": "Mons Mouton Plateau"},
    {"region_id": "nobile_rim_1", "name": "Nobile Rim 1"},
    {"region_id": "nobile_rim_2", "name": "Nobile Rim 2"},
    {"region_id": "peak_near_cabeus_b", "name": "Peak Near Cabeus B"},
    {"region_id": "slater_plain", "name": "Slater Plain"},
)

SOURCE_NEEDED = (
    "USGS ScienceBase item 671a6fa8d34efed5620f89f8 "
    "(DOI 10.5066/P1MEQ6UK, https://www.sciencebase.gov/catalog/item/671a6fa8d34efed5620f89f8), "
    "file A3_9regions-lonlat-simplified.zip (S3 key "
    "671a6fa8d34efed5620f89f8/A3_9regions-lonlat-simplified.zip, bucket "
    "prod-is-usgs-sb-prod-content, declared size 637136 bytes), OR an "
    "equivalent officially published boundary/footprint polygon for the "
    "same nine regions."
)

UNAVAILABLE_REASON = (
    "Region boundary/footprint geometry was not retrievable in this "
    "environment: the ScienceBase file/download endpoints for this item "
    "serve only its single-page-app HTML shell for this file, not the "
    "file bytes, and the known fallback URL patterns (legacy __disk__ "
    "catalog route, direct S3 bucket) were refused or unavailable. The "
    "per-region zip files that *were* downloaded successfully contain "
    "only fine-resolution navigation grid lines (1 km/100 m/10 m "
    "*_S_Grid.shp), not a region boundary polygon, and were not used as a "
    "substitute for one."
)


def build_regions_index() -> dict[str, object]:
    """Build the regions.json payload: one entry per known official
    region, each explicitly marked unavailable with the exact reason and
    exact source needed. No geometry is invented."""

    entries = []
    for region in REGIONS:
        entries.append(
            {
                "region_id": region["region_id"],
                "name": region["name"],
                "centroid_lat_deg": None,
                "centroid_lon_deg": None,
                "svg_path": None,
                "geometry_available": False,
                "unavailable_reason": UNAVAILABLE_REASON,
                "source_needed": SOURCE_NEEDED,
                "source_catalog": (
                    "USGS ScienceBase item 671a6fa8d34efed5620f89f8 "
                    "(DOI 10.5066/P1MEQ6UK) -- region identifier and name "
                    "only; no coordinates or boundary verified"
                ),
            }
        )
    return {
        "version": "0.1.0",
        "regions": entries,
    }


class RegionGeometryError(ValueError):
    """Raised when region geometry is missing, invalid, or ambiguous."""


Point = tuple[float, float]
Ring = Sequence[Point]


def _validate_ring(ring: Ring) -> list[Point]:
    points = [(float(x), float(y)) for x, y in ring]
    if len(points) < 4 or points[0] != points[-1]:
        raise RegionGeometryError("region rings must be closed and contain at least four points")
    if any(not math.isfinite(value) for point in points for value in point):
        raise RegionGeometryError("region coordinates must be finite")
    if len(set(points[:-1])) != len(points) - 1:
        raise RegionGeometryError("region ring contains repeated vertices")
    area = sum(
        points[index][0] * points[index + 1][1] - points[index + 1][0] * points[index][1]
        for index in range(len(points) - 1)
    )
    if math.isclose(area, 0.0, abs_tol=1e-12):
        raise RegionGeometryError("region ring must enclose a non-zero area")
    for first in range(len(points) - 1):
        a, b = points[first], points[first + 1]
        for second in range(first + 1, len(points) - 1):
            if second in (first - 1, first, first + 1) or (
                first == 0 and second == len(points) - 2
            ):
                continue
            c, d = points[second], points[second + 1]
            if _segments_intersect(a, b, c, d):
                raise RegionGeometryError("region ring has self-intersecting edges")
    return points


def _orientation(a: Point, b: Point, c: Point) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _segments_intersect(a: Point, b: Point, c: Point, d: Point) -> bool:
    def on_segment(start: Point, end: Point, point: Point) -> bool:
        return min(start[0], end[0]) <= point[0] <= max(start[0], end[0]) and min(
            start[1], end[1]
        ) <= point[1] <= max(start[1], end[1])

    orientations = (
        _orientation(a, b, c),
        _orientation(a, b, d),
        _orientation(c, d, a),
        _orientation(c, d, b),
    )
    if all(math.isclose(value, 0.0, abs_tol=1e-12) for value in orientations):
        return (
            on_segment(a, b, c)
            or on_segment(a, b, d)
            or on_segment(c, d, a)
            or on_segment(c, d, b)
        )
    return orientations[0] * orientations[1] <= 0.0 and orientations[2] * orientations[3] <= 0.0


def _path_for_ring(ring: Ring) -> str:
    points = _validate_ring(ring)
    commands = [f"M {points[0][0]:.6f} {-points[0][1]:.6f}"]
    commands.extend(f"L {x:.6f} {-y:.6f}" for x, y in points[1:])
    commands.append("Z")
    return " ".join(commands)


def export_artemis_svg(
    rings: Sequence[Ring],
    output_path: Path,
    *,
    source: str,
    projection: dict[str, Any],
    coordinate_frame: str,
    units: str = "km",
) -> Path:
    """Export one verified projected exterior ring as an SVG outline."""

    if not rings:
        raise RegionGeometryError("verified Artemis geometry is unavailable")
    if len(rings) != 1:
        raise RegionGeometryError("holes and multipolygons are not supported")
    if not source.strip():
        raise RegionGeometryError("Artemis geometry source is required")
    if units != "km":
        raise RegionGeometryError("Artemis projected geometry units must be km")
    if coordinate_frame != "frontend_polar_stereographic_south":
        raise RegionGeometryError("unsupported Artemis coordinate frame")
    expected_projection = {
        "type": "polar_stereographic_south",
        "radius_m": 1737.4,
        "central_meridian_deg": 0.0,
        "standard_parallel_deg": -90.0,
        "r": "2R*tan(colat/2)",
        "x": "r*sin(lon_east)",
        "y": "r*cos(lon_east)",
    }
    for field, expected in expected_projection.items():
        actual = projection.get(field)
        if actual != expected and not (
            isinstance(actual, (int, float))
            and isinstance(expected, (int, float))
            and math.isclose(float(actual), float(expected), abs_tol=1e-9)
        ):
            raise RegionGeometryError(f"Artemis projection field is invalid: {field}")
    paths = [_path_for_ring(ring) for ring in rings]
    all_points = [point for ring in rings for point in _validate_ring(ring)]
    min_x = min(point[0] for point in all_points)
    max_x = max(point[0] for point in all_points)
    min_y = min(-point[1] for point in all_points)
    max_y = max(-point[1] for point in all_points)
    if math.isclose(min_x, max_x) or math.isclose(min_y, max_y):
        raise RegionGeometryError("Artemis geometry has an empty SVG extent")
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    metadata = escape(
        json.dumps(
            {
                "source": source,
                "projection": projection,
                "coordinate_frame": coordinate_frame,
                "units": units,
            },
            sort_keys=True,
        )
    )
    output_path.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" '
        f"data-source={quoteattr(source)} "
        f'viewBox="{min_x:.6f} {min_y:.6f} {max_x - min_x:.6f} {max_y - min_y:.6f}">\n'
        f"  <metadata>{metadata}</metadata>\n"
        f'  <path d="{" ".join(paths)}" fill="none" />\n'
        "</svg>\n",
        encoding="utf-8",
    )
    return output_path


def write_regions_index(
    output_path: Path,
    *,
    regions: list[dict[str, Any]],
    unavailable_reason: str | None = None,
) -> Path:
    """Write the frontend region descriptor without inventing region entries."""

    if not regions and not unavailable_reason:
        raise RegionGeometryError("empty region index requires an unavailability reason")
    if regions:
        root = Path(output_path).parent
        required = {
            "region_id",
            "name",
            "centroid_lat_deg",
            "centroid_lon_deg",
            "svg_path",
            "projection",
            "source",
        }
        for region in regions:
            if not required.issubset(region):
                raise RegionGeometryError("available region is missing required metadata")
            if not isinstance(region["svg_path"], str) or not region["svg_path"].strip():
                raise RegionGeometryError("available region has no SVG path")
            if not all(
                isinstance(region[field], (int, float)) and math.isfinite(float(region[field]))
                for field in ("centroid_lat_deg", "centroid_lon_deg")
            ):
                raise RegionGeometryError("region centroid must be finite")
            if not isinstance(region["projection"], dict) or not isinstance(region["source"], str):
                raise RegionGeometryError("region projection and source metadata are required")
            for path_field in ("svg_file", "metadata_file"):
                relative_path = region.get(path_field)
                if not isinstance(relative_path, str) or not (root / relative_path).is_file():
                    raise RegionGeometryError(
                        f"region {path_field} does not reference an existing file"
                    )
    document = {
        "schema": "regions",
        "version": "0.1.0",
        "regions": regions,
        "status": "available" if regions else "unavailable",
    }
    if unavailable_reason:
        document["reason"] = unavailable_reason
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return output_path
