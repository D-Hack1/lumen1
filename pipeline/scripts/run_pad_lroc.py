# Owner: Shiva Shakthi (terrain) -- pad slope for the coarse-mask sites from LROC NAC DTMs.
"""Pad statistics and dispersion grids for coarse-mask sites from published LROC NAC DTMs.

    python scripts/run_pad_lroc.py [site_id ...]

The coarse masks come from the global 237 m LDEM_128, which cannot resolve a lander pad, so these sites had no pad slope and their
verdict could never judge the slope requirement. LROC publishes NAC stereo DTMs (2-5 m/px) of several landing sites in the PDS
(LRO-L-LROC-5-RDR-V1.0, volume LROLRC_2001; method: Henriksen et al. 2017, Icarus 283, 122-137). Where one covers the site, this script
reads a window of it over HTTP, re-projects it to the same local stereographic metre grid the rest of the terrain code uses (at the DTM's
own resolution), and runs the SAME, unmodified pad code that produced the polar pad files (terrain/pad.py: 7 x 7 px plane fit at the
site, dispersion slope statistics within the project's 250 m radius). Slope uses height differences only, so the DTM's vertical datum
does not enter. A site with no covering DTM, or with missing pixels at the site, is reported and left without a pad file: nothing is
invented. The mask and sigma are NOT changed (they keep the 250 km LDEM_128 terrain).
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from rasterio.crs import CRS
from rasterio.errors import RasterioIOError
from rasterio.warp import Resampling, reproject, transform
from rasterio.windows import from_bounds

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from run_pad import _pad_defaults

from lumen_pipeline.terrain.crops import CropSpec, TerrainCrop, TerrainCrops
from lumen_pipeline.terrain.dem_io import DemWindow
from lumen_pipeline.terrain.dispersion import generate_dispersion, write_dispersion
from lumen_pipeline.terrain.masks import _site, _site_coordinates
from lumen_pipeline.terrain.pad import (
    PadStatisticsUnavailable,
    generate_pad_statistics,
    write_pad_statistics,
)

MOON_R_M = 1_737_400.0
HALF_M = 400.0  # crop half-width: covers the 250 m dispersion radius plus margin
PDS = "https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/DATA/SDP/NAC_DTM"
# site_id -> LROC DTM product name. Each was checked to cover the site (product page min/max lat/lon), see docs/data_sources_terrain.md.
# Blue Ghost (Mare Crisium) and SLIM (Shioli) have no LROC NAC DTM in the PDS at the time of writing, so they are not listed.
DTMS = {
    "apollo_11": "APOLLO11",
    "apollo_12": "APOLLO12",
    "apollo_14": "APOLLO14",
    "apollo_15": "APOLLO15",
    "apollo_16": "APOLLO16",
    "apollo_17": "APOLLO17",
    "change6_apollo_basin": "CHANGE6",
}


def tif_url(name: str) -> str:
    return f"{PDS}/{name}/NAC_DTM_{name}.TIF"


def build_crops(
    ds: rasterio.DatasetReader, site_id: str, name: str, lat: float, lon_east: float
) -> TerrainCrops:
    sphere = CRS.from_proj4(f"+proj=longlat +R={MOON_R_M} +no_defs")
    # The DTM's longitude convention may be 0-360 or -180..180; transform both and keep the one inside the raster.
    xy = None
    for lon in (lon_east, lon_east % 360.0, ((lon_east + 180.0) % 360.0) - 180.0):
        xs, ys = transform(sphere, ds.crs, [lon], [lat])
        if (
            ds.bounds.left <= xs[0] <= ds.bounds.right
            and ds.bounds.bottom <= ys[0] <= ds.bounds.top
        ):
            xy = (xs[0], ys[0])
            break
    if xy is None:
        raise ValueError(f"{site_id}: site ({lat}, {lon_east}) is outside NAC_DTM_{name}")
    pad = (
        2.5 * HALF_M
    )  # generous source window: equirectangular x is stretched away from the true-scale latitude
    win = (
        from_bounds(xy[0] - pad, xy[1] - pad, xy[0] + pad, xy[1] + pad, ds.transform)
        .round_offsets()
        .round_lengths()
    )
    raw = ds.read(1, window=win, boundless=True, fill_value=np.nan).astype("float64")
    raw[(raw < -1e30) | (raw > 1e30)] = np.nan  # PDS label: NoDATA = -3.40282266e+038
    src_transform = ds.window_transform(win)
    pixel = abs(ds.transform.a)
    n = math.ceil(2 * HALF_M / pixel)
    dst_crs = CRS.from_proj4(
        f"+proj=stere +lat_0={lat} +lon_0={lon_east} +R={MOON_R_M} +units=m +no_defs"
    )
    dst_transform = Affine(pixel, 0.0, -n * pixel / 2.0, 0.0, -pixel, n * pixel / 2.0)
    out = np.full((n, n), np.nan, dtype="float64")
    reproject(
        raw,
        out,
        src_transform=src_transform,
        src_crs=ds.crs,
        dst_transform=dst_transform,
        dst_crs=dst_crs,
        resampling=Resampling.bilinear,
        src_nodata=np.nan,
        dst_nodata=np.nan,
    )
    valid = np.isfinite(out)
    c = n // 2
    if not valid[c - 4 : c + 5, c - 4 : c + 5].all():
        raise ValueError(
            f"{site_id}: NAC_DTM_{name} has missing pixels at the site; no pad is computed"
        )
    key = f"lroc_nac_dtm_{name.lower()}"
    window = DemWindow(
        elevation=np.where(valid, out, np.nanmedian(out)),
        valid=valid,
        transform=dst_transform,
        crs=dst_crs,
        bounds=(-n * pixel / 2.0, -n * pixel / 2.0, n * pixel / 2.0, n * pixel / 2.0),
        resolution_m=(pixel, pixel),
        source=key,
        provenance={
            "source_crs": ds.crs.to_wkt(),
            "frame": "MOON_ME",
            "vertical_reference": "height_relative",
            "datum_reference": "1737400 m sphere (PDS label radii)",
            "unit": "m",
            "scale": 1.0,
            "offset": 0.0,
            "nodata": -3.40282266e38,
            "cache_key": None,
            "reprojected_to": dst_crs.to_proj4(),
            "resampling": "bilinear",
            "note": f"LROC NAC DTM {name} (PDS LROLRC_2001); re-projected to a local stereographic metre grid around the site",
        },
    )
    spec = CropSpec(
        name="near",
        min_distance_km=0.0,
        max_distance_km=HALF_M / 1000.0,
        source_keys=(key,),
        preferred_resolution_m=pixel,
    )
    crop = TerrainCrop(
        spec=spec, dem=window, source_key=key, source_resolution_m=pixel, source_url=tif_url(name)
    )
    return TerrainCrops(
        site_id=site_id,
        latitude_deg=lat,
        longitude_deg_east=lon_east,
        near=crop,
        mid=None,
        far=None,
        unavailable={
            "mid": "pad statistics need the near field only",
            "far": "pad statistics need the near field only",
        },
    )


def main(site_ids: tuple[str, ...]) -> None:
    defaults = _pad_defaults()
    env = {
        "GDAL_HTTP_MULTIRANGE": "YES",
        "CPL_VSIL_CURL_CHUNK_SIZE": "1048576",
        "VSI_CACHE": "TRUE",
        "GDAL_HTTP_MAX_RETRY": "3",
    }
    for site_id in site_ids:
        name = DTMS.get(site_id)
        if name is None:
            print(
                f"[{site_id}] SKIPPED: no LROC NAC DTM covers this site; it keeps no pad slope (nothing invented)"
            )
            continue
        lat, lon = _site_coordinates(site_id, _site(site_id))
        try:
            with rasterio.Env(**env), rasterio.open(f"/vsicurl/{tif_url(name)}") as ds:
                crops = build_crops(ds, site_id, name, lat, lon)
            stats = generate_pad_statistics(
                site_id, crops, latitude_deg=lat, longitude_deg_east=lon, **defaults
            )
        except (ValueError, PadStatisticsUnavailable, RasterioIOError) as exc:
            print(f"[{site_id}] BLOCKED: {exc}")
            continue
        path = write_pad_statistics(stats)
        try:
            payload, sidecar = generate_dispersion(
                site_id, crops, latitude_deg=lat, longitude_deg_east=lon
            )
        except PadStatisticsUnavailable as exc:
            print(f"[{site_id}] dispersion BLOCKED: {exc}")
            continue
        dispersion_path = write_dispersion(site_id, payload, sidecar)
        s = stats.slopes
        print(
            f"[{site_id}] pad written to {path}: slope {stats.plane.slope_deg:.2f} deg over {stats.plane.window_m[0]:.0f} m "
            f"(NAC_DTM_{name}, {stats.source_resolution_m:g} m/px); 250 m p50/p95 {s.p50_deg:.1f}/{s.p95_deg:.1f} deg"
            if s
            else ""
        )
        print(
            f"[{site_id}] dispersion written to {dispersion_path}: "
            f"slope {sidecar['slope_deg_min']:.2f}-{sidecar['slope_deg_max']:.2f} deg"
        )


if __name__ == "__main__":
    main(tuple(sys.argv[1:]) or (*DTMS, "blue_ghost_m1", "slim_shioli"))
