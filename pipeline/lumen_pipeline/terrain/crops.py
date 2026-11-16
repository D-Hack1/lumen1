"""Deterministic multi-resolution terrain crop selection and reads."""

from __future__ import annotations

import math
import re
from collections.abc import Mapping
from dataclasses import dataclass

from pyproj import CRS, Transformer

from .dem_io import (
    LUNAR_SPHERICAL_CRS,
    SPHERE_RADIUS_M,
    DemProduct,
    DemReader,
    DemWindow,
    load_products,
)

_BOUNDARY_TOLERANCE_M = 1.0
_BOUNDARY_MAX_SEGMENT_M = 250.0
_BOUNDARY_MAX_SAMPLES = 16_384
# The transformed boundary is refined until each chord is below 250 m and
# midpoint curvature is below this 1 m conservative envelope.


class CropCoverageError(RuntimeError):
    """Raised when a requested crop has no verified covered source."""

    def __init__(
        self,
        message: str,
        *,
        site_id: str | None = None,
        source_key: str | None = None,
        crop: str | None = None,
        required_region_km: tuple[float, float] | None = None,
        uncovered_region_km: str | None = None,
    ) -> None:
        super().__init__(message)
        self.site_id = site_id
        self.source_key = source_key
        self.crop = crop
        self.required_region_km = required_region_km
        self.uncovered_region_km = uncovered_region_km


@dataclass(frozen=True)
class CropSpec:
    """One deterministic crop interval and its ordered source candidates."""

    name: str
    min_distance_km: float
    max_distance_km: float
    source_keys: tuple[str, ...]
    preferred_resolution_m: float


@dataclass(frozen=True)
class TerrainCrop:
    """A read terrain crop and its actual source provenance."""

    spec: CropSpec
    dem: DemWindow
    source_key: str
    source_resolution_m: float
    source_url: str

    @property
    def achieved_resolution_m(self) -> float:
        return min(abs(value) for value in self.dem.resolution_m)


@dataclass(frozen=True)
class TerrainCrops:
    """Near, mid, and far crops, preserving unavailable intervals explicitly."""

    site_id: str
    latitude_deg: float
    longitude_deg_east: float
    near: TerrainCrop | None
    mid: TerrainCrop | None
    far: TerrainCrop | None
    unavailable: Mapping[str, str]

    def for_distance_km(self, distance_km: float) -> TerrainCrop:
        """Select the crop owning a distance, rejecting unavailable coverage."""

        crops = tuple(crop for crop in (self.near, self.mid, self.far) if crop is not None)
        for index, crop in enumerate(crops):
            upper_inclusive = index == len(crops) - 1
            in_range = crop.spec.min_distance_km <= distance_km and (
                distance_km <= crop.spec.max_distance_km
                if upper_inclusive
                else distance_km < crop.spec.max_distance_km
            )
            if in_range:
                return crop
        raise CropCoverageError(f"no available terrain crop covers {distance_km} km")

    @property
    def near_field_resolution_m(self) -> float:
        if self.near is None:
            raise CropCoverageError("near-field terrain crop is unavailable")
        return self.near.achieved_resolution_m


_CROP_SPECS = (
    CropSpec(
        "near",
        0.0,
        5.0,
        (
            "site_specific_5m_lola_pgda_78",
            "polar_5m_lola_pgda_81",
            "polar_10m_lola_pgda_90",
        ),
        5.0,
    ),
    CropSpec("mid", 5.0, 80.0, ("polar_20m_lola_pgda_90",), 20.0),
    CropSpec("far", 80.0, 250.0, ("regional_240m_lola_pgda_90",), 240.0),
)

_CY3_CROP_SPECS = (
    CropSpec(
        "near",
        0.0,
        5.0,
        # PLAN_FINAL §4.1's full CY-3 near-field source ladder, in order:
        # (1) a verified published DTM of the landing area; (2) the finest
        # LOLA gridded product covering 69.37°S (polar_60m_lola_pgda_90; no
        # 5/10/20/30 m polar product reaches this latitude; see
        # dem_sources.yaml notes); (3) the 60-90S 240 m product, explicitly
        # "guaranteed" by the plan as the near-field fallback of last resort.
        # _select_product tries these strictly in order and only reaches
        # item (3) when both (1) and (2) are unavailable or unverified.
        (
            "chandrayaan3_lroc_vikramsite_dtm",
            "polar_60m_lola_pgda_90",
            "regional_240m_lola_pgda_90",
        ),
        3.0,
    ),
    CropSpec(
        "mid",
        5.0,
        80.0,
        (
            "polar_60m_lola_pgda_90",
            "regional_240m_lola_pgda_90",
        ),
        60.0,
    ),
    CropSpec(
        "far",
        80.0,
        250.0,
        ("regional_240m_lola_pgda_90",),
        240.0,
    ),
)


