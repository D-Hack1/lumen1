#!/usr/bin/env python3
# Owner: Nived
"""Generate web/public/data-mock/ — a FAKE dataset with the same folder structure as data/.

Deterministic (no randomness without a fixed seed). Run from anywhere:

    python3 web/src/mocks/make_mock.py

Every number here is synthetic. Formats are DRAFTS taken from PLAN_FINAL §6 + R3 delta D-11 and
must be reconciled with the owners' contracts at H2 (see web/public/data-mock/README.md).
All binary data is little-endian.
"""
from __future__ import annotations

import hashlib
import json
import math
import random
import struct
import sys
import zlib
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "pipeline"))
from lumen_pipeline.terrain.tierb import (
    TierBTile,
    TileSpec,
    _tile_coordinates,
    write_index,
    write_tile,
)

OUT = Path(__file__).resolve().parents[2] / "public" / "data-mock"
R_MOON_M = 1_737_400.0
VERSION = 1
MOCK_NOTE = "MOCK DATA — synthetic values, not for science or demo claims"

# ---------------------------------------------------------------- helpers


def w_json(rel: str, obj: object) -> None:
    p = OUT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, indent=2) + "\n")


def w_bin(rel: str, data: bytes) -> None:
    p = OUT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)


def w_array(rel: str, data: bytes, *, shape, dtype, fields, units, scale=None, offset=None, **extra) -> None:
    """Gowri's shared binary-sidecar contract (pipeline/common/binio.py): raw little-endian array + JSON sidecar."""
    w_bin(rel, data)
    meta = {"version": "1", "shape": list(shape), "dtype": dtype, "fields": fields, "units": units, "scale": scale, "offset": offset,
            "producer": "web/src/mocks/make_mock.py", "created_utc": "2026-01-01T00:00:00Z",
            "sha256": hashlib.sha256(data).hexdigest(), "mock": True, "note": MOCK_NOTE, **extra}
    w_json(rel[:-4] + ".json", meta)


def hdr(schema: str, **kw: object) -> dict:
    return {"schema": schema, "version": VERSION, "mock": True, "note": MOCK_NOTE, **kw}


def epoch_s(y: int, mo: int, d: int, h: int = 0, mi: int = 0, s: int = 0) -> int:
    return int(datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc).timestamp())


def iso(t: int) -> str:
    return datetime.fromtimestamp(t, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def norm(v):
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v]


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def site_frame(lat_deg: float, lon_deg: float):
    """Gowri's frames.py order: rows are (east, north_reference, up); local = M @ vec_ME. Azimuth = atan2(east, north_ref)."""
    la, lo = math.radians(lat_deg), math.radians(lon_deg)
    u = [math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)]
    ref = [1.0, 0.0, 0.0] if abs(lat_deg) >= 60 else [0.0, 0.0, 1.0]
    e = norm(cross(ref, u))
    n_ref = norm(cross(u, e))
    return [e, n_ref, u], ("+X_ME" if abs(lat_deg) >= 60 else "+Z_ME")


def polar_xy_km(lat_deg: float, lon_deg: float):
    """South-polar stereographic, true scale at the pole: r = 2R tan(colat/2); x=r sin(lon), y=r cos(lon)."""
    colat = math.radians(90.0 + lat_deg)
    r = 2 * R_MOON_M * math.tan(colat / 2) / 1000.0
    lo = math.radians(lon_deg)
    return r * math.sin(lo), r * math.cos(lo)


# ---------------------------------------------------------------- sites (all values fake)

