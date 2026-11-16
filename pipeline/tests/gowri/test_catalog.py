import json

import numpy as np
import pytest
import yaml

from lumen_pipeline.catalog.build_catalog import (
    EXPECTED_SITE_IDS,
    build_catalog,
    default_sites_path,
)
from lumen_pipeline.common.frames import site_rotation_matrix


def test_g6_catalog_schema_coordinates_and_pending_terrain(tmp_path):
    output = tmp_path / "sites.json"
    catalog = build_catalog(output_path=output, terrain_root=tmp_path / "terrain")

    assert catalog["schema"] == "catalog"
    assert catalog["version"] == 1
    assert catalog["coordinate_frame"] == "MOON_ME_DE421"
    assert tuple(site["id"] for site in catalog["sites"]) == EXPECTED_SITE_IDS
    assert json.loads(output.read_text(encoding="utf-8")) == catalog
    assert set(catalog) == {"schema", "version", "coordinate_frame", "sites"}
    for site in catalog["sites"]:
        assert set(site) == {
            "id",
            "name",
            "category",
            "agency",
            "program",
            "latitude_deg",
            "longitude_deg_east",
            "coordinate_frame",
            "landing_coords",
            "target_coords",
            "coord_note",
            "touchdown_utc",
            "touchdown_precision",
            "last_contact_utc",
            "reference_axis",
            "rotation_matrix",
            "tier",
            "terrain",
            "source_url",
            "source_type",
            "verification_status",
            "verified_by",
            "notes",
        }
        assert site["coordinate_frame"] == "MOON_ME_DE421"
        assert site["tier"] in {"A", "C"}
        assert site["terrain"]["status"] == "unavailable"
        assert all(value is None for key, value in site["terrain"].items() if key != "status")
        assert site["verification_status"] == "verified"

    cy3 = catalog["sites"][1]
    assert cy3["landing_coords"]["lat"] == -69.373
    assert cy3["target_coords"]["lon"] == 32.348126
    assert cy3["touchdown_utc"] == "2023-08-23T12:33:00Z"
    assert cy3["touchdown_precision"] == "minute"

    blue_ghost = catalog["sites"][3]
    assert blue_ghost["landing_coords"] is None
    assert blue_ghost["target_coords"]["lat"] == 18.56
    assert blue_ghost["last_contact_utc"] == "2025-03-16T23:25:00Z"


def test_g6_rotation_matrices_are_frame_consistent_and_right_handed(tmp_path):
    catalog = build_catalog(output_path=tmp_path / "sites.json")

    for site in catalog["sites"]:
        matrix = np.asarray(site["rotation_matrix"])
        expected = site_rotation_matrix(site["latitude_deg"], site["longitude_deg_east"])
        np.testing.assert_allclose(matrix, expected, atol=1e-15)
        np.testing.assert_allclose(matrix @ matrix.T, np.eye(3), atol=1e-12)
        assert np.linalg.det(matrix) > 0.0
    # The reference axis follows the latitude: +X_ME near the poles, +Z_ME elsewhere.
    expected_axes = {
        "im2_athena": "+X_ME",
        "cy3_shiv_shakti": "+X_ME",
        "shackleton_ridge": "+X_ME",
        "shackleton_rim_ridge": "+X_ME",
        "blue_ghost_m1": "+Z_ME",
    }
    for site in catalog["sites"]:
        assert site["reference_axis"] == expected_axes.get(site["id"], "+Z_ME"), site["id"]


def test_g6_catalog_is_deterministic(tmp_path):
    output = tmp_path / "sites.json"
    build_catalog(output_path=output)
    first = output.read_bytes()
    build_catalog(output_path=output)
    assert output.read_bytes() == first


def test_catalog_exposes_only_validated_pad_and_dispersion_paths(tmp_path):
    terrain = tmp_path / "terrain"
    (terrain / "pad").mkdir(parents=True)
    (terrain / "dispersion").mkdir()
    (terrain / "pad" / "apollo_11.json").write_text(
        json.dumps({"site_id": "apollo_11", "slope_deg": 1.25, "near_field_resolution_m": 2.0}),
        encoding="utf-8",
    )
    (terrain / "dispersion" / "apollo_11.bin").write_bytes(bytes(121))
    (terrain / "dispersion" / "apollo_11.json").write_text(
        json.dumps(
            {"site_id": "apollo_11", "nodes": [11, 11], "spacing_m": 50.0, "dtype": "uint8"}
        ),
        encoding="utf-8",
    )

    catalog = build_catalog(output_path=tmp_path / "sites.json", terrain_root=terrain)
    sites = {site["id"]: site for site in catalog["sites"]}

    assert sites["apollo_11"]["terrain"] == {
        "status": "available",
        "near_field_res_m": 2.0,
        "mask": None,
        "sigma": None,
        "pad": {"slope_deg": 1.25},
        "dispersion_file": "terrain/dispersion/apollo_11.bin",
        "psr": None,
    }
    assert sites["blue_ghost_m1"]["terrain"]["status"] == "unavailable"
    assert sites["slim_shioli"]["terrain"]["dispersion_file"] is None


