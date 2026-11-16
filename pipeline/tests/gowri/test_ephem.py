import numpy as np

from lumen_pipeline.common.binio import read_array, write_array
from lumen_pipeline.ephem.ephemeris import (
    build_ephemeris,
    hermite_position,
    validate_ephemeris_file,
)


def test_dsn_signed_int16_encoding_round_trip(tmp_path):
    stored = np.array([-180, -1, 0, 1, 180], dtype=np.int16)
    path = tmp_path / "dsn.bin"

    metadata = write_array(
        path,
        stored,
        fields=["moon_elevation"],
        units="degrees",
        producer="test",
        scale=0.5,
    )
    decoded, read_metadata = read_array(path)

    assert metadata["dtype"] == "int16"
    assert read_metadata["scale"] == 0.5
    assert decoded.dtype == np.dtype("<i2")
    np.testing.assert_array_equal(decoded, stored)
    np.testing.assert_allclose(decoded / 2, [-90.0, -0.5, 0.0, 0.5, 90.0])


def test_ephemeris_writer_preserves_contract_layout(tmp_path):
    output = tmp_path / "ephem.bin"
    metadata = build_ephemeris(
        output,
        start_utc="2023-01-01T00:00:00Z",
        end_utc="2023-01-01T02:00:00Z",
    )

    nodes, sidecar = read_array(output)
    assert nodes.shape == (3, 12)
    assert nodes.dtype == np.dtype("<f4")
    assert sidecar["frame"] == "MOON_ME"
    assert sidecar["spice_frame"] == "MOON_ME_DE421"
    assert sidecar["cadence_s"] == 3600
    assert sidecar["aberration_correction"] == "LT+S"
    assert sidecar["body_order"] == ["sun", "earth"]
    assert len(sidecar["kernel_provenance"]) == 5
    assert metadata["start_et_tdb"] == sidecar["start_et_tdb"]

    position = hermite_position(nodes, float(sidecar["start_et_tdb"]), float(sidecar["start_et_tdb"]) + 1800)
    assert position.shape == (2, 3)


def test_g2_hermite_validation_on_small_ephemeris(tmp_path):
    output = tmp_path / "ephem.bin"
    build_ephemeris(
        output,
        start_utc="2023-01-01T00:00:00Z",
        end_utc="2023-01-02T00:00:00Z",
    )
    result = validate_ephemeris_file(output, epochs=100, seed=1)

    assert result.max_direction_error_deg < 0.001
