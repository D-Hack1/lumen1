# Owner: Gowri (gate G6) — pad slope versus NASA PGDA slope rasters.
"""Compare each Tier-A site's published pad slope with the PGDA slope raster value at the same point.

    python scripts/run_g6.py            # writes pipeline/reports/g6_pad_slope_vs_pgda.json

The pad slope (terrain/pad/<site>.json) is the R3 7 x 7 plane fit on the site's near-field DEM. The independent reference is PGDA's own slope
product (LDSM_*), read straight from the archive over HTTP at the site's coordinates (centre pixel and the mean of the surrounding 3 x 3 pixels).
The two do not share a baseline (a 70 m plane fit versus a 20 m or 60 m pixel slope), so a difference is reported, not hidden; the gate's criterion
is "within a few degrees" and is read here as 3 degrees.
"""
from __future__ import annotations

import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import rasterio
import yaml
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lumen_pipeline.terrain.dem_io import LUNAR_SPHERICAL_CRS  # noqa: E402
from lumen_pipeline.terrain.masks import _site, _site_coordinates  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
TOLERANCE_DEG = 3.0
# Site -> the PGDA slope product that covers it and the key that describes it in dem_sources.yaml.
SITES = {
    "im2_athena": "polar_20m_lola_pgda_90",
    "shackleton_rim_ridge": "polar_20m_lola_pgda_90",
    "cy3_shiv_shakti": "polar_60m_lola_pgda_90",
}


def _slope_at(url: str, lat: float, lon: float) -> dict:
    with rasterio.open(url) as ds:
        x, y = Transformer.from_crs(LUNAR_SPHERICAL_CRS, ds.crs, always_xy=True).transform(lon, lat)
        row, col = ds.index(x, y)
        window = rasterio.windows.Window(col - 1, row - 1, 3, 3)
        block = ds.read(1, window=window).astype("float64")  # sites are far from the raster edge; a plain (non-boundless) window works over HTTP
        nodata = ds.nodata
        if nodata is not None and not np.isnan(nodata):
            block[block == nodata] = np.nan
        return {
            "centre_deg": float(block[1, 1]),
            "mean_3x3_deg": float(np.nanmean(block)) if np.isfinite(block).any() else float("nan"),
            "min_3x3_deg": float(np.nanmin(block)) if np.isfinite(block).any() else float("nan"),
            "max_3x3_deg": float(np.nanmax(block)) if np.isfinite(block).any() else float("nan"),
            "pixel_size_m": float(abs(ds.transform.a)),
        }


def main() -> None:
    products = yaml.safe_load((ROOT / "pipeline" / "config" / "dem_sources.yaml").read_text(encoding="utf-8"))["products"]
    rows = []
    for site_id, product_key in SITES.items():
        pad = json.loads((ROOT / "web" / "public" / "data" / "terrain" / "pad" / f"{site_id}.json").read_text(encoding="utf-8"))
        lat, lon = _site_coordinates(site_id, _site(site_id))
        url = products[product_key]["slope_url"]
        ref = _slope_at(url, lat, lon)
        diff = abs(pad["slope_deg"] - ref["centre_deg"])
        rows.append({
            "site_id": site_id, "latitude_deg": lat, "longitude_deg_east": lon,
            "pad_slope_deg": pad["slope_deg"], "pad_dem_source": pad["plane_fit"]["dem_source"],
            "pgda_product": product_key, "pgda_slope_url": url, "pgda": ref,
            "abs_difference_vs_centre_deg": diff,
            "abs_difference_vs_3x3_mean_deg": abs(pad["slope_deg"] - ref["mean_3x3_deg"]),
            "within_tolerance": bool(np.isfinite(diff) and diff <= TOLERANCE_DEG),
        })
        print(site_id, f"pad {pad['slope_deg']:.2f}  pgda {ref['centre_deg']:.2f} (3x3 mean {ref['mean_3x3_deg']:.2f})  diff {diff:.2f}")
    report = {
        "gate": "G6", "description": "Pad slope versus PGDA slope rasters", "criterion_deg": TOLERANCE_DEG,
        "recorded_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "git_commit": subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip(),
        "command": "python pipeline/scripts/run_g6.py", "sites": rows,
        "method": "PGDA slope raster read over HTTP at the site; centre pixel compared with the published pad slope. The baselines differ (70 m plane fit vs 20 m / 60 m pixel slope).",
    }
    path = ROOT / "pipeline" / "reports" / "g6_pad_slope_vs_pgda.json"
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("wrote", path)


if __name__ == "__main__":
    main()
