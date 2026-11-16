# Entry point: ASSUMED-ERROR Monte-Carlo terrain sigma for ONE coarse-mask site (LDEM_128, ~237 m/px).
#
# NASA publishes NO per-pixel error raster for the global LDEM_128 model these masks are built from (checked: PDS LOLA GDR
# cylindrical/img and float_img hold only ldem_128.img/.lbl/.xml; PGDA products 78 and 90 cover only the south pole, 60 S to pole).
# So the per-pixel _ERR scaling used for the fine-terrain sites is impossible here. Instead this script perturbs the DEM with a
# CONSTANT 1-sigma elevation error (--error-m, default 1.0 m) and runs the same clone/raycast/ddof=1 machinery as run_mc_sigma_site.py.
#
# This is an ASSUMPTION, not a measurement, and the sidecar says so ("error_model": "assumed_uniform"). The 1.0 m default is LOLA's
# commonly quoted absolute vertical accuracy (~1 m; 10 cm precision), cited as "Mazarico et al. 2013" in secondary text; the primary
# paper and LDEM_128's own accuracy were NOT read. The user (project owner) explicitly approved this approach, overriding the earlier
# "no uniform sigma" rule.
#
# Usage:  python scripts/run_mc_sigma_coarse.py apollo_11 [--clones 30] [--length-m 50] [--error-m 1.0] [--seed 20260515]
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import rasterio
import run_masks_global as G
from run_mc_sigma_site import CROP_SEED_COMPONENT, REPO, _growth_factor, _read_published_mask

