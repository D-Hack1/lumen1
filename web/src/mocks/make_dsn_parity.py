#!/usr/bin/env python3
# Owner: Nived
"""Independent oracle for the DSN-aware link (N-8). Reads web/public/data/dsn/dsn.{bin,json} with plain numpy (NOT the TS loader, NOT Gowri's
dsn.py), linearly interpolates the 10-minute Moon-elevation nodes at seeded random instants, and records per-station elevation plus
"at least one complex above the mask" for two masks. The TypeScript test (dsn.test.ts) must reproduce it.

    python3 web/src/mocks/make_dsn_parity.py
"""
from __future__ import annotations

import datetime as dt
import json
import random
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
DSN = ROOT / "web" / "public" / "data" / "dsn"
OUT = Path(__file__).resolve().parents[1] / "engine" / "__tests__" / "fixtures" / "dsn_parity.json"

side = json.loads((DSN / "dsn.json").read_text())
raw = np.fromfile(DSN / "dsn.bin", dtype="<i2")
shape = tuple(side["shape"])  # [3, N] axis_order [station, time]
assert side["axis_order"] == ["station", "time"] and raw.size == shape[0] * shape[1], "unexpected layout"
elev = raw.reshape(shape).astype(float) * side["scale"] + side["offset"]
start = dt.datetime.fromisoformat(side["start_utc"].replace("Z", "+00:00")).timestamp()
cad = float(side["cadence_s"])
n = shape[1]

rng = random.Random(20261116)
cases = []
for i in range(80):
    # 2025-03-01 .. 2026-12-31, inside the real ephemeris span; plus a few exactly on nodes
    t = start + rng.uniform(2.16 * 365.25 * 86400, 3.99 * 365.25 * 86400)
    if i % 10 == 0:
        t = start + round((t - start) / cad) * cad
    x = (t - start) / cad
    k = int(np.floor(x))
    f = x - k
    e = [float((1 - f) * elev[s, k] + f * elev[s, k + 1]) for s in range(3)]
    cases.append({"utcMs": t * 1000.0, "elevDeg": e, "any10": bool(max(e) >= 10.0), "any0": bool(max(e) >= 0.0), "stations": [bool(x >= 10.0) for x in e]})

# 24 cases right at the edge: instants within +-20 min of nodes where the best complex is between 9 and 11 deg (and the exact crossing neighbourhood)
best = elev.max(axis=0)
near = np.where((best > 9.0) & (best < 11.0))[0]
near = near[(near > int(2.2 * 365.25 * 86400 / cad)) & (near < int(3.9 * 365.25 * 86400 / cad))]
for idx in rng.sample(list(near), 24):
    x = float(idx) + rng.uniform(-2.0, 2.0)
    t = start + x * cad
    k = int(np.floor(x)); f = x - k
    e = [float((1 - f) * elev[s, k] + f * elev[s, k + 1]) for s in range(3)]
    cases.append({"utcMs": t * 1000.0, "elevDeg": e, "any10": bool(max(e) >= 10.0), "any0": bool(max(e) >= 0.0), "stations": [bool(v >= 10.0) for v in e]})

# fraction of a whole year in which >=1 complex is above 10 deg (node grid, no interpolation): a physical sanity band for the TS test
y0 = int((dt.datetime(2025, 1, 1, tzinfo=dt.timezone.utc).timestamp() - start) / cad)
y1 = int((dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc).timestamp() - start) / cad)
frac = float((elev[:, y0:y1].max(axis=0) >= 10.0).mean())
OUT.write_text(json.dumps({"version": 1, "source": "numpy decode of web/public/data/dsn/dsn.bin (independent of the TS loader)", "startUtc": side["start_utc"], "cadenceS": cad,
                           "stations": side["fields"], "fraction2025Any10": frac, "cases": cases}, indent=0) + "\n")
print(f"wrote {OUT.relative_to(ROOT)}: {len(cases)} cases; 2025 fraction with >=1 complex above 10 deg = {frac:.4f}; any10 true in {sum(c['any10'] for c in cases)}/{len(cases)}")
