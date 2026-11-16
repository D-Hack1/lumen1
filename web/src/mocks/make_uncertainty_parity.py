#!/usr/bin/env python3
# Owner: Nived
"""Cross-language parity fixture for the uncertainty reference (G4, N-6).

Runs Gowri's REAL Python (pipeline/lumen_pipeline/reference/uncertainty.py) on seeded synthetic cases and records inputs and
outputs as JSON. The TypeScript tests (engine/__tests__/uncertainty.parity.test.ts) replay the same inputs and must reproduce the
same outputs, so CI needs no Python. Geometry is closed-form in both languages (no ephemeris), so the comparison isolates the
uncertainty maths. Regenerate after any change to uncertainty.py:

    python3 web/src/mocks/make_uncertainty_parity.py [--pipeline path/to/pipeline]
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
OUT = HERE.parents[1] / "engine" / "__tests__" / "fixtures" / "uncertainty_parity.json"

ap = argparse.ArgumentParser()
ap.add_argument("--pipeline", default=str(HERE.parents[3] / "pipeline"), help="directory that contains lumen_pipeline/")
args = ap.parse_args()
sys.path.insert(0, args.pipeline)

import numpy as np  # noqa: E402

from lumen_pipeline.reference.events import Event, detect_events  # noqa: E402
from lumen_pipeline.reference.uncertainty import (  # noqa: E402
    exact_event_uncertainty,
    fast_event_uncertainty,
    limb_offset_deg,
    numeric_bounds,
    shift_horizon_mask,
    three_pass_bounds,
    total_clearance_rate_deg_per_hour,
)
from lumen_pipeline.reference.visibility import Horizon  # noqa: E402

rng = random.Random(20261114)
BIN = 1.0  # 360 bins keeps the fixture small; the bin-boundary logic is identical to 0.1 deg bins


def mask(name: str) -> list[float]:
    if name == "ridge":  # smooth ridge line plus a narrow spike (like the real masks)
        v = [1.5 + 1.2 * math.sin(math.radians(i * BIN) * 3) + 0.4 * math.sin(math.radians(i * BIN) * 11) for i in range(360)]
        v[137] += 3.0
        return v
    if name == "wall":  # step edges exactly at bin boundaries: the one-sided-stencil stress case
        return [0.5 if (i // 20) % 2 == 0 else 6.0 for i in range(360)]
    return [0.0] * 360


MASKS = {n: mask(n) for n in ("ridge", "wall", "flat")}


def horizon(case: dict) -> Horizon:
    h = case["horizon"]
    return Horizon(
        np.array(MASKS[h["mask"]]), bin_width_deg=BIN, slope_deg=h.get("slopeDeg"), uphill_azimuth_deg=h.get("uphillAzDeg"),
        d_min_m=h.get("dMinM"), observer_height_m=h.get("observerHeightM", 0.0),
    )


def geometry(g: dict):
    # elevation(t) = e0 + e1*t + e2*sin(w*t + p)   azimuth(t) = a0 + a1*t     (t in seconds, degrees)
    return lambda t: (g["e0"] + g["e1"] * t + g["e2"] * math.sin(g["w"] * t + g["p"]), g["a0"] + g["a1"] * t)


def sigma_fn(s: dict):
    return lambda az: s["s0"] + s["s1"] * abs(math.sin(math.radians(az)))


def num(x):
    """JSON-safe: infinities become the strings 'inf' / '-inf'."""
    return ("inf" if x > 0 else "-inf") if isinstance(x, float) and math.isinf(x) else x


def rand_geom(az_rate_range=(-0.02, 0.02), a0=None):
    return {
        "e0": rng.uniform(-1.0, 4.0), "e1": rng.uniform(-0.002, 0.002), "e2": rng.uniform(0.0, 0.3), "w": rng.uniform(0.0, 2e-3), "p": rng.uniform(0, 6.28),
        "a0": rng.uniform(0, 360) if a0 is None else a0, "a1": rng.uniform(*az_rate_range),
    }


cases: list[dict] = []

# ---- clearance rate: smooth interior, then deliberately straddling a bin boundary (one-sided stencil), with/without a bracket
for i in range(24):
    name = rng.choice(["ridge", "wall", "flat"])
    near_boundary = i >= 8
    # a bin boundary lies at az = (k + 0.5) * BIN; put the event within +-0.6 deg of one, and make the stencil (+-120 s) cross it
    k = rng.randrange(360)
    a_event = ((k + 0.5) * BIN + rng.uniform(-0.6, 0.6)) % 360 if near_boundary else rng.uniform(0, 360)
    rate = rng.choice([-0.01, -0.004, 0.004, 0.01]) if near_boundary else rng.uniform(-0.003, 0.003)
    g = rand_geom()
    g["a1"] = rate
    g["a0"] = (a_event - rate * 100.0) % 360  # so azimuth at t = 100 s is a_event
    c = {
        "kind": "rate", "horizon": {"mask": name, "slopeDeg": 6.0 if i % 5 == 0 else None, "uphillAzDeg": 120.0 if i % 5 == 0 else None, "dMinM": 15.0 if i % 5 == 0 else None, "observerHeightM": 1.0},
        "geom": g, "eventSeconds": 100.0, "limbOffsetDeg": rng.choice([0.0, 0.2665, -0.2665]),
        "bracket": [95.0, 100.0] if i % 3 == 1 else ([100.0, 106.0] if i % 3 == 2 else None),
    }
    c["expected"] = total_clearance_rate_deg_per_hour(
        c["eventSeconds"], geometry(g), horizon(c), limb_offset_deg=c["limbOffsetDeg"], bracketing_interval=tuple(c["bracket"]) if c["bracket"] else None
    )
    cases.append(c)

# ---- limb offset
for df, r in [(0.0, 0.2665), (0.5, 0.2665), (1.0, 0.2665), (0.0, 0.95), (1.0, 0.0), (0.5, 0.0)]:
    cases.append({"kind": "limb", "diskFraction": df, "angularRadiusDeg": r, "expected": limb_offset_deg(df, r)})

# ---- fast event uncertainty (incl. grazing by rate and by the 12 h dt limit)
for i in range(20):
    name = rng.choice(["ridge", "wall", "flat"])
    g = rand_geom()
    if i % 4 == 0:
        g.update({"e1": 0.0, "e2": 0.0, "a1": 0.0})  # exactly zero rate => infinite delta t, grazing "rate"
    elif i % 4 == 1:
        g.update({"e1": 1e-6, "a1": 0.0, "e2": 0.0})  # tiny rate => grazing
    elif i % 4 == 2:
        g.update({"e1": 2e-6, "a1": 0.0, "e2": 0.0})  # 0.0072 deg/h: above the 0.005 rate floor, but sigma/rate > 12 h => "dt_limit"
    c = {
        "kind": "fast", "horizon": {"mask": name, "observerHeightM": 2.0}, "geom": g, "eventSeconds": 50.0,
        "sigma": {"s0": 0.5, "s1": 0.0} if i % 4 == 2 else {"s0": rng.choice([0.05, 0.1, 0.2, 0.5]), "s1": rng.choice([0.0, 0.1])},
        "diskFraction": rng.choice([0.0, 0.5, 1.0]), "angularRadiusDeg": rng.choice([0.2665, 0.95, 0.0]),
        "bracket": [45.0, 50.0] if i % 2 else None,
    }
    u = fast_event_uncertainty(
        c["eventSeconds"], geometry(g), horizon(c), sigma_fn(c["sigma"]), disk_fraction=c["diskFraction"], angular_radius_deg=c["angularRadiusDeg"],
        bracketing_interval=tuple(c["bracket"]) if c["bracket"] else None,
    )
    c["expected"] = {"deltaTSeconds": num(u.delta_t_seconds), "rateDegPerHour": u.clearance_rate_deg_per_hour, "dtMethod": u.dt_method, "grazingReason": u.grazing_reason}
    cases.append(c)

# ---- the 12 h dt_limit boundary, fast path: rate fixed at 0.0072 deg/h (above the 0.005 floor), sigma = rate * hours => delta t = hours
for hours in (11.0, 11.9, 12.1, 13.0, 20.0):
    g = {"e0": 3.0, "e1": 2e-6, "e2": 0.0, "w": 0.0, "p": 0.0, "a0": 40.0, "a1": 0.0}
    c = {"kind": "fast", "horizon": {"mask": "flat", "observerHeightM": 2.0}, "geom": g, "eventSeconds": 50.0, "sigma": {"s0": 0.0072 * hours, "s1": 0.0},
         "diskFraction": 0.5, "angularRadiusDeg": 0.0, "bracket": None, "boundaryHours": hours}
    u = fast_event_uncertainty(c["eventSeconds"], geometry(g), horizon(c), sigma_fn(c["sigma"]), disk_fraction=0.5, angular_radius_deg=0.0)
    c["expected"] = {"deltaTSeconds": num(u.delta_t_seconds), "rateDegPerHour": u.clearance_rate_deg_per_hour, "dtMethod": u.dt_method, "grazingReason": u.grazing_reason}
    cases.append(c)

# ---- shift + three-pass + numeric bounds (the near-zone plane must NOT be shifted)
for i in range(8):
    name = rng.choice(["ridge", "wall"])
    sig_scalar = rng.choice([0.1, 0.25, 0.6])
    c = {"kind": "shift", "horizon": {"mask": name, "slopeDeg": 7.0, "uphillAzDeg": 200.0, "dMinM": 15.0, "observerHeightM": 1.0}, "sigma": sig_scalar, "probeAzimuths": [0.0, 17.3, 90.0, 137.5, 250.0, 359.9]}
    h = horizon(c)
    up = shift_horizon_mask(h, sig_scalar, direction=1)
    dn = shift_horizon_mask(h, sig_scalar, direction=-1)
    c["expected"] = {
        "up": [up.elevation_at(a) for a in c["probeAzimuths"]], "down": [dn.elevation_at(a) for a in c["probeAzimuths"]],
        "upEffective": [up.effective_at(a) for a in c["probeAzimuths"]], "slope": up.slope_deg,
    }
    passes = three_pass_bounds(h, sig_scalar, lambda cur: cur.effective_at(90.0))
    lo, nom, hi = numeric_bounds(passes)
    c["expected"]["bounds"] = [lo, nom, hi]
    cases.append(c)

# ---- exact path: half the spread of the three event times, vanishing, dt_limit
# half-spread 42800 s (< 12 h = 43200 s) and 43300 s (> 12 h) straddle the exact-path dt_limit
for lo, nom, hi in [(800, 1000, 1300), (1000, 1000, 1000), (990, 1000, 1010), (0, 1000, 2 * 12 * 3600 + 1000), (-500, 100, 100), (0, 42800, 85600), (0, 43300, 86600)]:
    u = exact_event_uncertainty(Event("sunset", float(nom)), Event("sunset", float(lo)), Event("sunset", float(hi)))
    cases.append({"kind": "exact", "times": [lo, nom, hi], "expected": {"deltaTSeconds": num(u.delta_t_seconds), "dtMethod": u.dt_method, "grazingReason": u.grazing_reason}})
for which in ("lower", "upper", "both"):
    n = Event("sunset", 1000.0)
    u = exact_event_uncertainty(n, None if which in ("lower", "both") else Event("sunset", 900.0), None if which in ("upper", "both") else Event("sunset", 1100.0))
    cases.append({"kind": "exactVanish", "which": which, "expected": {"deltaTSeconds": u.delta_t_seconds, "dtMethod": u.dt_method, "grazingReason": u.grazing_reason}})

# ---- event detection: the same predicate and range through her detect_events; her refinement bracket must be reproduced exactly
for rng_s, thr, falling in [((0.0, 600.0), 55.0, True), ((0.0, 600.0), 371.3, True), ((0.0, 2000.0), 1234.5, False), ((100.0, 5000.0), 4321.0, True), ((0.0, 241.0), 240.5, False), ((0.0, 3600.0), 1799.99, True)]:
    pred = (lambda et, t=thr: et < t) if falling else (lambda et, t=thr: et >= t)
    evs = detect_events(rng_s[0], rng_s[1], pred, down="sunset", up="shadowExit")
    cases.append({"kind": "detect", "rangeSeconds": list(rng_s), "thresholdSeconds": thr, "falling": falling,
                  "expected": [{"type": e.type, "et": e.et, "bracketStart": e.bracket_start_et, "bracketEnd": e.bracket_end_et} for e in evs]})

commit = subprocess.run(["git", "-C", args.pipeline, "log", "-1", "--format=%h", "--", "lumen_pipeline/reference/uncertainty.py"], capture_output=True, text=True).stdout.strip()
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({"version": 1, "source": f"pipeline/lumen_pipeline/reference/uncertainty.py @ {commit or 'unknown'}", "binWidthDeg": BIN, "masks": MASKS, "cases": cases}, indent=1) + "\n")

kinds: dict[str, int] = {}
for c in cases:
    kinds[c["kind"]] = kinds.get(c["kind"], 0) + 1
print(f"wrote {OUT.relative_to(HERE.parents[2])}: {len(cases)} cases {kinds}")