SITES = [
    dict(id="im2_athena", name="IM-2 Athena (Mons Mouton)", cat="historical_landing", agency="NASA CLPS / Intuitive Machines",
         lat=-84.7906, lon=29.1957, tier="A", nf=5, base=1.0, amp=1.5, seed=1, slope=7.0, aspect=200.0,
         touchdown="2025-03-06T17:28:50Z", prec="second", psr=(4.2, 312.0, 2.8)),
    dict(id="cy3_shiv_shakti", name="Chandrayaan-3 Statio Shiv Shakti", cat="historical_landing", agency="ISRO",
         lat=-69.373, lon=32.319, tier="A", nf=20, base=2.0, amp=2.5, seed=2, slope=4.0, aspect=120.0,
         touchdown="2023-08-23T12:33:00Z", prec="minute", psr=None),
    dict(id="shackleton_ridge", name="Shackleton connecting ridge", cat="published_target", agency="NASA CLPS",
         lat=-89.54, lon=129.0, tier="A", nf=5, base=2.5, amp=3.5, seed=3, slope=9.0, aspect=330.0,
         touchdown=None, prec=None, psr=(0.9, 20.0, 210.0)),
    dict(id="blue_ghost_m1", name="Blue Ghost Mission 1 (Mare Crisium)", cat="historical_landing", agency="NASA CLPS / Firefly",
         lat=18.56, lon=61.81, tier="C", nf=None, base=None, amp=None, seed=4, slope=None, aspect=None,
         touchdown="2025-03-02T08:34:00Z", prec="minute", psr=None),
]
HEIGHTS_M = [1.0, 2.0, 5.0, 10.0]
BIN_DEG = 0.1
NBIN = 3600


def mask_deg(s, az_deg: float, h_m: float) -> float:
    """Synthetic horizon elevation (deg) at azimuth, observer height h."""
    rng_phase = s["seed"] * 1.7
    v = s["base"]
    v += s["amp"] * 0.5 * math.sin(math.radians(az_deg) * 2 + rng_phase)
    v += s["amp"] * 0.3 * math.sin(math.radians(az_deg) * 5 + rng_phase * 2)
    v += s["amp"] * 0.2 * math.sin(math.radians(az_deg) * 13 + rng_phase * 3)
    # a narrow ridge spike (exercises the R3 envelope guard)
    d = (az_deg - (40 + 70 * s["seed"])) % 360
    d = min(d, 360 - d)
    v += 3.0 * math.exp(-((d / 0.4) ** 2))
    # taller observers see slightly lower horizons
    return v - 0.03 * math.log(max(h_m, 1.0) + 1)


# ---------------------------------------------------------------- ephemeris + DSN

T0 = epoch_s(2023, 1, 1)
T1 = epoch_s(2031, 1, 1)
EPH_STEP = 6 * 3600  # mock only; real data is hourly — loaders must read `step_s`, never assume
SYNODIC_S = 29.530589 * 86400
SUN_DIST_KM = 1.496e8
INCL = math.radians(1.54)


def sun_pos(t: float):
    phi = 2 * math.pi * (t - T0) / SYNODIC_S
    c = [math.cos(phi), -math.sin(phi), 0.0]
    # tilt about X by the Sun's ±1.54° declination swing
    y = c[1] * math.cos(INCL) - c[2] * math.sin(INCL)
    z = c[1] * math.sin(INCL) + c[2] * math.cos(INCL)
    return [SUN_DIST_KM * c[0], SUN_DIST_KM * y, SUN_DIST_KM * z]


def earth_pos(t: float):
    lon = math.radians(7.0) * math.sin(2 * math.pi * (t - T0) / (27.55 * 86400))
    lat = math.radians(6.7) * math.sin(2 * math.pi * (t - T0) / (27.21 * 86400) + 1.0)
    dist = 384_400.0 * (1 + 0.055 * math.cos(2 * math.pi * (t - T0) / (27.55 * 86400)))
    return [dist * math.cos(lat) * math.cos(lon), dist * math.cos(lat) * math.sin(lon), dist * math.sin(lat)]


def vel(fn, t, eps=60.0):
    a, b = fn(t - eps), fn(t + eps)
    return [(b[i] - a[i]) / (2 * eps) for i in range(3)]


START_ET_TDB = 725803268.1839136  # real value for 2023-01-01T00:00:00Z (mock start is the same instant)


def make_ephem():
    """Mirrors the real ephem.json field names (step_seconds, start_et_tdb, frame MOON_ME_DE421, 4 field groups)."""
    n = (T1 - T0) // EPH_STEP + 1
    buf = bytearray()
    for i in range(n):
        t = T0 + i * EPH_STEP
        rec = sun_pos(t) + vel(sun_pos, t) + earth_pos(t) + vel(earth_pos, t)
        buf += struct.pack("<12f", *rec)
    w_array("ephem/ephem.bin", bytes(buf), shape=(n, 12), dtype="float32",
            fields=["sun_position_km", "sun_velocity_km_s", "earth_position_km", "earth_velocity_km_s"],
            units=["km", "km/s", "km", "km/s"],
            start_utc=iso(T0), end_utc=iso(T0 + (n - 1) * EPH_STEP), count=n, start_et_tdb=START_ET_TDB, step_seconds=EPH_STEP,
            frame="MOON_ME", spice_frame="MOON_ME_DE421", cadence_s=EPH_STEP, body_order=["sun", "earth"], aberration_correction="LT+S",
            kernel_provenance=[{"filename": "MOCK", "sha256": "0" * 64}],
            mock_cadence_note="mock is 6 h; real is 3600 s. Loaders must read step_seconds.")


