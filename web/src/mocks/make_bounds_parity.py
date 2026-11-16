#!/usr/bin/env python3
# Owner: Nived
"""Scenario-level parity fixture for three-pass bounds and event uncertainty (G4, N-6, seam 3).

Runs Gowri's REAL Python end to end on the REAL ephemeris with a synthetic terrain mask at IM-2:
  Ephemeris.from_file -> body_at -> availability -> detect_events -> first_pass_metrics   (three passes: -sigma, nominal, +sigma)
  fast_uncertainty_for_event / exact_event_uncertainty_from_masks                          (per nominal event)
and records inputs and outputs in fixtures/bounds_parity.json. The TypeScript test (core/bounds.parity.test.ts) replays it.

The one thing her module leaves to the caller is HOW a shifted-pass event is paired with its nominal event (resolve_event). The rule used
here (documented in core/bounds.ts too): the nearest event of the same type within 36 h, else "vanished".

    python3 web/src/mocks/make_bounds_parity.py [--pipeline path] [--ephem path]
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
ROOT = HERE.parents[3]
OUT = HERE.parents[1] / "engine" / "__tests__" / "fixtures" / "bounds_parity.json"

ap = argparse.ArgumentParser()
ap.add_argument("--pipeline", default=str(ROOT / "pipeline"))
ap.add_argument("--ephem", default=str(ROOT / "web" / "public" / "data" / "ephem" / "ephem.bin"))
args = ap.parse_args()
sys.path.insert(0, args.pipeline)

import numpy as np  # noqa: E402

from lumen_pipeline.reference.events import Event, detect_events, sample_times  # noqa: E402
from lumen_pipeline.reference.interp import Ephemeris  # noqa: E402
from lumen_pipeline.reference.bounds import WindowSpec, evaluate_with_bounds  # noqa: E402
from lumen_pipeline.reference.metrics import first_pass_metrics  # noqa: E402
from lumen_pipeline.reference.uncertainty import (  # noqa: E402
    exact_event_uncertainty_from_masks,
    fast_uncertainty_for_event,
    numeric_bounds,
    shift_horizon_mask,
)
from lumen_pipeline.reference.visibility import Horizon, availability  # noqa: E402

LAT, LON, HEIGHT = -84.7906, 29.1957, 2.0
START_UTC_S = 1741737600  # 2025-03-12T00:00:00Z: the window holds the real IM-2 sunset (19 Mar) and shadow exit (3 Apr)
EPOCH0_UTC_S = 1672531200  # 2023-01-01T00:00:00Z (ephemeris start)
DAYS = 28
BIN = 0.1
PAIR_WINDOW_S = 36 * 3600.0
SIGMA = {"base": 0.05, "amp": 0.15, "k": 2}  # sigma(az) = base + amp * |sin(k * az)|  [deg]


def mask_values() -> np.ndarray:
    az = (np.arange(3600) + 0.5) * BIN
    m = 1.2 + 1.1 * np.sin(np.radians(az) * 3) + 0.5 * np.sin(np.radians(az) * 11 + 1.0)
    m[1500:1520] += 2.0  # a ridge spike
    return m


def sigma_at(az_deg: float) -> float:
    return SIGMA["base"] + SIGMA["amp"] * abs(math.sin(math.radians(az_deg) * SIGMA["k"]))


MASK = mask_values()
SIGMA_BINS = np.array([sigma_at((i + 0.5) * BIN) for i in range(3600)])
eph = Ephemeris.from_file(args.ephem)
start_et = eph.start_et + (START_UTC_S - EPOCH0_UTC_S)
end_et = start_et + DAYS * 86400.0
times = sample_times(start_et, end_et)
H0 = Horizon(MASK, bin_width_deg=BIN, observer_height_m=HEIGHT)


def run_pass(h: Horizon):
    def state(et):
        sun = eph.body_at("sun", et, LAT, LON, HEIGHT)
        earth = eph.body_at("earth", et, LAT, LON, HEIGHT)
        sd, sc, su = availability("sun", sun.elevation_deg, sun.azimuth_deg, sun.distance_km, h, disk_threshold=0.5)
        ed, ec, eu = availability("earth", earth.elevation_deg, earth.azimuth_deg, earth.distance_km, h, disk_threshold=0.5, margin_deg=1.0)
        return sun, earth, sd, ed, sc, ec, su, eu

    samples = [state(et) for et in times]
    sun_up = [bool(s[6]) for s in samples]
    earth_up = [bool(s[7]) for s in samples]
    metrics = first_pass_metrics(times, sun_up, earth_up, [s[0].elevation_deg for s in samples], [s[1].elevation_deg for s in samples],
                                 [float(s[4]) for s in samples], [float(s[5]) for s in samples], [float(s[2]) for s in samples])
    sun_ev = detect_events(start_et, end_et, lambda et: bool(state(et)[6]), down="sunset", up="shadowExit")
    earth_ev = detect_events(start_et, end_et, lambda et: bool(state(et)[7]), down="earthset", up="earthrise")
    return metrics, sun_ev, earth_ev


m_lo, sun_lo, earth_lo = run_pass(shift_horizon_mask(H0, SIGMA_BINS, direction=-1))
m_nom, sun_nom, earth_nom = run_pass(H0)
m_hi, sun_hi, earth_hi = run_pass(shift_horizon_mask(H0, SIGMA_BINS, direction=1))


def pair(nominal: Event, shifted: list[Event]):
    """Nearest same-type event within 36 h, else None (vanished)."""
    same = [e for e in shifted if e.type == nominal.type and abs(e.et - nominal.et) <= PAIR_WINDOW_S]
    return min(same, key=lambda e: abs(e.et - nominal.et)) if same else None


def annotate(events: list[Event], body: str, lo: list[Event], hi: list[Event]):
    def geom(et):
        g = eph.body_at(body, et, LAT, LON, HEIGHT)
        return g.elevation_deg, g.azimuth_deg

    out = []
    for e in events:
        fast = fast_uncertainty_for_event(e, geom, H0, sigma_at, disk_fraction=0.5, angular_radius_deg=0.0)
        exact = exact_event_uncertainty_from_masks(
            e, H0, SIGMA_BINS, lambda h: pair(e, lo if h.elevations_deg[0] == shift_horizon_mask(H0, SIGMA_BINS, direction=-1).elevations_deg[0] else hi)
        )
        out.append({
            "type": e.type, "utcMs": (e.et - eph.start_et + EPOCH0_UTC_S) * 1000.0, "bracketMs": [(e.bracket_start_et - start_et) * 1000.0, (e.bracket_end_et - start_et) * 1000.0],
            "fast": {"deltaTSeconds": ("inf" if math.isinf(fast.delta_t_seconds) else fast.delta_t_seconds), "rateDegPerHour": fast.clearance_rate_deg_per_hour, "grazingReason": fast.grazing_reason},
            "exact": {"deltaTSeconds": exact.delta_t_seconds, "grazingReason": exact.grazing_reason},
        })
    return out


def _spec(type_, body, down, up):
    def visible(et, h):
        g = eph.body_at(body, et, LAT, LON, HEIGHT)
        kw = {"disk_threshold": 0.5} if body == "sun" else {"disk_threshold": 0.5, "margin_deg": 1.0}
        return bool(availability(body, g.elevation_deg, g.azimuth_deg, g.distance_km, h, **kw)[2])

    return WindowSpec(type_, down, up, visible, lambda a, b, h: eph.body_at(body, a, LAT, LON, HEIGHT).elevation_deg)


# CANONICAL metric method (Gowri, G-10 final): refined-window durations, via her own evaluate_with_bounds (sun + Earth specs, no DSN here).
SCEN = evaluate_with_bounds(start_et, end_et, H0, SIGMA_BINS, [_spec("sun", "sun", "sunset", "shadowExit"), _spec("earth", "earth", "earthset", "earthrise")], pair_event=pair)


def bounds_of(key):
    b = SCEN.metrics[key]
    return [b.lo, b.value, b.hi]


expected = {
    "sunEvents": annotate(sun_nom, "sun", sun_lo, sun_hi),
    "earthEvents": annotate(earth_nom, "earth", earth_lo, earth_hi),
    "metrics": {k: {"lo": b[0], "nominal": b[1], "hi": b[2]} for k in ("sunlitPct", "earthVisiblePct", "longestNightH") for b in [bounds_of(k)]},
    "counts": {"sunNominal": len(sun_nom), "sunLower": len(sun_lo), "sunUpper": len(sun_hi), "earthNominal": len(earth_nom), "earthLower": len(earth_lo), "earthUpper": len(earth_hi)},
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({
    "version": 1, "source": "pipeline/lumen_pipeline/reference (events, visibility, metrics, uncertainty) on the real ephem.bin",
    "input": {"latDeg": LAT, "lonDegEast": LON, "heightM": HEIGHT, "startUtcMs": START_UTC_S * 1000, "durationDays": DAYS, "binWidthDeg": BIN, "mask": [round(float(x), 12) for x in MASK],
              "sigma": SIGMA, "pairWindowSeconds": PAIR_WINDOW_S},
    "expected": expected,
}, indent=0) + "\n")
print(f"wrote {OUT.relative_to(ROOT)}")
print("counts:", expected["counts"])
print("metric bounds:", {k: [round(v, 3) for v in (x['lo'], x['nominal'], x['hi'])] for k, x in expected["metrics"].items()})
for ev in expected["sunEvents"][:3]:
    print(" ", ev["type"], "fast dt=%s s rate=%.3f deg/h" % (ev["fast"]["deltaTSeconds"], ev["fast"]["rateDegPerHour"]), "| exact dt=%s s" % ev["exact"]["deltaTSeconds"], ev["exact"]["grazingReason"])
