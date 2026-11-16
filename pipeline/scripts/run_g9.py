# Owner: Gowri (gate G9) -- predicted shadows vs a real LROC image.
"""G9: shadows predicted from terrain + LUMEN's Sun, compared with the shadows in an LROC NAC image of the Chandrayaan-3 landing area.

    python scripts/run_g9.py      # writes pipeline/reports/g9_cy3_shadows.json and one PNG per image

Data (all NASA PDS, LRO-L-LROC-5-RDR-V1.0, volume LROLRC_2001, product NAC_DTM_VIKRAMSITE1 -- Henriksen et al. 2017 method):
  * the 3 m/px NAC stereo DTM of the CY-3 landing area (pre-landing, images of 2023-07-03), and
  * the two 3 m orthophotos made from the same stereo images, on EXACTLY the same polar-stereographic grid -- so the photo and the terrain
    are registered by construction (no hand alignment).
Image times and LROC's own incidence angle at the image centre come from the LROC EDR pages (M1442997156LE, M1443025251LE).

Method:
  1. Sun direction at the image mid-time from LUMEN's published ephemeris (reference engine, LT+S, MOON_ME_DE421). As an independent check,
     the Sun elevation at the image centre is compared with 90 deg - LROC's reported incidence angle.
  2. Cast shadows on the DTM: the terrain is resampled into a frame whose x axis runs along the sunlight; a pixel is in shadow when any terrain
     between it and the Sun rises above the line to the Sun's centre (exact line-of-sight test via a running maximum of z + x tan(el)). Lunar
     curvature over the window and the Sun's 0.27 deg radius (penumbra) are not modelled.
  3. Observed shadow: orthophoto pixels darker than 0.35 x the median brightness (fixed in advance; sensitivity at 0.2x and 0.5x reported).
  4. Agreement over the central area (overall accuracy, shadow IoU, precision, recall) and a side-by-side figure for the visual check.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import sys
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.windows import from_bounds
from scipy.ndimage import label, map_coordinates

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lumen_pipeline.catalog import sparklines as S
from lumen_pipeline.common.timeutil import parse_utc
from lumen_pipeline.reference.interp import Ephemeris
from lumen_pipeline.terrain.dem_io import LUNAR_SPHERICAL_CRS

ROOT = Path(__file__).resolve().parents[2]
R_KM = 1737.4
BASE = "https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001"
DTM = f"{BASE}/DATA/SDP/NAC_DTM/VIKRAMSITE1/NAC_DTM_VIKRAMSITE1.TIF"
ORTHO = f"{BASE}/EXTRAS/BROWSE/NAC_DTM/VIKRAMSITE1/NAC_DTM_VIKRAMSITE1_{{img}}_3M.TIF"
SITE = (-69.373, 32.319)  # CY-3 catalogue coordinates (window centre)
TERRAIN_HALF_M = 4800.0  # terrain read around the site (occluders upstream of the evaluated area)
EVAL_HALF_M = 3000.0  # area where shadows are compared
# LROC EDR pages (https://data.lroc.im-ldi.com/lroc/view_lroc/LRO-L-LROC-2-EDR-V1.0/<id>): start/stop time, incidence at the image centre.
IMAGES = {
    "M1442997156": {"start": "2023-07-03T04:18:08Z", "stop": "2023-07-03T04:18:38Z", "lroc_incidence_deg": 73.84, "centre": (-69.27, 32.18)},
    "M1443025251": {"start": "2023-07-03T12:06:23Z", "stop": "2023-07-03T12:06:53Z", "lroc_incidence_deg": 74.65, "centre": (-69.27, 32.18)},
}
ENV = {"GDAL_HTTP_MULTIRANGE": "YES", "CPL_VSIL_CURL_CHUNK_SIZE": "1048576", "VSI_CACHE": "TRUE", "GDAL_HTTP_MAX_RETRY": "3"}


def unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v)


def site_vec(lat: float, lon: float) -> np.ndarray:
    la, lo = math.radians(lat), math.radians(lon)
    return np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])


def sun_dir(eph: Ephemeris, e0: dt.datetime, when: dt.datetime, lat: float, lon: float) -> tuple[np.ndarray, float]:
    """Topocentric unit vector to the Sun's centre (MOON_ME) and its elevation above the local spherical horizontal."""
    et = eph.start_et + (when - e0).total_seconds()
    up = site_vec(lat, lon)
    s = unit(eph.positions_at(et)[0] - R_KM * up)
    return s, math.degrees(math.asin(float(np.dot(s, up))))


DARK_FRACTION_OF_MEDIAN = 0.35  # fixed BEFORE comparing: the orthophoto histogram has no separate shadow mode (it rises steadily from DN ~10
# into the surface mode near DN 110), so a data-driven split (Otsu, valley) is ill-posed; 0.35 x median sits just above the dark tail.
# Sensitivity at 0.2x and 0.5x is reported alongside.


