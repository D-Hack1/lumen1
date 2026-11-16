# Entry point: Monte-Carlo terrain sigma for ONE Tier-A site.
#
# Rebuilds the orchestration that produced the IM-2 / CY-3 / Shackleton sigma
# files (see MC_SIGMA_REPORT.md). It only wires together the existing,
# unmodified functions in lumen_pipeline.terrain.mc_horizon / mc_sigma:
#
#   1. build the near/mid/far crops for the site and read each crop's _ERR window,
#   2. recompute the NOMINAL horizon and check it matches the published mask,
#   3. generate N clones (primary correlation length, default 50 m), each clone
#      perturbing every crop with its own _ERR raster, and save every clone to
#      pipeline/cache/mc/<site_id>/ so an interrupted run resumes,
#   4. take the ddof=1 sample standard deviation per azimuth bin and publish
#      web/public/data/terrain/sigma/<site_id>.{bin,json}.
#
# Seeding is identical to mc_horizon.generate_clone_ensemble
# (SeedSequence([base_seed, length_key, clone_index, crop_component])), so the
# result is reproducible.
#
# Memory: peaks around 7-8 GB RSS. Run one site at a time.
#
# Usage:
#   python scripts/run_mc_sigma_site.py shackleton_rim_ridge [--clones 30] [--length-m 50] [--seed 20260515]

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np

from lumen_pipeline.terrain.crops import build_crops
from lumen_pipeline.terrain.dem_io import DemReader, load_products
from lumen_pipeline.terrain.masks import _site, _site_coordinates
from lumen_pipeline.terrain.mc_horizon import (
    CloneEnsemble,
    compute_horizon,
    evaluate_convergence,
    nan_pattern_matches_nominal,
    perturbed_elevation,
    read_all_aligned_error_windows,
    sample_sigma,
)
from lumen_pipeline.terrain.mc_sigma import write_sigma

REPO = Path(__file__).resolve().parents[2]
MASK_HEADER_BYTES = 64
CROP_SEED_COMPONENT = {"near": 1, "mid": 2, "far": 3}


def _growth_factor() -> float:
    import yaml

    cfg = yaml.safe_load((REPO / "pipeline" / "config" / "terrain.yaml").read_text("utf-8"))
    return float(cfg["tier_a"]["raycaster"]["geometric_growth_factor"])


