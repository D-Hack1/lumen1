# Owner: Gowri Arun (catalog) / Shiva Shakthi (terrain) — added by Ebin as a verification aid
"""Sanity-check a site's coordinates against the PGDA average-illumination map (85-90S layer, 60 m/px).

Why: a catalogue row whose coordinates sit in permanent shadow cannot be a "near-perpetual light" site, and the engine will
(correctly) report ~0 % sunlit for it. This prints, for each site, the illumination AT the point, the mean over ~1.5 km
around it, and the brightest local maxima within 12 km — so a wrong latitude/longitude is obvious before a mask is built.

It reads only the published layer (web/public/data/terrain/layers/average_illumination_85_90S.{png,json}). The map is
colour-coded; values are recovered from the legend stops in the sidecar (nearest point on the legend ramp), so they are
good to a few percent — enough to tell 0 % from 50 %, not for science.

Run from pipeline/:   python scripts/check_site_illumination.py                 # every site in config/sites.yaml
                      python scripts/check_site_illumination.py --lat -89.45 --lon 222.6
Needs numpy, scipy, Pillow, pyyaml (no GIS stack). Sites outside 85-90S are reported as "outside the map".
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import maximum_filter, uniform_filter

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parents[2]
LAYER = ROOT / "web" / "public" / "data" / "terrain" / "layers" / "average_illumination_85_90S"
R_M = 1_737_400.0


class IlluminationMap:
    def __init__(self, layer: Path = LAYER):
        meta = json.loads(layer.with_suffix(".json").read_text(encoding="utf-8"))
        self.res = float(meta["resolution_m"])
        self.radius = float(meta["radius_m"])
        stops = sorted((s["value_pct"], tuple(int(s["hex"][i : i + 2], 16) for i in (1, 3, 5))) for s in meta["legend_stops"])
        self._v = np.linspace(0.0, 100.0, 1001)
        self._c = np.stack([np.interp(self._v, [v for v, _ in stops], [c[i] for _, c in stops]) for i in range(3)], 1)
        img = np.asarray(Image.open(layer.with_suffix(".png")).convert("RGBA"))
        self.n = img.shape[0]
        rgb = img[..., :3].reshape(-1, 3)
        uniq, inv = np.unique(rgb, axis=0, return_inverse=True)
        lut = np.array([self._v[((self._c - u.astype(float)) ** 2).sum(1).argmin()] for u in uniq])
        field = lut[inv.reshape(-1)].reshape(self.n, self.n)
        field[img[..., 3] < 128] = np.nan  # transparent = no data
        self.field = field

    def project(self, lat: float, lon: float) -> tuple[float, float]:
        rho = 2 * R_M * math.tan(math.radians(90 + lat) / 2)
        return rho * math.sin(math.radians(lon)), rho * math.cos(math.radians(lon))  # 0 E up (south-polar stereographic)

    def unproject(self, x: float, y: float) -> tuple[float, float]:
        colat = 2 * math.atan(math.hypot(x, y) / (2 * R_M))
        return -(90 - math.degrees(colat)), (math.degrees(math.atan2(x, y)) + 360) % 360

    def pixel(self, x: float, y: float) -> tuple[int, int]:
        return int(round((self.radius - y) / self.res)), int(round((x + self.radius) / self.res))  # row, col

    def at(self, lat: float, lon: float) -> float | None:
        x, y = self.project(lat, lon)
        r, c = self.pixel(x, y)
        return float(self.field[r, c]) if 0 <= r < self.n and 0 <= c < self.n else None

    def mean_within(self, lat: float, lon: float, half_m: float = 1500.0) -> float | None:
        x, y = self.project(lat, lon)
        r, c = self.pixel(x, y)
        k = int(half_m / self.res)
        if not (k <= r < self.n - k and k <= c < self.n - k):
            return None
        return float(np.nanmean(self.field[r - k : r + k + 1, c - k : c + k + 1]))

    def bright_spots(self, lat: float, lon: float, within_km: float = 12.0, min_pct: float = 45.0, top: int = 4):
        """Local maxima of the 7x7-smoothed field (a lander footprint is hundreds of metres) near a point."""
        x0, y0 = self.project(lat, lon)
        r0, c0 = self.pixel(x0, y0)
        k = int(within_km * 1000 / self.res)
        r1, r2, c1, c2 = max(0, r0 - k), min(self.n, r0 + k + 1), max(0, c0 - k), min(self.n, c0 + k + 1)
        sub = np.nan_to_num(self.field[r1:r2, c1:c2], nan=0.0)
        smooth = uniform_filter(sub, size=7)
        peaks = (smooth == maximum_filter(smooth, size=int(3000 / self.res) * 2 + 1)) & (smooth >= min_pct)
        out = []
        for j, i in zip(*np.where(peaks)):
            x, y = (c1 + i) * self.res - self.radius, self.radius - (r1 + j) * self.res
            if math.hypot(x - x0, y - y0) <= within_km * 1000:
                out.append((float(smooth[j, i]), *self.unproject(x, y), math.hypot(x - x0, y - y0) / 1000))
        return sorted(out, reverse=True)[:top]


def _sites() -> list[tuple[str, float, float]]:
    import yaml

    cfg = yaml.safe_load((ROOT / "pipeline" / "config" / "sites.yaml").read_text(encoding="utf-8"))
    out = []
    for s in cfg.get("sites", []):
        lat = s.get("latitude_deg", s.get("lat"))
        lon = s.get("longitude_deg_east", s.get("longitude_deg", s.get("lon")))
        if lat is not None and lon is not None:
            out.append((s["id"], float(lat), float(lon)))
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--lat", type=float)
    ap.add_argument("--lon", type=float, help="degrees EAST, 0-360 or -180..180")
    args = ap.parse_args(argv)
    m = IlluminationMap()
    targets = [("point", args.lat, args.lon)] if args.lat is not None and args.lon is not None else _sites()
    for name, lat, lon in targets:
        here = m.at(lat, lon)
        if here is None:
            print(f"{name:18s} lat {lat:8.3f} lon {lon:8.2f}E   outside the 85-90S map")
            continue
        mean = m.mean_within(lat, lon)
        flag = "  <-- in PERMANENT SHADOW at these coordinates" if here == here and here < 1.0 and (mean is None or mean < 3.0) else ""
        print(f"{name:18s} lat {lat:8.3f} lon {lon:8.2f}E   at point {here:5.1f}%   mean(1.5 km) {mean if mean is None else round(mean, 1)}%{flag}")
        for v, la, lo, d in m.bright_spots(lat, lon):
            print(f"{'':18s}   bright spot {v:5.1f}%  lat {la:8.3f}  lon {lo:7.2f}E   {d:4.1f} km away")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
