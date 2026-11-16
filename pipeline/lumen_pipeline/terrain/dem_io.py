"""Windowed DEM reads, normalization, validation, and local caching."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import tempfile
import warnings
import zipfile
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
import requests
import yaml
from pyproj import CRS, Transformer
from pyproj.exceptions import CRSError
from rasterio.enums import Resampling
from rasterio.io import DatasetReader
from rasterio.transform import Affine
from rasterio.windows import Window, from_bounds

SPHERE_RADIUS_M = 1_737_400.0
LUNAR_SPHERICAL_CRS = CRS.from_proj4("+proj=longlat +R=1737400 +no_defs")
SUPPORTED_HEIGHT_RANGE_M = (-9500.0, 11000.0)
POLAR_WARNING_RANGE_M = (-6000.0, 8000.0)
CACHE_SCHEMA_VERSION = "2"
REMOTE_SCHEMES = ("http://", "https://")
REMOTE_IDENTITY_TIMEOUT_S = 15.0

_METRE_UNITS = {"m", "metre", "metres", "meter", "meters"}
_KILOMETRE_UNITS = {"km", "kilometre", "kilometres", "kilometer", "kilometers"}
_SUPPORTED_UNITS = _METRE_UNITS | _KILOMETRE_UNITS
_SUPPORTED_VERTICAL_REFERENCES = frozenset({"height_relative", "absolute_radius"})
# Positive allowlist of verification statuses present in
# pipeline/config/dem_sources.yaml.  Unknown, arbitrary, or pending values are
# rejected; availability_status is not an activation signal.
_VERIFIED_VERIFICATION_STATUSES = frozenset({"source_page_and_urls_provided"})


def _is_finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _normalize_unit(unit: Any) -> str | None:
    if not isinstance(unit, str):
        return None
    normalized = unit.strip().lower()
    return normalized if normalized in _SUPPORTED_UNITS else None


def _normalize_vertical_reference(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    return normalized if normalized in _SUPPORTED_VERTICAL_REFERENCES else None


class DemError(RuntimeError):
    """Base class for DEM read and validation failures."""


class DemMetadataError(DemError):
    """Raised when source metadata is missing, unresolved, or inconsistent."""


class DemRangeError(DemError):
    """Raised when normalized DEM values fail the R3 range safeguards."""


@dataclass(frozen=True)
class DemProduct:
    """A registered DEM product and the metadata required to normalize it."""

    key: str
    name: str
    url: str
    resolution_m: float
    latitude_coverage: str | None = None
    error_url: str | None = None
    frame: str | None = None
    datum_reference: str | None = None
    format: str | None = None
    unit: str | None = None
    scale: float | None = None
    offset: float | None = None
    nodata: float | int | None = None
    vertical_reference: str | None = None
    error_unit: str | None = None
    error_scale: float | None = None
    error_offset: float | None = None
    error_nodata: float | int | None = None
    error_vertical_reference: str | None = None
    availability_status: str | None = None
    verification_status: str | None = None
    source_revision: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    @property
    def is_verified(self) -> bool:
        """Return whether every activation-critical value is explicit.

        Activation is fail-closed: the verification status must be on the
        positive registry allowlist, and every normalization value must be
        explicit and valid.  Availability status is intentionally not
        consulted, and no value is inferred from Rasterio defaults.
        """

        url = (self.url or "").strip()
        status = (self.verification_status or "").strip().lower()
        if not url or status not in _VERIFIED_VERIFICATION_STATUSES:
            return False
        if not _is_finite_number(self.resolution_m) or self.resolution_m <= 0:
            return False
        if not _is_finite_number(self.scale) or not _is_finite_number(self.offset):
            return False
        return (
            _normalize_unit(self.unit) is not None
            and self.nodata is not None
            and _normalize_vertical_reference(self.vertical_reference) is not None
        )

    def to_provenance(self) -> dict[str, Any]:
        return {
            "product_key": self.key,
            "name": self.name,
            "source": self.url,
            "error_source": self.error_url,
            "resolution_m": self.resolution_m,
            "latitude_coverage": self.latitude_coverage,
            "frame": self.frame,
            "datum_reference": self.datum_reference,
            "unit": self.unit,
            "scale": self.scale,
            "offset": self.offset,
            "nodata": self.nodata,
            "vertical_reference": self.vertical_reference,
            "error_unit": self.error_unit,
            "error_scale": self.error_scale,
            "error_offset": self.error_offset,
            "error_nodata": self.error_nodata,
            "error_vertical_reference": self.error_vertical_reference,
            "availability_status": self.availability_status,
            "verification_status": self.verification_status,
            "source_revision": self.source_revision,
        }


@dataclass
class DemWindow:
    """Normalized DEM values and the geospatial metadata for one window."""

    elevation: np.ndarray
    valid: np.ndarray
    transform: Affine
    crs: CRS
    bounds: tuple[float, float, float, float]
    resolution_m: tuple[float, float]
    source: str
    provenance: dict[str, Any]
    error: np.ndarray | None = None
    error_valid: np.ndarray | None = None


@dataclass(frozen=True)
class CacheKey:
    """Cache decision for one request, including resolved source identity."""

    key: str | None
    source_identity: dict[str, Any] | None
    error_identity: dict[str, Any] | None
    bypass_reason: str | None = None

    @property
    def cacheable(self) -> bool:
        return self.key is not None


def _default_config_path() -> Path:
    return Path(__file__).resolve().parents[2] / "config" / "dem_sources.yaml"


def _coerce_product(key: str, values: Mapping[str, Any]) -> DemProduct:
    format_metadata = values.get("format_metadata") or {}
    try:
        resolution_m = float(values["resolution_m"])
    except (KeyError, TypeError, ValueError):
        resolution_m = float("nan")
    return DemProduct(
        key=key,
        name=str(values.get("name", key)),
        url=str(values.get("dem_url") or ""),
        resolution_m=resolution_m,
        latitude_coverage=values.get("latitude_coverage"),
        error_url=values.get("error_url") or None,
        frame=values.get("frame"),
        datum_reference=values.get("datum_reference"),
        format=values.get("format"),
        unit=values.get("unit") or format_metadata.get("elevation_unit"),
        scale=values.get("scale"),
        offset=values.get("offset"),
        nodata=values.get("nodata"),
        vertical_reference=values.get("vertical_reference"),
        error_unit=values.get("error_unit"),
        error_scale=values.get("error_scale"),
        error_offset=values.get("error_offset"),
        error_nodata=values.get("error_nodata"),
        error_vertical_reference=values.get("error_vertical_reference"),
        availability_status=values.get("availability_status"),
        verification_status=values.get("verification_status"),
        source_revision=values.get("source_revision"),
        metadata=dict(values),
    )


def load_products(
    config_path: str | os.PathLike[str] | None = None,
    *,
    include_unverified: bool = False,
) -> dict[str, DemProduct]:
    """Load DEM products, excluding unverified products by default."""

    path = Path(config_path) if config_path else _default_config_path()
    with path.open("r", encoding="utf-8") as handle:
        document = yaml.safe_load(handle) or {}
    products: dict[str, DemProduct] = {}
    for key, values in (document.get("products") or {}).items():
        product = _coerce_product(key, values)
        if include_unverified or product.is_verified:
            products[key] = product
    return products


def _is_remote(source: str) -> bool:
    return source.strip().lower().startswith(REMOTE_SCHEMES)


def _source_uri(source: str) -> str:
    source = source.strip()
    if _is_remote(source):
        return f"/vsicurl/{source}"
    return source


def _source_fingerprint(source: str | None) -> dict[str, Any] | None:
    if not source:
        return None
    source = source.strip()
    if _is_remote(source):
        return None
    source_path = Path(source)
    try:
        source_stat = source_path.stat()
    except OSError:
        return None
    return {
        "path": str(source_path.resolve()),
        "size": source_stat.st_size,
        "mtime_ns": source_stat.st_mtime_ns,
    }


def _remote_identity_from_headers(headers: Mapping[str, str], *, ranged: bool) -> dict[str, Any]:
    """Build a cache identity from a real HTTP response, never from URL assumptions."""

    etag = (headers.get("ETag") or "").strip()
    last_modified = (headers.get("Last-Modified") or "").strip()
    content_length: int | None = None
    if ranged:
        content_range = (headers.get("Content-Range") or "").strip()
        match = re.fullmatch(r"bytes\s+\d+-\d+/(\d+|\*)", content_range)
        if match and match.group(1) != "*":
            content_length = int(match.group(1))
    else:
        raw_length = (headers.get("Content-Length") or "").strip()
        if raw_length.isdigit():
            content_length = int(raw_length)
    # Content-Length alone is not a change detector; require a validator.
    if not etag and not last_modified:
        return {}
    identity: dict[str, Any] = {"kind": "remote_http"}
    if etag:
        identity["etag"] = etag
    if last_modified:
        identity["last_modified"] = last_modified
    if content_length is not None:
        identity["content_length"] = content_length
    return identity


def _remote_identity(source: str) -> dict[str, Any] | None:
    """Resolve a remote identity from HEAD, falling back to a one-byte range GET."""

    try:
        head = requests.head(source, allow_redirects=True, timeout=REMOTE_IDENTITY_TIMEOUT_S)
    except requests.RequestException:
        head = None
    if head is not None:
        try:
            if head.ok:
                identity = _remote_identity_from_headers(head.headers, ranged=False)
                if identity:
                    return identity
        finally:
            head.close()
    try:
        with requests.get(
            source,
            headers={"Range": "bytes=0-0"},
            allow_redirects=True,
            stream=True,
            timeout=REMOTE_IDENTITY_TIMEOUT_S,
        ) as ranged:
            if ranged.status_code not in (200, 206):
                return None
            return (
                _remote_identity_from_headers(ranged.headers, ranged=ranged.status_code == 206)
                or None
            )
    except requests.RequestException:
        return None


def _source_identity(source: str | None, revision: str | None = None) -> dict[str, Any] | None:
    """Resolve a stable source identity, or return None when caching is unsafe."""

    if not source:
        return None
    source = source.strip()
    if not source:
        return None
    revision = (revision or "").strip()
    if _is_remote(source):
        if revision:
            return {"kind": "revision", "revision": revision}
        return _remote_identity(source)
    fingerprint = _source_fingerprint(source)
    if fingerprint is None:
        return None
    identity: dict[str, Any] = {"kind": "local", **fingerprint}
    if revision:
        identity["revision"] = revision
    return identity


def _checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _atomic_write(path: Path, writer: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="wb", prefix=f".{path.name}.", suffix=".tmp", dir=path.parent, delete=False
    ) as handle:
        temporary = Path(handle.name)
    try:
        writer(temporary)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _require_metadata(
    product: DemProduct, *, error: bool = False
) -> tuple[str, float, float, Any, str]:
    """Return only explicitly configured metadata, never Rasterio defaults."""

    prefix = "error_" if error else ""
    label = f"{product.key}._ERR" if error else product.key
    unit = _normalize_unit(getattr(product, f"{prefix}unit"))
    scale = getattr(product, f"{prefix}scale")
    offset = getattr(product, f"{prefix}offset")
    nodata = getattr(product, f"{prefix}nodata")
    vertical_reference = _normalize_vertical_reference(
        getattr(product, f"{prefix}vertical_reference")
    )
    if unit is None:
        raise DemMetadataError(f"{label}: explicit elevation unit is required")
    if not _is_finite_number(scale) or not _is_finite_number(offset):
        raise DemMetadataError(f"{label}: explicit scale and offset must be finite")
    if nodata is None or isinstance(nodata, bool) or not isinstance(nodata, (int, float)):
        raise DemMetadataError(f"{label}: explicit nodata is required")
    if isinstance(nodata, float) and math.isinf(nodata):
        raise DemMetadataError(f"{label}: explicit nodata must not be infinite")
    if vertical_reference is None:
        raise DemMetadataError(
            f"{label}: vertical_reference must be height_relative or absolute_radius"
        )
    return unit, float(scale), float(offset), nodata, vertical_reference


def _normalize_values(
    raw: np.ma.MaskedArray,
    *,
    unit: str,
    scale: float,
    offset: float,
    vertical_reference: str,
    nodata: Any,
    subtract_sphere: bool,
) -> tuple[np.ndarray, np.ndarray]:
    mask = np.ma.getmaskarray(raw).copy()
    values = np.asarray(raw.data, dtype=np.float64)
    if isinstance(nodata, float) and math.isnan(nodata):
        mask |= np.isnan(values)
    else:
        mask |= values == float(nodata)
    values = values * scale + offset
    if unit in _KILOMETRE_UNITS:
        values *= 1000.0
    if vertical_reference == "absolute_radius" and subtract_sphere:
        finite = values[~mask & np.isfinite(values)]
        if finite.size == 0:
            raise DemRangeError("absolute-radius source has no finite samples")
        if float(np.median(finite)) < 20_000.0:
            raise DemRangeError("absolute-radius source failed the median-radius trap")
        values -= SPHERE_RADIUS_M
    normalized = values.astype(np.float32)
    valid = ~mask & np.isfinite(normalized)
    return normalized, valid


def _validate_values(values: np.ndarray, valid: np.ndarray, *, crop_width_m: float) -> None:
    """Apply the R3 range and relief guards.

    The 10 km relief threshold applies to the horizontal crop width, matching
    the D-4 unit-trap wording ("over any crop >= 10 km wide").  A tall, narrow
    crop is therefore exempt, while a wide, short crop is checked.
    """

    finite = values[valid]
    if finite.size == 0:
        raise DemRangeError("DEM window contains no valid samples")
    low, high = SUPPORTED_HEIGHT_RANGE_M
    if np.any((finite < low) | (finite > high)):
        raise DemRangeError(f"normalized elevations exceed [{low}, {high}] m")
    if crop_width_m >= 10_000.0:
        p1, p99 = np.percentile(finite, [1, 99])
        if p99 - p1 < 50.0:
            raise DemRangeError("10 km or wider crop has P99-P1 below 50 m")
    warn_low, warn_high = POLAR_WARNING_RANGE_M
    if np.any((finite < warn_low) | (finite > warn_high)):
        warnings.warn(
            "polar DEM crop contains elevations outside [-6000, 8000] m",
            RuntimeWarning,
            stacklevel=3,
        )


def _pixel_window(dataset: DatasetReader, bounds: tuple[float, float, float, float]) -> Window:
    """Convert bounds to an outward-rounded pixel window clipped to the dataset."""

    left, bottom, right, top = (float(value) for value in bounds)
    if not all(math.isfinite(value) for value in (left, bottom, right, top)):
        raise DemError("window bounds must be finite")
    if left >= right or bottom >= top:
        raise DemError("window bounds must be ordered as (left, bottom, right, top)")
    requested = from_bounds(left, bottom, right, top, transform=dataset.transform)
    col_start = max(0, math.floor(requested.col_off))
    row_start = max(0, math.floor(requested.row_off))
    col_end = min(dataset.width, math.ceil(requested.col_off + requested.width))
    row_end = min(dataset.height, math.ceil(requested.row_off + requested.height))
    if col_end <= col_start or row_end <= row_start:
        raise DemError("requested window does not intersect source")
    return Window(col_start, row_start, col_end - col_start, row_end - row_start)


def _cache_key(
    product: DemProduct,
    bounds: tuple[float, float, float, float],
    width_m: float | None,
    read_error: bool,
) -> CacheKey:
    source_identity = _source_identity(product.url, product.source_revision)
    error_identity = None
    if read_error and product.error_url:
        # The product revision describes the DEM source only; validate the
        # uncertainty source independently.
        error_identity = _source_identity(product.error_url)
    if source_identity is None:
        return CacheKey(
            key=None,
            source_identity=None,
            error_identity=error_identity,
            bypass_reason="source_identity_unavailable",
        )
    if read_error and product.error_url and error_identity is None:
        return CacheKey(
            key=None,
            source_identity=source_identity,
            error_identity=None,
            bypass_reason="error_identity_unavailable",
        )
    request = {
        "schema": CACHE_SCHEMA_VERSION,
        "product": {
            "key": product.key,
            "url": product.url,
            "error_url": product.error_url,
            "resolution_m": product.resolution_m,
            "frame": product.frame,
            "datum_reference": product.datum_reference,
            "unit": product.unit,
            "scale": product.scale,
            "offset": product.offset,
            "nodata": product.nodata,
            "vertical_reference": product.vertical_reference,
            "error_unit": product.error_unit,
            "error_scale": product.error_scale,
            "error_offset": product.error_offset,
            "error_nodata": product.error_nodata,
            "error_vertical_reference": product.error_vertical_reference,
            "source_revision": product.source_revision,
        },
        "source_identity": source_identity,
        "error_identity": error_identity,
        "bounds": [round(float(value), 9) for value in bounds],
        "width_m": width_m,
        "read_error": read_error,
    }
    key = hashlib.sha256(
        json.dumps(request, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return CacheKey(
        key=key,
        source_identity=source_identity,
        error_identity=error_identity,
    )


def _cache_paths(cache_dir: Path, key: str) -> tuple[Path, Path]:
    return cache_dir / f"{key}.npz", cache_dir / f"{key}.json"


def _load_cached(cache_dir: Path, key: str) -> DemWindow | None:
    """Load a cache entry only when it is structurally valid for this key."""

    data_path, manifest_path = _cache_paths(cache_dir, key)
    if not data_path.is_file() or not manifest_path.is_file():
        return None
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict):
            return None
        if manifest.get("schema_version") != CACHE_SCHEMA_VERSION:
            return None
        if manifest.get("cache_key") != key:
            return None
        if manifest.get("sha256") != _checksum(data_path):
            return None
        shape = manifest.get("shape")
        if (
            not isinstance(shape, list)
            or len(shape) != 2
            or not all(
                isinstance(value, int) and not isinstance(value, bool) and value > 0
                for value in shape
            )
        ):
            return None
        transform_values = manifest.get("transform")
        if (
            not isinstance(transform_values, list)
            or len(transform_values) != 9
            or not all(_is_finite_number(value) for value in transform_values)
        ):
            return None
        bounds = manifest.get("bounds")
        if (
            not isinstance(bounds, list)
            or len(bounds) != 4
            or not all(_is_finite_number(value) for value in bounds)
        ):
            return None
        resolution = manifest.get("resolution_m")
        if (
            not isinstance(resolution, list)
            or len(resolution) != 2
            or not all(_is_finite_number(value) and value > 0 for value in resolution)
        ):
            return None
        crs_wkt = manifest.get("crs_wkt")
        source = manifest.get("source")
        provenance = manifest.get("provenance")
        if not isinstance(crs_wkt, str) or not isinstance(source, str):
            return None
        if not isinstance(provenance, dict):
            return None
        with np.load(data_path, allow_pickle=False) as data:
            files = set(data.files)
            if "elevation" not in files or "valid" not in files:
                return None
            elevation = np.asarray(data["elevation"])
            valid = np.asarray(data["valid"]).astype(bool)
            error = None
            error_valid = None
            if "error" in files or "error_valid" in files:
                if "error" not in files or "error_valid" not in files:
                    return None
                error = np.asarray(data["error"])
                error_valid = np.asarray(data["error_valid"]).astype(bool)
        expected_shape = tuple(shape)
        if elevation.dtype != np.float32 or elevation.shape != expected_shape:
            return None
        if valid.shape != expected_shape:
            return None
        if error is not None:
            if error.dtype != np.float32 or error.shape != expected_shape:
                return None
            if error_valid is None or error_valid.shape != expected_shape:
                return None
        return DemWindow(
            elevation=elevation,
            valid=valid,
            transform=Affine(*transform_values),
            crs=CRS.from_wkt(crs_wkt),
            bounds=tuple(bounds),
            resolution_m=tuple(resolution),
            source=source,
            provenance=provenance,
            error=error,
            error_valid=error_valid,
        )
    except (OSError, ValueError, TypeError, KeyError, EOFError, zipfile.BadZipFile, CRSError):
        return None


class DemReader:
    """Read and normalize DEM windows with deterministic local caching."""

    def __init__(
        self,
        products: Mapping[str, DemProduct] | None = None,
        cache_dir: str | os.PathLike[str] | None = None,
    ) -> None:
        self.products = dict(products or {})
        self.cache_dir = Path(
            cache_dir
            or os.environ.get(
                "LUMEN_DEM_CACHE",
                Path(__file__).resolve().parents[2] / "cache" / "dem",
            )
        )

    def _product(self, product: DemProduct | str) -> DemProduct:
        if isinstance(product, DemProduct):
            return product
        try:
            return self.products[product]
        except KeyError as exc:
            raise DemError(f"unknown DEM product: {product}") from exc

    def _verified(self, product: DemProduct | str) -> DemProduct:
        selected = self._product(product)
        if not selected.is_verified:
            raise DemMetadataError(f"{selected.key}: product is not verified for activation")
        return selected

    @contextmanager
    def _open(self, source: str) -> Iterator[DatasetReader]:
        # Remote COGs should never trigger a directory listing on open.
        with (
            rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"),
            rasterio.open(_source_uri(source)) as dataset,
        ):
            yield dataset

    def read_window(
        self,
        product: DemProduct | str,
        bounds: tuple[float, float, float, float],
        *,
        width_m: float | None = None,
        read_error: bool = False,
    ) -> DemWindow:
        selected = self._verified(product)
        cache = _cache_key(selected, bounds, width_m, read_error)
        if cache.key is not None:
            cached = _load_cached(self.cache_dir, cache.key)
            if cached is not None:
                cached.provenance["cache_hit"] = True
                return cached
        with self._open(selected.url) as dataset:
            result = self._read_from_dataset(selected, dataset, bounds, width_m, read_error, cache)
        if cache.key is not None:
            self._store_cache(cache, result)
        return result

    def _read_from_dataset(
        self,
        product: DemProduct,
        dataset: DatasetReader,
        bounds: tuple[float, float, float, float],
        width_m: float | None,
        read_error: bool,
        cache: CacheKey,
    ) -> DemWindow:
        window = _pixel_window(dataset, bounds)
        raw = dataset.read(1, window=window, masked=True, resampling=Resampling.nearest)
        unit, scale, offset, nodata, vertical_reference = _require_metadata(product)
        elevation, valid = _normalize_values(
            raw,
            unit=unit,
            scale=scale,
            offset=offset,
            vertical_reference=vertical_reference,
            nodata=nodata,
            subtract_sphere=True,
        )
        transform = dataset.window_transform(window)
        window_bounds = rasterio.transform.array_bounds(
            elevation.shape[0], elevation.shape[1], transform
        )
        crop_width_m = window_bounds[2] - window_bounds[0]
        crop_height_m = window_bounds[3] - window_bounds[1]
        _validate_values(elevation, valid, crop_width_m=crop_width_m)
        error = error_valid = None
        error_metadata: dict[str, Any] | None = None
        if read_error:
            if not product.error_url:
                raise DemMetadataError(f"{product.key}: no _ERR source is registered")
            error, error_valid, error_metadata = self._read_error(
                product, dataset, window, elevation.shape, valid
            )
        provenance = product.to_provenance()
        provenance.update(
            {
                "cache_hit": False,
                "cache_key": cache.key,
                "cacheable": cache.cacheable,
                "cache_bypass_reason": cache.bypass_reason,
                "source_identity": cache.source_identity,
                "error_identity": cache.error_identity,
                "window_bounds": list(window_bounds),
                "requested_bounds": [float(value) for value in bounds],
                "pixel_window": [
                    int(window.col_off),
                    int(window.row_off),
                    int(window.width),
                    int(window.height),
                ],
                "crop_width_m": crop_width_m,
                "crop_height_m": crop_height_m,
                "requested_width_m": width_m,
                "unit_applied": unit,
                "scale_applied": scale,
                "offset_applied": offset,
                "vertical_reference_applied": vertical_reference,
                "nodata_applied": nodata,
                "source_crs": dataset.crs.to_string() if dataset.crs else None,
                "source_bounds": list(dataset.bounds),
                "source_fingerprint": _source_fingerprint(product.url),
                "error_metadata": error_metadata,
            }
        )
        return DemWindow(
            elevation=elevation,
            valid=valid,
            transform=transform,
            crs=dataset.crs,
            bounds=tuple(window_bounds),
            resolution_m=(abs(transform.a), abs(transform.e)),
            source=product.url,
            provenance=provenance,
            error=error,
            error_valid=error_valid,
        )

    def _read_error(
        self,
        product: DemProduct,
        dem_dataset: DatasetReader,
        dem_window: Window,
        expected_shape: tuple[int, int],
        dem_valid: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
        with self._open(product.error_url or "") as error_dataset:
            if (
                error_dataset.crs != dem_dataset.crs
                or error_dataset.transform != dem_dataset.transform
                or error_dataset.width != dem_dataset.width
                or error_dataset.height != dem_dataset.height
            ):
                raise DemMetadataError(f"{product.key}: _ERR grid is not aligned with DEM")
            dem_bounds = rasterio.windows.bounds(dem_window, dem_dataset.transform)
            error_window = _pixel_window(error_dataset, dem_bounds)
            raw = error_dataset.read(
                1, window=error_window, masked=True, resampling=Resampling.nearest
            )
            unit, scale, offset, nodata, vertical_reference = _require_metadata(product, error=True)
            values, valid = _normalize_values(
                raw,
                unit=unit,
                scale=scale,
                offset=offset,
                vertical_reference=vertical_reference,
                nodata=nodata,
                subtract_sphere=False,
            )
            if values.shape != expected_shape:
                raise DemMetadataError(f"{product.key}: _ERR shape does not match DEM")
            valid &= dem_valid
            if np.any(values[valid] < 0):
                raise DemRangeError(f"{product.key}: _ERR contains negative uncertainty")
            metadata = {
                "unit": unit,
                "scale": scale,
                "offset": offset,
                "nodata": nodata,
                "vertical_reference": vertical_reference,
                "sphere_subtracted": False,
            }
            return values, valid, metadata

    def _store_cache(self, cache: CacheKey, result: DemWindow) -> None:
        if cache.key is None:
            return
        key = cache.key
        data_path, manifest_path = _cache_paths(self.cache_dir, key)
        arrays: dict[str, np.ndarray] = {
            "elevation": result.elevation,
            "valid": result.valid.astype(np.uint8),
        }
        if result.error is not None and result.error_valid is not None:
            arrays["error"] = result.error
            arrays["error_valid"] = result.error_valid.astype(np.uint8)

        def write_data(path: Path) -> None:
            with path.open("wb") as handle:
                np.savez_compressed(handle, **arrays)

        _atomic_write(data_path, write_data)
        manifest = {
            "schema_version": CACHE_SCHEMA_VERSION,
            "cache_key": key,
            "sha256": _checksum(data_path),
            "source": result.source,
            "shape": list(result.elevation.shape),
            "bounds": list(result.bounds),
            "resolution_m": list(result.resolution_m),
            "transform": list(result.transform),
            "crs_wkt": result.crs.to_wkt(),
            "source_identity": cache.source_identity,
            "error_identity": cache.error_identity,
            "provenance": result.provenance,
        }

        def write_manifest(path: Path) -> None:
            path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")

        _atomic_write(manifest_path, write_manifest)

    def read_site_window(
        self,
        product: DemProduct | str,
        *,
        lon_deg: float,
        lat_deg: float,
        width_m: float,
        height_m: float | None = None,
        read_error: bool = False,
    ) -> DemWindow:
        """Read a projected window centred on a lunar spherical lon/lat site."""

        if width_m <= 0 or (height_m is not None and height_m <= 0):
            raise ValueError("window dimensions must be positive")
        height_m = height_m or width_m
        selected = self._verified(product)
        with self._open(selected.url) as dataset:
            if dataset.crs is None:
                raise DemMetadataError(f"{selected.key}: source CRS is required")
            transformer = Transformer.from_crs(LUNAR_SPHERICAL_CRS, dataset.crs, always_xy=True)
            x, y = transformer.transform(lon_deg, lat_deg)
            half_width, half_height = width_m / 2.0, height_m / 2.0
            bounds = (x - half_width, y - half_height, x + half_width, y + half_height)
            requested_width = max(width_m, height_m)
            cache = _cache_key(selected, bounds, requested_width, read_error)
            if cache.key is not None:
                cached = _load_cached(self.cache_dir, cache.key)
                if cached is not None:
                    cached.provenance["cache_hit"] = True
                    return cached
            result = self._read_from_dataset(
                selected, dataset, bounds, requested_width, read_error, cache
            )
        if cache.key is not None:
            self._store_cache(cache, result)
        return result


def read_site_window(
    product: DemProduct | str,
    *,
    lon_deg: float,
    lat_deg: float,
    width_m: float,
    height_m: float | None = None,
    read_error: bool = False,
    cache_dir: str | os.PathLike[str] | None = None,
    products: Mapping[str, DemProduct] | None = None,
) -> DemWindow:
    """Convenience wrapper around :class:`DemReader.read_site_window`."""

    return DemReader(products=products, cache_dir=cache_dir).read_site_window(
        product,
        lon_deg=lon_deg,
        lat_deg=lat_deg,
        width_m=width_m,
        height_m=height_m,
        read_error=read_error,
    )