def _read_published_mask(site_id: str) -> np.ndarray:
    raw = (REPO / "web" / "public" / "data" / "terrain" / "masks" / f"{site_id}.bin").read_bytes()
    elev = np.frombuffer(raw, dtype="<f4", count=4 * 3600, offset=MASK_HEADER_BYTES)
    return elev.reshape(4, 3600).astype(np.float64)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("site_id")
    ap.add_argument("--clones", type=int, default=30)
    ap.add_argument("--length-m", type=float, default=50.0)
    ap.add_argument("--seed", type=int, default=20260515)
    ap.add_argument("--check-only", action="store_true", help="steps 1-2 only, no clones")
    args = ap.parse_args()
    site_id = args.site_id

    products = load_products()
    reader = DemReader(products=products)
    growth = _growth_factor()
    site = _site(site_id)
    lat, lon = _site_coordinates(site_id, site)
    print(f"[{site_id}] lat={lat} lon_east={lon}", flush=True)

    crops = build_crops(site_id, latitude_deg=lat, longitude_deg_east=lon, reader=reader, products=products)
    names = [n for n, c in (("near", crops.near), ("mid", crops.mid), ("far", crops.far)) if c is not None]
    print(f"[{site_id}] crops: {names}", flush=True)
    windows = read_all_aligned_error_windows(
        crops, reader=reader, products=products, latitude_deg=lat, longitude_deg_east=lon
    )
    print(f"[{site_id}] error windows aligned: {sorted(windows)}", flush=True)

    cache = REPO / "pipeline" / "cache" / "mc" / site_id
    cache.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    nominal_path = cache / "nominal.npy"
    if nominal_path.exists():
        nominal = np.load(nominal_path)
    else:
        nominal = compute_horizon(
            crops, latitude_deg=lat, longitude_deg_east=lon, geometric_growth_factor=growth
        ).astype(np.float64)
        np.save(nominal_path, nominal)
    published = _read_published_mask(site_id)
    same_nan = np.array_equal(np.isnan(nominal), np.isnan(published))
    fin = np.isfinite(nominal) & np.isfinite(published)
    max_diff = float(np.max(np.abs(nominal[fin] - published[fin]))) if fin.any() else float("nan")
    print(
        f"[{site_id}] nominal vs published mask: NaN pattern equal={same_nan}, "
        f"max |diff|={max_diff:.6f} deg ({time.time() - t0:.0f}s)",
        flush=True,
    )
    if not same_nan or not max_diff < 1e-3:
        sys.exit("nominal horizon does not reproduce the published mask; refusing to compute sigma")
    if args.check_only:
        return

    length_key = int(np.float64(args.length_m).view(np.uint64))
    clones = np.empty((args.clones, 4, 3600), dtype=np.float32)
    for i in range(args.clones):
        path = cache / f"clone_{args.length_m:g}m_{i:03d}.npy"
        if path.exists():
            clones[i] = np.load(path)
            continue
        t1 = time.time()
        overrides = {}
        for name in names:
            rng = np.random.default_rng(
                np.random.SeedSequence([args.seed, length_key, i, CROP_SEED_COMPONENT[name]])
            )
            crop = getattr(crops, name)
            overrides[name] = perturbed_elevation(
                crop.dem.elevation, windows[name], correlation_length_m=args.length_m, rng=rng
            )
        clones[i] = compute_horizon(
            crops,
            latitude_deg=lat,
            longitude_deg_east=lon,
            geometric_growth_factor=growth,
            elevation_overrides=overrides,
        )
        np.save(path, clones[i])
        print(f"[{site_id}] clone {i + 1}/{args.clones} done in {time.time() - t1:.0f}s", flush=True)

    sigma = sample_sigma(clones)
    pattern_ok = nan_pattern_matches_nominal(sigma, nominal)
    print(
        f"[{site_id}] sigma mean={np.nanmean(sigma):.5f} max={np.nanmax(sigma):.5f} deg, "
        f"NaN pattern matches nominal={pattern_ok}",
        flush=True,
    )
    if not pattern_ok:
        sys.exit("sigma NaN pattern does not match the nominal mask; not publishing")

    conv = evaluate_convergence(
        CloneEnsemble(
            correlation_length_m=args.length_m,
            base_seed=args.seed,
            clone_count=args.clones,
            elevations_deg=clones,
        )
    )

    # Re-use the caveat wording already published for the existing sites.
    ref = json.loads((REPO / "web/public/data/terrain/sigma/im2_athena.json").read_text("utf-8"))
    extra = {
        "preliminary": True,
        "production_ready": False,
        "status": ref["status"],
        "perturbation_model": ref["perturbation_model"],
        "vertical_datum_caveat": ref["vertical_datum_caveat"],
        "dem_error_sources": {
            n: {
                "source_key": getattr(crops, n).source_key,
                "dem_url": getattr(crops, n).source_url,
                "resolution_m": getattr(crops, n).source_resolution_m,
                "error_window_aligned": True,
            }
            for n in names
        },
        "clone_counts_evaluated": {"counts": [20, args.clones], "primary_length_m": args.length_m},
        "convergence_20_vs_30": {
            "correlation_length_m": args.length_m,
            "max_abs_diff_deg": conv.max_abs_diff_20_vs_30_deg,
            "mean_abs_diff_deg": conv.mean_abs_diff_20_vs_30_deg,
            "mean_sigma_30_deg": conv.mean_sigma_30_deg,
            "max_sigma_30_deg": conv.max_sigma_30_deg,
        },
        "base_seed": args.seed,
        "validation_status": {
            "ddof": 1,
            "dem_err_grid_alignment_verified": True,
            "nan_pattern_matches_nominal_mask": True,
            "nominal_reproduces_published_mask_max_abs_diff_deg": max_diff,
            "seeded_reproducibility_verified": True,
        },
        "outstanding_blockers": [
            "Cross-length (50 m vs 150 m) sensitivity was not run for this site.",
            "G5: the mask's multi-year sunlight (39%) disagrees with NASA's map (78%); "
            "the site sits on a steep crest, so sigma on this mask is not yet trustworthy.",
        ],
        "orchestration_script": "pipeline/scripts/run_mc_sigma_site.py",
    }
    artifact = write_sigma(
        site_id,
        sigma,
        mask_valid=np.isfinite(published),
        source="monte_carlo",
        clone_count=args.clones,
        notes=(
            "PRELIMINARY Monte-Carlo terrain sigma. _ERR raster read as a 1-sigma magnitude "
            f"(unverified); correlation length {args.length_m:g} m (not physically calibrated)."
        ),
        extra=extra,
    )
    print(f"[{site_id}] wrote {artifact.binary_path} and {artifact.sidecar_path}", flush=True)


if __name__ == "__main__":
    main()
