# Owner: Gowri (gate G5) — multi-year average sunlight versus NASA PGDA average-illumination map pixels.
"""Compare LUMEN's multi-year average sunlit percentage with the PGDA average-illumination raster at the same point.

    python scripts/run_g5.py            # writes pipeline/reports/g5_multiyear_vs_pgda.json

LUMEN side: the Python reference engine over the whole published ephemeris (2023-01-01 .. 2030-12-30, hourly nodes), every UTC day, a sample every 2 minutes,
on each site's real 2 m terrain mask, counting the Sun as available when at least 50 percent of its disk is above the horizon (LUMEN's own default).
PGDA side: AVGVISIB_*_201608.TIF (Mazarico et al. 2011, PGDA product 69), the fraction of time illuminated averaged hourly over an 18.6-year nutation cycle, read over
HTTP at the site (centre pixel and the 3 x 3 mean). The two cover different spans (8 years of a ~18.6-year cycle) and PGDA's treatment of the solar disk is not
spelled out on its page, so the report also gives the spread between LUMEN's own calendar years and a second disk definition ("any part of the disk"), as the
explanation of any difference. The criterion "within a few percent" is read as 5 percentage points.
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
from lumen_pipeline.catalog import sparklines as S  # noqa: E402
from lumen_pipeline.common.timeutil import parse_utc  # noqa: E402
from lumen_pipeline.reference.interp import Ephemeris  # noqa: E402
from lumen_pipeline.reference.visibility import FiniteSegmentTree, Horizon, availability  # noqa: E402
from lumen_pipeline.terrain.dem_io import LUNAR_SPHERICAL_CRS  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
TOLERANCE_PCT_POINTS = 5.0
LAYERS = {"65S_240m": "avg_illumination_65S_240m_pgda_69", "85S_60m": "avg_illumination_85S_60m_pgda_69"}
# site -> which PGDA layer covers it (85-90S for the pole sites, 65-90S otherwise)
SITES = {"im2_athena": "65S_240m", "cy3_shiv_shakti": "65S_240m", "shackleton_rim_ridge": "85S_60m", "shackleton_ridge": "85S_60m"}
FIRST_DAY, LAST_DAY = "2023-01-01T00:00:00Z", "2030-12-30T00:00:00Z"


def _horizon(site_id: str, height_m: float = 2.0) -> Horizon:
    root = S.default_terrain_root() / "masks"
    meta = json.loads((root / f"{site_id}.json").read_text(encoding="utf-8"))
    payload = (root / f"{site_id}.bin").read_bytes()
    elevation = np.frombuffer(payload, dtype="<f4", count=4 * 3600, offset=64).reshape(4, 3600)
    row = np.asarray(elevation[meta["heights_m"].index(height_m)], dtype=float)
    return Horizon(row, bin_width_deg=meta["bin_width_deg"], slope_deg=meta.get("slope_deg"), uphill_azimuth_deg=meta.get("uphill_azimuth_deg"),
                   d_min_m=meta.get("d_min_m"), observer_height_m=height_m, range_extrema=FiniteSegmentTree.from_elevations(row))


def _bias_sweep(site_id: str, lat: float, lon: float, eph, e0, days) -> dict[str, float]:
    """How the multi-year sunlit share moves if the whole terrain horizon is off by a constant angle (a way to see whether a DEM bias could explain a gap)."""
    root = S.default_terrain_root() / "masks"
    meta = json.loads((root / f"{site_id}.json").read_text(encoding="utf-8"))
    payload = (root / f"{site_id}.bin").read_bytes()
    base = np.asarray(np.frombuffer(payload, dtype="<f4", count=4 * 3600, offset=64).reshape(4, 3600)[meta["heights_m"].index(2.0)], dtype=float)
    out = {}
    for bias in (-0.5, -0.2, 0.0, 0.2, 0.5):
        row = base + bias
        h = Horizon(row, bin_width_deg=meta["bin_width_deg"], slope_deg=meta.get("slope_deg"), uphill_azimuth_deg=meta.get("uphill_azimuth_deg"),
                    d_min_m=meta.get("d_min_m"), observer_height_m=2.0, range_extrema=FiniteSegmentTree.from_elevations(row))
        out[f"{bias:+.1f}"] = float(np.mean([S._daily_percentages(eph, lat, lon, h, day, e0)[0] for day in days[::8]]))
    return out


def _pgda(url: str, lat: float, lon: float) -> dict:
    with rasterio.open(url) as ds:
        x, y = Transformer.from_crs(LUNAR_SPHERICAL_CRS, ds.crs, always_xy=True).transform(lon, lat)
        row, col = ds.index(x, y)
        raw = ds.read(1, window=rasterio.windows.Window(col - 1, row - 1, 3, 3)).astype("float64")
        raw[raw == ds.nodata] = np.nan
        block = raw * ds.scales[0] + ds.offsets[0]
        return {"centre_pct": float(block[1, 1] * 100), "mean_3x3_pct": float(np.nanmean(block) * 100), "min_3x3_pct": float(np.nanmin(block) * 100),
                "max_3x3_pct": float(np.nanmax(block) * 100), "pixel_size_m": float(abs(ds.transform.a))}


def main() -> None:
    sites = {s["id"]: s for s in yaml.safe_load(S.default_sites_path().read_text(encoding="utf-8"))["sites"]}
    products = yaml.safe_load((ROOT / "pipeline" / "config" / "dem_sources.yaml").read_text(encoding="utf-8"))["regional_layer_products"]
    eph = Ephemeris.from_file(S.default_ephemeris_path())
    e0 = parse_utc(json.loads(S.default_ephemeris_path().with_suffix(".json").read_text(encoding="utf-8"))["start_utc"])
    first, last = parse_utc(FIRST_DAY), parse_utc(LAST_DAY)
    days = []
    d = first
    while d < last:
        days.append(d)
        d += dt.timedelta(days=1)
    rows = []
    for site_id, layer in SITES.items():
        lat, lon = sites[site_id]["latitude_deg"], sites[site_id]["longitude_deg_east"]
        horizon = _horizon(site_id)
        daily = np.array([S._daily_percentages(eph, lat, lon, horizon, day, e0)[0] for day in days], dtype=float)
        # a second definition for the explanation: the Sun counts when ANY part of the disk is above the horizon
        keep = S.SUN_DISK_THRESHOLD
        S.SUN_DISK_THRESHOLD = 0.0001
        any_part = np.array([S._daily_percentages(eph, lat, lon, horizon, day, e0)[0] for day in days[::5]], dtype=float)
        S.SUN_DISK_THRESHOLD = keep
        years = {}
        for day, v in zip(days, daily):
            years.setdefault(day.year, []).append(v)
        yearly = {str(y): float(np.mean(v)) for y, v in years.items()}
        # how much the answer moves with the observer height (the masks exist for 1, 2, 5 and 10 m): a steep crest changes a lot over a few metres
        by_height = {str(h): float(np.mean([S._daily_percentages(eph, lat, lon, _horizon(site_id, h), day, e0)[0] for day in days[::4]])) for h in (1.0, 2.0, 5.0, 10.0)}
        pgda = _pgda(products[LAYERS[layer]]["url"], lat, lon)
        lumen = float(daily.mean())
        rows.append({
            "site_id": site_id, "latitude_deg": lat, "longitude_deg_east": lon, "mask_height_m": 2.0,
            "lumen_multi_year_sunlit_pct": lumen, "lumen_days": len(days), "lumen_yearly_pct": yearly,
            "lumen_yearly_spread_pct_points": float(max(yearly.values()) - min(yearly.values())),
            "lumen_any_part_of_disk_pct": float(any_part.mean()),
            "lumen_by_observer_height_pct": by_height,
            "lumen_by_horizon_bias_deg_pct": _bias_sweep(site_id, lat, lon, eph, e0, days),
            "pgda_layer": LAYERS[layer], "pgda_url": products[LAYERS[layer]]["url"], "pgda": pgda,
            "abs_difference_vs_centre_pct_points": abs(lumen - pgda["centre_pct"]),
            "abs_difference_vs_3x3_mean_pct_points": abs(lumen - pgda["mean_3x3_pct"]),
            "within_tolerance": bool(abs(lumen - pgda["centre_pct"]) <= TOLERANCE_PCT_POINTS),
        })
        print(site_id, f"LUMEN {lumen:.1f}%  (any-part {rows[-1]['lumen_any_part_of_disk_pct']:.1f}%, yearly spread {rows[-1]['lumen_yearly_spread_pct_points']:.1f})  PGDA {pgda['centre_pct']:.1f}% (3x3 {pgda['mean_3x3_pct']:.1f}, {pgda['min_3x3_pct']:.1f}-{pgda['max_3x3_pct']:.1f})")
    report = {
        "gate": "G5", "description": "Multi-year averages versus independent PGDA map pixels", "criterion_pct_points": TOLERANCE_PCT_POINTS,
        "recorded_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "git_commit": subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip(),
        "command": "python pipeline/scripts/run_g5.py", "sites": rows,
        "method": "LUMEN: Python reference engine over 2023-01-01..2030-12-29, every UTC day, 2-minute samples, 2 m terrain mask, Sun available at >=50% disk. PGDA: average-illumination raster read at the site "
        "(fraction of time illuminated, hourly over an 18.6-year nutation cycle). The spans differ (8 of ~18.6 years) and PGDA's disk treatment is not spelled out, so yearly spread and an any-part-of-disk variant are recorded as the explanation of differences.",
    }
    path = ROOT / "pipeline" / "reports" / "g5_multiyear_vs_pgda.json"
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("wrote", path)


if __name__ == "__main__":
    main()
