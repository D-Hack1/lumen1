import numpy as np

from lumen_pipeline.common.binio import read_array
from lumen_pipeline.ephem.dsn import (
    CADENCE_SECONDS,
    STATION_ORDER,
    build_dsn,
    dsn_ets,
    encode_elevations,
)
from lumen_pipeline.ephem.kernels import loaded_kernels


def test_dsn_station_order_encoding_and_metadata(tmp_path):
    output = tmp_path / "dsn.bin"
    metadata = build_dsn(
        output,
        start_utc="2023-01-01T00:00:00Z",
        end_utc="2023-01-01T00:20:00Z",
    )

    values, sidecar = read_array(output)
    assert values.shape == (3, 3)
    assert values.dtype == np.dtype("<i2")
    assert sidecar["fields"] == list(STATION_ORDER)
    assert sidecar["axis_order"] == ["station", "time"]
    assert sidecar["cadence_s"] == CADENCE_SECONDS
    assert sidecar["mode"] == "geometric_only"
    assert sidecar["frame"] == "IAU_EARTH"
    assert sidecar["scale"] == 0.5
    assert sidecar["offset"] == 0.0
    assert sidecar["station_coordinate_realization"] == "ITRF93"
    assert sidecar["station_coordinate_epoch"] == "not specified by JPL Horizons DSS observer geodetic headers"
    assert sidecar["station_coordinate_retrieval"]["provider"] == "JPL Horizons"
    assert sidecar["station_coordinate_retrieval"]["observer_centers"] == list(STATION_ORDER)
    assert len(sidecar["kernel_provenance"]) == 5
    assert metadata["shape"] == [3, 3]
    assert np.all(values >= -180) and np.all(values <= 180)


def test_dsn_grid_and_half_degree_encoding_are_deterministic():
    with loaded_kernels():
        ets = dsn_ets("2023-01-01T00:00:00Z", "2023-01-01T00:20:00Z")
    encoded = encode_elevations(np.array([-89.76, -0.25, 0.25, 89.76]))

    assert len(ets) == 3
    np.testing.assert_allclose(np.diff(ets), CADENCE_SECONDS)
    np.testing.assert_array_equal(encoded, [-180, 0, 0, 180])
