import numpy as np
import pytest

from lumen_pipeline.common.constants import AU_KM
from lumen_pipeline.reference.metrics import first_pass_metrics, power_series_metrics
from lumen_pipeline.reference.power import (
    Panel,
    PowerSeries,
    evaluate_power_series,
    integrate_battery_soc,
)
from lumen_pipeline.reference.windows import Window

PANEL = Panel(np.array([0.0, 0.0, 1.0]), area_m2=2.0, efficiency=0.25)
SUN = np.array([0.0, 0.0, 1.0])


def test_power_metrics_summarize_eclipse_generation_and_soc():
    power = evaluate_power_series(
        [0.0, 3600.0],
        [SUN, SUN],
        [AU_KM, AU_KM],
        [1.0, 0.0],
        [PANEL],
        [10.0, 10.0],
        battery_capacity_wh=1000.0,
        usable_depth_of_discharge=1.0,
        initial_soc_fraction=0.5,
    )

    metrics = power_series_metrics([0.0, 3600.0], power)

    assert metrics.generated_energy_wh == pytest.approx(340.25)
    assert metrics.generated_energy_per_day_wh == pytest.approx(8166.0)
    assert metrics.load_energy_wh == pytest.approx(10.0)
    assert metrics.net_energy_wh == pytest.approx(330.25)
    assert metrics.initial_soc_fraction == pytest.approx(0.5)
    assert metrics.final_soc_fraction == pytest.approx(0.83025)
    assert metrics.operating_hours is None


def test_first_pass_metrics_exposes_only_explicit_power_contract_fields():
    power = integrate_battery_soc(
        [0.0, 3600.0],
        [100.0, 100.0],
        [20.0, 20.0],
        battery_capacity_wh=1000.0,
        usable_depth_of_discharge=1.0,
        initial_soc_fraction=0.5,
    )
    metrics = first_pass_metrics(
        [0.0, 3600.0],
        [True, True],
        [True, True],
        [1.0, 1.0],
        [1.0, 1.0],
        [1.0, 1.0],
        [1.0, 1.0],
        [1.0, 1.0],
        power=power,
        operating_windows=[Window("ops", 0.0, 3600.0, 0.0, True, True)],
    )

    assert metrics["energyPerDayWh"] == {"value": 2400.0, "lo": None, "hi": None}
    assert metrics["opsHours"] == {"value": 1.0, "lo": None, "hi": None}


def test_power_metrics_handle_irregular_samples_variable_loads_and_partial_ops_windows():
    times = [0.0, 1800.0, 7200.0]
    power = integrate_battery_soc(
        times,
        [100.0, 200.0, 50.0],
        [10.0, 30.0, 20.0],
        battery_capacity_wh=1000.0,
        usable_depth_of_discharge=1.0,
        initial_soc_fraction=0.5,
    )
    windows = [
        Window("ops", -600.0, 1800.0, 0.0, True, False),
        Window("ops", 5400.0, 9000.0, 0.0, False, True),
    ]

    metrics = power_series_metrics(times, power, operating_windows=windows)

    assert metrics.generated_energy_wh == pytest.approx(262.5)
    assert metrics.load_energy_wh == pytest.approx(47.5)
    assert metrics.net_energy_wh == pytest.approx(215.0)
    assert metrics.operating_hours == pytest.approx(1.0)


def test_power_metrics_are_cadence_independent_for_constant_power():
    two_samples = integrate_battery_soc(
        [0.0, 86_400.0], [100.0, 100.0], [20.0, 20.0],
        battery_capacity_wh=10_000.0, usable_depth_of_discharge=1.0, initial_soc_fraction=0.5,
    )
    three_samples = integrate_battery_soc(
        [0.0, 43_200.0, 86_400.0], [100.0, 100.0, 100.0], [20.0, 20.0, 20.0],
        battery_capacity_wh=10_000.0, usable_depth_of_discharge=1.0, initial_soc_fraction=0.5,
    )

    first = power_series_metrics([0.0, 86_400.0], two_samples)
    second = power_series_metrics([0.0, 43_200.0, 86_400.0], three_samples)

    assert first.generated_energy_per_day_wh == second.generated_energy_per_day_wh == pytest.approx(2400.0)
    assert first.load_energy_wh == second.load_energy_wh == pytest.approx(480.0)


def test_power_metrics_report_curtailment_unserved_energy_and_conservation():
    curtailed = integrate_battery_soc(
        [0.0, 3600.0], [100.0, 100.0], [0.0, 0.0],
        battery_capacity_wh=100.0, usable_depth_of_discharge=1.0, initial_soc_fraction=0.5,
    )
    unserved = integrate_battery_soc(
        [0.0, 3600.0], [0.0, 0.0], [50.0, 50.0],
        battery_capacity_wh=100.0, usable_depth_of_discharge=0.5, initial_soc_fraction=0.5,
    )

    curtailed_metrics = power_series_metrics([0.0, 3600.0], curtailed)
    unserved_metrics = power_series_metrics([0.0, 3600.0], unserved)

    assert curtailed_metrics.curtailed_energy_wh == pytest.approx(50.0)
    assert unserved_metrics.unserved_energy_wh == pytest.approx(50.0)
    for power, metrics in [(curtailed, curtailed_metrics), (unserved, unserved_metrics)]:
        stored_delta = power.stored_energy_wh[-1] - power.stored_energy_wh[0]
        assert stored_delta == pytest.approx(metrics.net_energy_wh - metrics.curtailed_energy_wh + metrics.unserved_energy_wh)


def test_power_metrics_reject_zero_duration_series():
    series = PowerSeries(
        np.array([0.0, 0.0]),
        np.array([0.0, 0.0]),
        np.array([0.0, 0.0]),
        np.array([0.5, 0.5]),
        np.array([50.0, 50.0]),
        np.array([0.0, 0.0]),
        np.array([0.0, 0.0]),
    )

    with pytest.raises(ValueError, match="strictly increasing"):
        power_series_metrics([0.0, 0.0], series)
    with pytest.raises(ValueError, match="positive duration"):
        power_series_metrics([0.0, 3600.0], series, operating_windows=[Window("ops", 10.0, 10.0, 0.0, False, False)])
