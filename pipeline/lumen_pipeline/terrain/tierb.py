"""Tier-B v0.1.0 regional horizon tile serialization and generation."""

from __future__ import annotations

import hashlib
import json
import math
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from pyproj import CRS, Transformer

from .crops import CropSpec, TerrainCrop
from .dem_io import LUNAR_SPHERICAL_CRS, DemProduct, DemReader, DemWindow
from .horizon import raycast_horizon
from .masks import _restrict_crop
from .pad import PadStatisticsUnavailable, fit_ground_plane

CRS_PROJ4 = "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400"
TILE_SIZE_M = 20_000
BIN_DEG = 0.5
BIN_COUNT = 720
HEIGHT_M = 1.0
MASK_SCALE = 0.01
MASK_OFFSET = -10.0
MASK_SENTINEL = np.uint16(65535)
VERSION = "0.1.0"
NEAR_MAX_RANGE_KM = 5.0
FAR_MAX_RANGE_KM = 250.0


class TierBError(RuntimeError):
    """Raised when a Tier-B artifact would violate the frozen contract."""


@dataclass(frozen=True)
class TileSpec:
    origin_x_m: int
    origin_y_m: int
    spacing_m: int

    @property
    def node_count_axis(self) -> int:
        if self.spacing_m not in (2000, 4000):
            raise TierBError("Tier-B spacing must be 2000 or 4000 m")
        return TILE_SIZE_M // self.spacing_m

    @property
    def id(self) -> str:
        return f"s{self.spacing_m}_x{self.origin_x_m:+07d}_y{self.origin_y_m:+07d}"


@dataclass(frozen=True)
class TierBTile:
    spec: TileSpec
    latitude_deg: np.ndarray
    longitude_deg: np.ndarray
    mask_deg: np.ndarray
    slope_deg: np.ndarray
    downhill_aspect_deg: np.ndarray
    z0_m: np.ndarray
    d_min_m: np.ndarray
    provenance: dict[str, Any]


def _git_commit() -> str | None:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _tile_coordinates(spec: TileSpec) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    if spec.origin_x_m % TILE_SIZE_M or spec.origin_y_m % TILE_SIZE_M:
        raise TierBError("tile origins must be 20 km multiples from the pole")
    n = spec.node_count_axis
    x = spec.origin_x_m + np.arange(n, dtype=np.float64) * spec.spacing_m
    y = spec.origin_y_m + np.arange(n, dtype=np.float64) * spec.spacing_m
    xx, yy = np.meshgrid(x, y, indexing="xy")
    to_lonlat = Transformer.from_crs(CRS.from_proj4(CRS_PROJ4), LUNAR_SPHERICAL_CRS, always_xy=True)
    longitude, latitude = to_lonlat.transform(xx.ravel(), yy.ravel())
    # Seam ownership is deterministic: -85 degrees belongs only to the outer zone.
    expected_spacing = np.where(latitude < -85.0, 2000, 4000)
    if not np.all(expected_spacing == spec.spacing_m):
        raise TierBError("tile crosses the -85 degree seam; split it before generation")
    return xx.ravel(), yy.ravel(), np.asarray(latitude), np.asarray(longitude) % 360.0


def _validate_dem(dem: DemWindow) -> None:
    if dem.crs is None or not dem.crs.is_projected:
        raise TierBError("Tier-B requires a projected metre DEM")
    if not np.all(np.isfinite(dem.elevation[dem.valid])):
        raise TierBError("DEM validity mask includes non-finite elevation")
    if dem.provenance.get("vertical_reference_applied") != "height_relative":
        raise TierBError("Tier-B requires normalized height-relative DEM elevations")
    if dem.provenance.get("unit_applied") not in {"m", "metre", "metres", "meter", "meters"}:
        raise TierBError("Tier-B requires a DEM normalized from an explicit metre unit")


