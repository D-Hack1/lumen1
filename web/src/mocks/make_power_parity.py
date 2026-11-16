#!/usr/bin/env python3
# Owner: Nived
"""Python -> TypeScript parity fixture for the R3 power model (G4, G-10). Runs Gowri's REAL reference/power.py on seeded random inputs
and records inputs + outputs in fixtures/power_parity.json; engine/__tests__/power.parity.test.ts replays them in core/power.ts.

    python3 web/src/mocks/make_power_parity.py [--pipeline path]
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
OUT = HERE.parents[1] / "engine" / "__tests__" / "fixtures" / "power_parity.json"
ap = argparse.ArgumentParser()
ap.add_argument("--pipeline", default=str(ROOT / "pipeline"))
args = ap.parse_args()
sys.path.insert(0, args.pipeline)

import numpy as np  # noqa: E402

from lumen_pipeline.reference.power import (  # noqa: E402
    Panel, attitude_matrix, best_yaw_deg, evaluate_power_series, flat_ground_baseline_w, generic_panel_preset,
    integrate_battery_soc, orient_panels, solar_generation_w, solar_irradiance_w_m2,
)

rng = random.Random(20261115)
AU = 149_597_870.7
PRESETS = ["fourSide", "singleHeading", "horizontalDeck", "trackingMast"]


def unit(v):
    v = np.array(v, dtype=float)
    return v / np.linalg.norm(v)


def rand_unit(lower_hemisphere=False):
    while True:
        v = [rng.uniform(-1, 1) for _ in range(3)]
        if 0.05 < np.linalg.norm(v) <= 1:
            v = unit(v)
            if not lower_hemisphere and v[2] < 0:
                v[2] = -v[2]
            return v


def ground_normal():
    """Mostly gentle slopes (<= 25 deg), plus the exact edge cases: flat, and the 180-degree flip."""
    r = rng.random()
    if r < 0.12:
        return np.array([0.0, 0.0, 1.0])
    if r < 0.18:
        return np.array([0.0, 0.0, -1.0])
    slope = math.radians(rng.uniform(0.2, 25.0))
    az = rng.uniform(0, 2 * math.pi)
    return unit([math.sin(slope) * math.sin(az), math.sin(slope) * math.cos(az), math.cos(slope)])


def preset_args(name):
    d = {"panel_area_m2": rng.uniform(0.2, 6.0), "efficiency": rng.uniform(0.05, 0.4)}
    if name == "singleHeading":
        d["heading_deg"] = rng.choice([0.0, 90.0, 180.0, 270.0, rng.uniform(0, 360)])
    if name == "trackingMast":
        d["tracking_azimuth_deg"] = rng.uniform(-90, 450)  # outside [0,360) on purpose
    return d


def panels_json(panels):
    return [{"normal": [float(x) for x in p.normal], "areaM2": p.area_m2, "efficiency": p.efficiency} for p in panels]


def lst(a):
    return [float(x) for x in a]


cases = []
for i in range(30):  # attitude + orient_panels
    gn = ground_normal()
    yaw, tilt, tdir = rng.choice([0.0, 90.0, -45.0, rng.uniform(-360, 360)]), rng.choice([0.0, 30.0, rng.uniform(0, 30)]), rng.uniform(-360, 720)
    name = PRESETS[i % 4]
    pa = preset_args(name)
    panels = generic_panel_preset(name, **pa)
    m = attitude_matrix(gn, yaw, tilt, tdir)
    oriented = orient_panels(panels, gn, yaw, tilt, tdir)
    cases.append({"kind": "attitude", "groundNormal": lst(gn), "yawDeg": yaw, "tiltDeg": tilt, "tiltDirDeg": tdir, "preset": name, "presetArgs": pa,
                  "matrix": [lst(r) for r in m], "panels": panels_json(panels), "oriented": panels_json(oriented)})

for i in range(24):  # best yaw (15 degree sweep, first maximum on ties)
    gn = ground_normal()
    name = PRESETS[i % 4]
    pa = preset_args(name)
    panels = generic_panel_preset(name, **pa)
    sun = rand_unit() if i % 6 else np.array([1.0, 0.0, 0.0])  # includes an exact-tie-prone sun on an axis
    tilt = rng.choice([0.0, rng.uniform(0, 30)])
    tdir = rng.uniform(0, 360)
    cases.append({"kind": "bestYaw", "sun": lst(sun), "groundNormal": lst(gn), "tiltDeg": tilt, "tiltDirDeg": tdir, "panels": panels_json(panels),
                  "expected": best_yaw_deg(panels, sun, gn, tilt, tdir)})

for i in range(30):  # generation + irradiance + flat-ground baseline
    name = PRESETS[i % 4]
    panels = generic_panel_preset(name, **preset_args(name))
    sun = rand_unit(lower_hemisphere=(i % 5 == 0))
    dist = rng.uniform(0.97, 1.03) * AU
    disk = rng.choice([0.0, 1.0, 0.5, rng.random()])
    gn = ground_normal()
    yaw, tilt, tdir = rng.uniform(0, 360), rng.uniform(0, 30), rng.uniform(0, 360)
    oriented = orient_panels(panels, gn, yaw, tilt, tdir)
    cases.append({"kind": "generation", "sun": lst(sun), "distanceKm": dist, "diskFraction": disk, "groundNormal": lst(gn), "yawDeg": yaw, "tiltDeg": tilt, "tiltDirDeg": tdir,
                  "panels": panels_json(panels),
                  "expected": {"irradiance": solar_irradiance_w_m2(dist), "generationW": solar_generation_w(sun, dist, disk, oriented),
                               "flatBaselineW": flat_ground_baseline_w(sun, dist, disk, panels, yaw, tilt, tdir)}})

for i in range(14):  # battery SOC: irregular steps, charging, discharging, curtailment, unserved
    n = rng.randint(4, 40)
    t = [0.0]
    for _ in range(n - 1):
        t.append(t[-1] + rng.choice([60.0, 120.0, 600.0, rng.uniform(30, 7200)]))
    gen = [rng.choice([0.0, rng.uniform(0, 400)]) for _ in range(n)]
    load = [rng.choice([0.0, 20.0, rng.uniform(0, 150)]) for _ in range(n)]
    cap = rng.choice([50.0, 200.0, rng.uniform(10, 1000)])
    dod = rng.choice([1.0, 0.8, rng.uniform(0.2, 1.0)])
    init = rng.uniform(1.0 - dod, 1.0)
    r = integrate_battery_soc(t, gen, load, battery_capacity_wh=cap, usable_depth_of_discharge=dod, initial_soc_fraction=init)
    cases.append({"kind": "battery", "timesS": t, "generationW": gen, "loadW": load, "capacityWh": cap, "dod": dod, "initialSoc": init,
                  "expected": {k: lst(getattr(r, k)) for k in ("net_w", "soc_fraction", "stored_energy_wh", "curtailed_generation_wh", "unserved_load_wh")}})

for i in range(4):  # the combined evaluate_power_series
    n = 12
    t = [k * 1800.0 for k in range(n)]
    suns = [rand_unit() for _ in range(n)]
    dists = [rng.uniform(0.98, 1.02) * AU for _ in range(n)]
    disks = [rng.choice([0.0, 1.0, rng.random()]) for _ in range(n)]
    name = PRESETS[i]
    panels = generic_panel_preset(name, **preset_args(name))
    load = [rng.uniform(0, 80) for _ in range(n)]
    cap, dod, init = 300.0, 0.9, 0.6
    r = evaluate_power_series(t, suns, dists, disks, panels, load, battery_capacity_wh=cap, usable_depth_of_discharge=dod, initial_soc_fraction=init)
    cases.append({"kind": "series", "timesS": t, "suns": [lst(s) for s in suns], "distancesKm": dists, "disks": disks, "panels": panels_json(panels), "loadW": load,
                  "capacityWh": cap, "dod": dod, "initialSoc": init, "expected": {k: lst(getattr(r, k)) for k in ("generation_w", "net_w", "soc_fraction", "stored_energy_wh")}})

# invalid inputs must be rejected by both languages (the message text is not compared)
errors = [
    {"fn": "solarIrradiance", "args": {"distanceKm": 0.0}},
    {"fn": "solarIrradiance", "args": {"distanceKm": -1.0}},
    {"fn": "generation", "args": {"sun": [0.0, 0.0, 2.0], "distanceKm": AU, "disk": 1.0}},
    {"fn": "generation", "args": {"sun": [0.0, 0.0, 1.0], "distanceKm": AU, "disk": 1.5}},
    {"fn": "preset", "args": {"preset": "singleHeading"}},
    {"fn": "preset", "args": {"preset": "trackingMast"}},
    {"fn": "preset", "args": {"preset": "nope"}},
    {"fn": "battery", "args": {"timesS": [0.0, 0.0], "capacityWh": 10.0, "dod": 1.0, "initialSoc": 1.0}},
    {"fn": "battery", "args": {"timesS": [0.0, 1.0], "capacityWh": 0.0, "dod": 1.0, "initialSoc": 1.0}},
    {"fn": "battery", "args": {"timesS": [0.0, 1.0], "capacityWh": 10.0, "dod": 0.5, "initialSoc": 0.2}},
]

commit = subprocess.run(["git", "-C", str(ROOT), "log", "-1", "--format=%h", "--", "pipeline/lumen_pipeline/reference/power.py"], capture_output=True, text=True).stdout.strip()
OUT.write_text(json.dumps({"version": 1, "source": f"pipeline/lumen_pipeline/reference/power.py @ {commit or 'unknown'}", "cases": cases, "errors": errors}, indent=0) + "\n")
from collections import Counter  # noqa: E402
print(f"wrote {OUT.relative_to(ROOT)}: {len(cases)} cases {dict(Counter(c['kind'] for c in cases))}")
