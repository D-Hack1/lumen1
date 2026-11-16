"""Focused S-7 layer and region export tests."""

from __future__ import annotations

import json
from dataclasses import replace

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from lumen_pipeline.terrain.layers import (
    LayerInputError,
    RasterLayerMetadata,
    export_layer_png,
    inspect_raster,
    unavailable_layer_entry,
    write_layer_index,
)
from lumen_pipeline.terrain.regions import (
    RegionGeometryError,
    export_artemis_svg,
    write_regions_index,
)


def _metadata() -> RasterLayerMetadata:
    return RasterLayerMetadata(
        layer_id="slope_hazard",
        name="Slope Hazard",
        extent="80_90S",
        source="verified-slope.tif",
        units="class",
        value_semantics="Explicit verified hazard classes; zero is safe.",
        nodata=255,
        projection={
            "type": "polar_stereographic_south",
            "radius_m": 1_737_400.0,
            "central_meridian_deg": 0.0,
            "standard_parallel_deg": -90.0,
            "size_px": [2, 2],
            "centre_px": [1.0, 1.0],
            "lat_limit_deg": -80.0,
            "half_extent_km": 1.0,
            "metres_per_px": 1.0,
        },
        source_citation="verified test source",
        spatial_metadata={
            "crs": "EPSG:4326",
            "transform": [1.0, 0.0, 0.0, 0.0, -1.0, 2.0],
            "bounds": [0.0, 0.0, 2.0, 2.0],
            "resolution": [1.0, 1.0],
            "shape": [2, 2],
            "coordinate_convention": "test",
            "nodata": 255,
        },
        encoding="pre_encoded_integer",
        encoding_parameters={"kind": "identity", "dtype": "uint8"},
        legend_stops=[{"value": 0, "label": "safe", "hex": "#00ff00"}],
    )


def _source_metadata() -> dict:
    return {
        "crs": "EPSG:4326",
        "transform": [1.0, 0.0, 0.0, 0.0, -1.0, 2.0],
        "bounds": [0.0, 0.0, 2.0, 2.0],
        "resolution": [1.0, 1.0],
        "shape": [2, 2],
        "nodata": 255.0,
    }


def _projection() -> dict:
    return {
        "type": "polar_stereographic_south",
        "radius_m": 1737.4,
        "central_meridian_deg": 0.0,
        "standard_parallel_deg": -90.0,
        "r": "2R*tan(colat/2)",
        "x": "r*sin(lon_east)",
        "y": "r*cos(lon_east)",
    }


def test_export_layer_preserves_zero_and_nodata(tmp_path):
    output = tmp_path / "layers" / "slope.png"
    values = np.array([[0, 1], [2, 255]], dtype=np.uint8)

    entry = export_layer_png(
        values,
        output,
        metadata=_metadata(),
        source_metadata=_source_metadata(),
        index_directory=tmp_path,
    )
    write_layer_index(tmp_path / "index.json", entries=[entry])
    assert entry["file_path"] == "layers/slope.png"
    assert entry["metadata_path"] == "layers/slope.png.json"

    assert entry["available"] is True
    metadata = json.loads((output.with_name(output.name + ".json")).read_text(encoding="utf-8"))
    assert metadata["shape"] == [2, 2]
    assert metadata["resolution"] == [1.0, 1.0]
    assert metadata["coordinate_convention"] == "test"
    with rasterio.open(output) as dataset:
        assert dataset.read(1).tolist() == values.tolist()
        assert dataset.read(2).tolist() == [[255, 255], [255, 0]]
    inspected = inspect_raster(output)
    assert inspected["shape"] == [2, 2]
    assert inspected["dtype"] == "uint8"


def test_export_round_trips_actual_source_spatial_metadata(tmp_path):
    values = np.array([[0, 1], [2, 255]], dtype=np.uint8)
    source_path = tmp_path / "source.tif"
    with rasterio.open(
        source_path,
        "w",
        driver="GTiff",
        height=2,
        width=2,
        count=1,
        dtype="uint8",
        crs="EPSG:4326",
        transform=from_origin(10.0, -20.0, 0.5, 0.5),
        nodata=255,
    ) as source:
        source.write(values, 1)
    source_metadata = inspect_raster(source_path)
    layer_metadata = replace(
        _metadata(),
        spatial_metadata={
            **{
                key: source_metadata[key]
                for key in ("crs", "transform", "bounds", "resolution", "shape", "nodata")
            },
            "coordinate_convention": "source raster CRS axes",
        },
    )
    output = tmp_path / "layers" / "source.png"
    export_layer_png(
        values,
        output,
        metadata=layer_metadata,
        source_metadata=source_metadata,
        index_directory=tmp_path,
    )
    sidecar = json.loads((output.with_name(output.name + ".json")).read_text(encoding="utf-8"))
    assert sidecar["crs"] == "EPSG:4326"
    assert sidecar["transform"] == source_metadata["transform"]
    assert sidecar["bounds"] == source_metadata["bounds"]


def test_float_layer_requires_explicit_integer_encoding(tmp_path):
    with pytest.raises(LayerInputError, match="integer"):
        export_layer_png(
            np.ones((2, 2), dtype=np.float32),
            tmp_path / "layer.png",
            metadata=_metadata(),
            source_metadata=_source_metadata(),
            index_directory=tmp_path,
        )


