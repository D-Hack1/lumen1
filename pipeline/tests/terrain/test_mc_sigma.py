# Owner: Shiva Shakthi
"""LUMENSGM sigma header/schema tests (contracts/data_masks.md §4, §8, §10).

This covers only the binary header, sidecar schema, and publication
validation -- not Monte-Carlo clone generation, which remains unimplemented
(see mc_sigma.py's module docstring for the unresolved specification gaps:
exact clone_count and the spatial-correlation model are not specified
anywhere in the contracts or pipeline/config/terrain.yaml)."""

from __future__ import annotations

import struct

import numpy as np
import pytest

from lumen_pipeline.terrain.mc_sigma import (
    AZIMUTH_COUNT,
    HEADER_SIZE,
    HEADER_STRUCT,
    HEIGHTS_M,
    SIGMA_PAYLOAD_LENGTH,
    SigmaValidationError,
    _sigma_header,
    _validate_sigma_header,
    _validate_source_metadata,
    read_sigma,
    validate_sigma_array,
    write_sigma,
)

SHAPE = (len(HEIGHTS_M), AZIMUTH_COUNT)


def _all_valid_sigma(value: float = 0.1) -> tuple[np.ndarray, np.ndarray]:
    sigma = np.full(SHAPE, value, dtype=np.float32)
    valid = np.ones(SHAPE, dtype=bool)
    return sigma, valid


# ---------------------------------------------------------------------------
# Header: round-trip and exact contract layout (§4, §10.1-2)
# ---------------------------------------------------------------------------


def test_header_has_exact_contract_byte_layout():
    header = _sigma_header()
    assert len(header) == HEADER_SIZE == 64
    fields = struct.unpack(HEADER_STRUCT, header)
    assert fields == (
        b"LUMENSGM",
        1,
        64,
        4,
        3600,
        pytest.approx(0.1),
        pytest.approx(250.0),
        pytest.approx(1.0),
        64,  # sigma payload offset
        0,  # distance offset: zero, sigma has no distance payload
        57600,  # sigma payload length
        0,  # distance length: zero
        0,
        0,
        0,
    )


def test_header_round_trips_through_validation():
    payload = _sigma_header() + b"\x00" * SIGMA_PAYLOAD_LENGTH
    _validate_sigma_header(payload)  # must not raise


@pytest.mark.parametrize(
    ("mutate", "match"),
    [
        (lambda h: b"BADMAGIC" + h[8:], "magic"),
        (lambda h: h[:8] + struct.pack("<H", 2) + h[10:], "version"),
        (lambda h: h[:10] + struct.pack("<H", 32) + h[12:], "header size"),
        (lambda h: h[:12] + struct.pack("<I", 3) + h[16:], "dimensions"),
        (lambda h: h[:36] + struct.pack("<I", 1) + h[40:], "distance offset"),
        (lambda h: h[:44] + struct.pack("<I", 1) + h[48:], "distance length"),
        (lambda h: h[:48] + struct.pack("<I", 1) + h[52:], "reserved"),
    ],
)
def test_header_rejects_each_contract_violation(mutate, match):
    header = bytearray(_sigma_header())
    mutated = bytes(mutate(bytes(header)))
    payload = mutated + b"\x00" * SIGMA_PAYLOAD_LENGTH
    with pytest.raises(SigmaValidationError, match=match):
        _validate_sigma_header(payload)


def test_header_rejects_wrong_file_length():
    payload = _sigma_header() + b"\x00" * (SIGMA_PAYLOAD_LENGTH - 4)
    with pytest.raises(SigmaValidationError, match="file length"):
        _validate_sigma_header(payload)


def test_header_rejects_truncated_payload():
    with pytest.raises(SigmaValidationError, match="64-byte header"):
        _validate_sigma_header(b"short")


# ---------------------------------------------------------------------------
# Sigma array validation (§8, §10.6): NaN must match mask validity exactly
# ---------------------------------------------------------------------------


def test_validate_sigma_array_accepts_matching_valid_and_nan_pattern():
    sigma, valid = _all_valid_sigma()
    sigma[0, 0] = np.nan
    valid[0, 0] = False
    validate_sigma_array(sigma, valid)  # must not raise