from lumen_pipeline.terrain.masks import _site, _site_coordinates
from lumen_pipeline.terrain.mc_horizon import (
    CloneEnsemble,
    CropErrorWindow,
    compute_horizon,
    evaluate_convergence,
    nan_pattern_matches_nominal,
    perturbed_elevation,
    sample_sigma,
)
from lumen_pipeline.terrain.mc_sigma import write_sigma


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("site_id")
    ap.add_argument("--clones", type=int, default=30)
    ap.add_argument("--length-m", type=float, default=50.0)
    ap.add_argument("--error-m", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=20260515)
    ap.add_argument("--mask-tol-deg", type=float, default=1e-3, help="max allowed |recomputed nominal - published mask|; the actual value is recorded in the sidecar")
    args = ap.parse_args()
    site_id = args.site_id
    if site_id not in G.DEFAULT_SITE_IDS:
        sys.exit(f"{site_id} is not a coarse-mask site: {G.DEFAULT_SITE_IDS}")
    if not args.error_m > 0:
        sys.exit("--error-m must be positive")

    growth = _growth_factor()
    lat, lon = _site_coordinates(site_id, _site(site_id))
    print(f"[{site_id}] lat={lat} lon_east={lon}", flush=True)
    with rasterio.Env(GDAL_HTTP_MULTIRANGE="YES", CPL_VSIL_CURL_CHUNK_SIZE="1048576", VSI_CACHE="TRUE", VSI_CACHE_SIZE="200000000", GDAL_HTTP_MAX_RETRY="3"), rasterio.open(G.LBL_URL) as ds:
        crops = G.build_crops(ds, site_id, lat, lon)

    crop = crops.near
    shape = crop.dem.elevation.shape
    window = CropErrorWindow(
        crop_name="near", error_m=np.full(shape, args.error_m), error_valid=np.ones(shape, dtype=bool),
        dem_url=G.LBL_URL, error_url="none published: constant assumed 1-sigma error", resolution_m=float(crop.source_resolution_m), fraction_valid=1.0,
    )

    cache = REPO / "pipeline" / "cache" / "mc" / site_id
    cache.mkdir(parents=True, exist_ok=True)
    nominal_path = cache / "nominal.npy"
    nominal = np.load(nominal_path) if nominal_path.exists() else compute_horizon(crops, latitude_deg=lat, longitude_deg_east=lon, geometric_growth_factor=growth).astype(np.float64)
    np.save(nominal_path, nominal)
    published = _read_published_mask(site_id)
    same_nan = np.array_equal(np.isnan(nominal), np.isnan(published))
    fin = np.isfinite(nominal) & np.isfinite(published)
    max_diff = float(np.max(np.abs(nominal[fin] - published[fin]))) if fin.any() else float("nan")
    print(f"[{site_id}] nominal vs published mask: NaN equal={same_nan}, max |diff|={max_diff:.6f} deg", flush=True)
    if not same_nan or not max_diff < args.mask_tol_deg:
        sys.exit("nominal horizon does not reproduce the published mask; refusing to compute sigma")

    tag = f"{args.length_m:g}m_{args.error_m:g}e"
    length_key = int(np.float64(args.length_m).view(np.uint64))
    clones = np.empty((args.clones, 4, 3600), dtype=np.float32)
    for i in range(args.clones):
        path = cache / f"assumed_clone_{tag}_{i:03d}.npy"
        if path.exists():
            clones[i] = np.load(path)
            continue
        t1 = time.time()
        rng = np.random.default_rng(np.random.SeedSequence([args.seed, length_key, i, CROP_SEED_COMPONENT["near"]]))
        pert = perturbed_elevation(crop.dem.elevation, window, correlation_length_m=args.length_m, rng=rng)
        clones[i] = compute_horizon(crops, latitude_deg=lat, longitude_deg_east=lon, geometric_growth_factor=growth, elevation_overrides={"near": pert})
        np.save(path, clones[i])
        print(f"[{site_id}] clone {i + 1}/{args.clones} in {time.time() - t1:.0f}s", flush=True)

    sigma = sample_sigma(clones)
    if not nan_pattern_matches_nominal(sigma, nominal):
        sys.exit("sigma NaN pattern does not match the nominal mask; not publishing")
    print(f"[{site_id}] sigma mean={np.nanmean(sigma):.5f} max={np.nanmax(sigma):.5f} deg", flush=True)
    conv = evaluate_convergence(CloneEnsemble(correlation_length_m=args.length_m, base_seed=args.seed, clone_count=args.clones, elevations_deg=clones))

    extra = {
        "preliminary": True,
        "production_ready": False,
        "status": "PRELIMINARY -- ASSUMED-ERROR sigma, not a measured uncertainty; see error_model",
        "error_model": "assumed_uniform",
        "assumed_error_m": args.error_m,
        "error_model_basis": (
            "No per-pixel error raster is published for LDEM_128 (PDS LOLA GDR cylindrical/img + float_img contain only .img/.lbl/.xml; "
            "PGDA products 78 and 90 cover only 60S-pole). The DEM was therefore perturbed by a CONSTANT 1-sigma elevation error of "
            f"{args.error_m:g} m, taken from LOLA's commonly quoted ~1 m absolute vertical accuracy (cited as Mazarico et al. 2013 in secondary text; "
            "the primary paper and LDEM_128's own accuracy were NOT read). The error is assumed Gaussian, 1-sigma, and uniform over the window."
        ),
        "perturbation_model": {
            "kind": "spatially_correlated_gaussian_field",
            "construction": "white noise smoothed by a Gaussian kernel, renormalized to unit variance, scaled by the constant assumed error",
            "selected_length_m": args.length_m,
            "selected_length_is_physically_calibrated": False,
            "note": f"The correlation length ({args.length_m:g} m) is below the {crop.source_resolution_m:.0f} m pixel size, so the field is effectively uncorrelated between pixels.",
            "base_seed": args.seed,
        },
        "dem_source": {"source_key": G.SOURCE_KEY, "url": G.LBL_URL, "resolution_m": float(crop.source_resolution_m)},
        "convergence_20_vs_30": {
            "correlation_length_m": args.length_m,
            "max_abs_diff_deg": conv.max_abs_diff_20_vs_30_deg,
            "mean_abs_diff_deg": conv.mean_abs_diff_20_vs_30_deg,
            "mean_sigma_30_deg": conv.mean_sigma_30_deg,
            "max_sigma_30_deg": conv.max_sigma_30_deg,
        },
        "validation_status": {
            "ddof": 1,
            "nan_pattern_matches_nominal_mask": True,
            "nominal_reproduces_published_mask_max_abs_diff_deg": max_diff,
            "note": "Re-running the production mask generator on the current DEM window reproduces this nominal exactly, but not the published mask bit for bit (difference above). Sigma is a spread, so this small nominal offset is not expected to matter; the published mask was not regenerated.",
        },
        "vertical_datum_caveat": "The vertical datum of LDEM_128 relative to the 1,737,400 m sphere follows its PDS label (OFFSET=1737400); sigma is a spread statistic and is unaffected by a constant offset.",
        "orchestration_script": "pipeline/scripts/run_mc_sigma_coarse.py",
    }
    artifact = write_sigma(
        site_id, sigma, mask_valid=np.isfinite(published), source="monte_carlo", clone_count=args.clones,
        notes=f"PRELIMINARY ASSUMED-ERROR Monte-Carlo: constant {args.error_m:g} m 1-sigma DEM error (no error raster exists for LDEM_128); not a measured uncertainty.",
        extra=extra,
    )
    print(f"[{site_id}] wrote {artifact.binary_path}", flush=True)


if __name__ == "__main__":
    main()
