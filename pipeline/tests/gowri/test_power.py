import numpy as np
import pytest

from lumen_pipeline.common.constants import AU_KM, SOLAR_CONSTANT_W_M2
from lumen_pipeline.reference.power import (
    Panel,
    best_yaw_deg,
    evaluate_power_series,
    flat_ground_baseline_w,
    generic_panel_preset,
    integrate_battery_soc,
    orient_panels,
    solar_generation_w,
)

PANEL = Panel(np.array([0.0, 0.0, 1.0]), area_m2=2.0, efficiency=0.25)
SUN = np.array([0.0, 0.0, 1.0])


def test_solar_generation_applies_daylight_darkness_and_eclipse_fraction():
    daylight = solar_generation_w(SUN, AU_KM, 1.0, [PANEL])
    assert daylight == pytest.approx(SOLAR_CONSTANT_W_M2 * 0.5)
    assert solar_generation_w(SUN, AU_KM, 0.0, [PANEL]) == 0.0
    assert solar_generation_w(SUN, AU_KM, 0.5, [PANEL]) == pytest.approx(daylight / 2.0)
    assert solar_generation_w(np.array([0.0, 0.0, -1.0]), AU_KM, 1.0, [PANEL]) == 0.0


def test_generic_presets_require_configured_panel_physics_and_headings():
    four_side = generic_panel_preset("fourSide", panel_area_m2=2.0, efficiency=0.25)
    assert len(four_side) == 4
    np.testing.assert_allclose(
        [panel.normal for panel in four_side],
        [[0.0, 1.0, 0.0], [1.0, 0.0, 0.0], [0.0, -1.0, 0.0], [-1.0, 0.0, 0.0]],
        atol=1e-12,
    )

    heading = generic_panel_preset("singleHeading", panel_area_m2=2.0, efficiency=0.25, heading_deg=90.0)
    tracking = generic_panel_preset("trackingMast", panel_area_m2=2.0, efficiency=0.25, tracking_azimuth_deg=180.0)
    deck = generic_panel_preset("horizontalDeck", panel_area_m2=2.0, efficiency=0.25)
    np.testing.assert_allclose(heading[0].normal, [1.0, 0.0, 0.0], atol=1e-12)
    np.testing.assert_allclose(tracking[0].normal, [0.0, -1.0, 0.0], atol=1e-12)
    np.testing.assert_allclose(deck[0].normal, [0.0, 0.0, 1.0])
    with pytest.raises(ValueError, match="heading_deg"):
        generic_panel_preset("singleHeading", panel_area_m2=2.0, efficiency=0.25)
    with pytest.raises(ValueError, match="tracking_azimuth_deg"):
        generic_panel_preset("trackingMast", panel_area_m2=2.0, efficiency=0.25)


def test_attitude_composes_ground_tilt_yaw_and_off_nominal_tilt():
    ground = np.array([0.5, 0.0, np.sqrt(0.75)])
    deck = generic_panel_preset("horizontalDeck", panel_area_m2=1.0, efficiency=1.0)
    tilted = orient_panels(deck, ground, 0.0, 0.0, 0.0)
    np.testing.assert_allclose(tilted[0].normal, ground)

    north_facing = generic_panel_preset("singleHeading", panel_area_m2=1.0, efficiency=1.0, heading_deg=0.0)
    yawed = orient_panels(north_facing, np.array([0.0, 0.0, 1.0]), 90.0, 0.0, 0.0)
    np.testing.assert_allclose(yawed[0].normal, [1.0, 0.0, 0.0], atol=1e-12)

    off_nominal = orient_panels(deck, np.array([0.0, 0.0, 1.0]), 0.0, 30.0, 90.0)
    np.testing.assert_allclose(off_nominal[0].normal, [0.5, 0.0, np.sqrt(0.75)], atol=1e-12)
    assert best_yaw_deg(north_facing, np.array([1.0, 0.0, 0.0]), np.array([0.0, 0.0, 1.0]), 0.0, 0.0) == 90.0


def test_flat_ground_baseline_uses_same_controls_without_terrain_tilt():
    deck = generic_panel_preset("horizontalDeck", panel_area_m2=1.0, efficiency=1.0)
    baseline = flat_ground_baseline_w(SUN, AU_KM, 1.0, deck, 0.0, 0.0, 0.0)
    terrain = solar_generation_w(SUN, AU_KM, 1.0, orient_panels(deck, np.array([0.5, 0.0, np.sqrt(0.75)]), 0.0, 0.0, 0.0))
    assert baseline == pytest.approx(SOLAR_CONSTANT_W_M2)
    assert terrain == pytest.approx(SOLAR_CONSTANT_W_M2 * np.sqrt(0.75))


def test_battery_charges_and_discharges_using_interval_energy():
    charging = integrate_battery_soc(
        [0.0, 3600.0], [100.0, 100.0], [60.0, 60.0],
        battery_capacity_wh=200.0, usable_depth_of_discharge=0.8, initial_soc_fraction=0.5,
    )
    assert charging.stored_energy_wh[-1] == pytest.approx(140.0)
    assert charging.soc_fraction[-1] == pytest.approx(0.7)

    darkness = integrate_battery_soc(
        [0.0, 3600.0, 7200.0], [0.0, 0.0, 0.0], [60.0, 60.0, 60.0],
        battery_capacity_wh=200.0, usable_depth_of_discharge=0.8, initial_soc_fraction=0.5,
    )
    np.testing.assert_allclose(darkness.stored_energy_wh, [100.0, 40.0, 40.0])
    assert darkness.unserved_load_wh[-1] == pytest.approx(60.0)


def test_battery_reports_full_limit_and_is_timestep_consistent_for_constant_power():
    full = integrate_battery_soc(
        [0.0, 3600.0], [100.0, 100.0], [0.0, 0.0],
        battery_capacity_wh=100.0, usable_depth_of_discharge=1.0, initial_soc_fraction=0.8,
    )
    assert full.stored_energy_wh[-1] == 100.0
    assert full.curtailed_generation_wh[-1] == pytest.approx(80.0)

    result = integrate_battery_soc(
        [0.0, 1800.0, 3600.0], [100.0, 100.0, 100.0], [0.0, 0.0, 0.0],
        battery_capacity_wh=500.0, usable_depth_of_discharge=1.0, initial_soc_fraction=0.2,
    )
    assert result.soc_fraction[-1] == pytest.approx(0.4)


def test_power_series_combines_generation_eclipse_load_and_soc():
    result = evaluate_power_series(
        [0.0, 3600.0], [SUN, SUN], [AU_KM, AU_KM], [1.0, 0.0], [PANEL], [10.0, 10.0],
        battery_capacity_wh=1000.0, usable_depth_of_discharge=1.0, initial_soc_fraction=0.5,
    )
    assert result.generation_w.tolist() == pytest.approx([680.5, 0.0])
    assert result.net_w.tolist() == pytest.approx([670.5, -10.0])
    assert result.stored_energy_wh[-1] == pytest.approx(830.25)