def _crop_specs(site_id: str) -> tuple[CropSpec, ...]:
    """Return the site-specific ladder without changing the default S-4 ladder."""

    return _CY3_CROP_SPECS if site_id == "cy3_shiv_shakti" else _CROP_SPECS


def _latitude_coverage(value: str | None) -> tuple[float, float] | None:
    if not value:
        return None
    match = re.fullmatch(
        r"\s*(\d+(?:\.\d+)?)S\s*-\s*(\d+(?:\.\d+)?)S\s*",
        value,
    )
    if match is None:
        return None
    first, second = (float(part) for part in match.groups())
    return -max(first, second), -min(first, second)


def _covers(product: DemProduct, latitude_deg: float) -> bool:
    coverage = _latitude_coverage(product.latitude_coverage)
    return coverage is not None and coverage[0] <= latitude_deg <= coverage[1]


def _select_product(
    spec: CropSpec,
    products: Mapping[str, DemProduct],
    latitude_deg: float,
) -> DemProduct:
    for key in spec.source_keys:
        product = products.get(key)
        if product is not None and product.is_verified and _covers(product, latitude_deg):
            return product
    raise CropCoverageError(
        f"{spec.name} crop has no verified source covering latitude {latitude_deg}"
    )


def _radial_coverage(
    dem: DemWindow,
    *,
    latitude_deg: float,
    longitude_deg_east: float,
    region_km: tuple[float, float],
) -> tuple[bool, str]:
    """Check the complete radial annulus against original raster bounds."""

    source_bounds = dem.provenance.get("source_bounds")
    if (
        not isinstance(source_bounds, (list, tuple))
        or len(source_bounds) != 4
        or not all(isinstance(value, (int, float)) for value in source_bounds)
    ):
        return False, "source raster bounds are unavailable"

    if not dem.crs.is_projected:
        return False, "source CRS is not projected in linear ground units"

    # Rasterio CRS does not expose axis_info. Convert it to a PyProj CRS first.
    pyproj_crs = CRS.from_wkt(dem.crs.to_wkt())
    units = {axis.unit_name.lower() for axis in pyproj_crs.axis_info if axis.unit_name}
    if not units or not units <= {"metre", "meter", "metres", "meters"}:
        return False, f"source CRS units are not metres: {sorted(units)}"

    transformer = Transformer.from_crs(
        LUNAR_SPHERICAL_CRS,
        dem.crs,
        always_xy=True,
    )
    left, bottom, right, top = (float(value) for value in source_bounds)
    inner_km, outer_km = region_km
    lat0 = math.radians(latitude_deg)
    lon0 = math.radians(longitude_deg_east)

    def boundary_point(radius_km: float, bearing: float) -> tuple[float, float]:
        angular_distance = radius_km * 1000.0 / SPHERE_RADIUS_M
        sin_lat = math.sin(lat0) * math.cos(angular_distance) + math.cos(lat0) * math.sin(
            angular_distance
        ) * math.cos(bearing)
        lat = math.asin(max(-1.0, min(1.0, sin_lat)))
        lon = lon0 + math.atan2(
            math.sin(bearing) * math.sin(angular_distance) * math.cos(lat0),
            math.cos(angular_distance) - math.sin(lat0) * math.sin(lat),
        )
        return math.degrees(lon), math.degrees(lat)

    def transformed_boundary(
        radius_km: float,
    ) -> list[tuple[float, float]] | None:
        bearings = [2.0 * math.pi * index / 64 for index in range(64)]

        while True:
            longitudes, latitudes = zip(
                *(boundary_point(radius_km, bearing) for bearing in bearings)
            )
            xs, ys = transformer.transform(longitudes, latitudes)
            points = list(zip(bearings, xs, ys))

            mid_bearings = [
                bearing + ((points[(index + 1) % len(points)][0] - bearing) % (2.0 * math.pi)) / 2.0
                for index, (bearing, _, _) in enumerate(points)
            ]
            mid_lons, mid_lats = zip(
                *(boundary_point(radius_km, bearing) for bearing in mid_bearings)
            )
            mid_xs, mid_ys = transformer.transform(mid_lons, mid_lats)
            mids = list(zip(mid_bearings, mid_xs, mid_ys))

            converged = True
            for index, (_, x1, y1) in enumerate(points):
                _, x2, y2 = points[(index + 1) % len(points)]
                _, xm, ym = mids[index]

                segment_length = math.hypot(x2 - x1, y2 - y1)
                dx, dy = x2 - x1, y2 - y1

                if dx == 0.0 and dy == 0.0:
                    deviation = math.hypot(xm - x1, ym - y1)
                else:
                    projection = max(
                        0.0,
                        min(
                            1.0,
                            ((xm - x1) * dx + (ym - y1) * dy) / (dx * dx + dy * dy),
                        ),
                    )
                    deviation = math.hypot(
                        xm - (x1 + projection * dx),
                        ym - (y1 + projection * dy),
                    )

                if segment_length > _BOUNDARY_MAX_SEGMENT_M or deviation > _BOUNDARY_TOLERANCE_M:
                    converged = False

            if converged:
                return [(x, y) for _, x, y in points] + [(x, y) for _, x, y in mids]

            if len(bearings) * 2 > _BOUNDARY_MAX_SAMPLES:
                return None

            bearings = [
                value
                for index, point in enumerate(points)
                for value in (point[0], mid_bearings[index])
            ]

    rings = [outer_km] + ([inner_km] if inner_km > 0.0 else [])
    transformed_rings = [transformed_boundary(radius_km) for radius_km in rings]

    if any(ring is None for ring in transformed_rings):
        return False, "spherical boundary sampling did not converge conservatively"

    margin = _BOUNDARY_TOLERANCE_M
    valid_rings = [ring for ring in transformed_rings if ring is not None]
    outside = [
        (x, y)
        for ring in valid_rings
        for x, y in ring
        if not (left + margin <= x <= right - margin and bottom + margin <= y <= top - margin)
    ]

    if not outside:
        return True, f"complete {inner_km:g}-{outer_km:g} km radial region"

    total_samples = sum(len(ring) for ring in valid_rings)
    if len(outside) == total_samples:
        detail = "no sampled part of the required radial region intersects"
    else:
        detail = (
            "spherical radial boundary is only partially covered "
            f"({len(outside)} of {total_samples} samples outside)"
        )
    return False, detail