DSN = [("DSS-14", "Goldstone", 0.0), ("DSS-43", "Canberra", 2 * math.pi / 3), ("DSS-63", "Madrid", 4 * math.pi / 3)]
DSN_STEP = 1800


def make_dsn():
    """data_dsn.md: little-endian int16 = round(elevation_deg * 2), valid [-180, 180]. Layout here: time-major [count, 3]."""
    n = (T1 - T0) // DSN_STEP + 1
    buf = bytearray()
    for i in range(n):
        t = T0 + i * DSN_STEP
        for _, _, ph in DSN:
            el = 55 * math.sin(2 * math.pi * (t - T0) / 86164.1 + ph) + 20 * math.sin(2 * math.pi * (t - T0) / (27.32 * 86400))
            buf += struct.pack("<h", max(-180, min(180, round(max(-90.0, min(90.0, el)) * 2))))
    w_array("dsn/dsn.bin", bytes(buf), shape=(n, 3), dtype="int16", fields=[d[0] for d in DSN], units="deg", scale=0.5, offset=0.0,
            start_utc=iso(T0), cadence_s=DSN_STEP, mode="geometric_only", frame="MOON_ME",
            station_complexes={d[0]: d[1] for d in DSN}, mock_cadence_note="mock is 1800 s; real is 600 s. Read cadence_s.")


# ---------------------------------------------------------------- terrain: masks, sigma, pad, dispersion, summaries


MASK_HEADER_BYTES = 64
MASK_ELEV_OFF = 64
MASK_PAYLOAD = 4 * NBIN * 4  # (4, 3600) float32
MASK_DIST_OFF = MASK_ELEV_OFF + MASK_PAYLOAD
NAN = float("nan")
# bins deliberately unavailable (NaN) in this site's mask, to exercise NaN preservation and the circular
# range query across azimuth zero (contract §3.2, §5.3)
NAN_BINS = {"cy3_shiv_shakti": [3598, 3599, 0, 1]}
PROVENANCE = {"producer": "web/src/mocks/make_mock.py", "created_utc": "2026-01-01T00:00:00Z", "git_commit": "0" * 40}


def lumen_header(magic: bytes, elev_off: int, dist_off: int, elev_len: int, dist_len: int) -> bytes:
    """data_masks.md 3.1 / 4: 64-byte little-endian header shared by LUMENMSK and LUMENSGM."""
    h = struct.pack("<8sHHIIfffIIIIIIQ", magic, 1, MASK_HEADER_BYTES, 4, NBIN, BIN_DEG, 250.0, 1.0,
                    elev_off, dist_off, elev_len, dist_len, 0, 0, 0)
    assert len(h) == MASK_HEADER_BYTES
    return h


def binary_descriptor(magic: str) -> dict:
    return {"magic": magic, "format_version": 1, "byte_order": "little", "float_encoding": "ieee754-binary32",
            "layout": "header_then_elevation_then_distance" if magic == "LUMENMSK" else "header_then_sigma",
            "array_order": "c_contiguous_height_major"}