def generate_tile(
    spec: TileSpec,
    dem: DemWindow,
    *,
    max_range_km: float = 250.0,
    geometric_growth_factor: float = 1.5,
) -> TierBTile:
    """Generate one tile incrementally from an authentic normalized DEM crop."""
    _validate_dem(dem)
    x, y, latitude, longitude = _tile_coordinates(spec)
    if np.any(x < dem.bounds[0]) or np.any(x > dem.bounds[2]) or np.any(y < dem.bounds[1]) or np.any(y > dem.bounds[3]):
        raise TierBError("tile nodes are outside the supplied DEM crop")
    masks: list[np.ndarray] = []
    slopes: list[float] = []
    aspects: list[float] = []
    z0: list[float] = []
    d_min: list[float] = []
    source_resolution_m = float(min(abs(value) for value in dem.resolution_m))
    for lat, lon in zip(latitude, longitude, strict=True):
        try:
            plane = fit_ground_plane(dem, latitude_deg=float(lat), longitude_deg_east=float(lon))
        except PadStatisticsUnavailable as error:
            raise TierBError(f"node {lat:.6f},{lon:.6f}: {error}") from error
        horizon = raycast_horizon(
            dem,
            latitude_deg=float(lat),
            longitude_deg_east=float(lon),
            observer_heights_m=(HEIGHT_M,),
            bin_width_deg=BIN_DEG,
            max_range_km=max_range_km,
            near_field_pixel_size_m=source_resolution_m,
            geometric_growth_factor=geometric_growth_factor,
            site_elevation_m=plane.z0_m,
        )
        masks.append(horizon.elevation_deg[0])
        slopes.append(plane.slope_deg)
        aspects.append(plane.downhill_aspect_deg)
        z0.append(plane.z0_m)
        d_min.append(horizon.d_min_m)
    return TierBTile(
        spec=spec,
        latitude_deg=np.asarray(latitude, dtype=np.float32),
        longitude_deg=np.asarray(longitude, dtype=np.float32),
        mask_deg=np.asarray(masks, dtype=np.float32),
        slope_deg=np.asarray(slopes, dtype=np.float32),
        downhill_aspect_deg=np.asarray(aspects, dtype=np.float32),
        z0_m=np.asarray(z0, dtype=np.float32),
        d_min_m=np.asarray(d_min, dtype=np.float32),
        provenance={"dem": dem.provenance, "source_resolution_m": source_resolution_m},
    )


def estimated_crop_bytes(spec: TileSpec, resolution_m: float, radius_km: float) -> int:
    """Conservative elevation+valid-array footprint for one bounded source crop."""
    side_m = TILE_SIZE_M + 2.0 * radius_km * 1000.0
    pixels = math.ceil(side_m / resolution_m) ** 2
    return pixels * (np.dtype(np.float32).itemsize + np.dtype(np.bool_).itemsize)


def _validate_transition(near: TerrainCrop, far: TerrainCrop) -> None:
    _validate_dem(near.dem)
    _validate_dem(far.dem)
    if near.dem.crs != far.dem.crs:
        raise TierBError("near and far DEMs must use the same horizontal CRS")
    for field in ("frame", "datum_reference", "vertical_reference_applied"):
        if near.dem.provenance.get(field) != far.dem.provenance.get(field):
            raise TierBError(f"near/far DEM {field} provenance does not match")
    if near.achieved_resolution_m > far.achieved_resolution_m:
        raise TierBError("near DEM must not be coarser than far DEM")


def _merge_horizons(near: np.ndarray, far: np.ndarray) -> np.ndarray:
    if near.shape != (1, BIN_COUNT) or far.shape != near.shape:
        raise TierBError("near/far horizon arrays must both have shape (1, 720)")
    return np.where(np.isfinite(near) & (~np.isfinite(far) | (near >= far)), near, far)


def read_multires_windows(
    spec: TileSpec, reader: DemReader, products: dict[str, DemProduct]
) -> tuple[TerrainCrop, TerrainCrop]:
    """Read bounded PGDA windows for the fixed 20 m / 240 m Tier-B strategy."""
    x, y, _, _ = _tile_coordinates(spec)

    def bounds(radius_km: float) -> tuple[float, float, float, float]:
        halo = radius_km * 1000.0
        return float(x.min() - halo), float(y.min() - halo), float(x.max() + halo), float(y.max() + halo)

    near_product = products["polar_20m_lola_pgda_90"]
    far_product = products["regional_240m_lola_pgda_90"]
    near = TerrainCrop(
        CropSpec("tierb_near", 0.0, NEAR_MAX_RANGE_KM, (near_product.key,), 20.0),
        reader.read_window(near_product, bounds(NEAR_MAX_RANGE_KM), width_m=TILE_SIZE_M + 10_000.0),
        near_product.key,
        near_product.resolution_m,
        near_product.url,
    )
    far = TerrainCrop(
        CropSpec("tierb_far", NEAR_MAX_RANGE_KM, FAR_MAX_RANGE_KM, (far_product.key,), 240.0),
        reader.read_window(far_product, bounds(FAR_MAX_RANGE_KM), width_m=TILE_SIZE_M + 500_000.0),
        far_product.key,
        far_product.resolution_m,
        far_product.url,
    )
    _validate_transition(near, far)
    return near, far