def scores(pred: np.ndarray, obs: np.ndarray) -> dict:
    tp, fp, fn = int((pred & obs).sum()), int((pred & ~obs).sum()), int((~pred & obs).sum())
    n = pred.size
    return {"overall_accuracy": float((pred == obs).mean()), "shadow_iou": tp / max(1, tp + fp + fn), "precision": tp / max(1, tp + fp),
            "recall": tp / max(1, tp + fn), "predicted_shadow_fraction": float(pred.sum() / n), "observed_shadow_fraction": float(obs.sum() / n)}


def objects(pred: np.ndarray, obs: np.ndarray, min_px: int) -> dict:
    """Shadow regions as objects (8-connected). recall: share of observed dark regions >= min_px that overlap a predicted shadow; precision:
    share of predicted shadow regions >= min_px that overlap observed dark. Region size matters because a 3 m DTM cannot resolve the
    smallest craters and boulders, whose shadows are only a few pixels."""
    st = np.ones((3, 3), dtype=bool)
    lo, no = label(obs, structure=st)
    lp, n_p = label(pred, structure=st)
    so = np.bincount(lo.ravel())
    sp = np.bincount(lp.ravel())
    big_o = [i for i in range(1, no + 1) if so[i] >= min_px]
    big_p = [i for i in range(1, n_p + 1) if sp[i] >= min_px]
    hit_o = set(np.unique(lo[pred & (lo > 0)]))
    hit_p = set(np.unique(lp[obs & (lp > 0)]))
    return {"min_region_px": min_px, "min_region_m2": min_px * 9.0, "observed_regions": len(big_o), "predicted_regions": len(big_p),
            "observed_regions_matched": sum(i in hit_o for i in big_o), "predicted_regions_matched": sum(i in hit_p for i in big_p),
            "region_recall": sum(i in hit_o for i in big_o) / max(1, len(big_o)), "region_precision": sum(i in hit_p for i in big_p) / max(1, len(big_p))}


def main() -> None:
    eph = Ephemeris.from_file(S.default_ephemeris_path())
    e0 = parse_utc(json.loads(S.default_ephemeris_path().with_suffix(".json").read_text(encoding="utf-8"))["start_utc"])
    with rasterio.Env(**ENV), rasterio.open(f"/vsicurl/{DTM}") as ds:
        fwd = Transformer.from_crs(LUNAR_SPHERICAL_CRS, ds.crs, always_xy=True)
        Transformer.from_crs(ds.crs, LUNAR_SPHERICAL_CRS, always_xy=True)
        cx, cy = fwd.transform(SITE[1], SITE[0])
        win = from_bounds(cx - TERRAIN_HALF_M, cy - TERRAIN_HALF_M, cx + TERRAIN_HALF_M, cy + TERRAIN_HALF_M, ds.transform).round_offsets().round_lengths()
        z = ds.read(1, window=win).astype("float64")
        tr = ds.window_transform(win)
        z[(z < -1e30) | (z > 1e30)] = np.nan
        px = abs(ds.transform.a)
        dtm_crs = ds.crs.to_proj4()
    n_rows, n_cols = z.shape
    rows, cols = np.mgrid[0:n_rows, 0:n_cols]
    xs = tr.c + (cols + 0.5) * tr.a
    ys = tr.f + (rows + 0.5) * tr.e
    central = (np.abs(xs - cx) <= EVAL_HALF_M) & (np.abs(ys - cy) <= EVAL_HALF_M)

    report = {"gate": "G9", "site": "Chandrayaan-3 landing area (NAC_DTM_VIKRAMSITE1)", "dtm_url": DTM, "dtm_crs": dtm_crs, "pixel_m": px,
              "terrain_window_m": 2 * TERRAIN_HALF_M, "evaluated_window_m": 2 * EVAL_HALF_M, "images": {},
              "not_modelled": ["lunar curvature over the window (< 7 m drop at 9.6 km)", "solar disk radius / penumbra (Sun centre used)"],
              "command": "python pipeline/scripts/run_g9.py"}
    for img, meta in IMAGES.items():
        mid = parse_utc(meta["start"]) + (parse_utc(meta["stop"]) - parse_utc(meta["start"])) / 2
        _, el_centre = sun_dir(eph, e0, mid, *meta["centre"])
        s, el = sun_dir(eph, e0, mid, *SITE)
        # Direction toward the Sun in the map plane: step a tiny distance along the Sun's horizontal direction on the sphere and project.
        up = site_vec(*SITE)
        h = unit(s - np.dot(s, up) * up)
        p2 = unit(up + 1e-5 * h)
        lon2, lat2 = math.degrees(math.atan2(p2[1], p2[0])), math.degrees(math.asin(p2[2]))
        x2, y2 = fwd.transform(lon2, lat2)
        u = unit(np.array([x2 - cx, y2 - cy]))  # map coords (y up), pointing TOWARD the Sun
        # Rotated frame: axis "a" runs WITH the light (away from the Sun), axis "b" across it; both in array (col, row) units.
        a = np.array([-u[0], u[1]])  # array col/row: row axis points down (map y up), so the y component flips
        b = np.array([-a[1], a[0]])
        m = math.ceil(max(n_rows, n_cols) * 1.42)
        ii, jj = np.mgrid[0:m, 0:m]  # ii = rows (across the light), jj = columns (along the light)
        c0 = np.array([(n_cols - 1) / 2, (n_rows - 1) / 2])
        col = c0[0] + (jj - m / 2) * a[0] + (ii - m / 2) * b[0]
        row = c0[1] + (jj - m / 2) * a[1] + (ii - m / 2) * b[1]
        zr = map_coordinates(z, [row, col], order=1, cval=np.nan)
        t = math.tan(math.radians(el))
        g = zr + jj * px * t  # light travels +j: j is shadowed if some j2 < j has z(j2) - z(j) > (j - j2) px tan(el), i.e. g(j2) > g(j)
        g = np.where(np.isfinite(g), g, -np.inf)
        upstream = np.maximum.accumulate(g, axis=1)
        upstream = np.concatenate([np.full((m, 1), -np.inf), upstream[:, :-1]], axis=1)
        shadow_r = (upstream > g).astype("float64")
        # back to the DTM grid
        dc = cols - c0[0]
        dr = rows - c0[1]
        j_back = m / 2 + dc * a[0] + dr * a[1]
        i_back = m / 2 + dc * b[0] + dr * b[1]
        pred = map_coordinates(shadow_r, [i_back, j_back], order=0, cval=0.0) > 0.5

        with rasterio.Env(**ENV), rasterio.open(f"/vsicurl/{ORTHO.format(img=img)}") as od:
            assert od.transform == ds.transform and od.crs == ds.crs, "orthophoto grid differs from the DTM grid"
            dn = od.read(1, window=win).astype("float64")
        valid = central & np.isfinite(z)
        thr = DARK_FRACTION_OF_MEDIAN * float(np.median(dn[valid]))
        obs = dn < thr
        res = {"image_mid_utc": mid.strftime("%Y-%m-%dT%H:%M:%SZ"), "lumen_sun_elevation_at_site_deg": el,
               "sun_check": {"lroc_incidence_at_image_centre_deg": meta["lroc_incidence_deg"], "lroc_sun_elevation_deg": 90 - meta["lroc_incidence_deg"],
                             "lumen_sun_elevation_at_image_centre_deg": el_centre, "difference_deg": el_centre - (90 - meta["lroc_incidence_deg"])},
               "dark_threshold_dn": thr, "median_dn": float(np.median(dn[valid])), "scores": scores(pred[valid], obs[valid]),
               "regions": {f">={k}px": objects(pred & valid, obs & valid, k) for k in (10, 50, 200)},
               "threshold_sensitivity": {f"{k:.2f}x_median": scores(pred[valid], (dn < k * np.median(dn[valid]))[valid]) for k in (0.2, 0.35, 0.5)},
               "orthophoto_url": ORTHO.format(img=img)}
        report["images"][img] = res
        print(img, json.dumps({"sun_el": round(el, 3), "sun_check_diff_deg": round(res["sun_check"]["difference_deg"], 3), "thr": thr, **{k: round(v, 3) for k, v in res["scores"].items()}}), flush=True)
        figure(ROOT / "pipeline" / "reports" / f"g9_cy3_{img}.png", dn, pred, obs, central, img, mid, el)
        res["figure"] = f"pipeline/reports/g9_cy3_{img}.png"
    out = ROOT / "pipeline" / "reports" / "g9_cy3_shadows.json"
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out}")


