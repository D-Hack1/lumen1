"""Download and verify the locked DE421 SPICE kernel set used by backend tests."""

from __future__ import annotations

import hashlib
import time
import urllib.error
import urllib.request
from pathlib import Path

from lumen_pipeline.ephem.kernels import (
    KERNEL_FILENAMES,
    clear_kernels,
    load_kernels,
)

KERNELS = {
    "naif0012.tls": {
        "url": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls",
        "sha256": "678e32bdb5a744117a467cd9601cd6b373f0e9bc9bbde1371d5eee39600a039b",
        "header": b"KPL/LSK",
    },
    "pck00011.tpc": {
        "url": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc",
        "sha256": "3dff7b1dbeceaa01f25467767d3fa25816051c85d162d1edf04acb310ee28bb1",
        "header": b"KPL/PCK",
    },
    "de421.bsp": {
        "url": "https://naif.jpl.nasa.gov/pub/naif/MAVEN/kernels/spk/de421.bsp",
        "sha256": "08b20db2ae22488650641c5a9033e5bfda4b1c4b440cfeaf20f621cfa18ecdb3",
        "header": b"DAF/SPK",
    },
    "moon_pa_de421_1900-2050.bpc": {
        "url": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/moon_pa_de421_1900-2050.bpc",
        "sha256": "656f90616403d75a75f0cd6c8830fc5b44f8cb4facb5ccb8915e752b397520cf",
        "header": b"DAF/PCK",
    },
    "moon_080317.tf": {
        "url": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_080317.tf",
        "sha256": "78732477b96f9863e7b0d65bcee3c22b8707ca5ed0db56d1173319cb2e8c7993",
        "header": b"KPL/FK",
    },
}
ATTEMPTS = 3


def _sha256(path: Path) -> str:
    with path.open("rb") as kernel:
        return hashlib.file_digest(kernel, "sha256").hexdigest()


def _verify(path: Path, expected_sha256: str, expected_header: bytes) -> None:
    if not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError(f"kernel download is missing or empty: {path}")
    digest = _sha256(path)
    if digest != expected_sha256:
        raise RuntimeError(f"SHA-256 mismatch for {path}: expected {expected_sha256}, got {digest}")
    with path.open("rb") as kernel:
        if kernel.read(len(expected_header)) != expected_header:
            raise RuntimeError(f"unexpected SPICE file format for {path}: expected {expected_header!r}")


def _download(url: str, destination: Path) -> None:
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    for attempt in range(1, ATTEMPTS + 1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "LUMEN-kernel-provisioner/1"})
            with urllib.request.urlopen(request, timeout=300) as response, temporary.open("wb") as output:
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
            temporary.replace(destination)
            return
        except (OSError, TimeoutError, urllib.error.URLError) as error:
            temporary.unlink(missing_ok=True)
            if attempt == ATTEMPTS:
                raise RuntimeError(f"could not download {url} after {ATTEMPTS} attempts: {error}") from error
            time.sleep(2**attempt)


def main() -> None:
    directory = Path(__file__).resolve().parents[1] / "kernels"
    directory.mkdir(exist_ok=True)
    for filename in KERNEL_FILENAMES:
        kernel = KERNELS[filename]
        target = directory / filename
        try:
            _verify(target, kernel["sha256"], kernel["header"])
            print(f"using cached {filename}")
        except RuntimeError:
            _download(kernel["url"], target)
            _verify(target, kernel["sha256"], kernel["header"])
            print(f"downloaded and verified {filename}")
    try:
        paths = load_kernels(directory)
        print(f"SpiceyPy loaded {len(paths)} locked kernels")
    finally:
        clear_kernels()


if __name__ == "__main__":
    main()
