"""Hermite ephemeris interpolation and MOON_ME_DE421 topocentric geometry."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from lumen_pipeline.common.frames import direction_to_az_el, site_position_km, site_rotation_matrix
from lumen_pipeline.ephem.ephemeris import STEP_SECONDS, hermite_position


@dataclass(frozen=True)
class BodyGeometry:
    position_km: np.ndarray
    distance_km: float
    azimuth_deg: float
    elevation_deg: float


@dataclass(frozen=True)
class Ephemeris:
    nodes: np.ndarray
    start_et: float
    frame: str

    @classmethod
    def from_file(cls, path: str | Path) -> Ephemeris:
        binary = Path(path)
        metadata = json.loads(binary.with_suffix(".json").read_text(encoding="utf-8"))
        if (
            metadata["frame"] != "MOON_ME"
            or metadata.get("spice_frame") != "MOON_ME_DE421"
            or metadata["step_seconds"] != STEP_SECONDS
            or metadata.get("cadence_s") != STEP_SECONDS
        ):
            raise ValueError("unsupported ephemeris frame or cadence")
        shape = tuple(metadata["shape"])
        expected_bytes = math.prod(shape) * np.dtype("<f4").itemsize
        actual_bytes = binary.stat().st_size
        prefix = binary.read_bytes()[:64]
        if prefix.startswith(b"version https://git-lfs.github.com/spec/v1"):
            raise ValueError(
                "ephemeris binary is a Git LFS pointer; run `git lfs pull` before loading "
                f"{binary}"
            )
        if actual_bytes != expected_bytes:
            raise ValueError(
                f"ephemeris binary size is {actual_bytes} bytes, expected {expected_bytes} for shape {shape}; "
                "the artifact is truncated or Git LFS content was not fetched"
            )
        nodes = np.fromfile(binary, dtype="<f4").reshape(shape)
        if nodes.shape[1] != 12:
            raise ValueError("ephemeris nodes must contain 12 fields")
        return cls(nodes, float(metadata["start_et_tdb"]), metadata["spice_frame"])

    def positions_at(self, et: float) -> np.ndarray:
        return hermite_position(self.nodes, self.start_et, et)

    def body_at(
        self, body: str, et: float, latitude_deg: float, longitude_deg_east: float, height_m: float = 0.0
    ) -> BodyGeometry:
        index = {"sun": 0, "earth": 1}[body]
        position = self.positions_at(et)[index]
        topocentric = position - site_position_km(latitude_deg, longitude_deg_east, height_m)
        distance = float(np.linalg.norm(topocentric))
        direction_site = site_rotation_matrix(latitude_deg, longitude_deg_east) @ (topocentric / distance)
        azimuth, elevation = direction_to_az_el(direction_site)
        return BodyGeometry(position, distance, azimuth, elevation)
