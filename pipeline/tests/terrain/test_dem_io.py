"""Regression tests for windowed DEM IO (S-2)."""

from __future__ import annotations

import hashlib
import http.server
import json
import os
import re
import threading
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest
import rasterio
import rasterio.shutil
from pyproj import CRS, Transformer
from rasterio.transform import Affine, from_origin

from lumen_pipeline.terrain.dem_io import (
    LUNAR_SPHERICAL_CRS,
    SPHERE_RADIUS_M,
    DemError,
    DemMetadataError,
    DemProduct,
    DemRangeError,
    DemReader,
    _remote_identity,
    load_products,
    local_dem_path,
)

VERIFIED_STATUS = "source_page_and_urls_provided"
NATIVE_CRS = CRS.from_proj4(
    "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400 +units=m +no_defs"
)
PIXEL_M = 20.0
ROWS = COLS = 400
DEM_BOUNDS = (2000.0, -6000.0, 7000.0, -1000.0)
FULL_BOUNDS = (0.0, -ROWS * PIXEL_M, COLS * PIXEL_M, 0.0)


def test_local_dem_requires_matching_verified_manifest(tmp_path):
    product = DemProduct(
        key="local", name="local", url="https://example.test/dem.tif", resolution_m=20,
        unit="m", scale=1, offset=0, nodata=float("nan"), vertical_reference="height_relative",
        verification_status=VERIFIED_STATUS,
    )
    target = tmp_path / "dem.tif"
    target.with_suffix(".tif.part").write_bytes(b"interrupted")
    assert local_dem_path(product, tmp_path) is None
    target.write_bytes(b"not-a-geotiff")
    assert local_dem_path(product, tmp_path) is None
    target.with_suffix(".tif.lumen.json").write_text(json.dumps({
        "source_url": product.url, "size_bytes": target.stat().st_size,
        "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
    }))
    assert local_dem_path(product, tmp_path) == target
    target.write_bytes(b"interrupted-or-corrupt")
    assert local_dem_path(product, tmp_path) is None
REMOTE_ROWS = REMOTE_COLS = 512
REMOTE_TRANSFORM = from_origin(0.0, 0.0, PIXEL_M, PIXEL_M)
REMOTE_VALUES = (
    np.arange(REMOTE_ROWS, dtype=np.float32)[:, None] * 10.0
    + np.arange(REMOTE_COLS, dtype=np.float32)[None, :] * 10.0
).astype("float32")
REMOTE_WINDOW_BOUNDS = (2000.0, -6000.0, 4000.0, -4000.0)
REMOTE_EXPECTED = REMOTE_VALUES[200:300, 100:200]


def _write_raster(
    path: Path,
    values: np.ndarray,
    *,
    transform,
    nodata=-9999.0,
    crs=NATIVE_CRS,
) -> None:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=values.shape[0],
        width=values.shape[1],
        count=1,
        dtype="float32",
        crs=crs,
        transform=transform,
        nodata=nodata,
    ) as dataset:
        dataset.write(values.astype("float32"), 1)


def _product(tmp_path: Path, *, error: bool = True, **overrides):
    values = np.add.outer(np.arange(ROWS, dtype=np.float32), np.arange(COLS, dtype=np.float32))
    values[10, 10] = -9999.0
    transform = from_origin(0.0, 0.0, PIXEL_M, PIXEL_M)
    dem_path = tmp_path / "dem.tif"
    _write_raster(dem_path, values, transform=transform)
    error_path = tmp_path / "dem_ERR.tif"
    if error:
        _write_raster(error_path, np.full_like(values, 0.5), transform=transform)
    fields = {
        "key": "synthetic_20m",
        "name": "Synthetic 20 m",
        "url": str(dem_path),
        "error_url": str(error_path) if error else None,
        "resolution_m": PIXEL_M,
        "unit": "m",
        "scale": 1.0,
        "offset": 0.0,
        "nodata": -9999.0,
        "vertical_reference": "height_relative",
        "error_unit": "m",
        "error_scale": 1.0,
        "error_offset": 0.0,
        "error_nodata": -9999.0,
        "error_vertical_reference": "height_relative",
        "availability_status": None,
        "verification_status": VERIFIED_STATUS,
        "source_revision": "rev-a",
    }
    fields.update(overrides)
    return DemProduct(**fields), transform


def _wide_product(tmp_path: Path, values: np.ndarray, *, pixel_m: float = 10.0):
    transform = from_origin(0.0, 0.0, pixel_m, pixel_m)
    path = tmp_path / "wide.tif"
    _write_raster(path, values, transform=transform)
    product = DemProduct(
        key="wide",
        name="Wide synthetic",
        url=str(path),
        resolution_m=pixel_m,
        unit="m",
        scale=1.0,
        offset=0.0,
        nodata=-9999.0,
        vertical_reference="height_relative",
        verification_status=VERIFIED_STATUS,
    )
    return product, transform


def _remote_product(url: str, *, source_revision: str | None = None) -> DemProduct:
    return DemProduct(
        key="remote_cog",
        name="Remote COG",
        url=url,
        resolution_m=PIXEL_M,
        unit="m",
        scale=1.0,
        offset=0.0,
        nodata=-9999.0,
        vertical_reference="height_relative",
        verification_status=VERIFIED_STATUS,
        source_revision=source_revision,
    )