def generate_tile_multires(
    spec: TileSpec,
    near: TerrainCrop,
    far: TerrainCrop,
    *,
    geometric_growth_factor: float = 1.5,
) -> TierBTile:
    """Generate a complete Tier-B tile with 20 m near and 240 m far horizons.

    The near DEM owns [d_min, 5 km]; the far DEM owns (5, 250 km].  This is
    the Tier-A radial masking convention applied without loading a 20 m
    520 km crop. Both source horizons are raycast independently and merged by
    maximum elevation, so no resampling occurs at the transition.
    """
    _validate_transition(near, far)
    _, _, latitude, longitude = _tile_coordinates(spec)
    masks: list[np.ndarray] = []
    slopes: list[float] = []
    aspects: list[float] = []
    z0: list[float] = []
    d_min: list[float] = []
    for lat, lon in zip(latitude, longitude, strict=True):
        try:
            plane = fit_ground_plane(near.dem, latitude_deg=float(lat), longitude_deg_east=float(lon))
        except PadStatisticsUnavailable as error:
            raise TierBError(f"node {lat:.6f},{lon:.6f}: {error}") from error
        near_result = raycast_horizon(
            _restrict_crop(near, latitude_deg=float(lat), longitude_deg=float(lon)),
            latitude_deg=float(lat), longitude_deg_east=float(lon), observer_heights_m=(HEIGHT_M,),
            bin_width_deg=BIN_DEG, max_range_km=NEAR_MAX_RANGE_KM,
            near_field_pixel_size_m=near.achieved_resolution_m,
            geometric_growth_factor=geometric_growth_factor, site_elevation_m=plane.z0_m,
        )
        far_result = raycast_horizon(
            _restrict_crop(far, latitude_deg=float(lat), longitude_deg=float(lon)),
            latitude_deg=float(lat), longitude_deg_east=float(lon), observer_heights_m=(HEIGHT_M,),
            bin_width_deg=BIN_DEG, max_range_km=FAR_MAX_RANGE_KM,
            near_field_pixel_size_m=near.achieved_resolution_m,
            geometric_growth_factor=geometric_growth_factor, site_elevation_m=plane.z0_m,
        )
        elevation = _merge_horizons(near_result.elevation_deg, far_result.elevation_deg)
        if not np.all(np.isfinite(elevation[0])):
            raise TierBError(f"node {lat:.6f},{lon:.6f}: incomplete near/far horizon coverage")
        masks.append(elevation[0])
        slopes.append(plane.slope_deg)
        aspects.append(plane.downhill_aspect_deg)
        z0.append(plane.z0_m)
        d_min.append(near_result.d_min_m)
    return TierBTile(
        spec, np.asarray(latitude, dtype=np.float32), np.asarray(longitude, dtype=np.float32),
        np.asarray(masks, dtype=np.float32), np.asarray(slopes, dtype=np.float32),
        np.asarray(aspects, dtype=np.float32), np.asarray(z0, dtype=np.float32),
        np.asarray(d_min, dtype=np.float32),
        {
            "transition": {"near_km": [0.0, NEAR_MAX_RANGE_KM], "far_km": [NEAR_MAX_RANGE_KM, FAR_MAX_RANGE_KM], "merge": "maximum_horizon"},
            "near_dem": near.dem.provenance, "far_dem": far.dem.provenance,
            "peak_crop_bytes": estimated_crop_bytes(spec, near.achieved_resolution_m, NEAR_MAX_RANGE_KM) + estimated_crop_bytes(spec, far.achieved_resolution_m, FAR_MAX_RANGE_KM),
        },
    )


def _encode_mask(mask_deg: np.ndarray) -> np.ndarray:
    values = np.asarray(mask_deg, dtype=np.float64)
    encoded = np.full(values.shape, MASK_SENTINEL, dtype="<u2")
    finite = np.isfinite(values)
    codes = np.rint((values[finite] - MASK_OFFSET) / MASK_SCALE)
    if np.any(codes < 0) or np.any(codes >= int(MASK_SENTINEL)):
        raise TierBError("horizon mask contains a value outside the v0.1.0 quantization range")
    encoded[finite] = codes.astype("<u2")
    return encoded


def _encode_scaled(values: np.ndarray, *, scale: float, name: str) -> np.ndarray:
    raw = np.rint(np.asarray(values, dtype=np.float64) / scale)
    if not np.isfinite(raw).all() or np.any(raw < 0) or np.any(raw > 65535):
        raise TierBError(f"{name} cannot be represented by uint16 at scale {scale}")
    return raw.astype("<u2")


