# Owner: Gowri (gate G5) -- diagnostic: how much of the G5 gap is terrain resolution?
"""Recompute LUMEN's multi-year sunlit percentage at a site with the terrain progressively COARSENED, to test whether NASA's map (which is
built from coarser terrain than LUMEN's 10 m / 20 m / 240 m crops) differs because it cannot see near-field relief.

    python scripts/g5_resolution_test.py [site_id]      # writes pipeline/reports/g5_resolution_<site>.json

Variants (same raycaster, same daily-percentage function and day sampling as g5_pixel_comparison.py, 2 m observer, >= 50 % disk):
  * published: 10 m near (0-5 km) + 20 m mid (to 80 km) + 240 m far (to 250 km) -- the published mask's own crops;
  * 20m_all:   the 20 m product for 0-80 km + 240 m beyond (no 10 m near field);
  * 240m_all:  the 240 m product for the whole 250 km (no near or mid field).
"""
from __future__ import annotations

import dataclasses
import datetime as dt
import json
import sys
from pathlib import Path

import numpy as np
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from run_g5 import FIRST_DAY, LAST_DAY
from run_mc_sigma_site import _growth_factor

from lumen_pipeline.catalog import sparklines as S
from lumen_pipeline.common.timeutil import parse_utc
from lumen_pipeline.reference.interp import Ephemeris
from lumen_pipeline.reference.visibility import FiniteSegmentTree, Horizon
from lumen_pipeline.terrain.crops import build_crops
from lumen_pipeline.terrain.dem_io import DemReader, load_products
from lumen_pipeline.terrain.mc_horizon import compute_horizon

ROOT = Path(__file__).resolve().parents[2]


def as_near(crop, max_km: float):
    """Use a crop as the near field from 0 km out to max_km (the crop's own data and resolution are unchanged)."""
    return dataclasses.replace(crop, spec=dataclasses.replace(crop.spec, name="near", min_distance_km=0.0, max_distance_km=max_km))


def main(site_id: str) -> None:
    site = {s["id"]: s for s in yaml.safe_load(S.default_sites_path().read_text(encoding="utf-8"))["sites"]}[site_id]
    lat, lon = site["latitude_deg"], site["longitude_deg_east"]
    eph = Ephemeris.from_file(S.default_ephemeris_path())
    e0 = parse_utc(json.loads(S.default_ephemeris_path().with_suffix(".json").read_text(encoding="utf-8"))["start_utc"])
    days, d = [], parse_utc(FIRST_DAY)
    while d < parse_utc(LAST_DAY):
        days.append(d)
        d += dt.timedelta(days=1)
    days = days[::4]
    meta = json.loads((S.default_terrain_root() / "masks" / f"{site_id}.json").read_text(encoding="utf-8"))
    products = load_products()
    crops = build_crops(site_id, latitude_deg=lat, longitude_deg_east=lon, reader=DemReader(products=products), products=products)
    growth = _growth_factor()
    variants = {
        "published": crops,
        "20m_all": dataclasses.replace(crops, near=as_near(crops.mid, crops.mid.spec.max_distance_km), mid=None),
        "240m_all": dataclasses.replace(crops, near=as_near(crops.far, crops.far.spec.max_distance_km), mid=None, far=None),
    }
    out = {"site_id": site_id, "observer_height_m": 2.0, "day_step": 4, "days_sampled": len(days), "variants": {}}
    for name, c in variants.items():
        hz = compute_horizon(c, latitude_deg=lat, longitude_deg_east=lon, geometric_growth_factor=growth)
        row = np.asarray(hz[1], dtype=float)
        h = Horizon(row, bin_width_deg=meta["bin_width_deg"], slope_deg=None, uphill_azimuth_deg=None, d_min_m=None, observer_height_m=2.0,
                    range_extrema=FiniteSegmentTree.from_elevations(row))
        pct = float(np.mean([S._daily_percentages(eph, lat, lon, h, day, e0)[0] for day in days]))
        res = {"near_source": c.near.source_key, "near_resolution_m": c.near.source_resolution_m, "sunlit_pct": pct,
               "horizon_mean_deg": float(np.nanmean(row)), "horizon_max_deg": float(np.nanmax(row))}
        out["variants"][name] = res
        print(f"[{site_id}] {name:10s} near={res['near_source']} ({res['near_resolution_m']:g} m): sunlit {pct:.1f}%  horizon mean {res['horizon_mean_deg']:.2f} deg", flush=True)
    path = ROOT / "pipeline" / "reports" / f"g5_resolution_{site_id}.json"
    path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {path}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "shackleton_rim_ridge")
