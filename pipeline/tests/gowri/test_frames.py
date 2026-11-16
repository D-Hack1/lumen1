import numpy as np
import pytest

from lumen_pipeline.common.frames import (
    az_el_to_direction,
    direction_to_az_el,
    earth_ref_to_true_azimuth,
    reference_axis,
    site_rotation_matrix,
    true_north_vector,
)


@pytest.mark.parametrize("latitude", [-90.0, -89.9, -60.0, -59.9, 0.0, 59.9, 60.0, 89.9, 90.0])
@pytest.mark.parametrize("longitude", [0.0, 32.319, 180.0, 359.9])
def test_site_rotation_is_orthonormal_at_poles_and_reference_boundary(latitude, longitude):
    rotation = site_rotation_matrix(latitude, longitude)
    assert np.isfinite(rotation).all()
    np.testing.assert_allclose(rotation @ rotation.T, np.eye(3), atol=1e-12)
    np.testing.assert_allclose(np.linalg.det(rotation), 1.0, atol=1e-12)


@pytest.mark.parametrize("latitude", [-90.0, -60.0, 60.0, 90.0])
def test_polar_reference_axis_is_x(latitude):
    np.testing.assert_array_equal(reference_axis(latitude), np.array([1.0, 0.0, 0.0]))


@pytest.mark.parametrize("latitude", [-59.999, 0.0, 59.999])
def test_non_polar_reference_axis_is_z(latitude):
    np.testing.assert_array_equal(reference_axis(latitude), np.array([0.0, 0.0, 1.0]))


@pytest.mark.parametrize("latitude,longitude", [(-90.0, 0.0), (-60.0, 32.319), (0.0, 180.0), (60.0, 359.9), (90.0, 0.0)])
def test_site_rotation_is_right_handed(latitude, longitude):
    east, north, up = site_rotation_matrix(latitude, longitude)
    np.testing.assert_allclose(np.cross(east, north), up, atol=1e-12)


@pytest.mark.parametrize("azimuth,elevation", [(0.0, 0.0), (90.0, 20.0), (270.0, -10.0), (359.9, 89.0)])
def test_azimuth_elevation_round_trip(azimuth, elevation):
    direction = az_el_to_direction(azimuth, elevation)
    actual_azimuth, actual_elevation = direction_to_az_el(direction)
    assert actual_azimuth == pytest.approx(azimuth)
    assert actual_elevation == pytest.approx(elevation)


@pytest.mark.parametrize("azimuth,elevation,up", [(0.0, 90.0, 1.0), (137.2, 90.0, 1.0), (0.0, -90.0, -1.0), (278.4, -90.0, -1.0)])
def test_zenith_and_nadir_preserve_elevation_without_requiring_azimuth(azimuth, elevation, up):
    direction = az_el_to_direction(azimuth, elevation)
    _, actual_elevation = direction_to_az_el(direction)
    np.testing.assert_allclose(direction[:2], np.zeros(2), atol=1e-12)
    assert direction[2] == pytest.approx(up)
    assert actual_elevation == pytest.approx(elevation)


def test_non_polar_reference_azimuth_is_true_azimuth():
    assert earth_ref_to_true_azimuth(123.4, -45.0, 32.319) == pytest.approx(123.4)


@pytest.mark.parametrize("latitude", [-90.0, 90.0])
def test_true_north_is_explicitly_undefined_at_poles(latitude):
    with pytest.raises(ValueError, match="undefined"):
        true_north_vector(latitude, 0.0)