def _cache_paths(cache_dir: Path) -> tuple[Path, Path]:
    data_path = next(cache_dir.glob("*.npz"))
    return data_path, data_path.with_suffix(".json")


def _mutate_manifest(path: Path, mutate) -> None:
    document = json.loads(path.read_text(encoding="utf-8"))
    mutate(document)
    path.write_text(json.dumps(document), encoding="utf-8")


class _RangeServer:
    """Hermetic local HTTP server with HEAD and byte-range support."""

    def __init__(
        self,
        path: str,
        data: bytes,
        *,
        etag: str | None = '"v1"',
        last_modified: str | None = "Wed, 01 Jan 2025 00:00:00 GMT",
        head_enabled: bool = True,
    ) -> None:
        self.path = path
        self.data = data
        self.etag = etag
        self.last_modified = last_modified
        self.head_enabled = head_enabled
        self.requests: list[tuple[str, str, str | None]] = []
        self.bytes_sent = 0
        self._lock = threading.Lock()
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args: object) -> None:
                pass

            def do_HEAD(self) -> None:
                outer._respond(self, head_only=True)

            def do_GET(self) -> None:
                outer._respond(self, head_only=False)

        self._server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        self.url = f"http://127.0.0.1:{self._server.server_port}{self.path}"

    def _respond(self, handler, *, head_only: bool) -> None:
        with self._lock:
            range_header = handler.headers.get("Range")
            self.requests.append((handler.command, handler.path, range_header))
            data = self.data
            etag = self.etag
            last_modified = self.last_modified
            head_enabled = self.head_enabled
        if head_only and not head_enabled:
            handler.send_response(405)
            handler.send_header("Content-Length", "0")
            handler.send_header("Connection", "close")
            handler.end_headers()
            handler.close_connection = True
            return
        if handler.path.split("?", 1)[0] != self.path:
            handler.send_error(404)
            handler.close_connection = True
            return
        start, end, status = 0, len(data) - 1, 200
        if range_header:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
            if match is None:
                handler.send_error(416)
                handler.close_connection = True
                return
            raw_start, raw_end = match.groups()
            if raw_start:
                start = int(raw_start)
                end = int(raw_end) if raw_end else len(data) - 1
            else:
                start = len(data) - int(raw_end)
                end = len(data) - 1
            start = max(0, start)
            end = min(len(data) - 1, end)
            if start > end:
                handler.send_error(416)
                handler.close_connection = True
                return
            status = 206
        body = data[start : end + 1]
        handler.send_response(status)
        if etag is not None:
            handler.send_header("ETag", etag)
        if last_modified is not None:
            handler.send_header("Last-Modified", last_modified)
        handler.send_header("Accept-Ranges", "bytes")
        handler.send_header("Content-Type", "image/tiff")
        handler.send_header("Connection", "close")
        if status == 206:
            handler.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
            handler.send_header("Content-Length", str(len(body)))
        elif head_only:
            handler.send_header("Content-Length", str(len(data)))
        else:
            handler.send_header("Content-Length", str(len(body)))
        handler.end_headers()
        if not head_only:
            handler.wfile.write(body)
            handler.wfile.flush()
            with self._lock:
                self.bytes_sent += len(body)
        handler.close_connection = True

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5.0)


@pytest.fixture(scope="module")
def remote_cog(tmp_path_factory) -> bytes:
    directory = tmp_path_factory.mktemp("remote_cog")
    raw_path = directory / "raw.tif"
    cog_path = directory / "dem.tif"
    with rasterio.open(
        raw_path,
        "w",
        driver="GTiff",
        height=REMOTE_ROWS,
        width=REMOTE_COLS,
        count=1,
        dtype="float32",
        crs=NATIVE_CRS,
        transform=REMOTE_TRANSFORM,
        nodata=-9999.0,
        tiled=True,
        blockxsize=64,
        blockysize=64,
        compress="deflate",
    ) as dataset:
        dataset.write(REMOTE_VALUES, 1)
    rasterio.shutil.copy(raw_path, cog_path, driver="COG", BLOCKSIZE="64", COMPRESS="DEFLATE")
    with rasterio.open(cog_path) as dataset:
        assert dataset.profile["tiled"] is True
        assert dataset.block_shapes[0] == (64, 64)
    return cog_path.read_bytes()


@pytest.fixture
def range_server(remote_cog: bytes):
    servers: list[_RangeServer] = []

    def start(**kwargs) -> _RangeServer:
        server = _RangeServer("/dem.tif", remote_cog, **kwargs)
        servers.append(server)
        return server

    yield start
    for server in servers:
        server.close()


# ---------------------------------------------------------------------------
# 1. Fail-closed activation
# ---------------------------------------------------------------------------

_MISSING_METADATA = {
    "url": "",
    "verification_status": None,
    "unit": None,
    "scale": None,
    "offset": None,
    "nodata": None,
    "vertical_reference": None,
}


