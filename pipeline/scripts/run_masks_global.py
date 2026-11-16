# Owner: Shiva Shakthi (terrain) — added by Ebin so the non-polar catalogue sites get a terrain mask.
"""Terrain masks for sites OUTSIDE the south-polar DEM products, from NASA's global LOLA elevation model.

    python scripts/run_masks_global.py [site_id ...]

The polar PGDA products only reach 60 S, so Apollo, SLIM, Chang'e-6 and Blue Ghost had no terrain. NASA's Planetary Data System publishes the global
LOLA gridded elevation model LDEM_128 (128 pixels per degree, 236.9 m at the equator, simple-cylindrical, height relative to the 1,737.4 km sphere). This script
reads a window of it around each site straight from the archive (HTTP range reads), re-projects it onto a local stereographic metre grid, and gives it to the SAME
Tier-A raycaster and near-field plane fit that the polar sites use, so the mask format, heights (1, 2, 5, 10 m), 0.1 degree bins and 250 km range are identical.

What is different, and is recorded in each mask's sidecar: the terrain is ~237 m per pixel everywhere (no 5 m near field), so horizons close to the site are smoothed and
sunrise/sunset times are approximate. The app labels these masks "coarse". Nothing here is invented; a window that is missing data stops the site.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import rasterio
import yaml
from affine import Affine
from rasterio.crs import CRS
from rasterio.warp import Resampling, reproject

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lumen_pipeline.terrain.crops import CropSpec, TerrainCrop, TerrainCrops
from lumen_pipeline.terrain.dem_io import DemWindow
from lumen_pipeline.terrain.masks import (
    NearFieldUnavailable,
    _site,
    _site_coordinates,
    generate_tier_a_mask,
)
from lumen_pipeline.terrain.summaries import write_terrain_summary

LBL_URL = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_128.lbl"
SOURCE_KEY = "lola_gdr_ldem_128_pds"
PPD = 128
RANGE_KM = 250.0
HALF_KM = 262.0  # a little beyond the 250 km ray range, so edge pixels exist for the last ray steps
MOON_R_M = 1_737_400.0
KM_PER_DEG = 2 * math.pi * MOON_R_M / 1000.0 / 360.0
DEFAULT_SITE_IDS = (
    "apollo_11", "apollo_12", "apollo_14", "apollo_15", "apollo_16", "apollo_17", "slim_shioli", "change6_apollo_basin", "blue_ghost_m1",
)


def _growth_factor() -> float:
    config = yaml.safe_load((Path(__file__).resolve().parents[1] / "config" / "terrain.yaml").read_text(encoding="utf-8"))
    return float(config["tier_a"]["raycaster"]["geometric_growth_factor"])


def _read_window(ds: rasterio.DatasetReader, lat: float, lon_east: float) -> tuple[np.ndarray, Affine, CRS]:
    """Heights (m, NaN for no data) in the source's own simple-cylindrical grid around the site, wrapping across the 0/360 meridian."""
    half_lat = HALF_KM / KM_PER_DEG
    far_lat = min(89.0, abs(lat) + half_lat)  # the window is widest (in degrees of longitude) at its poleward edge
    half_lon = min(170.0, half_lat / max(0.05, math.cos(math.radians(far_lat))) * 1.02)
    width, height = ds.width, ds.height
    r0 = math.floor((90.0 - (lat + half_lat)) * PPD)
    r1 = math.ceil((90.0 - (lat - half_lat)) * PPD)
    c0 = math.floor((lon_east - half_lon) * PPD)
    c1 = math.ceil((lon_east + half_lon) * PPD)
    if r0 < 0 or r1 > height:
        raise ValueError("the window reaches a pole; use the polar products for this site")
    pieces = []
    if c0 < 0:
        pieces.append(ds.read(1, window=((r0, r1), (c0 + width, width))))
        pieces.append(ds.read(1, window=((r0, r1), (0, c1))))
    elif c1 > width:
        pieces.append(ds.read(1, window=((r0, r1), (c0, width))))
        pieces.append(ds.read(1, window=((r0, r1), (0, c1 - width))))
    else:
        pieces.append(ds.read(1, window=((r0, r1), (c0, c1))))
    raw = np.concatenate(pieces, axis=1).astype("float64")
    raw[raw == ds.nodata] = np.nan
    heights = raw * ds.scales[0]  # offset == the reference radius, so this IS the height above the 1,737.4 km sphere
    # Describe the window in a simple-cylindrical grid centred on the SITE longitude, so columns west of the 0/360 meridian continue smoothly (x is linear in longitude).
    metres_per_pixel = MOON_R_M * math.pi / 180.0 / PPD
    src_crs = CRS.from_proj4(f"+proj=eqc +lat_ts=0 +lat_0=0 +lon_0={lon_east} +R={MOON_R_M} +units=m +no_defs")
    x0 = MOON_R_M * math.radians(c0 / PPD - lon_east)
    y0 = MOON_R_M * math.radians(90.0 - r0 / PPD)
    return heights, Affine(metres_per_pixel, 0.0, x0, 0.0, -metres_per_pixel, y0), src_crs


