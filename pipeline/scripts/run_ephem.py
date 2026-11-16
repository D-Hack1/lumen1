"""Build the locked DE421 ephemeris artifact and run G2."""

from __future__ import annotations

import argparse
from pathlib import Path

from lumen_pipeline.ephem.ephemeris import (
    build_ephemeris,
    default_output_path,
    record_g2_result,
    validate_ephemeris_file,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=default_output_path())
    parser.add_argument("--validation-doc", type=Path, default=Path("../docs/validation.md"))
    parser.add_argument("--skip-validation", action="store_true")
    args = parser.parse_args()

    metadata = build_ephemeris(args.output)
    print(f"Wrote {args.output} with {metadata['count']} hourly nodes.")
    if not args.skip_validation:
        result = validate_ephemeris_file(args.output)
        record_g2_result(args.validation_doc, result)
        print(f"G2 PASS: {result.max_direction_error_deg:.9f} deg maximum direction residual.")


if __name__ == "__main__":
    main()