def _sections(tile: TierBTile) -> tuple[dict[str, dict[str, Any]], bytes]:
    n = tile.latitude_deg.size
    if tile.mask_deg.shape != (n, BIN_COUNT):
        raise TierBError("mask shape must be (n_nodes, 720)")
    arrays = {
        "lat_deg": np.asarray(tile.latitude_deg, dtype="<f4"),
        "lon_deg": np.asarray(tile.longitude_deg, dtype="<f4"),
        "mask": _encode_mask(tile.mask_deg),
        "slope_deg": _encode_scaled(tile.slope_deg, scale=0.01, name="slope_deg"),
        "downhill_aspect_deg": _encode_scaled(tile.downhill_aspect_deg, scale=0.01, name="downhill_aspect_deg"),
        "z0_m": np.asarray(tile.z0_m, dtype="<f4"),
        "d_min_m": np.asarray(tile.d_min_m, dtype="<f4"),
    }
    descriptors: dict[str, dict[str, Any]] = {}
    chunks: list[bytes] = []
    offset = 0
    for name, array in arrays.items():
        blob = array.tobytes(order="C")
        descriptor: dict[str, Any] = {
            "dtype": {"f": "float", "u": "uint"}[array.dtype.kind] + str(array.dtype.itemsize * 8),
            "offset_bytes": offset,
            "byte_length": len(blob),
            "shape": list(array.shape),
        }
        if name == "mask":
            descriptor.update(scale=MASK_SCALE, offset=MASK_OFFSET, unavailable_sentinel=int(MASK_SENTINEL), unit="deg")
        elif name in {"slope_deg", "downhill_aspect_deg"}:
            descriptor.update(scale=0.01, offset=0.0, unit="deg")
        else:
            descriptor["unit"] = "deg" if name in {"lat_deg", "lon_deg"} else "m"
        descriptors[name] = descriptor
        chunks.append(blob)
        offset += len(blob)
    return descriptors, b"".join(chunks)


def write_tile(tile: TierBTile, output_root: Path) -> dict[str, Any]:
    """Atomically write one raw binary tile and its provenance sidecar."""
    root = Path(output_root) / "tierb"
    tiles = root / "tiles"
    tiles.mkdir(parents=True, exist_ok=True)
    sections, payload = _sections(tile)
    binary = tiles / f"{tile.spec.id}.bin"
    temporary = binary.with_suffix(".bin.tmp")
    temporary.write_bytes(payload)
    temporary.replace(binary)
    n = tile.latitude_deg.size
    sidecar = {
        "schema": "tierb_tile_provenance",
        "version": VERSION,
        "producer": "lumen_pipeline.terrain.tierb",
        "git_commit": _git_commit(),
        "tile_id": tile.spec.id,
        "sha256": _sha256(binary),
        "provenance": tile.provenance,
    }
    (tiles / f"{tile.spec.id}.json").write_text(json.dumps(sidecar, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    x, y, latitude, longitude = _tile_coordinates(tile.spec)
    return {
        "id": tile.spec.id,
        "file": f"tiles/{tile.spec.id}.bin",
        "n_nodes": n,
        "spacing_m": tile.spec.spacing_m,
        "bbox_xy_m": [float(x.min()), float(y.min()), float(x.max()), float(y.max())],
        "bbox_deg": {"lat_min": float(latitude.min()), "lat_max": float(latitude.max()), "lon_min": float(longitude.min()), "lon_max": float(longitude.max())},
        "sections": sections,
        "sha256": sidecar["sha256"],
    }


def write_index(entries: list[dict[str, Any]], output_root: Path) -> Path:
    root = Path(output_root) / "tierb"
    root.mkdir(parents=True, exist_ok=True)
    index = {
        "schema": "tierb_index",
        "version": VERSION,
        "producer": "lumen_pipeline.terrain.tierb",
        "git_commit": _git_commit(),
        "crs": CRS_PROJ4,
        "bin_deg": BIN_DEG,
        "height_m": HEIGHT_M,
        "tiles": sorted(entries, key=lambda entry: entry["id"]),
    }
    path = root / "index.json"
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(index, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)
    return path


def read_tile(entry: dict[str, Any], root: Path) -> dict[str, np.ndarray]:
    """Strictly decode a v0.1.0 tile for round-trip validation."""
    payload = (Path(root) / "tierb" / entry["file"]).read_bytes()
    result: dict[str, np.ndarray] = {}
    for name, section in entry["sections"].items():
        dtype = {"float32": "<f4", "uint16": "<u2"}.get(section["dtype"])
        if dtype is None:
            raise TierBError(f"unsupported section dtype: {section['dtype']}")
        offset, length = section["offset_bytes"], section["byte_length"]
        if offset < 0 or length <= 0 or offset + length > len(payload):
            raise TierBError(f"invalid section bounds for {name}")
        array = np.frombuffer(payload, dtype=dtype, count=length // np.dtype(dtype).itemsize, offset=offset)
        if array.nbytes != length or list(array.shape) != [int(np.prod(section["shape"]))]:
            raise TierBError(f"invalid section length for {name}")
        result[name] = array.reshape(section["shape"])
    if result["mask"].shape != (entry["n_nodes"], BIN_COUNT):
        raise TierBError("mask section shape does not match contract")
    return result