def test_validate_sigma_array_rejects_wrong_shape():
    sigma = np.zeros((4, 100), dtype=np.float32)
    valid = np.ones((4, 100), dtype=bool)
    with pytest.raises(SigmaValidationError, match="shape"):
        validate_sigma_array(sigma, valid)


def test_validate_sigma_array_rejects_finite_negative_value():
    sigma, valid = _all_valid_sigma()
    sigma[2, 10] = -0.01
    with pytest.raises(SigmaValidationError, match="negative"):
        validate_sigma_array(sigma, valid)


def test_validate_sigma_array_rejects_nan_where_mask_is_valid():
    """A valid mask sample with NaN sigma must be rejected, not silently
    converted to zero or accepted."""

    sigma, valid = _all_valid_sigma()
    sigma[1, 5] = np.nan  # valid[1, 5] stays True
    with pytest.raises(SigmaValidationError, match="validity"):
        validate_sigma_array(sigma, valid)


def test_validate_sigma_array_rejects_finite_where_mask_is_invalid():
    """An unavailable mask sample must have NaN sigma, never a fabricated
    finite value."""

    sigma, valid = _all_valid_sigma()
    valid[3, 7] = False  # sigma[3, 7] stays finite (0.1)
    with pytest.raises(SigmaValidationError, match="validity"):
        validate_sigma_array(sigma, valid)


# ---------------------------------------------------------------------------
# Source metadata (§8): default | monte_carlo | calibrated
# ---------------------------------------------------------------------------


def test_default_source_forbids_clone_count():
    _validate_source_metadata("default", clone_count=None, notes=None)
    with pytest.raises(SigmaValidationError, match="absent"):
        _validate_source_metadata("default", clone_count=25, notes=None)


@pytest.mark.parametrize("clone_count", [20, 25, 30])
def test_monte_carlo_source_accepts_r3_range(clone_count):
    _validate_source_metadata("monte_carlo", clone_count=clone_count, notes=None)


@pytest.mark.parametrize("clone_count", [None, 19, 31, 0, -5])
def test_monte_carlo_source_rejects_outside_r3_range_or_missing(clone_count):
    with pytest.raises(SigmaValidationError):
        _validate_source_metadata("monte_carlo", clone_count=clone_count, notes=None)


def test_monte_carlo_source_rejects_non_integer_clone_count():
    with pytest.raises(SigmaValidationError, match="integer"):
        _validate_source_metadata("monte_carlo", clone_count=25.0, notes=None)
    with pytest.raises(SigmaValidationError, match="integer"):
        _validate_source_metadata("monte_carlo", clone_count=True, notes=None)


def test_calibrated_source_requires_notes():
    with pytest.raises(SigmaValidationError, match="notes"):
        _validate_source_metadata("calibrated", clone_count=None, notes=None)
    _validate_source_metadata(
        "calibrated", clone_count=None, notes="RMS vs Tier-A at curated sites"
    )


def test_unknown_source_is_rejected():
    with pytest.raises(SigmaValidationError, match="source"):
        _validate_source_metadata("guessed", clone_count=None, notes=None)


# ---------------------------------------------------------------------------
# write_sigma / read_sigma end-to-end
# ---------------------------------------------------------------------------


def test_write_sigma_round_trips_default_source(tmp_path, monkeypatch):
    monkeypatch.setattr("lumen_pipeline.terrain.mc_sigma._git_commit", lambda: "a" * 40)
    sigma, valid = _all_valid_sigma(0.1)
    sigma[0, 0] = np.nan
    valid[0, 0] = False

    artifact = write_sigma(
        "im2_athena",
        sigma,
        mask_valid=valid,
        source="default",
        output_root=tmp_path / "terrain",
    )

    assert artifact.binary_path.exists()
    assert artifact.sidecar_path.exists()
    decoded = read_sigma(artifact.binary_path)
    assert decoded.shape == SHAPE
    assert np.isnan(decoded[0, 0])
    assert decoded[0, 1] == pytest.approx(0.1)

    sidecar = artifact.sidecar
    assert sidecar["version"] == "1.0.0"
    assert sidecar["site_id"] == "im2_athena"
    assert sidecar["shape"] == [4, 3600]
    assert sidecar["height_order_m"] == [1.0, 2.0, 5.0, 10.0]
    assert sidecar["unit"] == "deg"
    assert sidecar["source"] == "default"
    assert "clone_count" not in sidecar
    assert sidecar["binary"]["magic"] == "LUMENSGM"
    assert sidecar["binary"]["format_version"] == 1