def build_crops(
    site_id: str,
    *,
    latitude_deg: float,
    longitude_deg_east: float,
    reader: DemReader,
    products: Mapping[str, DemProduct] | None = None,
    allow_unavailable: bool = True,
) -> TerrainCrops:
    """Read nested crops using ordered, verified source candidates.

    A missing or unverified source is recorded in ``unavailable`` and is never
    replaced by a coarser product. Set ``allow_unavailable=False`` when a
    complete three-crop run is required.
    """

    selected_products = products if products is not None else load_products()
    crops: dict[str, TerrainCrop | None] = {}
    unavailable: dict[str, str] = {}

    for spec in _crop_specs(site_id):
        try:
            product = _select_product(spec, selected_products, latitude_deg)
            dem = reader.read_site_window(
                product,
                lon_deg=longitude_deg_east,
                lat_deg=latitude_deg,
                width_m=2.0 * spec.max_distance_km * 1000.0,
                height_m=2.0 * spec.max_distance_km * 1000.0,
            )
            covered, coverage_detail = _radial_coverage(
                dem,
                latitude_deg=latitude_deg,
                longitude_deg_east=longitude_deg_east,
                region_km=(spec.min_distance_km, spec.max_distance_km),
            )

            if not covered:
                raise CropCoverageError(
                    (
                        f"{site_id}: source {product.key} does not fully cover "
                        f"{spec.name} crop "
                        f"({spec.min_distance_km:g}-{spec.max_distance_km:g} km): "
                        f"{coverage_detail}"
                    ),
                    site_id=site_id,
                    source_key=product.key,
                    crop=spec.name,
                    required_region_km=(
                        spec.min_distance_km,
                        spec.max_distance_km,
                    ),
                    uncovered_region_km=coverage_detail,
                )

            crops[spec.name] = TerrainCrop(
                spec=spec,
                dem=dem,
                source_key=product.key,
                source_resolution_m=product.resolution_m,
                source_url=product.url,
            )

        except (CropCoverageError, OSError, ValueError, RuntimeError) as exc:
            if not allow_unavailable:
                raise
            crops[spec.name] = None
            unavailable[spec.name] = str(exc)

    return TerrainCrops(
        site_id=site_id,
        latitude_deg=latitude_deg,
        longitude_deg_east=longitude_deg_east,
        near=crops["near"],
        mid=crops["mid"],
        far=crops["far"],
        unavailable=unavailable,
    )