@pytest.mark.parametrize("field", sorted(_MISSING_METADATA))
def test_activation_fails_closed_without_explicit_metadata(tmp_path, field):
    product, _ = _product(tmp_path, error=False)
    changed = replace(product, **{field: _MISSING_METADATA[field]})

    assert changed.is_verified is False
    with pytest.raises(DemMetadataError, match="not verified"):
        DemReader(cache_dir=tmp_path / "cache").read_window(changed, DEM_BOUNDS)


@pytest.mark.parametrize(
    "status", ["verified", "not_verified", "false", "random-status", "", "PENDING"]
)
def test_arbitrary_verification_status_is_rejected(tmp_path, status):
    product, _ = _product(tmp_path, error=False)
    changed = replace(product, verification_status=status)

    assert changed.is_verified is False
    with pytest.raises(DemMetadataError, match="not verified"):
        DemReader(cache_dir=tmp_path / "cache").read_window(changed, DEM_BOUNDS)


def test_registry_allowlist_status_is_accepted(tmp_path):
    product, _ = _product(tmp_path, error=False)
    changed = replace(product, verification_status=f"  {VERIFIED_STATUS.upper()}  ")

    assert changed.is_verified is True


@pytest.mark.parametrize("url", ["", "   ", "\t\n"])
def test_blank_url_is_rejected(tmp_path, url):
    product, _ = _product(tmp_path, error=False)
    changed = replace(product, url=url)

    assert changed.is_verified is False
    with pytest.raises(DemMetadataError, match="not verified"):
        DemReader(cache_dir=tmp_path / "cache").read_window(changed, DEM_BOUNDS)


@pytest.mark.parametrize(
    "resolution",
    [float("nan"), float("inf"), -float("inf"), 0.0, -PIXEL_M],
)
def test_invalid_resolution_is_rejected(tmp_path, resolution):
    product, _ = _product(tmp_path, error=False)
    changed = replace(product, resolution_m=resolution)

    assert changed.is_verified is False
    with pytest.raises(DemMetadataError, match="not verified"):
        DemReader(cache_dir=tmp_path / "cache").read_window(changed, DEM_BOUNDS)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("scale", float("nan")),
        ("scale", float("inf")),
        ("scale", -float("inf")),
        ("offset", float("nan")),
        ("offset", float("inf")),
        ("offset", -float("inf")),
    ],
)
def test_non_finite_scale_or_offset_is_rejected(tmp_path, field, value):
    product, _ = _product(tmp_path, error=False)
    changed = replace(product, **{field: value})

    assert changed.is_verified is False
    with pytest.raises(DemMetadataError, match="not verified"):
        DemReader(cache_dir=tmp_path / "cache").read_window(changed, DEM_BOUNDS)


def test_availability_status_is_not_consulted_for_activation(tmp_path):
    product, _ = _product(tmp_path, error=False)
    assert product.availability_status is None
    assert product.is_verified is True

    result = DemReader(cache_dir=tmp_path / "cache").read_window(
        product, DEM_BOUNDS, width_m=5000.0
    )

    assert result.elevation.shape == (250, 250)


@pytest.mark.parametrize(
    "availability", ["verified_product", "catalogue_product", "candidate", None]
)
def test_catalogue_label_cannot_rescue_incomplete_metadata(tmp_path, availability):
    product, _ = _product(tmp_path, error=False, availability_status=availability, nodata=None)

    assert product.is_verified is False
    with pytest.raises(DemMetadataError, match="not verified"):
        DemReader(cache_dir=tmp_path / "cache").read_window(product, DEM_BOUNDS)


def test_registry_excludes_entries_with_missing_or_untrusted_metadata(tmp_path):
    config = tmp_path / "dem_sources.yaml"
    config.write_text(
        "products:\n"
        "  incomplete:\n"
        "    name: Incomplete\n"
        "    resolution_m: 20.0\n"
        "    dem_url: https://example.invalid/incomplete.tif\n"
        "    availability_status: verified_product\n"
        f"    verification_status: {VERIFIED_STATUS}\n"
        "  complete:\n"
        "    name: Complete\n"
        "    resolution_m: 20.0\n"
        "    dem_url: https://example.invalid/complete.tif\n"
        "    availability_status: catalogue_product\n"
        f"    verification_status: {VERIFIED_STATUS}\n"
        "    unit: m\n"
        "    scale: 1.0\n"
        "    offset: 0.0\n"
        "    nodata: -9999.0\n"
        "    vertical_reference: height_relative\n"
        "  old_status:\n"
        "    name: Old status\n"
        "    resolution_m: 20.0\n"
        "    dem_url: https://example.invalid/old.tif\n"
        "    verification_status: verified\n"
        "    unit: m\n"
        "    scale: 1.0\n"
        "    offset: 0.0\n"
        "    nodata: -9999.0\n"
        "    vertical_reference: height_relative\n"
        "  arbitrary_status:\n"
        "    name: Arbitrary status\n"
        "    resolution_m: 20.0\n"
        "    dem_url: https://example.invalid/arbitrary.tif\n"
        "    verification_status: not_verified\n"
        "    unit: m\n"
        "    scale: 1.0\n"
        "    offset: 0.0\n"
        "    nodata: -9999.0\n"
        "    vertical_reference: height_relative\n",
        encoding="utf-8",
    )

    products = load_products(config)

    assert set(products) == {"complete"}


