"""Generate the geometry-only IM-2 golden set 1 for browser parity tests."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from pathlib import Path
from typing import Literal

from lumen_pipeline.common.timeutil import et_to_utc, utc_to_et
from lumen_pipeline.ephem.kernels import loaded_kernels
from lumen_pipeline.reference.events import EnvelopeBounds, detect_events, sample_times
from lumen_pipeline.reference.interp import Ephemeris
from lumen_pipeline.reference.metrics import (
    bounded,
    first_pass_metrics,
    longest_window_gap_hours,
    window_duration_seconds,
    window_percentage,
)
from lumen_pipeline.reference.visibility import Horizon, availability
from lumen_pipeline.reference.windows import resolve_min_sun_elevation_ops, windows_from_events

IM2_LATITUDE_DEG = -84.7906
IM2_LONGITUDE_DEG_EAST = 29.1957
IM2_TOUCHDOWN_UTC = "2025-03-06T17:28:50Z"
GOLDEN_DURATION_DAYS = 30


def default_ephemeris_path() -> Path:
    return Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "ephem" / "ephem.bin"


def default_output_path() -> Path:
    return Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "golden" / "golden_set1.json"


def _iso(et: float) -> str:
    return et_to_utc(et, precision=0)


def build_golden_set(
    output_path: str | Path | None = None,
    ephemeris_path: str | Path | None = None,
    *,
    min_sun_elevation_ops_deg: float = 0.0,
    definitions_preset: str | None = None,
) -> dict[str, object]:
    """Write G-8's reproducible, event-refined IM-2 smooth-sphere baseline."""
    output = Path(output_path) if output_path is not None else default_output_path()
    ephem_path = Path(ephemeris_path) if ephemeris_path is not None else default_ephemeris_path()
    ephemeris = Ephemeris.from_file(ephem_path)
    horizon = Horizon(observer_height_m=2.0)
    resolved_ops_elevation = resolve_min_sun_elevation_ops(
        min_sun_elevation_ops_deg, definitions_preset
    )
    definitions = {
        "sun_disk_threshold": 0.5,
        "earth_disk_threshold": 0.5,
        "earth_margin_deg": 1.0,
        "minSunElevationOps": resolved_ops_elevation,
        "definitionsPreset": definitions_preset,
    }
    with loaded_kernels():
        start_et = utc_to_et(IM2_TOUCHDOWN_UTC)
        end_et = start_et + GOLDEN_DURATION_DAYS * 86400.0
        times = sample_times(start_et, end_et)

        def state(et: float) -> dict[str, object]:
            sun = ephemeris.body_at("sun", et, IM2_LATITUDE_DEG, IM2_LONGITUDE_DEG_EAST, 2.0)
            earth = ephemeris.body_at("earth", et, IM2_LATITUDE_DEG, IM2_LONGITUDE_DEG_EAST, 2.0)
            sun_disk, sun_clearance, sun_up = availability(
                "sun", sun.elevation_deg, sun.azimuth_deg, sun.distance_km, horizon,
                disk_threshold=definitions["sun_disk_threshold"],
                min_sun_elevation_ops_deg=resolved_ops_elevation,
            )
            earth_disk, earth_clearance, earth_up = availability(
                "earth", earth.elevation_deg, earth.azimuth_deg, earth.distance_km, horizon,
                disk_threshold=definitions["earth_disk_threshold"], margin_deg=definitions["earth_margin_deg"],
            )
            return {
                "sun": sun, "earth": earth, "sun_disk": sun_disk, "earth_disk": earth_disk,
                "sun_clearance": sun_clearance, "earth_clearance": earth_clearance,
                "sun_up": sun_up, "earth_up": earth_up,
            }

        samples = [state(et) for et in times]
        # Smooth-sphere geometry has no caller-proven interval envelope, so this
        # guard intentionally forces R3's safe two-minute refinement fallback.
        unproven_envelope = lambda _left, _right: EnvelopeBounds(-90.0, 90.0, 0.0, 180.0, 90.0, False)
        sun_events = detect_events(
            start_et,
            end_et,
            lambda et: bool(state(et)["sun_up"]),
            down="sunset",
            up="shadowExit",
            horizon=horizon,
            envelope_bounds=unproven_envelope,
        )
        earth_events = detect_events(
            start_et,
            end_et,
            lambda et: bool(state(et)["earth_up"]),
            down="earthset",
            up="earthrise",
            horizon=horizon,
            envelope_bounds=unproven_envelope,
        )
        def ops_up(et: float) -> bool:
            sample = state(et)
            return bool(sample["sun_up"]) and bool(sample["earth_up"])

        ops_events = detect_events(
            start_et,
            end_et,
            ops_up,
            down="opsEnd",
            up="opsStart",
            horizon=horizon,
            envelope_bounds=unproven_envelope,
        )
        sun_visible = [bool(sample["sun_up"]) for sample in samples]
        earth_visible = [bool(sample["earth_up"]) for sample in samples]
        sun_elevation = [sample["sun"].elevation_deg for sample in samples]  # type: ignore[union-attr]
        earth_elevation = [sample["earth"].elevation_deg for sample in samples]  # type: ignore[union-attr]
        sun_clearance = [float(sample["sun_clearance"]) for sample in samples]
        earth_clearance = [float(sample["earth_clearance"]) for sample in samples]
        sun_disk = [float(sample["sun_disk"]) for sample in samples]
        sampled_metrics = first_pass_metrics(
            times, sun_visible, earth_visible, sun_elevation, earth_elevation, sun_clearance, earth_clearance, sun_disk
        )

        def peak_elevation(body: Literal["sun", "earth"]) -> Callable[[float, float], float]:
            elevations = sun_elevation if body == "sun" else earth_elevation

            def peak(start_et: float, end_et: float) -> float:
                values = [
                    ephemeris.body_at(body, start_et, IM2_LATITUDE_DEG, IM2_LONGITUDE_DEG_EAST, 2.0).elevation_deg,
                    ephemeris.body_at(body, end_et, IM2_LATITUDE_DEG, IM2_LONGITUDE_DEG_EAST, 2.0).elevation_deg,
                ]
                values.extend(
                    elevations[index] for index, et in enumerate(times) if start_et < et < end_et
                )
                return max(values)

            return peak

        sun_windows = windows_from_events(
            "sun",
            start_et,
            end_et,
            sun_visible[0],
            sun_events,
            down_event="sunset",
            up_event="shadowExit",
            peak_elevation_deg=peak_elevation("sun"),
        )
        earth_windows = windows_from_events(
            "earth",
            start_et,
            end_et,
            earth_visible[0],
            earth_events,
            down_event="earthset",
            up_event="earthrise",
            peak_elevation_deg=peak_elevation("earth"),
        )
        ops_windows = windows_from_events(
            "ops",
            start_et,
            end_et,
            ops_up(start_et),
            ops_events,
            down_event="opsEnd",
            up_event="opsStart",
            peak_elevation_deg=peak_elevation("sun"),
        )
        sunlit_pct = window_percentage(start_et, end_et, sun_windows)
        earth_visible_pct = window_percentage(start_et, end_et, earth_windows)
        metrics = dict(sampled_metrics)
        metrics.update(
            {
                "sunlitPct": bounded(sunlit_pct),
                "earthVisiblePct": bounded(earth_visible_pct),
                "linkPct": bounded(earth_visible_pct),
                "longestNightH": bounded(longest_window_gap_hours(start_et, end_et, sun_windows)),
                "longestCommGapH": bounded(longest_window_gap_hours(start_et, end_et, earth_windows)),
                "opsHours": bounded(window_duration_seconds(ops_windows) / 3600.0),
            }
        )
        windows = sun_windows + earth_windows + ops_windows
        render = [
            {
                "utc": _iso(et),
                "sun": {"azimuth_deg": sample["sun"].azimuth_deg, "elevation_deg": sample["sun"].elevation_deg, "disk_fraction": sample["sun_disk"], "clearance_deg": sample["sun_clearance"], "up": sample["sun_up"]},  # type: ignore[union-attr]
                "earth": {"azimuth_deg": sample["earth"].azimuth_deg, "elevation_deg": sample["earth"].elevation_deg, "disk_fraction": sample["earth_disk"], "clearance_deg": sample["earth_clearance"], "up": sample["earth_up"], "range_km": sample["earth"].distance_km},  # type: ignore[union-attr]
            }
            for index, (et, sample) in enumerate(zip(times, samples, strict=True))
            if index % 30 == 0
        ]
        case = {
            "id": "im2_touchdown_smooth_sphere_30d",
            "input": {
                "site_id": "im2_athena",
                "latitude_deg": IM2_LATITUDE_DEG,
                "longitude_deg_east": IM2_LONGITUDE_DEG_EAST,
                "coordinate_frame": ephemeris.frame,
                "start_utc": IM2_TOUCHDOWN_UTC,
                "duration_days": GOLDEN_DURATION_DAYS,
                "observer_height_m": 2.0,
                "terrain_mode": "smooth_sphere_pending_im2_mask",
                "definitions": definitions,
            },
            "events": [{"type": event.type, "utc": _iso(event.et), "dt_method": event.dt_method, "grazing_reason": event.grazing_reason} for event in sun_events + earth_events],
            "ops_events": [{"type": event.type, "utc": _iso(event.et), "dt_method": event.dt_method, "grazing_reason": event.grazing_reason} for event in ops_events],
            "windows": [{"type": window.type, "start_utc": _iso(window.start_et), "end_utc": _iso(window.end_et), "duration_h": window.duration_hours, "peak_elevation_deg": window.peak_elevation_deg, "flags": {"grazing": False, "partial_start": window.partial_start, "partial_end": window.partial_end}} for window in windows],
            "metrics": metrics,
            "link_metric_source": "earth_visibility_fallback_no_dsn",
            "render_samples_hourly": render,
            "unavailable": ["terrain_mask", "terrain_sigma", "dsn", "link_windows", "power", "pad", "psr", "uncertainty_bounds"],
        }
    payload = {
        "version": "2.0.0",
        "set": 1,
        "description": "G-8 IM-2 geometry-only, event-refined baseline; no terrain or DSN-derived link data.",
        "metric_method": "event_refined_windows",
        # Preserve fixture tolerances; frontend_engine_api.md separately reports measured G4 errors of
        # 5e-6 degrees azimuth, 1e-6 degrees elevation, and 0.25 seconds for events.
        "tolerances": {"elevation_deg": 0.005, "azimuth_deg": 0.005, "event_time_s": 60, "metric_percent": 1.0},
        "provenance": {"ephem_sha256": hashlib.sha256(ephem_path.read_bytes()).hexdigest(), "ephem_sidecar": ephem_path.with_suffix(".json").name, "frame": ephemeris.frame, "aberration_correction": "LT+S", "interpolation": "cubic_hermite"},
        "cases": [case],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return payload
