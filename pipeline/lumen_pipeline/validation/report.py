"""Build the evidence-backed LUMEN G0-G11 validation report."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

from lumen_pipeline.ephem.dsn import default_output_path as default_dsn_path
from lumen_pipeline.validation.frame_check import DIRECTION_TOLERANCE_RAD, MATRIX_TOLERANCE
from lumen_pipeline.validation.horizons_client import (
    AZIMUTH_TOLERANCE_DEG,
    DSN_ARTIFACT_TOLERANCE_PROPOSAL_DEG,
    DSN_ELEVATION_TOLERANCE_DEG,
    DSN_QUANTIZATION_HALF_STEP_DEG,
    ELEVATION_TOLERANCE_DEG,
    RANGE_TOLERANCE_KM,
    SITE_CASES,
    STATIONS,
    assert_g3_tolerances,
    assert_g3b_tolerances,
    default_fixture_dir,
    default_sites_path,
    dsn_fixture_path,
    fixture_path,
    run_g3,
    run_g3b,
    run_g3b_artifact,
)

REPORT_VERSION = 1
G2_TOLERANCE_DEG = 0.001


def default_output_path() -> Path:
    """Return the Gowri-owned validation report consumed by the application."""
    return Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "validation" / "report.json"


def default_g7_report_path() -> Path:
    """Return the checked-in G7 result artifact."""
    return Path(__file__).resolve().parents[2] / "reports" / "g7_cy3.json"


def default_g0_report_path() -> Path:
    """Return the checked-in G0 (raycaster on synthetic terrain) artifact."""
    return Path(__file__).resolve().parents[2] / "reports" / "g0_raycaster_synthetic.json"


def default_g8_report_path() -> Path:
    """Return the checked-in G8 (live-app performance) measurements."""
    return Path(__file__).resolve().parents[2] / "reports" / "g8_live_measurements.json"


def default_g6_report_path() -> Path:
    """Return the checked-in G6 (pad slope versus PGDA slope rasters) artifact."""
    return Path(__file__).resolve().parents[2] / "reports" / "g6_pad_slope_vs_pgda.json"


def default_g5_report_path() -> Path:
    """Return the checked-in G5 (multi-year average versus PGDA map pixels) artifact."""
    return Path(__file__).resolve().parents[2] / "reports" / "g5_multiyear_vs_pgda.json"


def default_g4_report_path() -> Path:
    """Return the checked-in G4 (TypeScript versus Python golden vectors) artifact."""
    return Path(__file__).resolve().parents[2] / "reports" / "g4_ts_python_parity.json"


def default_g11_report_path() -> Path:
    """Return the checked-in G11 (Windows Table / barcode / CSV integrity) artifact."""
    return Path(__file__).resolve().parents[2] / "reports" / "g11_integrity.json"


def default_g1_report_path() -> Path:
    """Return the checked-in G1 frame-validation artifact."""
    return Path(__file__).resolve().parents[2] / "reports" / "g1_lunar_frames.json"


def default_validation_doc_path() -> Path:
    """Return the checked-in document containing the G2 measurement."""
    return Path(__file__).resolve().parents[3] / "docs" / "validation.md"


def _relative(path: Path) -> str:
    root = Path(__file__).resolve().parents[3]
    try:
        return path.resolve().relative_to(root).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def _gate(identifier: str, description: str, status: str, **fields: Any) -> dict[str, Any]:
    return {"id": identifier, "description": description, "status": status, **fields}


def default_g9_report_path() -> Path:
    """Return the checked-in G9 (predicted shadows vs LROC image) evidence."""
    return Path(__file__).resolve().parents[2] / "reports" / "g9_cy3_shadows.json"


def _g9_gate(path: Path) -> dict[str, Any]:
    """G9's criterion is VISUAL agreement, a human judgment. The script records figures and numbers; the gate is PASS only once a person
    has looked at the figures and recorded a sign-off ("visual_signoff": {"by": ..., "date_utc": ..., "note": ...}) in the artifact."""
    description, criterion = "Tier-2 predicted shadows versus LROC image", "visual agreement"
    if not path.exists():
        return _gate("G9", description, "PENDING", criterion=criterion, reason="Shadow prediction vs LROC image has not been produced (python pipeline/scripts/run_g9.py).")
    try:
        r = json.loads(path.read_text(encoding="utf-8"))
        value = {
            img: {
                "image_mid_utc": v["image_mid_utc"],
                "sun_elevation_vs_lroc_incidence_diff_deg": v["sun_check"]["difference_deg"],
                "pixel_precision": v["scores"]["precision"],
                "regions": v["regions"],
                "figure": v.get("figure"),
            }
            for img, v in r["images"].items()
        }
        signoff = r.get("visual_signoff")
        common = {"criterion": criterion, "value": value, "artifact_paths": [_relative(path), *[v.get("figure") for v in r["images"].values() if v.get("figure")]],
                  "provenance": f"{r['site']}; DTM and orthophotos from NASA PDS ({r['dtm_url']}); Sun from LUMEN's ephemeris.",
                  "test_commands": [r["command"]]}
        if signoff:
            return _gate("G9", description, "PASS", visual_signoff=signoff, **common)
        return _gate("G9", description, "PENDING", reason="Evidence recorded (figures and region agreement); awaiting a human visual sign-off in the artifact.", **common)
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        return _gate("G9", description, "BLOCKED", reason=f"Invalid G9 artifact: {error}", artifact_paths=[_relative(path)])


def _pending_gates() -> list[dict[str, Any]]:
    return [
        _g9_gate(default_g9_report_path()),
        _gate(
            "G10",
            "Tier-B uncertainty calibration against Tier-A event times",
            "BLOCKED",
            criterion="at least about 68 percent inside reported delta-t or inflate sigma",
            reason="Requires Shivha's Monte Carlo sigma artifacts and Tier-B calibration inputs.",
            required_artifacts=["web/public/data/terrain/sigma/", "web/public/data/terrain/tierb/"],
        ),
    ]


def _g2_gate(document_path: Path) -> dict[str, Any]:
    if not document_path.exists():
        return _gate(
            "G2",
            "Hourly Hermite interpolation versus direct SpiceyPy",
            "PENDING",
            criterion=f"< {G2_TOLERANCE_DEG} deg across 10,000 epochs",
            reason="The validation document containing the G2 measurement is missing.",
            artifact_paths=[_relative(document_path)],
        )
    text = document_path.read_text(encoding="utf-8")
    match = re.search(
        r"Epochs: (\d+).*?Sun maximum direction residual: ([\d.]+) deg.*?"
        r"Earth maximum direction residual: ([\d.]+) deg",
        text,
        flags=re.DOTALL,
    )
    if match is None:
        return _gate(
            "G2",
            "Hourly Hermite interpolation versus direct SpiceyPy",
            "PENDING",
            criterion=f"< {G2_TOLERANCE_DEG} deg across 10,000 epochs",
            reason="The validation document does not contain a parseable G2 measurement.",
            artifact_paths=[_relative(document_path)],
        )
    epochs, sun, earth = int(match.group(1)), float(match.group(2)), float(match.group(3))
    maximum = max(sun, earth)
    return _gate(
        "G2",
        "Hourly Hermite interpolation versus direct SpiceyPy",
        "PASS" if epochs == 10_000 and maximum < G2_TOLERANCE_DEG else "FAIL",
        criterion=f"< {G2_TOLERANCE_DEG} deg across 10,000 epochs",
        value={"epochs": epochs, "max_sun_direction_error_deg": sun, "max_earth_direction_error_deg": earth},
        artifact_paths=[_relative(document_path)],
        provenance="Recorded deterministic G2 run, seed 421.",
        test_commands=["pytest tests/gowri/test_ephem.py"],
    )


def _fixture_metadata(paths: list[Path]) -> list[dict[str, str]]:
    evidence = []
    for path in paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        evidence.append(
            {
                "path": _relative(path),
                "source": payload["source"],
                "fetched_utc": payload["fetched_utc"],
            }
        )
    return evidence


def _g3_gate(fixtures_dir: Path) -> dict[str, Any]:
    paths = [fixture_path(site, body, fixtures_dir) for site in SITE_CASES for body in ("sun", "earth")]
    config_path = default_sites_path()
    try:
        comparisons = run_g3(fixtures_dir)
        assert_g3_tolerances(comparisons)
        if len(comparisons) != 200:
            raise ValueError(f"expected 200 comparisons, found {len(comparisons)}")
        return _gate(
            "G3",
            "Smooth-sphere topocentric geometry versus NASA/JPL Horizons",
            "PASS",
            criterion="elevation/azimuth < 0.01 deg; Earth range < 1 km",
            value={
                "comparison_count": len(comparisons),
                "max_elevation_error_deg": max(item.elevation_error_deg for item in comparisons),
                "max_azimuth_error_deg": max(item.azimuth_error_deg or 0.0 for item in comparisons),
                "max_earth_range_error_km": max(
                    item.range_error_km for item in comparisons if item.body == "earth"
                ),
            },
            tolerances={
                "elevation_deg": ELEVATION_TOLERANCE_DEG,
                "azimuth_deg": AZIMUTH_TOLERANCE_DEG,
                "earth_range_km": RANGE_TOLERANCE_KM,
            },
            artifact_paths=[_relative(config_path), *[_relative(path) for path in paths]],
            provenance=_fixture_metadata(paths),
            test_commands=["pytest tests/gowri/test_horizons.py"],
        )
    except (AssertionError, FileNotFoundError, KeyError, ValueError) as error:
        return _gate(
            "G3",
            "Smooth-sphere topocentric geometry versus NASA/JPL Horizons",
            "BLOCKED",
            criterion="elevation/azimuth < 0.01 deg; Earth range < 1 km",
            reason=str(error),
            artifact_paths=[_relative(config_path), *[_relative(path) for path in paths]],
        )


def _g3b_gate(fixtures_dir: Path) -> dict[str, Any]:
    paths = [dsn_fixture_path(station, fixtures_dir) for station in STATIONS]
    artifact = default_dsn_path()
    try:
        comparisons = run_g3b(fixtures_dir)
        artifact_comparisons = run_g3b_artifact(fixtures_dir)
        assert_g3b_tolerances(comparisons)
        if len(comparisons) != 45:
            raise ValueError(f"expected 45 comparisons, found {len(comparisons)}")
        if len(artifact_comparisons) != 45:
            raise ValueError(f"expected 45 decoded DSN comparisons, found {len(artifact_comparisons)}")
        return _gate(
            "G3b",
            "DSS Moon-centre elevation versus NASA/JPL Horizons",
            "PASS",
            criterion="Moon elevation < 0.1 deg",
            value={
                "comparison_count": len(comparisons),
                "max_moon_elevation_error_deg": max(item.elevation_error_deg for item in comparisons),
                "decoded_artifact": {
                    "comparison_count": len(artifact_comparisons),
                    "max_direct_geometry_error_deg": max(
                        item.direct_elevation_error_deg for item in artifact_comparisons
                    ),
                    "max_quantization_error_deg": max(
                        item.quantization_error_deg for item in artifact_comparisons
                    ),
                    "max_decoded_elevation_error_deg": max(
                        item.decoded_elevation_error_deg for item in artifact_comparisons
                    ),
                    "quantization_half_step_deg": DSN_QUANTIZATION_HALF_STEP_DEG,
                    "proposed_artifact_tolerance_deg": DSN_ARTIFACT_TOLERANCE_PROPOSAL_DEG,
                    "status": "PROPOSED_NOT_LOCKED",
                },
            },
            tolerances={"moon_elevation_deg": DSN_ELEVATION_TOLERANCE_DEG},
            artifact_paths=[*[_relative(path) for path in paths], _relative(artifact), _relative(artifact.with_suffix(".json"))],
            provenance=_fixture_metadata(paths),
            test_commands=["pytest tests/gowri/test_horizons.py tests/gowri/test_dsn.py"],
        )
    except (AssertionError, FileNotFoundError, KeyError, ValueError) as error:
        return _gate(
            "G3b",
            "DSS Moon-centre elevation versus NASA/JPL Horizons",
            "BLOCKED",
            criterion="Moon elevation < 0.1 deg",
            reason=str(error),
            artifact_paths=[*[_relative(path) for path in paths], _relative(artifact), _relative(artifact.with_suffix(".json"))],
        )


def _g7_gate(path: Path) -> dict[str, Any]:
    if not path.exists():
        return _gate(
            "G7",
            "Chandrayaan-3 touchdown Sun elevation and timeline",
            "BLOCKED",
            reason="G7 report artifact is missing.",
            artifact_paths=[_relative(path)],
        )
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
        # The qualitative half of G7, checked against ISRO's own timeline (scripts/run_g7_timeline.py). It is recorded as evidence only: the
        # gate's status still follows the quantitative 8.75 deg claim's source provenance, which is unresolved.
        timeline_path = path.with_name("g7_timeline.json")
        timeline = json.loads(timeline_path.read_text(encoding="utf-8")) if timeline_path.exists() else None
        timeline_value = None if timeline is None else {
            "consistent_with_isro_timeline": timeline["consistent"],
            "isro_source": timeline["isro_source"],
            "lumen_terrain_sunset_utc": timeline["lumen_terrain_sunset_utc"],
            "lumen_sun_below_6deg_utc": timeline["lumen_sun_below_6deg_utc"],
            "lumen_next_terrain_sunrise_utc": timeline["lumen_next_terrain_sunrise_utc"],
            "checks": timeline["checks"],
        }
        return _gate(
            "G7",
            "Chandrayaan-3 touchdown Sun elevation and timeline",
            report["source_provenance_result"],
            calculation_status=report["calculation_status"],
            numerical_result=report["numerical_result"],
            source_provenance_result=report["source_provenance_result"],
            value={
                "computed_sun_elevation_deg": report["computed"]["sun_elevation_deg"],
                "unverified_planned_comparison": {
                    "reference_sun_elevation_deg": report["reference"]["sun_elevation_deg"],
                    "recorded_tolerance_deg": report["reference"]["recorded_tolerance_deg"],
                    "absolute_error_deg": report["absolute_error_deg"],
                },
                "timeline_status": report["qualitative_timeline_check"]["status"],
                "primary_sourced_timeline": timeline_value,
                "im2_touchdown_conditions": report["im2_touchdown_conditions"],
            },
            timestamp_utc=report["timestamp_utc"],
            artifact_paths=[_relative(path), *([_relative(timeline_path)] if timeline is not None else [])],
            provenance=report["reference"]["source_metadata"],
            test_commands=["pytest tests/gowri/test_g7.py"],
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        return _gate(
            "G7",
            "Chandrayaan-3 touchdown Sun elevation and timeline",
            "BLOCKED",
            reason=f"Invalid G7 report artifact: {error}",
            artifact_paths=[_relative(path)],
        )


def _g1_gate(path: Path) -> dict[str, Any]:
    description = "PA/ME frame transformations versus independent Skyfield reference"
    if not path.exists():
        return _gate("G1", description, "BLOCKED", reason="G1 frame-validation evidence is missing.", artifact_paths=[_relative(path)])
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
        if report["id"] != "G1" or report["schema_version"] != 1:
            raise ValueError("unsupported G1 evidence schema")
        if report["criteria"]["matrix_max_abs_error"] != {"operator": "<", "value": MATRIX_TOLERANCE}:
            raise ValueError("G1 matrix criterion does not match the R3 tolerance")
        if report["criteria"]["direction_max_angular_error_rad"] != {
            "operator": "<",
            "value": DIRECTION_TOLERANCE_RAD,
        }:
            raise ValueError("G1 direction criterion does not match the R3 tolerance")
        if report["reference"]["independent_implementation"] != "Skyfield":
            raise ValueError("G1 evidence lacks the independent Skyfield comparison")
        if report["frames"]["principal_axis"]["name"] != "MOON_PA_DE421":
            raise ValueError("G1 principal-axis frame does not match DE421")
        if (
            report["frames"]["mean_earth"]["name"] != "MOON_ME_DE421"
            or report["frames"]["mean_earth"]["relative_to"] != "MOON_PA_DE421"
        ):
            raise ValueError("G1 mean-Earth frame definition does not match DE421")
        if len(report["epochs_utc"]) < 2:
            raise ValueError("G1 evidence must include multiple UTC epochs")
        if not report["kernels"] or any(len(kernel["sha256"]) != 64 for kernel in report["kernels"]):
            raise ValueError("G1 evidence lacks SHA-256 kernel identifiers")

        metrics = report["metrics"]
        matrix_error = float(metrics["max_matrix_error"])
        direction_error = float(metrics["max_direction_error_rad"])
        orthogonality_error = float(metrics["orthogonality_error_max_abs"])
        minimum_determinant = float(metrics["minimum_determinant"])
        measured_status = (
            "PASS"
            if (
                all(
                    math.isfinite(value) and value >= 0.0
                    for value in (matrix_error, direction_error, orthogonality_error)
                )
                and math.isfinite(minimum_determinant)
                and matrix_error < MATRIX_TOLERANCE
                and direction_error < DIRECTION_TOLERANCE_RAD
                and orthogonality_error <= MATRIX_TOLERANCE
                and minimum_determinant > 0.0
            )
            else "FAIL"
        )
        if report["status"] != measured_status:
            raise ValueError("G1 status does not match its measured residuals")
        return _gate(
            "G1",
            description,
            measured_status,
            criterion="matrix < 1e-9; direction < 1e-6 rad",
            value=metrics,
            tolerances={
                "matrix_max_abs_error": MATRIX_TOLERANCE,
                "direction_max_angular_error_rad": DIRECTION_TOLERANCE_RAD,
                "orthogonality_error_max_abs": MATRIX_TOLERANCE,
                "determinant": "positive",
            },
            epochs_utc=report["epochs_utc"],
            frames=report["frames"],
            provenance={"reference": report["reference"], "kernels": report["kernels"]},
            artifact_paths=[_relative(path)],
            test_commands=[
                "pytest tests/gowri/test_frames_spice.py",
                "python -m lumen_pipeline.validation.frame_check",
            ],
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        return _gate(
            "G1",
            description,
            "BLOCKED",
            reason=f"Invalid G1 report artifact: {error}",
            artifact_paths=[_relative(path)],
        )


G0_DESCRIPTION = "Raycaster on synthetic cone/crater DEM"
G0_CRITERION = "< 0.01 deg"


def _g0_gate(path: Path) -> dict[str, Any]:
    if not path.exists():
        return _gate(
            "G0", G0_DESCRIPTION, "PENDING", criterion=G0_CRITERION,
            reason="No persisted G0 measurement artifact is available; run pipeline/scripts/record_ts_evidence.py g0.",
            artifact_paths=[_relative(path)],
        )
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
        outcomes = {c["test"]: c["outcome"] for c in report["tests"]}
        required_ok = all(outcomes.get(name) == "passed" for name in report["required_tests"]) and len(report["required_tests"]) >= 3
        clean = report["totals"]["not_passed"] == 0 and report["totals"]["tests"] > 0
        strict_enough = report["criterion_deg"] <= 0.01 and report["asserted_tolerance_count"] >= 4
        return _gate(
            "G0", G0_DESCRIPTION, "PASS" if required_ok and clean and strict_enough else "FAIL", criterion=G0_CRITERION,
            value={"tests": report["totals"]["tests"], "passed": report["totals"]["passed"], "required_tests": report["required_tests"],
                   "asserted_tolerances_below_criterion": report["asserted_tolerance_count"]},
            artifact_paths=[_relative(path), "pipeline/tests/terrain/test_horizon_synthetic.py"],
            provenance=f"Recorded {report['recorded_utc']} at commit {report['git_commit'][:10]}: {report['method']}",
            test_commands=["python pipeline/scripts/record_ts_evidence.py g0"],
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        return _gate("G0", G0_DESCRIPTION, "BLOCKED", reason=f"Invalid G0 artifact: {error}", artifact_paths=[_relative(path)])


G8_DESCRIPTION = "Performance on the demo laptop"
G8_CRITERION = "site <100 ms; slip <16 ms/frame; hover <4 ms; Scan <300 ms; Quick Answer <150 ms"


def _g8_gate(path: Path) -> dict[str, Any]:
    """G8 is PASS only when every budget is measured and met on the demo laptop. A partial or over-budget measurement is reported, never promoted."""
    if not path.exists():
        return _gate(
            "G8", G8_DESCRIPTION, "PENDING", criterion=G8_CRITERION,
            reason="No measured demo-laptop performance artifact is available.", artifact_paths=[_relative(path)],
        )
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
        measured = report["measured"]
        budgets = report["budgets_ms"]
        not_measurable = report["not_measurable_in_live_app"]
        site_p95 = float(measured["siteSwitchMs"]["p95"])
        site_p50 = float(measured["siteSwitchMs"]["p50"])
        slip_p95 = float(measured["slipDragFrameMs"]["p95"])
        over = []
        if site_p95 > budgets["siteSwitch"]:
            over.append(f"site switch p95 {site_p95:.0f} ms (budget {budgets['siteSwitch']} ms)")
        if slip_p95 > budgets["slipFrame"] + 0.5:
            over.append(f"slip drag frame p95 {slip_p95:.1f} ms (budget {budgets['slipFrame']} ms)")
        reasons = list(over)
        if not_measurable:
            reasons.append("not measurable in the live app: " + ", ".join(not_measurable))
        reasons.append("hover is measured to the next frame, not to overlay-drawn")
        reasons.append("the measuring machine is not confirmed to be the demo laptop")
        return _gate(
            "G8", G8_DESCRIPTION, "PENDING", criterion=G8_CRITERION,
            reason="Partly measured on " + str(report["machine"].get("cpu")) + "; not promoted: " + "; ".join(reasons) + ".",
            value={"site_switch_ms": measured["siteSwitchMs"], "slip_drag_frame_ms": measured["slipDragFrameMs"],
                   "hover_to_next_frame_ms": measured["hoverToFrameMs"], "site_switch_p50_over_budget": site_p50 > budgets["siteSwitch"]},
            artifact_paths=[_relative(path)],
            provenance=f"Recorded {report['recorded_utc']} at commit {report['git_commit'][:10]}; " + " ".join(report["notes"]),
            test_commands=["LUMEN_G8_OUT=<file> npx playwright test -c e2e/playwright.real.config.ts livePerf"],
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        return _gate("G8", G8_DESCRIPTION, "BLOCKED", reason=f"Invalid G8 artifact: {error}", artifact_paths=[_relative(path)])


G6_DESCRIPTION = "Pad slope versus PGDA slope rasters"
G6_CRITERION = "within a few degrees"
G6_TOLERANCE_DEG = 3.0


def _g6_gate(path: Path) -> dict[str, Any]:
    if not path.exists():
        return _gate(
            "G6", G6_DESCRIPTION, "PENDING", criterion=G6_CRITERION,
            reason="No independent PGDA slope-raster comparison artifact is available; run pipeline/scripts/run_g6.py.",
            artifact_paths=[_relative(path)],
        )
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
        rows = report["sites"]
        diffs = [float(r["abs_difference_vs_centre_deg"]) for r in rows]
        finite = all(math.isfinite(d) for d in diffs) and len(rows) >= 3
        # The recorded tolerance must be no looser than the gate's own reading of "a few degrees", and every site must meet it.
        meets = finite and report["criterion_deg"] <= G6_TOLERANCE_DEG and all(d <= report["criterion_deg"] for d in diffs)
        return _gate(
            "G6", G6_DESCRIPTION, "PASS" if meets else "FAIL", criterion=G6_CRITERION + f" (read as <= {G6_TOLERANCE_DEG:g} deg)",
            value={
                "sites_compared": len(rows),
                "max_abs_difference_deg": max(diffs) if diffs else None,
                "per_site": {r["site_id"]: {"pad_deg": r["pad_slope_deg"], "pgda_deg": r["pgda"]["centre_deg"], "difference_deg": r["abs_difference_vs_centre_deg"], "pgda_product": r["pgda_product"]} for r in rows},
            },
            artifact_paths=[_relative(path)],
            provenance=f"Recorded {report['recorded_utc']} at commit {report['git_commit'][:10]}. {report['method']} "
            "PGDA's slope products are derived from the same LOLA elevation data, so this checks the plane-fit and geometry, not the elevation data itself.",
            test_commands=["python pipeline/scripts/run_g6.py"],
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        return _gate("G6", G6_DESCRIPTION, "BLOCKED", reason=f"Invalid G6 artifact: {error}", artifact_paths=[_relative(path)])


G5_DESCRIPTION = "Multi-year averages versus independent PGDA map pixels"
G5_CRITERION = "within a few percent; differences explained"
G5_TOLERANCE_POINTS = 5.0


def _g5_gate(path: Path) -> dict[str, Any]:
    """PASS only if every compared site is within the tolerance; a site outside it makes the gate FAIL and is named, with the facts that bear on why."""
    if not path.exists():
        return _gate(
            "G5", G5_DESCRIPTION, "BLOCKED", criterion=G5_CRITERION,
            reason="Independent documented PGDA map-pixel references have not been supplied; run pipeline/scripts/run_g5.py.",
            required_artifacts=[_relative(path)],
        )
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
        rows = report["sites"]
        diffs = {r["site_id"]: float(r["abs_difference_vs_centre_pct_points"]) for r in rows}
        finite = len(rows) >= 3 and all(math.isfinite(d) for d in diffs.values())
        tolerance = float(report["criterion_pct_points"])
        outside = sorted(site for site, d in diffs.items() if not d <= tolerance)
        meets = finite and tolerance <= G5_TOLERANCE_POINTS and not outside
        per_site = {
            r["site_id"]: {
                "lumen_pct": round(r["lumen_multi_year_sunlit_pct"], 1), "pgda_centre_pct": round(r["pgda"]["centre_pct"], 1),
                "pgda_3x3_range_pct": [round(r["pgda"]["min_3x3_pct"], 1), round(r["pgda"]["max_3x3_pct"], 1)],
                "difference_points": round(r["abs_difference_vs_centre_pct_points"], 1), "lumen_yearly_spread_points": round(r["lumen_yearly_spread_pct_points"], 1),
                "lumen_by_observer_height_pct": {k: round(v, 1) for k, v in r.get("lumen_by_observer_height_pct", {}).items()},
                "lumen_by_horizon_bias_deg_pct": {k: round(v, 1) for k, v in r.get("lumen_by_horizon_bias_deg_pct", {}).items()},
            }
            for r in rows
        }
        extra: dict[str, Any] = {}
        # Diagnostics for an out-of-tolerance site (scripts/g5_pixel_comparison.py, scripts/g5_resolution_test.py), if recorded.
        diagnostics: dict[str, Any] = {}
        diag_paths: list[str] = []
        for site in outside:
            d: dict[str, Any] = {}
            px = path.with_name(f"g5_pixels_{site}.json")
            if px.exists():
                pr = json.loads(px.read_text(encoding="utf-8"))
                d["map_3x3_pixels"] = {**{k: round(v, 3) for k, v in pr["summary"].items()},
                                       "lumen_range_pct": [round(min(p["lumen_pct"] for p in pr["pixels"]), 1), round(max(p["lumen_pct"] for p in pr["pixels"]), 1)]}
                diag_paths.append(_relative(px))
            rs = path.with_name(f"g5_resolution_{site}.json")
            if rs.exists():
                rr = json.loads(rs.read_text(encoding="utf-8"))
                d["terrain_resolution_sunlit_pct"] = {k: round(v["sunlit_pct"], 1) for k, v in rr["variants"].items()}
                diag_paths.append(_relative(rs))
            if d:
                diagnostics[site] = d
        if outside:
            extra["reason"] = (
                "Outside the " + f"{tolerance:g}-point tolerance: " + ", ".join(f"{site} ({diffs[site]:.1f} points)" for site in outside)
                + ". Not explained away: a constant horizon bias of +/-0.5 degrees moves it only a few points and observer height only partly (see value). "
                + ("Ruled out by the recorded diagnostics: a single-pixel/footprint effect (LUMEN is lower than the map at all nine map pixels around the "
                   "site, by a similar amount) and terrain resolution (coarser terrain makes LUMEN darker, not brighter). Remaining hypothesis, untested: a "
                   "horizontal offset of this knife-edge crest between the 2016 map's DEM and the 2023 re-adjusted DEMs LUMEN uses. " if diagnostics else "")
                + "The cause is not established and the site's mask needs a terrain-owner review."
            )
        if diagnostics:
            extra["diagnostics"] = diagnostics
        return _gate(
            "G5", G5_DESCRIPTION, "PASS" if meets else "FAIL", criterion=G5_CRITERION + f" (read as <= {G5_TOLERANCE_POINTS:g} percentage points)",
            value={"sites_compared": len(rows), "max_difference_points": round(max(diffs.values()), 1) if diffs else None, "per_site": per_site},
            artifact_paths=[_relative(path), *diag_paths],
            provenance=f"Recorded {report['recorded_utc']} at commit {report['git_commit'][:10]}. {report['method']}",
            test_commands=["python pipeline/scripts/run_g5.py", *(["python pipeline/scripts/g5_pixel_comparison.py", "python pipeline/scripts/g5_resolution_test.py"] if diag_paths else [])],
            **extra,
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        return _gate("G5", G5_DESCRIPTION, "BLOCKED", reason=f"Invalid G5 artifact: {error}", artifact_paths=[_relative(path)])


G4_CRITERION = "elevation < 0.005 deg; events +/-1 min; dt +/-5%; metrics +/-1%"
G4_DESCRIPTION = "TypeScript versus Python golden vectors"
G11_DESCRIPTION = "Windows Table, barcode, and CSV integrity"


def _g4_gate(path: Path) -> dict[str, Any]:
    if not path.exists():
        return _gate(
            "G4", G4_DESCRIPTION, "PENDING", criterion=G4_CRITERION,
            reason="No browser-engine parity artifact is available; run pipeline/scripts/record_ts_evidence.py.",
            artifact_paths=[_relative(path)],
        )
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
        totals = report["totals"]
        sets = report["golden_sets"]
        tol1 = sets["golden_set1"]["tolerances"]
        tol2 = sets["golden_set2_synthetic"]["tolerances"]
        # The recorded tolerances must be at least as strict as the gate's criterion, or the pass would not mean anything.
        within_criterion = (
            tol1["elevation_deg"] <= 0.005
            and tol1["azimuth_deg"] <= 0.005
            and tol1["event_time_s"] <= 60
            and tol1["metric_percent"] <= 1.0
            and tol2["delta_t_percent"] <= 5.0
            and tol2["angle_deg"] <= 0.005
        )
        all_ran = (
            totals["tests"] > 0
            and totals["passed"] == totals["tests"]
            and totals["failed"] == 0
            and totals["skipped_or_todo"] == 0
            and sets["golden_set1"]["cases"] >= 1
            and sets["golden_set2_synthetic"]["cases"] >= 1
        )
        status = "PASS" if within_criterion and all_ran else "FAIL"
        return _gate(
            "G4", G4_DESCRIPTION, status, criterion=G4_CRITERION,
            value={"tests": totals["tests"], "passed": totals["passed"], "golden_set1_cases": sets["golden_set1"]["cases"],
                   "golden_set2_synthetic_cases": sets["golden_set2_synthetic"]["cases"]},
            tolerances={"golden_set1": tol1, "golden_set2_synthetic": tol2},
            artifact_paths=[_relative(path)],
            provenance=f"Recorded {report['recorded_utc']} at commit {report['git_commit'][:10]} (vitest, real ephemeris and golden files). "
            "The Shackleton golden set holds preliminary Python references and is reported separately.",
            test_commands=["python pipeline/scripts/record_ts_evidence.py g4"],
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        return _gate("G4", G4_DESCRIPTION, "BLOCKED", reason=f"Invalid G4 artifact: {error}", artifact_paths=[_relative(path)])


def _g11_gate(path: Path) -> dict[str, Any]:
    criterion = "100 percent match and CSV round-trip"
    if not path.exists():
        return _gate(
            "G11", G11_DESCRIPTION, "PENDING", criterion=criterion,
            reason="No cross-frontend Windows Table/barcode/CSV round-trip artifact is available; run pipeline/scripts/record_ts_evidence.py.",
            artifact_paths=[_relative(path)],
        )
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
        t = report["tally"]
        totals = report["totals"]
        complete = (
            t["cases"] > 0 and t["windows"] > 0 and t["barcodeCells"] > 0 and t["metricsRows"] > 0
            and totals["failed"] == 0 and totals["passed"] == totals["tests"] == t["cases"]
        )
        exact = (
            t["windowsMatched"] == t["windows"]
            and t["metricsMatched"] == t["metricsRows"]
            and t["barcodeAgree"] == t["barcodeCells"]
            and t["jsonLossless"] == t["cases"]
        )
        return _gate(
            "G11", G11_DESCRIPTION, "PASS" if complete and exact else "FAIL", criterion=criterion,
            value={
                "cases": t["cases"], "windows_compared": t["windows"], "windows_matched": t["windowsMatched"],
                "metric_rows_compared": t["metricsRows"], "metric_rows_matched": t["metricsMatched"],
                "barcode_cells_compared": t["barcodeCells"], "barcode_cells_agreeing": t["barcodeAgree"],
                "barcode_cells_skipped_at_window_edges": t["barcodeSkippedAtEdges"],
            },
            artifact_paths=[_relative(path)],
            provenance=f"Recorded {report['recorded_utc']} at commit {report['git_commit'][:10]}: {report['method']} "
            "Sites: " + ", ".join(sorted({d['site'] for d in report['detail']})) + "; 30 days from " + report["window_start_utc"][:10] + ".",
            test_commands=["python pipeline/scripts/record_ts_evidence.py g11"],
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        return _gate("G11", G11_DESCRIPTION, "BLOCKED", reason=f"Invalid G11 artifact: {error}", artifact_paths=[_relative(path)])


def build_validation_report(
    *, fixtures_dir: str | Path | None = None, g7_report_path: str | Path | None = None,
    validation_doc_path: str | Path | None = None, g1_report_path: str | Path | None = None,
    g4_report_path: str | Path | None = None, g11_report_path: str | Path | None = None,
    g0_report_path: str | Path | None = None, g8_report_path: str | Path | None = None,
    g6_report_path: str | Path | None = None, g5_report_path: str | Path | None = None,
) -> dict[str, Any]:
    """Assemble report data from checked-in artifacts without network access."""
    fixture_directory = Path(fixtures_dir) if fixtures_dir is not None else default_fixture_dir()
    g7_path = Path(g7_report_path) if g7_report_path is not None else default_g7_report_path()
    g1_path = Path(g1_report_path) if g1_report_path is not None else default_g1_report_path()
    g0_path = Path(g0_report_path) if g0_report_path is not None else default_g0_report_path()
    g8_path = Path(g8_report_path) if g8_report_path is not None else default_g8_report_path()
    g6_path = Path(g6_report_path) if g6_report_path is not None else default_g6_report_path()
    g5_path = Path(g5_report_path) if g5_report_path is not None else default_g5_report_path()
    g4_path = Path(g4_report_path) if g4_report_path is not None else default_g4_report_path()
    g11_path = Path(g11_report_path) if g11_report_path is not None else default_g11_report_path()
    g2_path = Path(validation_doc_path) if validation_doc_path is not None else default_validation_doc_path()
    gates = _pending_gates() + [
        _g1_gate(g1_path),
        _g2_gate(g2_path),
        _g3_gate(fixture_directory),
        _g3b_gate(fixture_directory),
        _g7_gate(g7_path),
        _g0_gate(g0_path),
        _g4_gate(g4_path),
        _g5_gate(g5_path),
        _g6_gate(g6_path),
        _g8_gate(g8_path),
        _g11_gate(g11_path),
    ]
    gates.sort(key=lambda gate: (int(gate["id"][1:]) if gate["id"] != "G3b" else 3, gate["id"]))
    non_pass = [gate["id"] for gate in gates if gate["status"] != "PASS"]
    return {
        "version": REPORT_VERSION,
        "status": "READY" if not non_pass else "NOT_READY",
        "gate_count": len(gates),
        "non_pass_gates": non_pass,
        "gates": gates,
        "reference_engine_evidence": {
            "scope": "Python reference-engine component tests; this evidence does not establish browser parity or terrain compliance.",
            "test_commands": [
                "pytest tests/gowri/test_uncertainty.py tests/gowri/test_events_guarded.py tests/gowri/test_bounds.py tests/gowri/test_golden_synthetic.py",
                "pytest tests/gowri/test_golden_near_zone_synthetic.py",
            ],
            "coverage": [
                "fast and exact event uncertainty",
                "envelope-guarded sampling and disk-span extrema",
                "ISRO Vikram 6-degree operations preset",
                "three-pass bounds and disk event thresholds",
            ],
        },
        "open_issues": [],
        "limitations": [
            "No gate is promoted to PASS solely because a unit test exists or passes.",
            "G5 requires independent PGDA map-pixel references, not synthetic records.",
            "G7 numerical agreement does not establish the source provenance of the 8.75-degree claim.",
            "G10 requires terrain-owner Monte Carlo sigma and Tier-B calibration artifacts.",
        ],
    }


def write_validation_report(output_path: str | Path | None = None, **kwargs: Any) -> dict[str, Any]:
    """Write the deterministic aggregate report and return its decoded content."""
    path = Path(output_path) if output_path is not None else default_output_path()
    report = build_validation_report(**kwargs)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    print(json.dumps(write_validation_report(), sort_keys=True))
