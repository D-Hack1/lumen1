# Owner: Gowri (gate G5) -- diagnostic: LUMEN vs PGDA pixel by pixel around a site.
"""Compare LUMEN's multi-year sunlit percentage with NASA's average-illumination map at the centres of the 3 x 3 map pixels around a site.

    python scripts/g5_pixel_comparison.py [site_id]      # default shackleton_rim_ridge; writes pipeline/reports/g5_pixels_<site>.json

Why: G5 compares one LUMEN point with one 60 m map pixel. On a steep crest the map's own neighbouring pixels differ by tens of points, so a
single-point comparison cannot tell a terrain error from a location/footprint effect. Here LUMEN is evaluated with exactly the published
mask method (same crop ladder, same raycaster via mc_horizon.compute_horizon, same daily-percentage function run_g5.py uses, 2 m observer,
>= 50 % disk) at the centre of every map pixel in the 3 x 3 block, over every 4th day of 2023-01-01..2030-12-29, and the two fields are
compared pixel by pixel. The site point itself is also re-run and checked against the published mask.
"""
from __future__ import annotations

import datetime as dt
import json
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
import yaml
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from run_g5 import FIRST_DAY, LAST_DAY, LAYERS, SITES, _horizon
from run_mc_sigma_site import _growth_factor, _read_published_mask

from lumen_pipeline.catalog import sparklines as S
from lumen_pipeline.common.timeutil import parse_utc
from lumen_pipeline.reference.interp import Ephemeris
from lumen_pipeline.reference.visibility import FiniteSegmentTree, Horizon
from lumen_pipeline.terrain.crops import build_crops
from lumen_pipeline.terrain.dem_io import LUNAR_SPHERICAL_CRS, DemReader, load_products
from lumen_pipeline.terrain.mc_horizon import compute_horizon

ROOT = Path(__file__).resolve().parents[2]
HEIGHT_INDEX = 1  # 2 m


def main(site_id: str) -> None:
    sites = {s["id"]: s for s in yaml.safe_load(S.default_sites_path().read_text(encoding="utf-8"))["sites"]}
    layers = yaml.safe_load((ROOT / "pipeline" / "config" / "dem_sources.yaml").read_text(encoding="utf-8"))["regional_layer_products"]
    url = layers[LAYERS[SITES[site_id]]]["url"]
    lat0, lon0 = sites[site_id]["latitude_deg"], sites[site_id]["longitude_deg_east"]
    eph = Ephemeris.from_file(S.default_ephemeris_path())
    e0 = parse_utc(json.loads(S.default_ephemeris_path().with_suffix(".json").read_text(encoding="utf-8"))["start_utc"])
    days, d = [], parse_utc(FIRST_DAY)
    while d < parse_utc(LAST_DAY):
        days.append(d)
        d += dt.timedelta(days=1)
    days = days[::4]
    meta = json.loads((S.default_terrain_root() / "masks" / f"{site_id}.json").read_text(encoding="utf-8"))

    with rasterio.open(url) as ds:
        fwd = Transformer.from_crs(LUNAR_SPHERICAL_CRS, ds.crs, always_xy=True)
        inv = Transformer.from_crs(ds.crs, LUNAR_SPHERICAL_CRS, always_xy=True)
        r0, c0 = ds.index(*fwd.transform(lon0, lat0))
        block = ds.read(1, window=rasterio.windows.Window(c0 - 1, r0 - 1, 3, 3)).astype("float64") * ds.scales[0] + ds.offsets[0]
        points = []
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                lon, lat = inv.transform(*ds.xy(r0 + dr, c0 + dc))
                points.append({"dr": dr, "dc": dc, "lat": float(lat), "lon_east": float(lon % 360.0), "pgda_pct": float(block[dr + 1, dc + 1] * 100)})

    products = load_products()
    reader = DemReader(products=products)
    growth = _growth_factor()

    def sunlit(lat: float, lon: float, row: np.ndarray) -> float:
        h = Horizon(row, bin_width_deg=meta["bin_width_deg"], slope_deg=None, uphill_azimuth_deg=None, d_min_m=meta.get("d_min_m"),
                    observer_height_m=2.0, range_extrema=FiniteSegmentTree.from_elevations(row))
        return float(np.mean([S._daily_percentages(eph, lat, lon, h, day, e0)[0] for day in days]))

    # Sanity: the site itself, from the published mask, as G5 does (slope/aspect from the mask's near-zone plane included there).
    site_pct = float(np.mean([S._daily_percentages(eph, lat0, lon0, _horizon(site_id), day, e0)[0] for day in days]))
    print(f"[{site_id}] site (published mask, every 4th day): {site_pct:.1f}%", flush=True)

    # The crops are read ONCE around the site: every map-pixel centre is within ~85 m of it, well inside the 5 / 80 / 250 km crops, and the
    # raycaster, crop restriction and near-field fit all place the observer from the lat/lon they are given (not the crop centre).
    crops = build_crops(site_id, latitude_deg=lat0, longitude_deg_east=lon0, reader=reader, products=products)
    site_hz = compute_horizon(crops, latitude_deg=lat0, longitude_deg_east=lon0, geometric_growth_factor=growth)
    site_vs_published = float(np.nanmax(np.abs(site_hz - _read_published_mask(site_id))))
    print(f"[{site_id}] shared crops reproduce the published mask at the site: max |diff| = {site_vs_published:.6f} deg", flush=True)

    for p in points:
        t0 = time.time()
        hz = compute_horizon(crops, latitude_deg=p["lat"], longitude_deg_east=p["lon_east"], geometric_growth_factor=growth)
        p["lumen_pct"] = sunlit(p["lat"], p["lon_east"], np.asarray(hz[HEIGHT_INDEX], dtype=float))
        p["near_source"] = crops.near.source_key if crops.near else None
        print(f"[{site_id}] pixel ({p['dr']:+d},{p['dc']:+d}) {p['lat']:.4f},{p['lon_east']:.3f}: LUMEN {p['lumen_pct']:.1f}%  PGDA {p['pgda_pct']:.1f}%  "
              f"({time.time() - t0:.0f}s)", flush=True)

    lum = np.array([p["lumen_pct"] for p in points])
    pg = np.array([p["pgda_pct"] for p in points])
    report = {
        "site_id": site_id, "pgda_url": url, "observer_height_m": 2.0, "days_sampled": len(days), "day_step": 4,
        "site_published_mask_pct": site_pct, "site_recomputed_vs_published_mask_max_abs_diff_deg": site_vs_published, "pixels": points,
        "summary": {
            "lumen_mean_pct": float(lum.mean()), "pgda_mean_pct": float(pg.mean()), "mean_abs_diff_pct_points": float(np.abs(lum - pg).mean()),
            "median_signed_diff_pct_points": float(np.median(lum - pg)), "pearson_r": float(np.corrcoef(lum, pg)[0, 1]),
        },
    }
    out = ROOT / "pipeline" / "reports" / f"g5_pixels_{site_id}.json"
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], indent=1))
    print(f"wrote {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "shackleton_rim_ridge")
