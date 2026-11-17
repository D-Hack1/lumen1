"""Opt-in, resumable acquisition of configured PGDA DEMs.

No bytes are downloaded unless ``--approve-download`` is supplied.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import requests

from lumen_pipeline.terrain.dem_io import load_products


def _sha256(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def _metadata(url: str) -> dict[str, str]:
    response = requests.head(url, allow_redirects=True, timeout=30)
    response.raise_for_status()
    if response.headers.get("Accept-Ranges", "").lower() != "bytes":
        raise RuntimeError("source does not advertise resumable byte-range support")
    length = response.headers.get("Content-Length")
    if not length or not length.isdigit():
        raise RuntimeError("source did not provide Content-Length")
    return {"size_bytes": length, "etag": response.headers.get("ETag", ""), "last_modified": response.headers.get("Last-Modified", "")}


def acquire(product_key: str, directory: Path, *, approve: bool) -> Path:
    product = load_products()[product_key]
    metadata = _metadata(product.url)
    target = directory / Path(product.url).name
    partial = target.with_suffix(target.suffix + ".part")
    partial_manifest = partial.with_suffix(partial.suffix + ".json")
    directory.mkdir(parents=True, exist_ok=True)
    if not approve:
        raise RuntimeError(f"approval required: {product.url} ({metadata['size_bytes']} bytes)")
    offset = partial.stat().st_size if partial.exists() else 0
    if offset > int(metadata["size_bytes"]):
        raise RuntimeError("partial file exceeds authoritative Content-Length")
    if offset:
        if not partial_manifest.is_file():
            raise RuntimeError("refusing to resume an unverified partial file")
        recorded = json.loads(partial_manifest.read_text(encoding="utf-8"))
        if recorded != {"source_url": product.url, **metadata}:
            raise RuntimeError("partial file source identity differs from the current PGDA object")
    else:
        partial_manifest.write_text(
            json.dumps({"source_url": product.url, **metadata}, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    headers = {"Range": f"bytes={offset}-"} if offset else {}
    response = requests.get(product.url, headers=headers, stream=True, timeout=(30, 300))
    response.raise_for_status()
    if offset and response.status_code != 206:
        raise RuntimeError("server did not honor Range for resumable download")
    with partial.open("ab" if offset else "wb") as output:
        for chunk in response.iter_content(1024 * 1024):
            if chunk:
                output.write(chunk)
    if partial.stat().st_size != int(metadata["size_bytes"]):
        raise RuntimeError("incomplete download retained as .part for resumption")
    partial.replace(target)
    partial_manifest.unlink(missing_ok=True)
    manifest = {"source_url": product.url, **metadata, "size_bytes": target.stat().st_size, "sha256": _sha256(target)}
    target.with_suffix(target.suffix + ".lumen.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return target


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("product", choices=("polar_20m_lola_pgda_90", "regional_240m_lola_pgda_90"))
    parser.add_argument("--directory", type=Path, default=Path("cache/dem-downloads"))
    parser.add_argument("--approve-download", action="store_true")
    args = parser.parse_args()
    print(acquire(args.product, args.directory, approve=args.approve_download))


if __name__ == "__main__":
    main()
