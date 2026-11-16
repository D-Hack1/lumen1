"""Deterministic synthetic Golden Set 2 edge vectors.

These vectors exercise reference primitives only.  They never represent DEM,
sigma, DSN, or catalog data for a lunar landing site.
"""

from __future__ import annotations

import json
from pathlib import Path


def default_synthetic_output_path() -> Path:
    return Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "golden" / "golden_set2_synthetic.json"


def synthetic_golden_payload() -> dict[str, object]:
    """Return static, hand-derived Set 2 reference vectors in declared units."""
    cases: list[dict[str, object]] = [
        {
            "id": "synthetic_flat_visibility_boundaries",
            "input": {"site_id": "synthetic_flat", "time_scale": "ET seconds", "range_et": [0, 120], "horizon_deg": 0.0, "sun_distance_km": 149597870.7},
            "expected": {"visibility": [{"elevation_deg": 2.0, "clearance_deg": 2.0, "disk_fraction": 1.0, "visible": True}, {"elevation_deg": -2.0, "clearance_deg": -2.0, "disk_fraction": 0.0, "visible": False}]},
        },
        {
            "id": "synthetic_terrain_mask_boundary",
            "input": {"site_id": "synthetic_ridge", "time_scale": "ET seconds", "range_et": [0, 120], "horizon_deg": 4.0, "sun_distance_km": 149597870.7},
            "expected": {"visibility": [{"elevation_deg": 5.0, "clearance_deg": 1.0, "visible": True}, {"elevation_deg": 3.0, "clearance_deg": -1.0, "visible": False}]},
        },
        {
            "id": "synthetic_disk_limb_conventions",
            "input": {"site_id": "synthetic_disk", "time_scale": "ET seconds", "range_et": [0, 0], "solar_radius_deg": 0.25},
            "expected": {"limb_clearance_offset_deg": {"disk_0_pct": 0.25, "disk_50_pct": 0.0, "disk_100_pct": -0.25}},
        },
        {
            "id": "synthetic_disk_span_extrema",
            "input": {"site_id": "synthetic_disk_span", "time_scale": "ET seconds", "centre_azimuth_deg": 0.0, "off_centre_spike_azimuth_deg": 359.95, "spike_elevation_deg": 10.0, "sun_elevation_deg": 1.0},
            "expected": {"disk_fraction_lt": 1.0},
        },
        {
            "id": "synthetic_nan_wraparound_extrema",
            "input": {"site_id": "synthetic_nan_wrap", "time_scale": "ET seconds", "bin_width_deg": 90.0, "elevations_deg": [1.0, None, -3.0, 4.0]},
            "expected": {"minimum_deg": -3.0, "maximum_deg": 4.0},
        },
        {
            "id": "synthetic_event_at_window_start",
            "input": {"site_id": "synthetic_window_start", "time_scale": "ET seconds", "range_et": [0, 240], "visible_when": "et >= 0"},
            "expected": {"events": [], "window": {"partial_start": True, "start_et": 0.0, "end_et": 240.0}},
        },
        {
            "id": "synthetic_refined_visibility_window",
            "input": {"site_id": "synthetic_refined_window", "time_scale": "ET seconds", "range_et": [0, 600], "visible_when": "120 <= et < 480"},
            "expected": {"event_types": ["shadowExit", "sunset"], "window": {"start_et": 120.0, "end_et": 480.0, "partial_start": False, "partial_end": False}},
        },
        {
            "id": "synthetic_total_clearance_rate",
            "input": {"site_id": "synthetic_moving_mask", "time_scale": "ET seconds", "range_et": [-20, 220], "elevation_deg": "5 + 0.001 * et", "azimuth_deg": "10 + 0.1 * et", "mask_deg_per_bin": 0.01, "mask_bin_width_deg": 0.1},
            "expected": {"clearance_rate_deg_per_hour": -32.4},
        },
        {
            "id": "synthetic_three_pass_bounds",
            "input": {"site_id": "synthetic_sigma", "time_scale": "ET seconds", "range_et": [0, 720], "mask_deg": 1.0, "sigma_deg": 0.25, "visible_when": "1.5 - abs(et - 360) / 120 >= mask"},
            "expected": {"shifted_masks_deg": [0.75, 1.0, 1.25], "numeric_bounds": [0.75, 1.0, 1.25], "window_start_et": {"lo": 270.0, "value": 300.0, "hi": 330.0}, "window_end_et": {"lo": 390.0, "value": 420.0, "hi": 450.0}, "window_duration_hours": {"lo": 1.0 / 60.0, "value": 1.0 / 30.0, "hi": 1.0 / 20.0}, "sunlit_pct": {"lo": 100.0 / 12.0, "value": 100.0 / 6.0, "hi": 25.0}},
        },
        {
            "id": "synthetic_exact_event_uncertainty",
            "input": {"site_id": "synthetic_exact", "time_scale": "ET seconds", "event_times_et": [80.0, 100.0, 120.0]},
            "expected": {"delta_t_seconds": 20.0, "dt_method": "exact", "grazing_reason": None},
        },
        {
            "id": "synthetic_disk_event_thresholds",
            "input": {"site_id": "synthetic_disk_events", "time_scale": "ET seconds", "thresholds": [0.0, 0.5, 1.0]},
            "expected": {"zero_visible_at_zero": False, "half_visible_at_half": True, "full_visible_at_full": True},
        },
        {
            "id": "synthetic_grazing_rate",
            "input": {"site_id": "synthetic_grazing", "time_scale": "ET seconds", "sigma_deg": 0.2, "constant_clearance_deg": 0.0},
            "expected": {"delta_t_seconds": "infinity", "grazing_reason": "rate"},
        },
        {
            "id": "synthetic_near_zone_slope_edges",
            "input": {"site_id": "synthetic_pad", "time_scale": "ET seconds", "terrain_horizon_deg": -1.0, "slope_deg": 10.0, "uphill_azimuth_deg": 0.0, "d_min_m": 15.0, "observer_height_m": 1.0},
            "expected": {"flat_or_downhill_effective_deg": -1.0, "cross_slope_effective_deg": -1.0, "uphill_effective_deg": 6.2597},
        },
        {
            "id": "synthetic_guarded_span_spike",
            "input": {"site_id": "synthetic_span_spike", "time_scale": "ET seconds", "range_et": [0, 3600], "mask_bin_width_deg": 0.3, "spike_bin": 100, "spike_elevation_deg": 100.0, "azimuth_deg": "29.7 + et / 3600", "envelope_azimuth_centre_deg": 29.7, "envelope_azimuth_half_width_deg": 1.1},
            "expected": {"sample_count": 31, "event_types": ["sunset", "shadowExit"], "endpoint_states_equal": True},
        },
        {
            "id": "synthetic_tier_c_smooth_moon",
            "input": {"site_id": "synthetic_tier_c", "time_scale": "ET seconds", "observer_height_m": 2.0, "terrain_mode": "smooth_moon"},
            "expected": {"terrain_sigma": None, "label": "smooth-Moon bound"},
        },
        {
            "id": "synthetic_min_sun_elevation_ops",
            "input": {"site_id": "synthetic_ops", "time_scale": "ET seconds", "elevation_deg": 5.0, "disk_threshold": 0.5, "min_sun_elevation_ops_deg": 6.0},
            "expected": {"visible": False, "definitions_preset": "isroVikramOps"},
        },
        {
            "id": "synthetic_power_eclipse_soc",
            "input": {"site_id": "synthetic_power", "time_scale": "ET seconds", "times_et": [0.0, 3600.0], "panel_normal": [0.0, 0.0, 1.0], "panel_area_m2": 2.0, "panel_efficiency": 0.25, "sun_distance_km": 149597870.7, "disk_fractions": [1.0, 0.0], "load_w": [10.0, 10.0], "battery_capacity_wh": 1000.0, "usable_depth_of_discharge": 1.0, "initial_soc_fraction": 0.5},
            "expected": {"generation_w": [680.5, 0.0], "net_w": [670.5, -10.0], "stored_energy_wh": [500.0, 830.25], "energyPerDayWh": 8166.0},
        },
        {
            "id": "synthetic_dsn_link_modes",
            "input": {"site_id": "synthetic_dsn", "time_scale": "ET seconds", "range_et": [0, 1200], "station_order": ["DSS-14", "DSS-43", "DSS-63"], "station_elevations_deg": [[20.0, 0.0, 20.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]], "cadence_s": 600, "interpolation": "linear", "dsn_mask_deg": 5.0, "earth_visible": True},
            "expected": {"dsn_off": {"link_pct": 100.0, "longest_comm_gap_hours": 0.0}, "dsn_aware": {"event_types": ["link_down", "link_recovery"], "event_times_et": [450.0, 750.0], "link_pct": 75.0, "longest_comm_gap_hours": 1.0 / 12.0}},
        },
        {
            "id": "synthetic_dsn_out_of_coverage",
            "input": {"site_id": "synthetic_dsn_coverage", "time_scale": "ET seconds", "range_et": [0, 1800], "station_order": ["DSS-14", "DSS-43", "DSS-63"], "station_elevations_deg": [[20.0, 0.0, 20.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]], "cadence_s": 600, "interpolation": "linear", "dsn_mask_deg": 5.0, "earth_visible": True},
            "expected": {"dsn_aware": {"event_types": ["link_down", "link_recovery", "link_down"], "event_times_et": [450.0, 750.0, 1200.0], "link_pct": 50.0, "longest_comm_gap_hours": 1.0 / 6.0}},
        },
    ]
    return {
        "version": "1.0.0",
        "set": 2,
        "kind": "synthetic_reference_vectors",
        "description": "Deterministic R3 edge vectors for reference and browser parity; not production terrain or site results.",
        "units": {"time": "ET seconds", "angle": "deg", "distance": "km", "uncertainty": "s"},
        "tolerances": {"angle_deg": 0.005, "event_time_s": 10.0, "delta_t_percent": 5.0},
        "provenance": {"synthetic": True, "terrain_artifacts": "none", "dem_data": "none", "dsn_data": "none", "source": "hand-derived R3 reference cases"},
        "case_schema": {"required": ["id", "input", "expected"], "input_time_scale": "ET seconds"},
        "typescript_parity": {
            "full": [
                "synthetic_flat_visibility_boundaries",
                "synthetic_terrain_mask_boundary",
                "synthetic_disk_limb_conventions",
                "synthetic_disk_span_extrema",
                "synthetic_nan_wraparound_extrema",
                "synthetic_event_at_window_start",
                "synthetic_refined_visibility_window",
                "synthetic_total_clearance_rate",
                "synthetic_exact_event_uncertainty",
                "synthetic_disk_event_thresholds",
                "synthetic_grazing_rate",
                "synthetic_near_zone_slope_edges",
                "synthetic_tier_c_smooth_moon",
                "synthetic_min_sun_elevation_ops",
                "synthetic_power_eclipse_soc",
                "synthetic_dsn_out_of_coverage",
            ],
            "partial": {
                "synthetic_three_pass_bounds": "TS replays scalar three-pass mask bounds; scenario-window bounds are Python-only.",
                "synthetic_dsn_link_modes": "TS replays DSN interpolation and pointwise on/off states; link-window metrics are Python-only.",
            },
            "python_only": {
                "synthetic_guarded_span_spike": "TS has no envelope-guarded coarse sampler or exact span-extrema proof.",
            },
        },
        "cases": cases,
    }


def build_synthetic_golden_set(output_path: str | Path | None = None) -> dict[str, object]:
    """Write deterministic synthetic Set 2 JSON without reading production artifacts."""
    output = Path(output_path) if output_path is not None else default_synthetic_output_path()
    payload = synthetic_golden_payload()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes((json.dumps(payload, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8"))
    return payload