# ---------------------------------------------------------------------------
# 2. Clipping and outward rounding
# ---------------------------------------------------------------------------


def test_window_uses_floor_start_ceil_end_and_outward_rounding(tmp_path):
    product, _ = _product(tmp_path, error=False)

    result = DemReader(cache_dir=tmp_path / "cache").read_window(
        product, (10.0, -3990.0, 1010.0, -10.0), width_m=1000.0
    )

    # cols 0.5..50.5 -> floor 0, ceil 51; rows 0.5..199.5 -> floor 0, ceil 200
    assert result.elevation.shape == (200, 51)
    assert result.provenance["pixel_window"] == [0, 0, 51, 200]
    assert result.bounds == (0.0, -4000.0, 1020.0, 0.0)
    assert result.transform == Affine(20.0, 0.0, 0.0, 0.0, -20.0, 0.0)


def test_window_is_clipped_to_dataset_bounds(tmp_path):
    product, _ = _product(tmp_path, error=False)

    result = DemReader(cache_dir=tmp_path / "cache").read_window(
        product, (-1000.0, -9000.0, 1000.0, 1000.0), width_m=2000.0
    )

    # Requested window extends past the west, south and north edges.
    assert result.elevation.shape == (400, 50)
    assert result.provenance["pixel_window"] == [0, 0, 50, 400]
    assert result.bounds == (0.0, -8000.0, 1000.0, 0.0)
    assert result.transform == Affine(20.0, 0.0, 0.0, 0.0, -20.0, 0.0)


def test_window_bounds_come_from_clipped_window(tmp_path):
    product, _ = _product(tmp_path, error=False)

    result = DemReader(cache_dir=tmp_path / "cache").read_window(
        product, (-1000.0, -9000.0, 1000.0, 1000.0), width_m=2000.0
    )

    # The transformed bounds describe the clipped raster, not the request.
    assert result.bounds[0] == result.transform.c == 0.0
    assert result.bounds[3] == result.transform.f == 0.0
    assert result.bounds != (-1000.0, -9000.0, 1000.0, 1000.0)


def test_window_outside_dataset_is_rejected(tmp_path):
    product, _ = _product(tmp_path, error=False)

    with pytest.raises(DemError, match="does not intersect"):
        DemReader(cache_dir=tmp_path / "cache").read_window(
            product, (9000.0, -100.0, 10000.0, -50.0), width_m=500.0
        )


# ---------------------------------------------------------------------------
# 3. Absolute-radius _ERR values
# ---------------------------------------------------------------------------


def test_absolute_radius_error_is_converted_without_sphere_subtraction(tmp_path):
    product, transform = _product(tmp_path)
    _write_raster(
        tmp_path / "dem_ERR.tif",
        np.full((ROWS, COLS), 1.0, dtype=np.float32),
        transform=transform,
    )
    changed = replace(
        product,
        error_unit="km",
        error_scale=2.0,
        error_offset=0.5,
        error_vertical_reference="absolute_radius",
    )

    result = DemReader(cache_dir=tmp_path / "cache").read_window(
        changed, DEM_BOUNDS, width_m=5000.0, read_error=True
    )

    assert result.error is not None
    assert result.error_valid is not None
    # (1.0 * 2.0 + 0.5) km = 2500 m; the lunar radius must never be removed.
    assert np.isclose(result.error[result.error_valid], 2500.0).all()
    metadata = result.provenance["error_metadata"]
    assert metadata["unit"] == "km"
    assert metadata["vertical_reference"] == "absolute_radius"
    assert metadata["sphere_subtracted"] is False


def test_absolute_radius_dem_is_converted_to_height(tmp_path):
    product, transform = _product(tmp_path, error=False)
    radius = SPHERE_RADIUS_M + 150.0
    _write_raster(
        tmp_path / "dem.tif",
        np.full((ROWS, COLS), radius, dtype=np.float32),
        transform=transform,
    )
    changed = replace(product, vertical_reference="absolute_radius")

    result = DemReader(cache_dir=tmp_path / "cache").read_window(
        changed, DEM_BOUNDS, width_m=5000.0
    )

    assert np.isclose(result.elevation[result.valid], 150.0).all()


def test_absolute_radius_dem_without_radius_geometry_is_rejected(tmp_path):
    product, transform = _product(tmp_path, error=False)
    _write_raster(
        tmp_path / "dem.tif",
        np.full((ROWS, COLS), 100.0, dtype=np.float32),
        transform=transform,
    )
    changed = replace(product, vertical_reference="absolute_radius")

    with pytest.raises(DemRangeError, match="absolute-radius"):
        DemReader(cache_dir=tmp_path / "cache").read_window(changed, DEM_BOUNDS, width_m=5000.0)


# ---------------------------------------------------------------------------
# 4. Independent _ERR nodata
# ---------------------------------------------------------------------------


