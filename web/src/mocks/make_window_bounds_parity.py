#!/usr/bin/env python3
# Owner: Nived
"""Python -> TypeScript parity fixture for the R3 event-driven windows and scenario three-pass bounds (G-10 final): reference/windows.py
(`windows_from_events`), reference/metrics.py (window percentage / longest gap), reference/bounds.py (`evaluate_with_bounds`).
Visibility predicates are closed-form so both languages evaluate identical functions:
    visible(et, horizon) = e0 + e1*et + A*sin(w*et + p)  >=  horizon.effective_at(a0 + a1*et)
and the peak elevation of a window is the maximum of that elevation sampled each minute (plus the window end). Writes
fixtures/window_bounds_parity.json; engine/__tests__/windowBounds.parity.test.ts replays it in core/windowBounds.ts.

    python3 web/src/mocks/make_window_bounds_parity.py [--pipeline path]
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
OUT = HERE.parents[1] / "engine" / "__tests__" / "fixtures" / "window_bounds_parity.json"
ap = argparse.ArgumentParser()
ap.add_argument("--pipeline", default=str(ROOT / "pipeline"))
args = ap.parse_args()
sys.path.insert(0, args.pipeline)

import numpy as np  # noqa: E402

from lumen_pipeline.reference.bounds import WindowSpec, evaluate_with_bounds  # noqa: E402
from lumen_pipeline.reference.events import Event  # noqa: E402
from lumen_pipeline.reference.metrics import longest_window_gap_hours, window_duration_seconds, window_percentage  # noqa: E402
from lumen_pipeline.reference.visibility import Horizon  # noqa: E402
from lumen_pipeline.reference.windows import Window, windows_from_events  # noqa: E402

rng = random.Random(20261118)
N_BINS, BIN = 720, 0.5


def val(x):
    return None if x is None else float(x)


def bv(b):
    return {"value": val(b.value), "lo": val(b.lo), "hi": val(b.hi)}


def pair_factory(window_s):
    def pair(event, candidates):
        matches = [c for c in candidates if c.type == event.type and (window_s is None or abs(c.et - event.et) <= window_s)]
        return min(matches, key=lambda c: abs(c.et - event.et), default=None)

    return pair


def elevation(p, et):
    return p["e0"] + p["e1"] * et + p["A"] * math.sin(p["w"] * et + p["p"])


def make_spec(kind, p, az):
    def visible(et, horizon):
        return elevation(p, et) >= horizon.effective_at(az["a0"] + az["a1"] * et)

    def peak(start, end, horizon):
        t, best = start, -math.inf
        while t < end:
            best = max(best, elevation(p, t))
            t += 60.0
        return max(best, elevation(p, end))

    return WindowSpec(kind, f"{kind}_down", f"{kind}_up", visible, peak)


def random_mask():
    base = rng.uniform(0.2, 1.6)
    v = [round(base + rng.uniform(-0.15, 0.15), 3) for _ in range(N_BINS)]
    for _ in range(rng.choice([1, 3, 6])):  # ridges
        c = rng.randrange(N_BINS)
        for k in range(rng.choice([1, 2, 4])):
            v[(c + k) % N_BINS] = round(v[(c + k) % N_BINS] + rng.uniform(0.3, 1.8), 3)
    return v


cases = []
TYPES = ["sun", "earth", "link", "ops"]
for i in range(14):
    span = rng.choice([86400.0, 2 * 86400.0, 3 * 86400.0])
    mask = random_mask()
    nspec = rng.choice([1, 2, 3, 4])
    specs = []
    for kind in TYPES[:nspec]:
        period = rng.uniform(14 * 3600, 40 * 3600)
        p = {"e0": round(rng.uniform(0.0, 1.2), 3), "e1": round(rng.choice([0.0, 1e-6, -1e-6]), 9), "A": round(rng.uniform(0.8, 3.0), 3), "w": 2 * math.pi / period, "p": round(rng.uniform(0, 6.28), 3)}
        az = {"a0": round(rng.uniform(0, 360), 3), "a1": round(rng.choice([0.0, 360 / 86400.0 * 0.3, 360 / 86400.0, -360 / 86400.0 * 0.5]), 9)}
        specs.append({"type": kind, "p": p, "az": az})
    sigma = rng.choice([0.0, 0.05, 0.2, 0.2, 0.6, [round(rng.uniform(0.02, 0.4), 3) for _ in range(N_BINS)]])
    pw = rng.choice([None, None, 36 * 3600.0, 3600.0])
    h = Horizon(np.array(mask, dtype=float), bin_width_deg=BIN)
    ws = [make_spec(s["type"], s["p"], s["az"]) for s in specs]
    r = evaluate_with_bounds(0.0, span, h, np.array(sigma, dtype=float) if isinstance(sigma, list) else sigma, ws, pair_event=pair_factory(pw))
    case = {"kind": "bounds", "span": span, "mask": mask, "binWidthDeg": BIN, "sigma": sigma, "pairWindowSeconds": pw, "specs": specs}
    case["expected"] = {
        "metrics": {k: bv(v) for k, v in r.metrics.items()},
        "sunlitDurationHours": bv(r.sunlit_duration_hours),
        "events": {t: [{"type": e.type, "et": e.et, "bracketStart": e.bracket_start_et, "bracketEnd": e.bracket_end_et, "dtSeconds": val(e.dt_seconds), "dtMethod": e.dt_method,
                        "grazingReason": e.grazing_reason} for e in evs] for t, evs in r.events.items()},
        "windows": {t: [{"start": bv(w.start_et), "end": bv(w.end_et), "duration": bv(w.duration_hours), "partialStart": w.nominal.partial_start, "partialEnd": w.nominal.partial_end,
                         "peak": w.nominal.peak_elevation_deg} for w in ws_] for t, ws_ in r.windows.items()},
        "passMetrics": {n: {k: val(v) for k, v in getattr(r, n).metrics.items()} for n in ("lower", "nominal", "upper")},
    }
    cases.append(case)

# windows_from_events + the metric helpers on hand-built event lists (incl. partial starts/ends, empty, back-to-back)
for i in range(30):
    start, end = 0.0, rng.choice([3600.0, 86400.0])
    initially = rng.random() < 0.5
    n = rng.choice([0, 1, 2, 3, 4, 7])
    times = sorted(rng.uniform(start, end) for _ in range(n))
    evs = []
    vis = initially
    for t in times:
        evs.append(Event("x_down" if vis else "x_up", t))
        vis = not vis
    peak = lambda a, b: round(0.5 * (a + b) / 3600.0, 6)  # deterministic stand-in
    wins = windows_from_events("x", start, end, initially, evs, down_event="x_down", up_event="x_up", peak_elevation_deg=peak)
    cases.append({"kind": "windows", "start": start, "end": end, "initiallyVisible": initially, "events": [{"type": e.type, "et": e.et} for e in evs],
                  "expected": {"windows": [{"start": w.start_et, "end": w.end_et, "peak": w.peak_elevation_deg, "partialStart": w.partial_start, "partialEnd": w.partial_end} for w in wins],
                               "durationSeconds": window_duration_seconds(wins), "percentage": window_percentage(start, end, wins), "longestGapHours": longest_window_gap_hours(start, end, wins)}})

# invalid inputs both languages must reject
errors = [
    {"fn": "windows", "start": 0.0, "end": 0.0, "initiallyVisible": False, "events": []},
    {"fn": "windows", "start": 0.0, "end": 10.0, "initiallyVisible": True, "events": [{"type": "x_up", "et": 5.0}]},
    {"fn": "windows", "start": 0.0, "end": 10.0, "initiallyVisible": False, "events": [{"type": "x_down", "et": 5.0}]},
    {"fn": "windows", "start": 0.0, "end": 10.0, "initiallyVisible": False, "events": [{"type": "x_up", "et": 7.0}, {"type": "x_down", "et": 3.0}]},
    {"fn": "windows", "start": 0.0, "end": 10.0, "initiallyVisible": False, "events": [{"type": "bogus", "et": 3.0}]},
    {"fn": "windows", "start": 0.0, "end": 10.0, "initiallyVisible": False, "events": [{"type": "x_up", "et": 30.0}]},
    {"fn": "percentage", "start": 5.0, "end": 5.0},
]
commit = subprocess.run(["git", "-C", str(ROOT), "log", "-1", "--format=%h", "--", "pipeline/lumen_pipeline/reference/bounds.py"], capture_output=True, text=True).stdout.strip()
OUT.write_text(json.dumps({"version": 1, "source": f"pipeline/lumen_pipeline/reference/{{bounds,windows,metrics}}.py @ {commit or 'unknown'}", "cases": cases, "errors": errors}, separators=(",", ":")) + "\n")
b = [c for c in cases if c["kind"] == "bounds"]
print(f"wrote {OUT.relative_to(ROOT)}: {len(b)} bounds + {len(cases) - len(b)} windows cases; {OUT.stat().st_size // 1024} KiB")
print("windows per bounds case:", [sum(len(v) for v in c["expected"]["windows"].values()) for c in b])
print("vanished events:", sum(1 for c in b for evs in c["expected"]["events"].values() for e in evs if e["grazingReason"] == "vanishes"), "| windows with null range:",
      sum(1 for c in b for ws in c["expected"]["windows"].values() for w in ws if w["start"]["lo"] is None))
print("partial windows:", sum(1 for c in b for ws in c["expected"]["windows"].values() for w in ws if w["partialStart"] or w["partialEnd"]))