def figure(path: Path, dn: np.ndarray, pred: np.ndarray, obs: np.ndarray, central: np.ndarray, img: str, mid: dt.datetime, el: float) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    r = np.where(central.any(axis=1))[0]
    c = np.where(central.any(axis=0))[0]
    sl = (slice(r[0], r[-1] + 1), slice(c[0], c[-1] + 1))
    ph, pr, ob = dn[sl], pred[sl], obs[sl]
    agree = np.zeros(ph.shape + (3,))
    agree[pr & ob] = (1, 1, 1)  # shadow in both
    agree[pr & ~ob] = (0.9, 0.3, 0.2)  # predicted only
    agree[~pr & ob] = (0.2, 0.5, 0.95)  # observed only
    fig, ax = plt.subplots(1, 3, figsize=(15, 5.4), dpi=110)
    ax[0].imshow(ph, cmap="gray")
    ax[0].set_title(f"LROC NAC orthophoto {img}\n{mid:%Y-%m-%d %H:%M} UTC")
    ax[1].imshow(np.where(pr, 0.0, 0.8), cmap="gray", vmin=0, vmax=1)
    ax[1].set_title(f"LUMEN predicted cast shadow\n3 m NAC DTM, Sun elevation {el:.2f} deg")
    ax[2].imshow(agree)
    ax[2].set_title("Agreement: white both, red predicted only,\nblue observed only (dark in photo), black lit in both")
    for a in ax:
        a.set_xticks([])
        a.set_yticks([])
    fig.suptitle("G9 -- Chandrayaan-3 landing area, 6 km x 6 km (NASA PDS NAC_DTM_VIKRAMSITE1)", y=0.99)
    fig.tight_layout(rect=(0, 0, 1, 0.93))
    fig.savefig(path)
    plt.close(fig)


if __name__ == "__main__":
    main()