def test_error_nodata_is_independent_of_dem_nodata(tmp_path):
    product, transform = _product(tmp_path)
    error_values = np.full((ROWS, COLS), 0.5, dtype=np.float32)
    error_values[10, 11] = -8888.0
    _write_raster(tmp_path / "dem_ERR.tif", error_values, transform=transform)
    changed = replace(product, error_nodata=-8888.0)

    result = DemReader(cache_dir=tmp_path / "cache").read_window(
        changed, FULL_BOUNDS, width_m=8000.0, read_error=True
    )

    assert result.error is not None
    assert result.error_valid is not None
    # DEM nodata at [10, 10]; _ERR nodata at [10, 11].
    assert result.valid[10, 10] == np.False_
    assert result.error_valid[10, 10] == np.False_
    assert result.valid[10, 11] == np.True_
    assert result.error_valid[10, 11] == np.False_
    assert np.isclose(result.error[result.error_valid], 0.5).all()


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("error_unit", None, "explicit elevation unit"),
        ("error_scale", None, "explicit scale"),
        ("error_offset", None, "explicit scale"),
        ("error_nodata", None, "explicit nodata"),
        ("error_vertical_reference", None, "vertical_reference"),
    ],
)
def test_error_metadata_must_be_explicit(tmp_path, field, value, message):
    product, _ = _product(tmp_path)
    changed = replace(product, **{field: value})

    with pytest.raises(DemMetadataError, match=message):
        DemReader(cache_dir=tmp_path / "cache").read_window(
            changed, DEM_BOUNDS, width_m=5000.0, read_error=True
        )


def test_error_metadata_never_falls_back_to_dem_metadata(tmp_path):
    product, _ = _product(tmp_path)
    changed = replace(
        product,
        error_unit=None,
        error_scale=None,
        error_offset=None,
        error_nodata=None,
        error_vertical_reference=None,
    )

    with pytest.raises(DemMetadataError, match="_ERR"):
        DemReader(cache_dir=tmp_path / "cache").read_window(
            changed, DEM_BOUNDS, width_m=5000.0, read_error=True
        )


# ---------------------------------------------------------------------------
# 5. Metadata cache invalidation and corruption handling
# ---------------------------------------------------------------------------


def test_repeat_read_hits_cache(tmp_path):
    product, _ = _product(tmp_path, error=False)
    reader = DemReader(cache_dir=tmp_path / "cache")

    first = reader.read_window(product, DEM_BOUNDS, width_m=5000.0)
    second = reader.read_window(product, DEM_BOUNDS, width_m=5000.0)

    assert first.provenance["cache_hit"] is False
    assert second.provenance["cache_hit"] is True
    assert second.provenance["cache_key"] == first.provenance["cache_key"]


@pytest.mark.parametrize(
    "change",
    [
        {"unit": "km", "scale": 0.001},
        {"scale": 2.0},
        {"offset": 250.0},
        {"nodata": -8888.0},
        {"vertical_reference": "absolute_radius", "offset": SPHERE_RADIUS_M},
        {"error_unit": "km", "error_scale": 0.001},
        {"error_nodata": -7777.0},
        {"resolution_m": 10.0},
        {"source_revision": "rev-b"},
    ],
)
def test_cache_key_changes_when_metadata_changes(tmp_path, change):
    product, _ = _product(tmp_path, error=False)
    reader = DemReader(cache_dir=tmp_path / "cache")

    first = reader.read_window(product, DEM_BOUNDS, width_m=5000.0)
    changed = replace(product, **change)
    second = reader.read_window(changed, DEM_BOUNDS, width_m=5000.0)

    assert second.provenance["cache_key"] != first.provenance["cache_key"]
    assert second.provenance["cache_hit"] is False


def test_cache_key_changes_when_error_source_changes(tmp_path):
    product, _ = _product(tmp_path)
    other = tmp_path / "other_ERR.tif"
    other.write_bytes((tmp_path / "dem_ERR.tif").read_bytes())
    reader = DemReader(cache_dir=tmp_path / "cache")

    first = reader.read_window(product, DEM_BOUNDS, width_m=5000.0, read_error=True)
    second = reader.read_window(
        replace(product, error_url=str(other)), DEM_BOUNDS, width_m=5000.0, read_error=True
    )

    assert second.provenance["cache_key"] != first.provenance["cache_key"]
    assert second.provenance["cache_hit"] is False


