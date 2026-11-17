# Owner: Gowri
# Entry point for run_sigma_calibration stage.

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lumen_pipeline.validation.sigma_calibration import default_output_path, write_calibration


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Calibrate Tier-B event-time sigma against Tier-A references."
    )
    parser.add_argument(
        "input", type=Path, help="JSON with events, provenance, and authentic_tierb"
    )
    parser.add_argument("--output", type=Path, default=default_output_path())
    args = parser.parse_args()
    source = json.loads(args.input.read_text(encoding="utf-8"))
    record = write_calibration(
        source.get("events", []),
        provenance=source.get("provenance", {}),
        authentic_tierb=source.get("authentic_tierb") is True,
        output_path=args.output,
    )
    print(f"G10 {record['status']}: {record.get('sample_count', 0)} valid events")


if __name__ == "__main__":
    main()
