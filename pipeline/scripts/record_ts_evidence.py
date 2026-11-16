# Owner: Gowri
"""Record the browser-engine evidence for gates G4 and G11 as checked-in artifacts.

    python scripts/record_ts_evidence.py            # G4 and G11
    python scripts/record_ts_evidence.py g4

Runs the TypeScript test files in `web/` (Vitest) against the REAL published data and writes what was measured to
`pipeline/reports/g4_ts_python_parity.json` and `pipeline/reports/g11_integrity.json`. The validation report reads those files; a gate is PASS
only if the recorded numbers meet its criterion, so re-run this after changing the engine or the data, then `python -m lumen_pipeline.validation.report`.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "web"
REPORTS = ROOT / "pipeline" / "reports"
G4_FILES = [
    "src/engine/__tests__/core.parity.test.ts",
    "src/engine/__tests__/golden2.test.ts",
    "src/engine/__tests__/golden2NearZone.test.ts",
    "src/engine/__tests__/golden2Shackleton.test.ts",
]
GOLDEN = {
    "golden_set1": "web/public/data/golden/golden_set1.json",
    "golden_set2_synthetic": "web/public/data/golden/golden_set2_synthetic.json",
    "golden_set2_near_zone_synthetic": "web/public/data/golden/golden_set2_near_zone_synthetic.json",
    "golden_set2_shackleton_preliminary": "web/public/data/golden/golden_set2_shackleton_preliminary.json",
}


def _npx() -> str:
    found = shutil.which("npx.cmd") or shutil.which("npx")
    if not found:
        raise SystemExit("npx was not found; install Node 20 to record the browser-engine evidence")
    return found


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()


def _vitest(files: list[str], env: dict[str, str]) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "vitest.json"
        cmd = [_npx(), "vitest", "run", *files, "--reporter=json", f"--outputFile={out}"]
        proc = subprocess.run(cmd, cwd=WEB, env={**os.environ, **env}, capture_output=True, text=True, check=False)
        if not out.exists():
            raise SystemExit(f"vitest produced no report:\n{proc.stdout}\n{proc.stderr}")
        return json.loads(out.read_text(encoding="utf-8"))


def _common() -> dict:
    return {
        "recorded_utc": dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "git_commit": _git("rev-parse", "HEAD"),
        "working_tree_dirty": bool(_git("status", "--porcelain", "--", "web/src", "web/public/data", "pipeline/lumen_pipeline")),
        "node": subprocess.run(["node", "--version"], capture_output=True, text=True, check=False).stdout.strip(),
    }


def record_g4() -> Path:
    result = _vitest(G4_FILES, {"LUMEN_REQUIRE_PARITY": "1"})
    files = []
    for f in result["testResults"]:
        statuses = [a["status"] for a in f["assertionResults"]]
        files.append({"file": Path(f["name"]).name, "tests": len(statuses), "passed": statuses.count("passed"), "other": len(statuses) - statuses.count("passed")})
    tolerances = {}
    for key, rel in GOLDEN.items():
        data = json.loads((ROOT / rel).read_text(encoding="utf-8"))
        tolerances[key] = {"tolerances": data["tolerances"], "cases": len(data["cases"])}
    report = {
        "gate": "G4",
        "description": "TypeScript engine versus Python golden vectors",
        "command": "LUMEN_REQUIRE_PARITY=1 npx vitest run " + " ".join(G4_FILES),
        **_common(),
        "totals": {
            "tests": result["numTotalTests"],
            "passed": result["numPassedTests"],
            "failed": result["numFailedTests"],
            "skipped_or_todo": result["numPendingTests"] + result["numTodoTests"],
        },
        "files": files,
        "golden_sets": tolerances,
        "note": "golden_set1 is the Python reference for IM-2 over 30 days on the published ephemeris; the Shackleton set holds PRELIMINARY Python references.",
    }
    path = REPORTS / "g4_ts_python_parity.json"
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return path


G0_TEST_FILE = "pipeline/tests/terrain/test_horizon_synthetic.py"
G0_REQUIRED_TESTS = (
    "test_g0_flat_spherical_dem_matches_curvature_and_height_effects",
    "test_cone_and_crater_have_expected_horizon_behavior",
    "test_adaptive_peak_refinement_matches_independent_dense_bilinear_reference",
)


def record_g0() -> Path:
    """G0: the raycaster against analytic cone / crater / flat-sphere references (< 0.01 deg). Runs the Python tests and records the outcome."""
    import xml.etree.ElementTree as ET

    with tempfile.TemporaryDirectory() as tmp:
        xml = Path(tmp) / "junit.xml"
        subprocess.run([sys.executable, "-m", "pytest", str(ROOT / G0_TEST_FILE), "-q", f"--junitxml={xml}"], cwd=ROOT / "pipeline", capture_output=True, text=True, check=False)
        if not xml.exists():
            raise SystemExit("pytest produced no JUnit report for G0")
        cases = []
        for case in ET.parse(xml).getroot().iter("testcase"):
            outcome = "failed" if case.find("failure") is not None or case.find("error") is not None else "skipped" if case.find("skipped") is not None else "passed"
            cases.append({"test": case.get("name"), "outcome": outcome})
    source = (ROOT / G0_TEST_FILE).read_text(encoding="utf-8")
    report = {
        "gate": "G0",
        "description": "Raycaster on synthetic cone/crater DEM",
        "command": "pytest " + G0_TEST_FILE,
        **_common(),
        "criterion_deg": 0.01,
        "asserted_tolerance_count": source.count("< 0.01") + source.count("abs=0.01"),
        "required_tests": list(G0_REQUIRED_TESTS),
        "tests": cases,
        "totals": {"tests": len(cases), "passed": sum(c["outcome"] == "passed" for c in cases), "not_passed": sum(c["outcome"] != "passed" for c in cases)},
        "method": "Each required test compares the raycaster with an independent analytic or dense-sampled reference and asserts the maximum error is below 0.01 deg.",
    }
    path = REPORTS / "g0_raycaster_synthetic.json"
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return path


def record_g11() -> Path:
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "g11.json"
        result = _vitest(["src/engine/__tests__/g11Integrity.test.ts"], {"LUMEN_G11_OUT": str(out)})
        if not out.exists():
            raise SystemExit("the G11 test wrote no measurement (is the published data present and hydrated from Git LFS?)")
        measured = json.loads(out.read_text(encoding="utf-8"))
    report = {
        "gate": "G11",
        "description": "Windows Table, barcode and CSV integrity on real engine results",
        "command": "LUMEN_G11_OUT=<file> npx vitest run src/engine/__tests__/g11Integrity.test.ts",
        **_common(),
        "totals": {"tests": result["numTotalTests"], "passed": result["numPassedTests"], "failed": result["numFailedTests"]},
        **measured,
        "method": "CSV and JSON exports are parsed back and compared with the engine result field by field; barcode cells (hourly series) are compared with the Windows Table "
        "(strictly inside a window = up, outside every window = down; cells within one step of a window edge are skipped and counted).",
    }
    path = REPORTS / "g11_integrity.json"
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return path


if __name__ == "__main__":
    which = {a.lower() for a in sys.argv[1:]} or {"g0", "g4", "g11"}
    for name, fn in (("g0", record_g0), ("g4", record_g4), ("g11", record_g11)):
        if name in which:
            print("wrote", fn())