def test_cache_key_changes_when_local_source_fingerprint_changes(tmp_path):
    product, _ = _product(tmp_path, error=False)
    source = Path(product.url)
    reader = DemReader(cache_dir=tmp_path / "cache")

    first = reader.read_window(product, DEM_BOUNDS, width_m=5000.0)
    stat = source.stat()
    os.utime(source, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
    second = reader.read_window(product, DEM_BOUNDS, width_m=5000.0)

    assert second.provenance["cache_key"] != first.provenance["cache_key"]
    assert second.provenance["cache_hit"] is False


_CORRUPT_MANIFEST_CASES = [
    ("schema", lambda manifest: manifest.__setitem__("schema_version", "1")),
    ("key", lambda manifest: manifest.__setitem__("cache_key", "0" * 64)),
    ("checksum", lambda manifest: manifest.__setitem__("sha256", "0" * 64)),
    ("shape", lambda manifest: manifest.__setitem__("shape", [1, 1])),
    ("transform", lambda manifest: manifest.__setitem__("transform", [1.0, 0.0])),
    ("bounds", lambda manifest: manifest.__setitem__("bounds", "invalid")),
    ("resolution", lambda manifest: manifest.__setitem__("resolution_m", [0.0, PIXEL_M])),
    ("provenance", lambda manifest: manifest.__setitem__("provenance", [])),
    ("crs", lambda manifest: manifest.__setitem__("crs_wkt", 42)),
]


@pytest.mark.parametrize(
    ("name", "mutate"),
    _CORRUPT_MANIFEST_CASES,
    ids=[name for name, _ in _CORRUPT_MANIFEST_CASES],
)
def test_invalid_cache_manifest_is_treated_as_miss(tmp_path, name, mutate):
    product, _ = _product(tmp_path, error=False)
    reader = DemReader(cache_dir=tmp_path / "cache")

    reader.read_window(product, DEM_BOUNDS, width_m=5000.0)
    _, manifest_path = _cache_paths(tmp_path / "cache")
    _mutate_manifest(manifest_path, mutate)

    rebuilt = reader.read_window(product, DEM_BOUNDS, width_m=5000.0)
    assert rebuilt.provenance["cache_hit"] is False

    recovered = reader.read_window(product, DEM_BOUNDS, width_m=5000.0)
    assert recovered.provenance["cache_hit"] is True


def test_malformed_manifest_json_is_treated_as_miss(tmp_path):
    product, _ = _product(tmp_path, error=False)
    reader = DemReader(cache_dir=tmp_path / "cache")

    reader.read_window(product, DEM_BOUNDS, width_m=5000.0)
    _, manifest_path = _cache_paths(tmp_path / "cache")
    manifest_path.write_text("{not valid json", encoding="utf-8")

    rebuilt = reader.read_window(product, DEM_BOUNDS, width_m=5000.0)
    assert rebuilt.provenance["cache_hit"] is False


def test_corrupt_cache_archive_is_treated_as_miss(tmp_path):
    product, _ = _product(tmp_path, error=False)
    reader = DemReader(cache_dir=tmp_path / "cache")

    reader.read_window(product, DEM_BOUNDS, width_m=5000.0)
    data_path, manifest_path = _cache_paths(tmp_path / "cache")
    data_path.write_bytes(b"not a zip archive")
    _mutate_manifest(
        manifest_path,
        lambda manifest: manifest.__setitem__(
            "sha256", hashlib.sha256(data_path.read_bytes()).hexdigest()
        ),
    )

    rebuilt = reader.read_window(product, DEM_BOUNDS, width_m=5000.0)
    assert rebuilt.provenance["cache_hit"] is False


def test_cache_archive_shape_mismatch_is_treated_as_miss(tmp_path):
    product, _ = _product(tmp_path, error=False)
    reader = DemReader(cache_dir=tmp_path / "cache")

    reader.read_window(product, DEM_BOUNDS, width_m=5000.0)
    data_path, manifest_path = _cache_paths(tmp_path / "cache")
    with data_path.open("wb") as handle:
        np.savez_compressed(
            handle,
            elevation=np.zeros((1, 1), dtype=np.float32),
            valid=np.zeros((1, 1), dtype=np.uint8),
        )
    _mutate_manifest(
        manifest_path,
        lambda manifest: manifest.__setitem__(
            "sha256", hashlib.sha256(data_path.read_bytes()).hexdigest()
        ),
    )

    rebuilt = reader.read_window(product, DEM_BOUNDS, width_m=5000.0)
    assert rebuilt.provenance["cache_hit"] is False


# ---------------------------------------------------------------------------
# 6. Remote COG identity and windowed I/O
# ---------------------------------------------------------------------------


def test_remote_cog_window_uses_range_requests(tmp_path, range_server):
    server = range_server()
    reader = DemReader(cache_dir=tmp_path / "cache")

    result = reader.read_window(_remote_product(server.url), REMOTE_WINDOW_BOUNDS, width_m=2000.0)

    assert result.elevation.shape == (100, 100)
    np.testing.assert_allclose(result.elevation, REMOTE_EXPECTED)
    assert result.valid.all()
    assert result.transform == Affine(20.0, 0.0, 2000.0, 0.0, -20.0, -4000.0)
    assert result.bounds == pytest.approx((2000.0, -6000.0, 4000.0, -4000.0))
    assert result.provenance["source_identity"]["kind"] == "remote_http"
    assert result.provenance["source_identity"]["etag"] == '"v1"'
    assert result.provenance["cacheable"] is True

    ranged_gets = [
        header
        for command, _path, header in server.requests
        if command == "GET" and header is not None
    ]
    assert ranged_gets
    assert server.bytes_sent > 0
    assert server.bytes_sent < len(server.data)


def test_changed_remote_identity_invalidates_cache(tmp_path, range_server):
    server = range_server()
    product = _remote_product(server.url)
    reader = DemReader(cache_dir=tmp_path / "cache")

    first = reader.read_window(product, REMOTE_WINDOW_BOUNDS, width_m=2000.0)
    server.etag = '"v2"'
    server.last_modified = "Thu, 02 Jan 2025 00:00:00 GMT"
    second = reader.read_window(product, REMOTE_WINDOW_BOUNDS, width_m=2000.0)

    assert second.provenance["cache_key"] != first.provenance["cache_key"]
    assert second.provenance["cache_hit"] is False
    assert second.provenance["source_identity"]["etag"] == '"v2"'
    assert second.provenance["source_identity"]["last_modified"] == (
        "Thu, 02 Jan 2025 00:00:00 GMT"
    )


def test_missing_remote_identity_bypasses_cache(tmp_path, range_server):
    server = range_server(etag=None, last_modified=None)
    product = _remote_product(server.url)
    reader = DemReader(cache_dir=tmp_path / "cache")

    first = reader.read_window(product, REMOTE_WINDOW_BOUNDS, width_m=2000.0)

    assert first.provenance["cache_key"] is None
    assert first.provenance["cacheable"] is False
    assert first.provenance["cache_bypass_reason"] == "source_identity_unavailable"
    assert first.provenance["source_identity"] is None
    assert not (tmp_path / "cache").exists()

    second = reader.read_window(product, REMOTE_WINDOW_BOUNDS, width_m=2000.0)
    assert second.provenance["cache_hit"] is False
    assert not (tmp_path / "cache").exists()
    assert any(
        command == "GET" and header == "bytes=0-0" for command, _path, header in server.requests
    )


def test_explicit_remote_revision_is_cacheable_without_validators(tmp_path, range_server):
    server = range_server(etag=None, last_modified=None)
    product = _remote_product(server.url, source_revision="rev-1")
    reader = DemReader(cache_dir=tmp_path / "cache")

    first = reader.read_window(product, REMOTE_WINDOW_BOUNDS, width_m=2000.0)
    assert first.provenance["source_identity"] == {
        "kind": "revision",
        "revision": "rev-1",
    }
    assert first.provenance["cacheable"] is True

    repeated = reader.read_window(product, REMOTE_WINDOW_BOUNDS, width_m=2000.0)
    assert repeated.provenance["cache_hit"] is True

    changed = reader.read_window(
        replace(product, source_revision="rev-2"),
        REMOTE_WINDOW_BOUNDS,
        width_m=2000.0,
    )
    assert changed.provenance["cache_key"] != first.provenance["cache_key"]
    assert changed.provenance["cache_hit"] is False


def test_remote_identity_falls_back_to_range_get_without_head(range_server, remote_cog):
    server = range_server(head_enabled=False)

    identity = _remote_identity(server.url)

    assert identity is not None
    assert identity["kind"] == "remote_http"
    assert identity["etag"] == '"v1"'
    assert identity["content_length"] == len(remote_cog)
    assert any(command == "HEAD" for command, _path, _header in server.requests)
    assert any(
        command == "GET" and header == "bytes=0-0" for command, _path, header in server.requests
    )


# ---------------------------------------------------------------------------
# 7. Kilometre conversion
# ---------------------------------------------------------------------------


def test_dem_kilometres_are_converted_after_scale_and_offset(tmp_path):
    product, transform = _product(tmp_path, error=False)
    _write_raster(
        tmp_path / "dem.tif",
        np.full((ROWS, COLS), 1.0, dtype=np.float32),
        transform=transform,
    )
    changed = replace(product, unit="km", scale=2.0, offset=0.5)

    result = DemReader(cache_dir=tmp_path / "cache").read_window(
        changed, DEM_BOUNDS, width_m=5000.0
    )

    # (1.0 * 2.0 + 0.5) km = 2500 m
    assert np.isclose(result.elevation[result.valid], 2500.0).all()
    assert result.provenance["unit_applied"] == "km"


def test_error_kilometres_are_converted_after_scale_and_offset(tmp_path):
    product, transform = _product(tmp_path)
    _write_raster(
        tmp_path / "dem_ERR.tif",
        np.full((ROWS, COLS), 0.5, dtype=np.float32),
        transform=transform,
    )
    changed = replace(product, error_unit="km", error_scale=2.0, error_offset=1.0)

    result = DemReader(cache_dir=tmp_path / "cache").read_window(
        changed, DEM_BOUNDS, width_m=5000.0, read_error=True
    )

    assert result.error is not None
    assert result.error_valid is not None
    # (0.5 * 2.0 + 1.0) km = 2000 m
    assert np.isclose(result.error[result.error_valid], 2000.0).all()
    assert result.provenance["error_metadata"]["unit"] == "km"


def test_unsupported_elevation_unit_is_rejected(tmp_path):
    product, _ = _product(tmp_path, error=False)
    changed = replace(product, unit="feet")

    assert changed.is_verified is False
    with pytest.raises(DemMetadataError, match="not verified"):
        DemReader(cache_dir=tmp_path / "cache").read_window(changed, DEM_BOUNDS)


# ---------------------------------------------------------------------------
# 8. Relief and warning validation
# ---------------------------------------------------------------------------


def test_flat_crop_wider_than_10km_fails_relief_guard(tmp_path):
    product, _ = _wide_product(tmp_path, np.full((1200, 1200), 100.0, dtype=np.float32))

    with pytest.raises(DemRangeError, match="P99-P1"):
        DemReader(cache_dir=tmp_path / "cache").read_window(
            product, (0.0, -12000.0, 12000.0, 0.0), width_m=12000.0
        )


def test_flat_wide_short_crop_fails_relief_guard(tmp_path):
    product, _ = _wide_product(tmp_path, np.full((1200, 1200), 100.0, dtype=np.float32))

    # 12 km in x but only 1 km in y: the horizontal-width guard applies.
    with pytest.raises(DemRangeError, match="P99-P1"):
        DemReader(cache_dir=tmp_path / "cache").read_window(
            product, (0.0, -1000.0, 12000.0, 0.0), width_m=12000.0
        )


def test_flat_narrow_tall_crop_is_exempt_from_relief_guard(tmp_path):
    product, _ = _wide_product(tmp_path, np.full((1200, 1200), 100.0, dtype=np.float32))

    # 5 km in x but 12 km in y: no 10 km-wide crop, so no relief check.
    result = DemReader(cache_dir=tmp_path / "cache").read_window(
        product, (0.0, -12000.0, 5000.0, 0.0), width_m=12000.0
    )

    assert result.provenance["crop_width_m"] == pytest.approx(5000.0)
    assert result.provenance["crop_height_m"] == pytest.approx(12000.0)
    assert result.elevation.size > 0


def test_relief_guard_uses_clipped_crop_width_not_requested_width(tmp_path):
    product, _ = _wide_product(tmp_path, np.full((1200, 1200), 100.0, dtype=np.float32))

    # Requested width is 20 km, but the clipped crop is only 5 km wide.
    result = DemReader(cache_dir=tmp_path / "cache").read_window(
        product, (1000.0, -6000.0, 6000.0, -1000.0), width_m=20000.0
    )

    assert result.provenance["crop_width_m"] == pytest.approx(5000.0)
    assert result.elevation.size > 0


def test_wide_crop_with_relief_passes(tmp_path):
    values = np.add.outer(np.arange(1200), np.arange(1200)).astype(np.float32)
    product, _ = _wide_product(tmp_path, values)

    result = DemReader(cache_dir=tmp_path / "cache").read_window(
        product, (0.0, -12000.0, 12000.0, 0.0), width_m=12000.0
    )

    assert result.provenance["crop_width_m"] == pytest.approx(12000.0)
    assert np.percentile(result.elevation[result.valid], 99) > 2000.0


@pytest.mark.parametrize("value", [9000.0, -7000.0])
def test_polar_warning_for_values_outside_nominal_range(tmp_path, value):
    product, transform = _product(tmp_path, error=False)
    _write_raster(
        tmp_path / "dem.tif",
        np.full((ROWS, COLS), value, dtype=np.float32),
        transform=transform,
    )

    with pytest.warns(RuntimeWarning, match="polar DEM crop"):
        DemReader(cache_dir=tmp_path / "cache").read_window(product, DEM_BOUNDS, width_m=5000.0)


@pytest.mark.parametrize("value", [12000.0, -10000.0])
def test_values_outside_supported_range_are_rejected(tmp_path, value):
    product, transform = _product(tmp_path, error=False)
    _write_raster(
        tmp_path / "dem.tif",
        np.full((ROWS, COLS), value, dtype=np.float32),
        transform=transform,
    )

    with pytest.raises(DemRangeError, match="exceed"):
        DemReader(cache_dir=tmp_path / "cache").read_window(product, DEM_BOUNDS, width_m=5000.0)


# ---------------------------------------------------------------------------
# Supporting behaviour
# ---------------------------------------------------------------------------


def test_site_window_reads_aligned_error_grid(tmp_path):
    product, _ = _product(tmp_path)
    transformer = Transformer.from_crs(NATIVE_CRS, LUNAR_SPHERICAL_CRS, always_xy=True)
    lon, lat = transformer.transform(4000.0, -4000.0)

    result = DemReader(cache_dir=tmp_path / "cache").read_site_window(
        product,
        lon_deg=lon,
        lat_deg=lat,
        width_m=5000.0,
        read_error=True,
    )

    assert result.elevation.shape == result.valid.shape
    assert result.error is not None
    assert result.error_valid is not None
    assert result.error.shape == result.elevation.shape
    assert result.resolution_m == (PIXEL_M, PIXEL_M)
    assert result.provenance["scale_applied"] == 1.0
    assert result.provenance["offset_applied"] == 0.0


def test_error_grid_misalignment_is_rejected(tmp_path):
    product, _ = _product(tmp_path)
    _write_raster(
        tmp_path / "dem_ERR.tif",
        np.ones((ROWS, COLS), dtype=np.float32),
        transform=from_origin(1.0, 0.0, PIXEL_M, PIXEL_M),
    )

    with pytest.raises(DemMetadataError, match="not aligned"):
        DemReader(cache_dir=tmp_path / "cache").read_window(
            product, DEM_BOUNDS, width_m=5000.0, read_error=True
        )