def test_write_sigma_monte_carlo_records_clone_count(tmp_path, monkeypatch):
    monkeypatch.setattr("lumen_pipeline.terrain.mc_sigma._git_commit", lambda: "b" * 40)
    sigma, valid = _all_valid_sigma(0.05)
    artifact = write_sigma(
        "cy3_shiv_shakti",
        sigma,
        mask_valid=valid,
        source="monte_carlo",
        clone_count=30,
        output_root=tmp_path / "terrain",
    )
    assert artifact.sidecar["clone_count"] == 30
    assert artifact.sidecar["source"] == "monte_carlo"


def test_write_sigma_rejects_invalid_or_missing_git_commit(tmp_path, monkeypatch):
    monkeypatch.setattr("lumen_pipeline.terrain.mc_sigma._git_commit", lambda: None)
    sigma, valid = _all_valid_sigma()
    with pytest.raises(SigmaValidationError, match="40-character"):
        write_sigma(
            "im2_athena",
            sigma,
            mask_valid=valid,
            source="default",
            output_root=tmp_path / "terrain",
        )


def test_write_sigma_rejects_array_that_fails_validation(tmp_path, monkeypatch):
    monkeypatch.setattr("lumen_pipeline.terrain.mc_sigma._git_commit", lambda: "c" * 40)
    sigma, valid = _all_valid_sigma()
    sigma[0, 0] = -1.0  # finite negative: invalid
    with pytest.raises(SigmaValidationError, match="negative"):
        write_sigma(
            "im2_athena",
            sigma,
            mask_valid=valid,
            source="default",
            output_root=tmp_path / "terrain",
        )
    # Nothing should have been written.
    assert not (tmp_path / "terrain" / "sigma" / "im2_athena.bin").exists()


def test_read_sigma_rejects_a_corrupted_file(tmp_path, monkeypatch):
    monkeypatch.setattr("lumen_pipeline.terrain.mc_sigma._git_commit", lambda: "d" * 40)
    sigma, valid = _all_valid_sigma()
    artifact = write_sigma(
        "im2_athena",
        sigma,
        mask_valid=valid,
        source="default",
        output_root=tmp_path / "terrain",
    )
    corrupted = artifact.binary_path.read_bytes()[:-10]  # truncate the payload
    artifact.binary_path.write_bytes(corrupted)
    with pytest.raises(SigmaValidationError, match="file length"):
        read_sigma(artifact.binary_path)


def test_write_sigma_extra_fields_are_included_in_the_sidecar(tmp_path, monkeypatch):
    monkeypatch.setattr("lumen_pipeline.terrain.mc_sigma._git_commit", lambda: "e" * 40)
    sigma, valid = _all_valid_sigma()
    artifact = write_sigma(
        "im2_athena",
        sigma,
        mask_valid=valid,
        source="monte_carlo",
        clone_count=30,
        output_root=tmp_path / "terrain",
        extra={"correlation_lengths_tested_m": [50.0, 150.0], "preliminary": True},
    )
    assert artifact.sidecar["correlation_lengths_tested_m"] == [50.0, 150.0]
    assert artifact.sidecar["preliminary"] is True


def test_write_sigma_extra_fields_cannot_collide_with_contract_fields(tmp_path, monkeypatch):
    monkeypatch.setattr("lumen_pipeline.terrain.mc_sigma._git_commit", lambda: "f" * 40)
    sigma, valid = _all_valid_sigma()
    with pytest.raises(SigmaValidationError, match="collide"):
        write_sigma(
            "im2_athena",
            sigma,
            mask_valid=valid,
            source="default",
            output_root=tmp_path / "terrain",
            extra={"unit": "rad"},
        )
    # Nothing should have been written.
    assert not (tmp_path / "terrain" / "sigma" / "im2_athena.bin").exists()
