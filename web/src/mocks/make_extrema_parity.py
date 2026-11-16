#!/usr/bin/env python3
# Owner: Nived
"""Python -> TypeScript parity fixture for the exact disk-span extrema (R3, G-10 final) and the disk fraction that uses them.
Runs Gowri's REAL reference/visibility.py (Horizon.extrema, disk_fraction) on seeded random masks/spans and records inputs + outputs in
fixtures/extrema_parity.json; engine/__tests__/extrema.parity.test.ts replays them in core/visibility.ts.

    python3 web/src/mocks/make_extrema_parity.py [--pipeline path]
"""
from __future__ import annotations

import argparse
import json
import math
import random
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
ROOT = HERE.parents[3]
OUT = HERE.parents[1] / "engine" / "__tests__" / "fixtures" / "extrema_parity.json"
ap = argparse.ArgumentParser()
ap.add_argument("--pipeline", default=str(ROOT / "pipeline"))
args = ap.parse_args()
sys.path.insert(0, args.pipeline)

import numpy as np  # noqa: E402

from lumen_pipeline.reference.visibility import Horizon, disk_fraction  # noqa: E402

rng = random.Random(20261117)
NAN = float("nan")


def enc(x):
    if isinstance(x, float) and math.isnan(x):
        return "nan"
    if x == math.inf:
        return "inf"
    if x == -math.inf:
        return "-inf"
    return x


def mask(n):
    base = rng.uniform(-6.0, 4.0)  # includes terrain well below the near-zone plane's (negative) angle
    v = [round(base + rng.uniform(-0.4, 0.4), 3) for _ in range(n)]
    for _ in range(rng.choice([0, 1, 2, 3])):  # spikes: a ridge one or two bins wide
        c = rng.randrange(n)
        for k in range(rng.choice([1, 2])):
            v[(c + k) % n] = round(v[(c + k) % n] + rng.uniform(0.3, 3.0), 3)
    if rng.random() < 0.25:  # unavailable bins
        for _ in range(rng.choice([1, 2, 5])):
            v[rng.randrange(n)] = NAN
    if rng.random() < 0.08:
        v = [NAN] * n  # all unavailable
    return v


def near_zone():
    if rng.random() < 0.5:
        return {}
    return {"slope_deg": rng.choice([0.0, 3.0, 10.0, rng.uniform(0, 25)]), "uphill_azimuth_deg": rng.uniform(0, 360), "d_min_m": rng.choice([6.0, 15.0, 45.0]),
            "observer_height_m": rng.choice([0.0, 1.0, 2.0, 10.0])}


def horizon(case):
    return Horizon(np.array(case["mask"], dtype=float), bin_width_deg=case["binWidthDeg"], slope_deg=case.get("nz", {}).get("slope_deg"),
                   uphill_azimuth_deg=case.get("nz", {}).get("uphill_azimuth_deg"), d_min_m=case.get("nz", {}).get("d_min_m"),
                   observer_height_m=case.get("nz", {}).get("observer_height_m", 0.0))


cases = []
SIZES = [(720, 0.5), (360, 1.0), (72, 5.0), (36, 10.0), (4, 90.0), (3600, 0.1)]
for i in range(140):
    n, bw = SIZES[i % len(SIZES)] if i % 12 else (3600, 0.1)
    m = mask(n)
    nz = near_zone()
    c = {"kind": "extrema", "mask": [enc(x) for x in m], "binWidthDeg": bw, "nz": nz}
    centre = rng.choice([0.0, 90.0, 359.99, bw * rng.randrange(n), rng.uniform(-720, 720)])
    half = rng.choice([0.0, 0.05, 0.27, 1.0, bw / 2, bw, 2.5 * bw, 15.0, 90.0, 179.9, 180.0, 200.0, rng.uniform(0, 60)])
    c["centre"], c["half"] = centre, half
    h = horizon({**c, "mask": m})
    lo, hi = h.extrema(centre, half)
    c["expected"] = [enc(float(lo)), enc(float(hi))]
    cases.append(c)

# no mask (smooth Moon) with and without a near-zone plane
for i in range(12):
    nz = near_zone()
    c = {"kind": "smooth", "binWidthDeg": 0.1, "nz": {**nz, "observer_height_m": nz.get("observer_height_m", rng.choice([0.0, 2.0]))}, "centre": rng.uniform(-400, 400), "half": rng.choice([0.0, 0.3, 5.0, 90.0, 180.0, 250.0])}
    h = Horizon(None, bin_width_deg=0.1, slope_deg=c["nz"].get("slope_deg"), uphill_azimuth_deg=c["nz"].get("uphill_azimuth_deg"), d_min_m=c["nz"].get("d_min_m"),
                observer_height_m=c["nz"].get("observer_height_m", 0.0))
    lo, hi = h.extrema(c["centre"], c["half"])
    c["expected"] = [enc(float(lo)), enc(float(hi))]
    cases.append(c)

# disk fraction end to end (uses the extrema short-circuits then the chord rule): masks with ridges near the disk
DIST = {"sun": 149597870.7, "earth": 384400.0}
for i in range(120):
    body = "sun" if i % 2 == 0 else "earth"
    n, bw = (3600, 0.1) if i % 6 == 0 else (720, 0.5)
    m = [x for x in mask(n)]
    m = [x if not (isinstance(x, float) and math.isnan(x)) else 1.0 for x in m]  # the chord rule needs a finite mask
    nz = near_zone()
    c = {"kind": "disk", "body": body, "mask": m, "binWidthDeg": bw, "nz": nz}
    az = rng.uniform(0, 360)
    for j in range(rng.choice([0, 1, 3])):  # a ridge right where the body is
        idx = (int(az / bw) + rng.randrange(-3, 4)) % n
        m[idx] = round(m[idx] + rng.uniform(0.2, 1.5), 3)
    el = float(np.interp(rng.random(), [0, 1], [min(m) - 0.7, max(m) + 0.7]))
    c["mask"] = m
    c["azimuth"], c["elevation"], c["distanceKm"] = round(az, 6), round(el, 6), round(DIST[body] * rng.uniform(0.97, 1.03), 3)
    h = horizon({**c, "mask": m})
    c["expected"] = disk_fraction(body, c["elevation"], c["azimuth"], c["distanceKm"], h)
    cases.append(c)

commit = subprocess.run(["git", "-C", str(ROOT), "log", "-1", "--format=%h", "--", "pipeline/lumen_pipeline/reference/visibility.py"], capture_output=True, text=True).stdout.strip()
OUT.write_text(json.dumps({"version": 1, "source": f"pipeline/lumen_pipeline/reference/visibility.py @ {commit or 'unknown'}", "cases": cases}, separators=(",", ":")) + "\n")
from collections import Counter  # noqa: E402
print(f"wrote {OUT.relative_to(ROOT)}: {len(cases)} cases {dict(Counter(c['kind'] for c in cases))}; {OUT.stat().st_size // 1024} KiB")
