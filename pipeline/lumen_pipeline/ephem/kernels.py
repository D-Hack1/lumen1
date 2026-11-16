"""Deterministic loading for LUMEN's locked DE421 lunar kernel set."""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

# The FK's generic MOON_ME name is not the DE421-specific frame ID. Use the
# canonical DE421 name throughout the ephemeris and validation pipeline.
MOON_FRAME = "MOON_ME_DE421"
SKYFIELD_MOON_FRAME = "MOON_ME_DE421"
KERNEL_FILENAMES = (
    "naif0012.tls",
    "pck00011.tpc",
    "de421.bsp",
    "moon_pa_de421_1900-2050.bpc",
    "moon_080317.tf",
)


class MissingKernelError(FileNotFoundError):
    """Raised when the locked kernel set is not available locally."""


def default_kernel_dir() -> Path:
    """Return the configured kernel directory without creating it."""
    configured = os.environ.get("LUMEN_KERNEL_DIR")
    if configured:
        return Path(configured).expanduser()
    return Path(__file__).resolve().parents[2] / "kernels"


def kernel_paths(kernel_dir: str | Path | None = None) -> tuple[Path, ...]:
    """Resolve and verify the exact G-4 kernel files in deterministic order."""
    directory = Path(kernel_dir) if kernel_dir is not None else default_kernel_dir()
    paths = tuple(directory / filename for filename in KERNEL_FILENAMES)
    missing = [str(path) for path in paths if not path.is_file()]
    if missing:
        raise MissingKernelError(
            "Missing required LUMEN DE421 kernels:\n"
            + "\n".join(f"  - {path}" for path in missing)
            + "\nDownload the locked files to pipeline/kernels or set LUMEN_KERNEL_DIR."
        )
    return paths


def resolve_moon_frame(spice: object) -> str:
    """Assert that the locked FK provides the canonical DE421 mean-Earth frame."""
    if spice.namfrm(MOON_FRAME) == 0:
        raise RuntimeError("moon_080317.tf did not resolve MOON_ME_DE421")
    return SKYFIELD_MOON_FRAME


def load_kernels(kernel_dir: str | Path | None = None) -> tuple[Path, ...]:
    """Clear SPICE state, then load exactly the locked lunar kernel set."""
    import spiceypy as spice

    paths = kernel_paths(kernel_dir)
    spice.kclear()
    try:
        for path in paths:
            spice.furnsh(str(path))
        resolve_moon_frame(spice)
    except Exception:
        spice.kclear()
        raise
    return paths


def clear_kernels() -> None:
    """Unload all SPICE kernels loaded by the standalone pipeline process."""
    import spiceypy as spice

    spice.kclear()


@contextmanager
def loaded_kernels(kernel_dir: str | Path | None = None) -> Iterator[tuple[Path, ...]]:
    """Load the locked set and always clear SPICE's global kernel pool."""
    paths = load_kernels(kernel_dir)
    try:
        yield paths
    finally:
        clear_kernels()
