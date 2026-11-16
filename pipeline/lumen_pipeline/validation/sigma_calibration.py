# Owner: Gowri
# Tier-B sigma calibration against Tier-A (G10).

"""Deterministic G10 event-time coverage calibration.

Input event times and sigmas are seconds.  Distance bands are supplied by the
Tier-B producer; this module deliberately has no invented geographic cutoffs.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

TARGET_COVERAGE = 0.68
VERSION = "0.1.0"


def default_output_path() -> Path:
    return Path(__file__).resolve().parents[2] / "reports" / "g10_sigma_calibration.json"


def _validated_events(
    events: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    valid: list[dict[str, Any]] = []
    missing: list[dict[str, str]] = []
    for index, event in enumerate(events):
        try:
            site_id = str(event["site_id"])
            event_type = str(event["event_type"])
            band = str(event["distance_band"])
            tier_a = float(event["tier_a_time_s"])
            tier_b = float(event["tier_b_time_s"])
            sigma = float(event["tier_b_sigma_s"])
            if (
                not site_id
                or not event_type
                or not band
                or sigma <= 0
                or not all(math.isfinite(value) for value in (tier_a, tier_b, sigma))
            ):
                raise ValueError("empty identifier, non-finite time, or non-positive sigma")
        except (KeyError, TypeError, ValueError) as error:
            missing.append({"index": str(index), "reason": str(error)})
            continue
        valid.append(
            {
                "site_id": site_id,
                "event_type": event_type,
                "distance_band": band,
                "tier_a_time_s": tier_a,
                "tier_b_time_s": tier_b,
                "tier_b_sigma_s": sigma,
            }
        )
    return (
        sorted(
            valid,
            key=lambda event: (
                event["distance_band"],
                event["site_id"],
                event["event_type"],
                event["tier_a_time_s"],
                event["tier_b_time_s"],
            ),
        ),
        missing,
    )


def calibrate(
    events: list[dict[str, Any]], *, provenance: dict[str, Any], authentic_tierb: bool
) -> dict[str, Any]:
    """Inflate each supplied distance band until empirical coverage reaches 68%.

    Synthetic test data may exercise this function but is never eligible for a
    scientific PASS: only an explicitly authentic Tier-B source can qualify.
    """
    valid, missing = _validated_events(events)
    if not authentic_tierb:
        return {
            "version": VERSION,
            "status": "BLOCKED",
            "reason": "authentic Tier-B event and sigma inputs are required",
            "sample_count": len(valid),
            "missing_events": missing,
            "provenance": provenance,
        }
    if not valid:
        return {
            "version": VERSION,
            "status": "BLOCKED",
            "reason": "no valid matched Tier-A/Tier-B events",
            "sample_count": 0,
            "missing_events": missing,
            "provenance": provenance,
        }
    bands: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in valid:
        bands[event["distance_band"]].append(event)
    result: dict[str, Any] = {}
    covered_before = covered_after = 0
    for band, rows in sorted(bands.items()):
        ratios = sorted(
            abs(row["tier_b_time_s"] - row["tier_a_time_s"]) / row["tier_b_sigma_s"] for row in rows
        )
        factor = max(1.0, ratios[math.ceil(TARGET_COVERAGE * len(ratios)) - 1])
        before = sum(ratio <= 1.0 for ratio in ratios)
        after = sum(ratio <= factor for ratio in ratios)
        covered_before += before
        covered_after += after
        result[band] = {
            "sample_count": len(rows),
            "coverage_before": before / len(rows),
            "coverage_after": after / len(rows),
            "sigma_multiplier": factor,
            "unit": "s",
            "event_types": sorted({row["event_type"] for row in rows}),
        }
    return {
        "version": VERSION,
        "status": "PASS" if covered_after / len(valid) >= TARGET_COVERAGE else "FAIL",
        "criterion_coverage": TARGET_COVERAGE,
        "time_unit": "s",
        "sample_count": len(valid),
        "coverage_before": covered_before / len(valid),
        "coverage_after": covered_after / len(valid),
        "bands": result,
        "missing_events": missing,
        "provenance": provenance,
    }


def write_calibration(
    events: list[dict[str, Any]],
    *,
    provenance: dict[str, Any],
    authentic_tierb: bool,
    output_path: str | Path | None = None,
) -> dict[str, Any]:
    record = calibrate(events, provenance=provenance, authentic_tierb=authentic_tierb)
    path = Path(output_path) if output_path is not None else default_output_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return record
