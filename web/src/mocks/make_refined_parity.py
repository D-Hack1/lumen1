#!/usr/bin/env python3
# Owner: Nived
"""Oracle for the canonical demo metrics: REFINED-window durations (Gowri, G-10 final) instead of 2-minute sample counts.
Runs her REAL Python on the REAL ephemeris and dsn.bin, end to end, for several sites/windows:
    detect_events (2-min grid + 10 s bisection)  ->  windows_from_events  ->  window_percentage / longest_window_gap_hours / window_duration_seconds
for sun, earth, link (Earth visible AND >= 1 DSN complex above the mask, linear interpolation) and ops (sun AND link), and writes
fixtures/refined_parity.json for engine/__tests__/refined.parity.test.ts. The peak elevation of a window is the maximum of the body's elevation over
its refined start, its refined end and the 2-minute grid samples strictly between them (the same definition in the TS engine).

    python3 web/src/mocks/make_refined_parity.py [--pipeline path] [--ephem path] [--dsn path]
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
ROOT = HERE.parents[3]
OUT = HERE.parents[1] / "engine" / "__tests__" / "fixtures" / "refined_parity.json"
ap = argparse.ArgumentParser()
ap.add_argument("--pipeline", default=str(ROOT / "pipeline"))
ap.add_argument("--ephem", default=str(ROOT / "web" / "public" / "data" / "ephem" / "ephem.bin"))
ap.add_argument("--dsn", default=str(ROOT / "web" / "public" / "data" / "dsn" / "dsn.bin"))
args = ap.parse_args()
sys.path.insert(0, args.pipeline)

import numpy as np  # noqa: E402

from lumen_pipeline.reference.dsn import DsnSeries  # noqa: E402
from lumen_pipeline.reference.events import detect_events, sample_times  # noqa: E402
from lumen_pipeline.reference.interp import Ephemeris  # noqa: E402
from lumen_pipeline.reference.metrics import longest_window_gap_hours, window_duration_seconds, window_percentage  # noqa: E402
from lumen_pipeline.reference.visibility import Horizon, availability  # noqa: E402
from lumen_pipeline.reference.windows import windows_from_events  # noqa: E402

EPOCH0_UTC_S = 1672531200  # 2023-01-01T00:00:00Z (ephemeris / DSN start)
eph = Ephemeris.from_file(args.ephem)
dsn = DsnSeries.from_file(args.dsn, start_et=eph.start_et)
BIN = 0.1


def utc_ms(et):
    return (et - eph.start_et + EPOCH0_UTC_S) * 1000.0


def ridge_mask():
    az = (np.arange(3600) + 0.5) * BIN
    m = 1.2 + 1.1 * np.sin(np.radians(az) * 3) + 0.5 * np.sin(np.radians(az) * 11 + 1.0)
    m[1500:1520] += 2.0
    return np.round(m, 6)


def run(site, start_utc_s, days, mask, dsn_mask_deg):
    lat, lon, height = site
    start_et = eph.start_et + (start_utc_s - EPOCH0_UTC_S)
    end_et = start_et + days * 86400.0
    h = Horizon(None if mask is None else mask, bin_width_deg=BIN, observer_height_m=height)
    grid = sample_times(start_et, end_et)

    def geom(body, et):
        g = eph.body_at(body, et, lat, lon, height)
        return g

    def sun_up(et):
        g = geom("sun", et)
        return bool(availability("sun", g.elevation_deg, g.azimuth_deg, g.distance_km, h, disk_threshold=0.5)[2])

    def earth_up(et):
        g = geom("earth", et)
        return bool(availability("earth", g.elevation_deg, g.azimuth_deg, g.distance_km, h, disk_threshold=0.5, margin_deg=1.0)[2])

    def link_up(et):
        return earth_up(et) and (True if dsn_mask_deg is None else bool(dsn.any_station_above(et, dsn_mask_deg, interpolation="linear")))

    def ops_up(et):
        return sun_up(et) and link_up(et)

    def peak_of(body):
        def peak(start, end):
            best = max(geom(body, start).elevation_deg, geom(body, end).elevation_deg)
            for t in grid:
                if start < t < end:
                    best = max(best, geom(body, t).elevation_deg)
            return best

        return peak

    spec = {
        "sun": (sun_up, "sunset", "shadowExit", "sun"),
        "earth": (earth_up, "earthset", "earthrise", "earth"),
        "link": (link_up, "linkDown", "linkUp", "earth"),
        "ops": (ops_up, "opsEnd", "opsStart", "sun"),
    }
    out_windows, out_events, wins = {}, {}, {}
    for t, (pred, down, up, body) in spec.items():
        evs = detect_events(start_et, end_et, pred, down=down, up=up)
        ws = windows_from_events(t, start_et, end_et, pred(start_et), evs, down_event=down, up_event=up, peak_elevation_deg=peak_of(body))
        wins[t] = ws
        out_events[t] = [{"type": e.type, "utcMs": utc_ms(e.et)} for e in evs]
        out_windows[t] = [{"startMs": utc_ms(w.start_et), "endMs": utc_ms(w.end_et), "peak": w.peak_elevation_deg, "partialStart": w.partial_start, "partialEnd": w.partial_end} for w in ws]
    metrics = {
        "sunlitPct": window_percentage(start_et, end_et, wins["sun"]),
        "earthVisiblePct": window_percentage(start_et, end_et, wins["earth"]),
        "linkPct": window_percentage(start_et, end_et, wins["link"]),
        "longestNightH": longest_window_gap_hours(start_et, end_et, wins["sun"]),
        "longestCommGapH": longest_window_gap_hours(start_et, end_et, wins["link"]),
        "opsHours": window_duration_seconds(wins["ops"]) / 3600.0,
    }
    return {"metrics": metrics, "windows": out_windows, "events": out_events}


SCENARIOS = [
    ("im2_athena", (-84.7906, 29.1957, 2.0), 1741282130, 30, None, 10.0),
    ("im2_athena_dsn_off", (-84.7906, 29.1957, 2.0), 1741282130, 30, None, None),
    ("im2_athena_ridge_mask", (-84.7906, 29.1957, 2.0), 1741737600, 28, ridge_mask(), 10.0),
    ("blue_ghost_m1", (18.56, 61.81, 2.0), 1741282130, 30, None, 10.0),
    ("cy3_shiv_shakti", (-69.373, 32.319, 2.0), 1767225600, 21, None, 10.0),  # 2026-01-01
    ("shackleton_ridge", (-89.54, 129.0, 2.0), 1764547200, 14, None, 10.0),  # 2025-12-01, polar: long windows, edges
]
cases = []
for name, site, start_s, days, mask, dsn_mask in SCENARIOS:
    r = run(site, start_s, days, mask, dsn_mask)
    cases.append({"name": name, "latDeg": site[0], "lonDegEast": site[1], "heightM": site[2], "startUtcMs": start_s * 1000, "durationDays": days,
                  "mask": None if mask is None else [float(x) for x in mask], "binWidthDeg": BIN, "dsnMaskDeg": dsn_mask, **r})
    m = r["metrics"]
    print(f"{name:24s} sunlit {m['sunlitPct']:8.4f}  earth {m['earthVisiblePct']:8.4f}  link {m['linkPct']:8.4f}  night {m['longestNightH']:8.3f} h  gap {m['longestCommGapH']:7.3f} h  ops {m['opsHours']:8.3f} h  windows {[len(v) for v in r['windows'].values()]}")
OUT.write_text(json.dumps({"version": 1, "source": "pipeline/lumen_pipeline/reference (events, windows, metrics, dsn, visibility) on the real ephem.bin and dsn.bin", "cases": cases}, separators=(",", ":")) + "\n")
print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KiB)")
