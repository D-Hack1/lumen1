# Owner: Gowri
"""G8 comparison of LUMEN elevations against documented PGDA values."""

from __future__ import annotations

import argparse
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from lumen_pipeline.common.timeutil import parse_utc
from lumen_pipeline.reference.interp import Ephemeris

ElevationAt = Callable[[str, float, float, float, str], float]


def default_reference_path() -> Path:
    """Return the required, externally sourced PGDA comparison input path."""
    return Path(__file__).resolve().parents[2] / "data" / "validation" / "pgda_reference.json"


def _required(record: dict[str, Any], key: str) -> Any:
    if key not in record:
        raise ValueError(f"PGDA reference record is missing {key}")
    return record[key]


def evaluate_records(
    source: str, version: str, records: list[dict[str, Any]], elevation_at: ElevationAt
) -> dict[str, Any]:
    """Compare documented point elevations and return a reproducible G8 report."""
    comparisons = []
    for record in records:
        site = _required(record, "site")
        timestamp_utc = _required(record, "timestamp_utc")
        body = _required(record, "body")
        reference = float(_required(record, "elevation_deg"))
        tolerance = float(_required(record, "tolerance_deg"))
        if body not in {"sun", "earth"} or tolerance < 0:
            raise ValueError("PGDA records require a sun or earth body and non-negative tolerance_deg")
        latitude = float(_required(site, "latitude_deg"))
        longitude = float(_required(site, "longitude_deg_east"))
        height = float(site.get("height_m", 0.0))
        computed = elevation_at(body, latitude, longitude, height, timestamp_utc)
        absolute_error = abs(computed - reference)
        comparisons.append(
            {
                "site_id": _required(site, "id"),
                "latitude_deg": latitude,
                "longitude_deg_east": longitude,
                "height_m": height,
                "timestamp_utc": timestamp_utc,
                "body": body,
                "computed_elevation_deg": computed,
                "reference_elevation_deg": reference,
                "absolute_error_deg": absolute_error,
                "tolerance_deg": tolerance,
                "status": "PASS" if absolute_error <= tolerance else "FAIL",
            }
        )
    return {
        "gate": "G8",
        "source": source,
        "version": version,
        "status": "PASS" if comparisons and all(item["status"] == "PASS" for item in comparisons) else "FAIL",
        "comparisons": comparisons,
    }


def compare_pgda(reference_path: str | Path, ephemeris_path: str | Path) -> dict[str, Any]:
    """Run G8 when documented PGDA values are available, otherwise report BLOCKED."""
    path = Path(reference_path)
    if not path.exists():
        return {
            "gate": "G8",
            "status": "BLOCKED",
            "reason": f"documented PGDA reference data is missing: {path}",
            "comparisons": [],
        }
    payload = json.loads(path.read_text(encoding="utf-8"))
    source = _required(payload, "source")
    version = _required(payload, "version")
    records = _required(payload, "records")
    if not isinstance(source, str) or not isinstance(version, str) or not isinstance(records, list):
        raise TypeError("PGDA references require string source/version and a records list")
    ephemeris = Ephemeris.from_file(ephemeris_path)
    start_utc = json.loads(Path(ephemeris_path).with_suffix(".json").read_text(encoding="utf-8"))["start_utc"]
    start = parse_utc(start_utc)

    def elevation_at(body: str, latitude: float, longitude: float, height: float, timestamp_utc: str) -> float:
        timestamp = parse_utc(timestamp_utc)
        et = ephemeris.start_et + (timestamp - start).total_seconds()
        return ephemeris.body_at(body, et, latitude, longitude, height).elevation_deg

    return evaluate_records(source, version, records, elevation_at)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--references", type=Path, default=default_reference_path())
    parser.add_argument("--ephem", type=Path, default=Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "ephem" / "ephem.bin")
    args = parser.parse_args()
    print(json.dumps(compare_pgda(args.references, args.ephem), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