def make_masks():
    for s in SITES:
        if s["tier"] == "C":
            continue
        gaps = set(NAN_BINS.get(s["id"], []))
        elev, dist, sig = [], [], []
        gmax, gmin = [], []
        for hi, h in enumerate(HEIGHTS_M):
            finite = []
            for b in range(NBIN):
                az = (b + 0.5) * BIN_DEG
                if b in gaps:
                    elev.append(NAN)
                    dist.append(NAN)
                    sig.append(NAN)
                    continue
                v = mask_deg(s, az, h)
                finite.append(v)
                elev.append(v)
                dist.append(5 + 120 * (0.5 + 0.5 * math.sin(math.radians(az) * 3 + s["seed"] + hi * 0.1)))
                sig.append(0.10 + 0.01 * ((b // 300) % 6) + 0.002 * hi)
            gmax.append(round(max(finite), 6))
            gmin.append(round(min(finite), 6))
        pack = lambda xs: struct.pack(f"<{len(xs)}f", *xs)  # noqa: E731
        w_bin(f"terrain/masks/{s['id']}.bin",
              lumen_header(b"LUMENMSK", MASK_ELEV_OFF, MASK_DIST_OFF, MASK_PAYLOAD, MASK_PAYLOAD) + pack(elev) + pack(dist))
        w_bin(f"terrain/sigma/{s['id']}.bin", lumen_header(b"LUMENSGM", 64, 0, MASK_PAYLOAD, 0) + pack(sig))
        w_json(f"terrain/masks/{s['id']}.json", hdr(
            "mask", version="1.0.0", **PROVENANCE, site_id=s["id"], bin_width_deg=BIN_DEG, azimuth_count=NBIN,
            azimuth_zero="projected_site_frame_reference", azimuth_direction="toward_site_frame_e",
            azimuth_center="i_plus_0.5_times_bin_width", heights_m=HEIGHTS_M, ray_range_km=250.0,
            near_field_resolution_m=s["nf"], d_min_m=3 * s["nf"], z0_m=0.0,
            median_filter_region_radius_m=100.0, median_filter_kernel_px=3, median_filter_status="applied",
            plane_fit_kernel_px=7, plane_fit_half_width_px=3, slope_deg=s["slope"], downhill_aspect_deg=s["aspect"],
            uphill_azimuth_deg=(s["aspect"] + 180) % 360, global_max_deg=gmax, global_min_deg=gmin,
            range_extrema={"strategy": "finite_segment_tree", "supports_circular_azimuth_ranges": True},
            near_zone_model="fitted_local_plane", dem_source="MOCK-DEM", binary=binary_descriptor("LUMENMSK"),
            mock_nan_bins=sorted(gaps)))
        w_json(f"terrain/sigma/{s['id']}.json", hdr(
            "sigma", version="1.0.0", **PROVENANCE, site_id=s["id"], bin_width_deg=BIN_DEG, azimuth_count=NBIN,
            shape=[4, NBIN], height_order_m=HEIGHTS_M, source="default", unit="deg",
            notes="mock default sigma ~0.1 deg", binary=binary_descriptor("LUMENSGM")))


def make_pad_disp_summaries():
    for s in SITES:
        if s["tier"] == "C":
            w_json(f"terrain/summaries/{s['id']}.json", hdr(
                "site_summary", version="0.1.0", site_id=s["id"], run_timestamp_utc="2026-01-01T00:00:00Z", tier="pending",
                near_field_res_m=None, dem_source=None,
                files_present={k: None for k in ("mask_bin", "mask_json", "sigma_bin", "sigma_json", "pad_json", "dispersion_bin", "dispersion_json")},
                pad_headline=None, psr=None))
            continue
        th = s["slope"]
        nf = s["nf"]
        up = (s["aspect"] + 180) % 360
        # ground normal in the site frame, rotated to MOON_ME (rows of the rotation matrix are n_ref, e, u)
        mat, _ = site_frame(s["lat"], s["lon"])
        la, aa = math.radians(th), math.radians(up)  # horizontal projection of g points uphill
        n_c, e_c, u_c = math.sin(la) * math.cos(aa), math.sin(la) * math.sin(aa), math.cos(la)
        g_me = [n_c * mat[1][i] + e_c * mat[0][i] + u_c * mat[2][i] for i in range(3)]  # mat rows: east, north_ref, up
        # 11x11 dispersion micro-grid, 50 m spacing. DRAFT layout (contract leaves it unresolved): slope uint8 (0.1 deg)
        grid = bytearray()
        for j in range(11):
            for i in range(11):
                v = th + 2.0 * math.sin(i * 0.7 + s["seed"]) * math.cos(j * 0.5)
                grid.append(max(0, min(255, round(max(0.0, v) * 10))))
        # The pad stats are DERIVED from the stored grid (same scatter, one source of truth): the badge and the histogram cannot disagree.
        # Percentiles use linear interpolation (numpy default); tolerance = the default hazard tolerance, 10 deg, "below" = strictly below.
        vals = sorted(g * 0.1 for g in grid)

        def pct(p):
            x = (len(vals) - 1) * p / 100.0
            lo = int(x)
            return vals[lo] + (x - lo) * (vals[min(lo + 1, len(vals) - 1)] - vals[lo])

        disp_stats = {"p50": round(pct(50), 3), "p95": round(pct(95), 3), "max": round(vals[-1], 3),
                      "pct_below_tolerance": round(100.0 * sum(1 for v in vals if v < 10.0) / len(vals), 3)}
        w_json(f"terrain/pad/{s['id']}.json", hdr(
            "pad", version="0.1.0", producer="lumen_pipeline.terrain.pad (mock)", created_utc="2026-01-01T00:00:00Z", site_id=s["id"],
            ground_normal_me=[round(x, 9) for x in g_me], slope_deg=th, downhill_aspect_deg=s["aspect"], uphill_az_deg=up,
            z0_m=0.0, d_min_m=3 * nf, near_field_resolution_m=nf, under_resolved=nf > 6,
            plane_fit={"k": 3, "window_px": [7, 7], "window_dim_m": [7 * nf, 7 * nf], "baseline_m": 6 * nf, "dem_source": "MOCK-DEM"},
            dispersion_slope_stats=disp_stats))
        w_json(f"terrain/dispersion/{s['id']}.json", hdr(
            "dispersion", version="0.1.0", producer="mock", created_utc="2026-01-01T00:00:00Z", git_commit="0" * 40, site_id=s["id"],
            bin_width_deg=0.5, observer_height_m=1.0, nodes=[11, 11], spacing_m=50, dtype="uint8", unit_deg=0.1,
            layout="DRAFT: slope only, row-major [row j][col i], j north; horizon bins/aspect not mocked"))
        w_bin(f"terrain/dispersion/{s['id']}.bin", bytes(grid))
        psr = None
        if s["psr"]:
            psr = {"distance_km": s["psr"][0], "bearing_deg": s["psr"][1], "nearest_psr_area_km2": s["psr"][2], "source_classification": "derived"}
        w_json(f"terrain/summaries/{s['id']}.json", hdr(
            "site_summary", version="0.1.0", site_id=s["id"], run_timestamp_utc="2026-01-01T00:00:00Z", tier="Tier A",
            near_field_res_m=nf, dem_source="MOCK-DEM",
            files_present={"mask_bin": f"masks/{s['id']}.bin", "mask_json": f"masks/{s['id']}.json", "sigma_bin": f"sigma/{s['id']}.bin",
                           "sigma_json": f"sigma/{s['id']}.json", "pad_json": f"pad/{s['id']}.json",
                           "dispersion_bin": f"dispersion/{s['id']}.bin", "dispersion_json": f"dispersion/{s['id']}.json"},
            pad_headline={"slope_deg": th, "downhill_aspect_deg": s["aspect"], "uphill_az_deg": up, "under_resolved": nf > 6}, psr=psr))


# ---------------------------------------------------------------- Tier-B tile + sigma calibration

TILE_BINS = 720


def make_tierb():
    # Use the production serializer so frontend mocks exercise the frozen layout.
    spec = TileSpec(0, 0, 2000)
    _, _, latitude, longitude = _tile_coordinates(spec)
    n = latitude.size
    mask = -10.0 + ((np.arange(n)[:, None] + np.arange(TILE_BINS)[None, :]) % 20000) * 0.01
    mask = mask.astype(np.float32)
    mask[0, :3] = [-10.0, np.nan, 0.0]
    tile = TierBTile(
        spec=spec,
        latitude_deg=latitude.astype(np.float32),
        longitude_deg=longitude.astype(np.float32),
        mask_deg=mask,
        slope_deg=np.arange(n, dtype=np.float32) * 0.01,
        downhill_aspect_deg=np.arange(n, dtype=np.float32) * 0.01,
        z0_m=-50.0 + np.arange(n, dtype=np.float32) * 0.25,
        d_min_m=60.0 + (np.arange(n, dtype=np.float32) % 2) * 30.0,
        provenance={"synthetic": True, "serialization_only": True},
    )
    terrain_root = OUT / "terrain"
    legacy = terrain_root / "tierb" / "tiles" / "s90_000.bin"
    legacy.unlink(missing_ok=True)
    entry = write_tile(tile, terrain_root)
    write_index([entry], terrain_root)


def make_sigma_summary():
    w_json("terrain/sigma/sigma.json", hdr(
        "sigma_summary", tierA_default_deg=0.1, tierB_default_deg=0.5,
        tierB_calibrated=[{"max_snap_km": 1, "sigma_deg": 0.3}, {"max_snap_km": 2, "sigma_deg": 0.45}, {"max_snap_km": 4, "sigma_deg": 0.6}],
        mc={"clones": 30, "sites": ["im2_athena", "shackleton_ridge"]}))


# ---------------------------------------------------------------- PSR raster, layers, regions

PSR_N = 80
PSR_HALF_KM = 304.0
EXTENTS = {"80S": 80, "85S": 85}


def ext_radius_km(lat_limit: int) -> float:
    return 2 * R_MOON_M * math.tan(math.radians(90 - lat_limit) / 2) / 1000.0


FAKE_PSRS = [(-20.0, 15.0, 12.0), (30.0, -40.0, 20.0), (-60.0, -80.0, 30.0), (150.0, 90.0, 25.0)]  # x,y,radius km


def psr_dist_km(x, y):
    return max(0.0, min(math.hypot(x - cx, y - cy) - r for cx, cy, r in FAKE_PSRS))


def make_psr():
    px = (2 * PSR_HALF_KM) / PSR_N
    buf = bytearray()
    for j in range(PSR_N):
        for i in range(PSR_N):
            x = -PSR_HALF_KM + (i + 0.5) * px
            y = PSR_HALF_KM - (j + 0.5) * px
            buf += struct.pack("<H", min(65535, round(psr_dist_km(x, y) * 100)))
    w_bin("terrain/psr/psr_distance.bin", bytes(buf))
    w_json("terrain/psr/psr_distance.json", hdr(
        "psr_distance", size_px=[PSR_N, PSR_N], pixel_m=px * 1000, half_extent_km=PSR_HALF_KM, dtype="uint16", unit_km=0.01,
        projection={"type": "polar_stereographic_south", "radius_m": R_MOON_M, "x": "r*sin(lon)", "y": "r*cos(lon)", "r": "2R*tan(colat/2)"},
        origin="top-left pixel centre at (-half+px/2, +half-px/2) km", source="derived", psr_threshold_pct=0.1, min_area_km2=0.1))


def png(path: Path, w: int, h: int, rgba) -> None:
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            raw += bytes(rgba(x, y))

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    data += chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


LAYERS = [
    ("illumination", "Average Illumination", [[0, "0 %", "#1b1b2f"], [0.5, "50 %", "#8a8a5c"], [1, "100 %", "#fff3b0"]]),
    ("earth_visibility", "Earth Visibility", [[0, "0 %", "#1e2a4a"], [0.5, "50 %", "#3d7ea6"], [1, "100 %", "#9fe0f6"]]),
    ("slope_hazard", "Slope Hazard", [[0, "<5°", "#44aa99"], [0.33, "5–10°", "#ddcc77"], [0.66, "10–15°", "#cc6677"], [1, ">15°", "#882255"]]),
    ("psr", "PSR (derived)", [[0, "no", "#000000"], [1, "permanently shadowed region (a cold trap that may host ice)", "#1e3cc8"]]),
    ("psr_distance", "Distance to PSR", [[0, "0 km", "#ff0000"], [1, "200 km", "#00b4ff"]]),
]
PNG_SIZE = 256


def make_layers():
    entries = []
    for ext_id, lat_limit in EXTENTS.items():
        half = ext_radius_km(lat_limit)
        for lid, label, stops in LAYERS:
            def px_fn(x, y, lid=lid, half=half):
                xx = (x + 0.5 - PNG_SIZE / 2) / (PNG_SIZE / 2) * half
                yy = -(y + 0.5 - PNG_SIZE / 2) / (PNG_SIZE / 2) * half
                r = math.hypot(xx, yy)
                if r > half:
                    return (0, 0, 0, 0)
                inpsr = psr_dist_km(xx, yy) == 0.0
                if lid == "illumination":
                    v = max(0.0, min(1.0, 0.2 + 0.6 * (0.5 + 0.5 * math.sin(xx / 25) * math.cos(yy / 31)) - (0.2 if inpsr else 0)))
                    g = round(40 + 215 * v)
                    return (g, g, round(g * 0.6), 220)
                if lid == "earth_visibility":
                    v = 0.5 + 0.5 * math.cos(math.atan2(xx, yy) - 0.5)
                    return (round(30 + 40 * v), round(80 + 120 * v), round(120 + 120 * v), 220)
                if lid == "slope_hazard":
                    v = 0.5 + 0.5 * math.sin(xx / 15) * math.sin(yy / 19)
                    return [(68, 170, 153), (221, 204, 119), (204, 102, 119), (136, 34, 85)][min(3, int(v * 4))] + (200,)
                if lid == "psr":
                    return (30, 60, 200, 230) if inpsr else (0, 0, 0, 0)
                v = min(1.0, psr_dist_km(xx, yy) / 200.0)
                return (round(255 * (1 - v)), round(180 * v), round(255 * v), 200)

            fn = f"{lid}_{ext_id}.png"
            png(OUT / "terrain" / "layers" / fn, PNG_SIZE, PNG_SIZE, px_fn)
            entries.append({
                "layer_id": lid, "name": label, "extent": {"80S": "80_90S", "85S": "85_90S"}[ext_id], "filename": fn,
                "projection": {"type": "polar_stereographic_south", "radius_m": R_MOON_M, "central_meridian_deg": 0.0, "standard_parallel_deg": -90.0,
                               "r": "2R*tan(colat/2)", "x": "r*sin(lon_east)", "y": "r*cos(lon_east)", "px": "cx + x/mpp", "py": "cy - y/mpp",
                               "size_px": [PNG_SIZE, PNG_SIZE], "centre_px": [PNG_SIZE / 2, PNG_SIZE / 2], "lat_limit_deg": -lat_limit,
                               "half_extent_km": half, "metres_per_px": half * 1000 / (PNG_SIZE / 2),
                               "status": "DRAFT: projection parameters not frozen (data_terrain_misc.md 5.4)"},
                "legend_stops": [{"value": v, "label": lb, "hex": hx} for v, lb, hx in stops],
                "source_citation": "MOCK (synthetic raster)", "derived": lid in ("psr", "psr_distance")})
    w_json("terrain/layers.json", hdr("layers", version="0.1.0", layers=entries))


REGIONS = [("mock_region_1", "MOCK region 1", -89.3, 60.0, 20.0), ("mock_region_2", "MOCK region 2", -86.9, 200.0, 25.0),
           ("mock_region_3", "MOCK region 3", -85.4, 310.0, 30.0)]


def make_regions():
    half = ext_radius_km(80)
    out = []
    for rid, name, lat, lon, rad in REGIONS:
        x, y = polar_xy_km(lat, lon)
        cy = -y  # svg y is flipped
        d = f"M {x - rad:.2f} {cy:.2f} a {rad} {rad} 0 1 0 {2 * rad} 0 a {rad} {rad} 0 1 0 {-2 * rad} 0 Z"
        out.append({"region_id": rid, "name": name, "centroid_lat_deg": lat, "centroid_lon_deg": lon, "svg_path": d,
                    "projection": {"type": "polar_stereographic_south", "units": "km", "y_flipped": True, "half_extent_km": half,
                                   "status": "DRAFT: shared with layers"}})
    w_json("terrain/regions.json", hdr("regions", version="0.1.0", regions=out))


# ---------------------------------------------------------------- catalog + sparklines

SPARK_DAYS = 400
SPARK_START = epoch_s(2025, 1, 1)


def make_sparklines():
    buf = bytearray()
    for s in SITES:
        for series in range(2):
            for d in range(SPARK_DAYS):
                if s["tier"] == "C":  # smooth-Moon site: gentle monthly cycle only
                    v = 48 + 5 * math.sin(2 * math.pi * d / 29.53)
                else:
                    v = 50 + 40 * math.sin(2 * math.pi * d / (29.53 * (1.0 if series == 0 else 0.93)) + s["seed"] * 0.9 + series * 1.2)
                buf.append(max(0, min(100, round(v))))
    w_array("catalog/sparklines.bin", bytes(buf), shape=(len(SITES), 2, SPARK_DAYS), dtype="uint8", fields=["sunlit_pct", "link_pct"], units="percent",
            start_utc=iso(SPARK_START), days=SPARK_DAYS, sites=[s["id"] for s in SITES],
            definitions="mock defaults (2 m, 50% disk, Earth >=1 deg + DSN >=10 deg)",
            note="DRAFT extras: sites/start_utc/days are not yet in data_catalog.md; layout [site][series][day]")


def make_catalog():
    """Mirrors the real sites.json: terrain info nested under `terrain`, rotation rows (east, north_ref, up), coords {lat, lon, source}."""
    sites = []
    for idx, s in enumerate(SITES):
        mat, ref = site_frame(s["lat"], s["lon"])
        tier_c = s["tier"] == "C"
        psr = s["psr"]
        is_cy3 = s["id"] == "cy3_shiv_shakti"
        terrain = {"status": "pending" if tier_c else "ready", "near_field_res_m": s["nf"],
                   "mask": None if tier_c else f"masks/{s['id']}.json",
                   "sigma": None if tier_c else {"source": "default", "default_deg": 0.1, "file": f"sigma/{s['id']}.json"},
                   "pad": None if tier_c else {"file": f"pad/{s['id']}.json", "slope_deg": s["slope"], "downhill_aspect_deg": s["aspect"]},
                   "dispersion_file": None if tier_c else f"dispersion/{s['id']}.json",
                   "psr": None if not psr else {"distance_km": psr[0], "bearing_deg": psr[1], "nearest_psr_area_km2": psr[2], "source": "derived"}}
        rec = {
            "id": s["id"], "name": s["name"], "category": s["cat"], "agency": s["agency"], "program": "MOCK",
            "latitude_deg": s["lat"], "longitude_deg_east": s["lon"], "coordinate_frame": "MOON_ME_DE421",
            "landing_coords": {"lat": s["lat"], "lon": s["lon"], "source": "mock"},
            "target_coords": ({"lat": -69.367621, "lon": 32.348126, "source": "mock"} if is_cy3 else None),
            "coord_note": "mock coordinate" if not is_cy3 else "mock; landing and target ~350 m apart", "notes": MOCK_NOTE,
            "touchdown_utc": s["touchdown"], "touchdown_precision": s["prec"], "last_contact_utc": None,
            "reference_axis": ref, "rotation_matrix": mat, "tier": s["tier"], "terrain": terrain,
            "source_url": "https://example.invalid/mock", "source_type": "mock", "verification_status": "mock", "verified_by": None,
        }
        sites.append(rec)
    w_json("catalog/sites.json", hdr("catalog", coordinate_frame="MOON_ME_DE421", sites=sites))


# ---------------------------------------------------------------- golden, validation, manifest


def make_golden():
    for n in (1, 2):
        w_json(f"golden/golden_set{n}.json", hdr(
            "golden", set=n, cases=[], tolerances={"elevation_deg": 0.01, "time_s": 10},
            note="Empty on purpose: real vectors come from Gowri (H7:30 / H12). Parity tests must SKIP while cases is empty."))


def make_validation():
    gates = [{"id": f"G{i}", "description": f"mock gate {i}", "metric": "n/a", "threshold": None, "value": None, "pass": None, "chart": None}
             for i in range(0, 14)]
    w_json("validation/report.json", hdr("validation_report", gates=gates))
    (OUT / "validation" / "charts").mkdir(parents=True, exist_ok=True)


def make_manifest():
    files = sorted(str(p.relative_to(OUT)) for p in OUT.rglob("*") if p.is_file() and p.name not in (".gitkeep", "manifest.json")
                   and "terrain" in p.parts)
    w_json("terrain/manifest.json", hdr("terrain_manifest", files=files))


def clean() -> None:
    """Remove previously generated files (keeps README.md and .gitkeep) so stale outputs can never linger."""
    for f in OUT.rglob("*"):
        if f.is_file() and f.name not in (".gitkeep", "README.md"):
            f.unlink()


def main() -> None:
    random.seed(0)
    clean()
    make_ephem()
    make_dsn()
    make_masks()
    make_pad_disp_summaries()
    make_tierb()
    make_sigma_summary()
    make_psr()
    make_layers()
    make_regions()
    make_sparklines()
    make_catalog()
    make_golden()
    make_validation()
    make_manifest()
    total = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    print(f"wrote mock dataset to {OUT} ({total / 1024:.0f} KiB)")


if __name__ == "__main__":
    main()