def test_nodata_must_fit_output_dtype(tmp_path):
    metadata = _metadata()
    metadata = RasterLayerMetadata(**{**metadata.__dict__, "nodata": 256})
    with pytest.raises(LayerInputError, match="representable"):
        export_layer_png(
            np.ones((2, 2), dtype=np.uint8),
            tmp_path / "layer.png",
            metadata=metadata,
            source_metadata=_source_metadata(),
            index_directory=tmp_path,
        )


def test_export_rejects_spatial_metadata_mismatch(tmp_path):
    source = _source_metadata()
    source["shape"] = [3, 2]
    with pytest.raises(LayerInputError, match="does not match source raster"):
        export_layer_png(
            np.ones((2, 2), dtype=np.uint8),
            tmp_path / "layer.png",
            metadata=_metadata(),
            source_metadata=source,
            index_directory=tmp_path,
        )


def test_only_four_s7_layer_ids_are_indexed():
    assert unavailable_layer_entry("psr", "80_90S", reason="missing")["layer_id"] == "psr"
    with pytest.raises(LayerInputError, match="unsupported terrain layer"):
        unavailable_layer_entry("psr_distance", "80_90S", reason="out of scope")


def test_extent_validation_rejects_non_frontend_extent():
    with pytest.raises(LayerInputError, match="unsupported terrain extent"):
        unavailable_layer_entry("psr", "60_90S", reason="invalid")


def test_unavailable_index_does_not_claim_missing_files(tmp_path):
    entry = unavailable_layer_entry("psr", "85_90S", reason="verified PSR raster is unavailable")
    output = tmp_path / "layers.json"
    write_layer_index(output, entries=[entry])

    document = json.loads(output.read_text(encoding="utf-8"))
    assert document["layers"][0]["available"] is False
    assert document["layers"][0]["filename"] is None


def test_available_index_requires_existing_output(tmp_path):
    entry = {
        "layer_id": "psr",
        "extent": "80_90S",
        "available": True,
        "filename": "missing.png",
        "file_path": "layers/missing.png",
        "metadata_path": "layers/missing.png.json",
    }
    with pytest.raises(LayerInputError, match="does not exist"):
        write_layer_index(tmp_path / "layers.json", entries=[entry])


def test_svg_export_validates_geometry_and_preserves_projection(tmp_path):
    output = tmp_path / "artemis.svg"
    export_artemis_svg(
        [[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 0.0)]],
        output,
        source='verified "test" geometry',
        projection=_projection(),
        coordinate_frame="frontend_polar_stereographic_south",
    )

    text = output.read_text(encoding="utf-8")
    assert "<metadata>" in text
    assert "data-source=" in text
    assert 'verified "test" geometry' in text
    assert 'viewBox="0.000000 -1.000000 1.000000 1.000000"' in text
    assert "L 1.000000 -0.000000" in text


def test_svg_export_rejects_missing_geometry(tmp_path):
    with pytest.raises(RegionGeometryError, match="unavailable"):
        export_artemis_svg(
            [],
            tmp_path / "artemis.svg",
            source="missing",
            projection=_projection(),
            coordinate_frame="frontend_polar_stereographic_south",
        )


def test_svg_export_rejects_self_intersecting_geometry(tmp_path):
    with pytest.raises(RegionGeometryError, match="self-intersecting|non-zero"):
        export_artemis_svg(
            [[(0.0, 0.0), (1.0, 1.0), (0.0, 1.0), (1.0, 0.0), (0.0, 0.0)]],
            tmp_path / "artemis.svg",
            source="verified",
            projection=_projection(),
            coordinate_frame="frontend_polar_stereographic_south",
        )


def test_svg_export_rejects_holes_and_invalid_projection(tmp_path):
    ring = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 0.0)]
    with pytest.raises(RegionGeometryError, match="holes and multipolygons"):
        export_artemis_svg(
            [ring, ring],
            tmp_path / "artemis.svg",
            source="verified",
            projection=_projection(),
            coordinate_frame="frontend_polar_stereographic_south",
        )
    with pytest.raises(RegionGeometryError, match="projection field"):
        export_artemis_svg(
            [ring],
            tmp_path / "artemis.svg",
            source="verified",
            projection={"type": "polar_stereographic_south"},
            coordinate_frame="frontend_polar_stereographic_south",
        )


def test_svg_export_rejects_repeated_and_collinear_rings(tmp_path):
    with pytest.raises(RegionGeometryError, match="repeated vertices"):
        export_artemis_svg(
            [[(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (2.0, 0.0), (0.0, 0.0)]],
            tmp_path / "repeated.svg",
            source="verified",
            projection=_projection(),
            coordinate_frame="frontend_polar_stereographic_south",
        )
    with pytest.raises(RegionGeometryError, match="non-zero"):
        export_artemis_svg(
            [[(0.0, 0.0), (1.0, 0.0), (2.0, 0.0), (0.0, 0.0)]],
            tmp_path / "collinear.svg",
            source="verified",
            projection=_projection(),
            coordinate_frame="frontend_polar_stereographic_south",
        )


def test_region_index_rejects_missing_svg_or_metadata(tmp_path):
    region = {
        "region_id": "test",
        "name": "Test",
        "centroid_lat_deg": -88.0,
        "centroid_lon_deg": 10.0,
        "svg_path": "M 0 0 Z",
        "projection": _projection(),
        "source": "verified",
    }
    with pytest.raises(RegionGeometryError, match="svg_file"):
        write_regions_index(tmp_path / "regions.json", regions=[region])


def test_empty_region_index_requires_reason(tmp_path):
    with pytest.raises(RegionGeometryError, match="unavailability"):
        write_regions_index(tmp_path / "regions.json", regions=[])
