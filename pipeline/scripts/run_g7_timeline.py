# Owner: Gowri (gate G7) -- the qualitative, primary-sourced half of G7: CY-3 sunset / next sunrise vs ISRO's published timeline.
"""Chandrayaan-3 lunar-day timeline from LUMEN's reference engine, compared with ISRO's own mission timeline.

    python scripts/run_g7_timeline.py      # writes pipeline/reports/g7_timeline.json

PLAN_FINAL_R3_DELTA D-13 defines G7 in two parts. The QUANTITATIVE part (Sun elevation 8.75 deg +/- 0.25 at touchdown) has no primary
source (see g7_cy3.json) and is not evaluated here. The QUALITATIVE part compares the site's timeline with the mission's. ISRO's
Chandrayaan-3 page (https://www.isro.gov.in/Chandrayaan3.html), heading "September 04, 2023", states verbatim: "The lander and rover are
in sleep mode. Awaiting their awakening around September 22, 2023." Consistency means: LUMEN's terrain sunset at the site comes AFTER the
4 Sep sleep (operations ended in daylight, before the local night), and LUMEN's next sunrise is close to "around 22 Sep".

Engine: the published 2 m CY-3 terrain mask, LUMEN's default Sun definition (>= 50 % of the disk above the terrain horizon), samples every
2 minutes, refined to 10 s. Also reported: when the geometric Sun elevation drops below 6 deg (the plan's "ISRO 6 deg ops" preset), and the
Sun elevation at the planned touchdown minute.
"""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import yaml
from run_g5 import _horizon

from lumen_pipeline.catalog import sparklines as S
from lumen_pipeline.common.timeutil import parse_utc
from lumen_pipeline.reference.interp import Ephemeris
from lumen_pipeline.reference.visibility import availability

ROOT = Path(__file__).resolve().parents[2]
SITE = "cy3_shiv_shakti"
ISRO_URL = "https://www.isro.gov.in/Chandrayaan3.html"
ISRO_SLEEP = "2023-09-04"  # "September 04, 2023: The lander and rover are in sleep mode."
ISRO_WAKE_AROUND = "2023-09-22"  # "Awaiting their awakening around September 22, 2023."
TOUCHDOWN = "2023-08-23T12:33:00Z"  # R3 D-12 (minute precision; no primary seconds-level source)
STEP_S, REFINE_S = 120, 10


def main() -> None:
    site = {s["id"]: s for s in yaml.safe_load(S.default_sites_path().read_text(encoding="utf-8"))["sites"]}[SITE]
    lat, lon = site["latitude_deg"], site["longitude_deg_east"]
    eph = Ephemeris.from_file(S.default_ephemeris_path())
    e0 = parse_utc(json.loads(S.default_ephemeris_path().with_suffix(".json").read_text(encoding="utf-8"))["start_utc"])
    horizon = _horizon(SITE, 2.0)

    def et(t: dt.datetime) -> float:
        return eph.start_et + (t - e0).total_seconds()

    def state(t: dt.datetime) -> tuple[bool, float]:
        g = eph.body_at("sun", et(t), lat, lon)
        return availability("sun", g.elevation_deg, g.azimuth_deg, g.distance_km, horizon, disk_threshold=S.SUN_DISK_THRESHOLD)[2], g.elevation_deg

    def refine(a: dt.datetime, b: dt.datetime, pred) -> dt.datetime:
        while (b - a).total_seconds() > REFINE_S:
            m = a + (b - a) / 2
            if pred(m) == pred(a):
                a = m
            else:
                b = m
        return b

    t0 = parse_utc(TOUCHDOWN)
    sun_up = lambda t: state(t)[0]
    below6 = lambda t: state(t)[1] < 6.0
    up0, el0 = state(t0)
    sunset = below6_at = sunrise = None
    t = t0
    prev_up, prev_b6 = up0, el0 < 6.0
    while t < t0 + dt.timedelta(days=50) and sunrise is None:
        n = t + dt.timedelta(seconds=STEP_S)
        up, el = state(n)
        if below6_at is None and not prev_b6 and el < 6.0:
            below6_at = refine(t, n, below6)
        if sunset is None and prev_up and not up:
            sunset = refine(t, n, sun_up)
        elif sunset is not None and not prev_up and up:
            sunrise = refine(t, n, sun_up)
        prev_up, prev_b6, t = up, el < 6.0, n

    iso = lambda x: x.strftime("%Y-%m-%dT%H:%M:%SZ") if x else None
    sleep = parse_utc(ISRO_SLEEP + "T00:00:00Z")
    wake = parse_utc(ISRO_WAKE_AROUND + "T00:00:00Z")
    sunset_after_sleep = sunset is not None and sunset.date() >= sleep.date()
    sunrise_offset_days = (sunrise - wake).total_seconds() / 86400 if sunrise else None
    consistent = bool(up0 and sunset_after_sleep and sunrise_offset_days is not None and abs(sunrise_offset_days) <= 2.0)
    report = {
        "gate": "G7", "part": "qualitative timeline (primary-sourced)", "site_id": SITE, "latitude_deg": lat, "longitude_deg_east": lon,
        "engine": "LUMEN Python reference engine, published 2 m terrain mask, Sun available at >= 50 % disk, 2-min samples refined to 10 s",
        "isro_source": {"url": ISRO_URL, "heading": "September 04, 2023",
                        "quote": "The lander and rover are in sleep mode. Awaiting their awakening around September 22, 2023."},
        "touchdown_utc_assumed": TOUCHDOWN, "sun_available_at_touchdown": up0, "sun_elevation_at_touchdown_deg": el0,
        "lumen_terrain_sunset_utc": iso(sunset), "lumen_sun_below_6deg_utc": iso(below6_at), "lumen_next_terrain_sunrise_utc": iso(sunrise),
        "checks": {
            "sun_up_at_touchdown": up0,
            "terrain_sunset_on_or_after_isro_sleep_date": sunset_after_sleep,
            "next_sunrise_minus_isro_wake_estimate_days": sunrise_offset_days,
            "next_sunrise_within_2_days_of_around_22_sep": sunrise_offset_days is not None and abs(sunrise_offset_days) <= 2.0,
        },
        "consistent": consistent,
        "not_evaluated": "Quantitative 8.75 deg +/- 0.25 at touchdown: no primary source (see g7_cy3.json); the 6 deg ops threshold is a plan preset, not an ISRO statement.",
        "command": "python pipeline/scripts/run_g7_timeline.py",
    }
    out = ROOT / "pipeline" / "reports" / "g7_timeline.json"
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("sun_elevation_at_touchdown_deg", "lumen_terrain_sunset_utc", "lumen_sun_below_6deg_utc", "lumen_next_terrain_sunrise_utc", "checks", "consistent")}, indent=1))


if __name__ == "__main__":
    main()