def test_catalog_rejects_incomplete_or_mismatched_terrain_artifacts(tmp_path):
    terrain = tmp_path / "terrain"
    (terrain / "pad").mkdir(parents=True)
    (terrain / "dispersion").mkdir()
    (terrain / "pad" / "apollo_11.json").write_text(
        json.dumps({"site_id": "other", "slope_deg": 1, "near_field_resolution_m": 2}),
        encoding="utf-8",
    )
    (terrain / "dispersion" / "apollo_11.bin").write_bytes(bytes(120))
    (terrain / "dispersion" / "apollo_11.json").write_text(
        json.dumps({"site_id": "apollo_11", "nodes": [11, 11], "spacing_m": 50, "dtype": "uint8"}),
        encoding="utf-8",
    )

    site = next(
        site
        for site in build_catalog(output_path=tmp_path / "sites.json", terrain_root=terrain)[
            "sites"
        ]
        if site["id"] == "apollo_11"
    )
    assert site["terrain"]["status"] == "unavailable"
    assert site["terrain"]["pad"] is None
    assert site["terrain"]["dispersion_file"] is None


def test_g6_catalog_allows_missing_optional_metadata(tmp_path):
    source = yaml.safe_load(default_sites_path().read_text(encoding="utf-8"))
    athena = next(site for site in source["sites"] if site["id"] == "im2_athena")
    athena.pop("landing_coords")
    athena.pop("touchdown_utc")
    athena.pop("touchdown_precision")
    athena.pop("last_contact_utc")
    sites_path = tmp_path / "sites.yaml"
    sites_path.write_text(yaml.safe_dump(source), encoding="utf-8")

    catalog = build_catalog(sites_path=sites_path, output_path=tmp_path / "sites.json")
    athena_catalog = next(site for site in catalog["sites"] if site["id"] == "im2_athena")

    assert athena_catalog["landing_coords"] is None
    assert athena_catalog["target_coords"] is None
    assert athena_catalog["touchdown_utc"] is None
    assert athena_catalog["touchdown_precision"] is None
    assert athena_catalog["last_contact_utc"] is None


def test_g6_catalog_rejects_missing_or_unknown_site_rows(tmp_path):
    source = yaml.safe_load(default_sites_path().read_text(encoding="utf-8"))
    source["sites"].pop()
    sites_path = tmp_path / "sites.yaml"
    sites_path.write_text(yaml.safe_dump(source), encoding="utf-8")

    with pytest.raises(ValueError, match="requires exactly these sites"):
        build_catalog(sites_path=sites_path, output_path=tmp_path / "sites.json")

    source["sites"].append({"id": "unverified_extra"})
    sites_path.write_text(yaml.safe_dump(source), encoding="utf-8")
    with pytest.raises(ValueError, match="requires exactly these sites"):
        build_catalog(sites_path=sites_path, output_path=tmp_path / "sites.json")


def test_expanded_sites_are_source_verified_with_no_invented_times(tmp_path):
    catalog = build_catalog(output_path=tmp_path / "sites.json")
    by_id = {site["id"]: site for site in catalog["sites"]}
    # Values as printed on the cited NASA / LROC pages.
    assert (by_id["apollo_11"]["latitude_deg"], by_id["apollo_11"]["longitude_deg_east"]) == (
        0.67416,
        23.47314,
    )
    assert (by_id["apollo_12"]["latitude_deg"], by_id["apollo_12"]["longitude_deg_east"]) == (
        -3.0128,
        -23.4219,
    )
    assert (by_id["apollo_17"]["latitude_deg"], by_id["apollo_17"]["longitude_deg_east"]) == (
        20.1911,
        30.7723,
    )
    assert (by_id["slim_shioli"]["latitude_deg"], by_id["slim_shioli"]["longitude_deg_east"]) == (
        -13.316,
        25.251,
    )
    assert (
        by_id["change6_apollo_basin"]["latitude_deg"],
        by_id["change6_apollo_basin"]["longitude_deg_east"],
    ) == (-41.6385, 206.0148)
    assert by_id["slim_shioli"]["touchdown_utc"] == "2024-01-19T15:20:00Z"
    for site_id in (
        "apollo_11",
        "apollo_12",
        "apollo_14",
        "apollo_15",
        "apollo_16",
        "apollo_17",
        "change6_apollo_basin",
    ):
        assert by_id[site_id]["touchdown_utc"] is None, site_id
    for site in catalog["sites"]:
        assert -180.0 <= site["longitude_deg_east"] <= 360.0
        assert site["source_url"].startswith("https://")
