# Owner: Shiva Shakthi
"""S-7 Artemis region tests: explicit-unavailable behavior. No geometry is
invented anywhere in regions.py, and this test asserts that directly."""

from __future__ import annotations

from lumen_pipeline.terrain.regions import REGIONS, build_regions_index


def test_nine_official_regions_are_listed():
    assert len(REGIONS) == 9
    region_ids = {r["region_id"] for r in REGIONS}
    assert len(region_ids) == 9  # all unique


def test_no_region_has_invented_geometry():
    index = build_regions_index()
    assert len(index["regions"]) == 9
    for entry in index["regions"]:
        assert entry["geometry_available"] is False
        assert entry["centroid_lat_deg"] is None
        assert entry["centroid_lon_deg"] is None
        assert entry["svg_path"] is None
        assert entry["unavailable_reason"]
        assert entry["source_needed"]
        assert entry["region_id"]
        assert entry["name"]


def test_region_ids_are_stable_snake_case_slugs():
    for region in REGIONS:
        region_id = region["region_id"]
        assert region_id == region_id.lower()
        assert " " not in region_id