def build_crops(ds: rasterio.DatasetReader, site_id: str, lat: float, lon_east: float) -> TerrainCrops:
    heights, src_transform, src_crs = _read_window(ds, lat, lon_east)
    if not np.isfinite(heights).all():
        raise ValueError(f"{site_id}: the elevation window has {int((~np.isfinite(heights)).sum())} missing pixels")
    pixel = abs(ds.transform.a)
    n = math.ceil(2 * HALF_KM * 1000.0 / pixel)
    dst_crs = CRS.from_proj4(f"+proj=stere +lat_0={lat} +lon_0={lon_east} +R={MOON_R_M} +units=m +no_defs")
    dst_transform = Affine(pixel, 0.0, -n * pixel / 2.0, 0.0, -pixel, n * pixel / 2.0)
    out = np.full((n, n), np.nan, dtype="float64")
    reproject(heights, out, src_transform=src_transform, src_crs=src_crs, dst_transform=dst_transform, dst_crs=dst_crs, resampling=Resampling.bilinear,
              src_nodata=np.nan, dst_nodata=np.nan)
    valid = np.isfinite(out)
    yy, xx = np.indices(out.shape)
    radius_km = np.hypot(xx - n / 2.0 + 0.5, yy - n / 2.0 + 0.5) * pixel / 1000.0
    # Pixels the source window did not reach may only lie beyond the ray range (the square grid's far corners); anything missing inside it stops the site.
    if (~valid & (radius_km <= RANGE_KM + 5.0)).any():
        raise ValueError(f"{site_id}: {int((~valid & (radius_km <= RANGE_KM + 5.0)).sum())} pixels inside the 250 km ray range were not filled from the source window")
    out = np.where(valid, out, np.nanmedian(out))  # only pixels beyond the ray range; they are never sampled
    window = DemWindow(
        elevation=out, valid=np.ones_like(valid, dtype=bool), transform=dst_transform, crs=dst_crs,
        bounds=(-n * pixel / 2.0, -n * pixel / 2.0, n * pixel / 2.0, n * pixel / 2.0), resolution_m=(pixel, pixel), source=SOURCE_KEY,
        provenance={
            "source_crs": ds.crs.to_wkt() if ds.crs else None, "frame": "MOON_ME", "vertical_reference": "height_relative", "datum_reference": "1737400 m reference sphere",
            "unit": "m", "scale": float(ds.scales[0]), "offset": float(ds.offsets[0]), "nodata": float(ds.nodata) if ds.nodata is not None else None,
            "cache_key": None, "reprojected_to": dst_crs.to_proj4(), "resampling": "bilinear",
            "note": "NASA PDS LOLA GDR LDEM_128 (simple cylindrical, 128 ppd); re-projected to a local stereographic metre grid around the site",
        },
    )
    spec = CropSpec(name="near", min_distance_km=0.0, max_distance_km=RANGE_KM, source_keys=(SOURCE_KEY,), preferred_resolution_m=pixel)
    crop = TerrainCrop(spec=spec, dem=window, source_key=SOURCE_KEY, source_resolution_m=pixel, source_url=LBL_URL)
    return TerrainCrops(
        site_id=site_id, latitude_deg=lat, longitude_deg_east=lon_east, near=crop, mid=None, far=None,
        unavailable={"mid": "one global elevation model covers the whole 250 km range", "far": "one global elevation model covers the whole 250 km range"},
    )


def main(site_ids: tuple[str, ...] = DEFAULT_SITE_IDS) -> None:
    growth = _growth_factor()
    # Big range-read chunks: the global file is row-major, so a 2,200-row window is otherwise thousands of tiny requests.
    with rasterio.Env(GDAL_HTTP_MULTIRANGE="YES", CPL_VSIL_CURL_CHUNK_SIZE="1048576", VSI_CACHE="TRUE", VSI_CACHE_SIZE="200000000", GDAL_HTTP_MAX_RETRY="3"), rasterio.open(LBL_URL) as ds:
        for site_id in site_ids:
            lat, lon = _site_coordinates(site_id, _site(site_id))
            try:
                print(f"[{site_id}] reading the elevation window ...", flush=True)
                crops = build_crops(ds, site_id, lat, lon)
                artifact = generate_tier_a_mask(site_id, crops, geometric_growth_factor=growth)
            except (ValueError, NearFieldUnavailable) as exc:
                print(f"[{site_id}] BLOCKED: {type(exc).__name__}: {exc}")
                continue
            m = artifact.metadata
            print(f"[{site_id}] mask written ({m['dem_source']}, {m['near_field_resolution_m']:.0f} m/px, near-zone slope {m['slope_deg']:.2f} deg, horizon {m['global_min_deg'][1]:.2f}..{m['global_max_deg'][1]:.2f} deg at 2 m)")
            write_terrain_summary(site_id, crops, mask=artifact)


if __name__ == "__main__":
    main(tuple(sys.argv[1:]) or DEFAULT_SITE_IDS)
