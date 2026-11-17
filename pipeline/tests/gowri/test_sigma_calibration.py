from lumen_pipeline.validation.sigma_calibration import calibrate


def test_calibration_inflates_each_source_supplied_band_to_68_percent():
    events = [
        {
            "site_id": "a",
            "event_type": "sunrise",
            "distance_band": "source-band-a",
            "tier_a_time_s": 0,
            "tier_b_time_s": 1,
            "tier_b_sigma_s": 1,
        },
        {
            "site_id": "a",
            "event_type": "sunrise",
            "distance_band": "source-band-a",
            "tier_a_time_s": 0,
            "tier_b_time_s": 2,
            "tier_b_sigma_s": 1,
        },
        {
            "site_id": "b",
            "event_type": "sunset",
            "distance_band": "source-band-a",
            "tier_a_time_s": 0,
            "tier_b_time_s": 3,
            "tier_b_sigma_s": 1,
        },
    ]
    record = calibrate(
        events, provenance={"tierb": "authenticated test fixture"}, authentic_tierb=True
    )

    assert record["status"] == "PASS"
    assert record["time_unit"] == "s"
    assert record["coverage_before"] == 1 / 3
    assert record["coverage_after"] >= 0.68
    assert record["bands"]["source-band-a"]["sigma_multiplier"] == 3


def test_calibration_never_promotes_synthetic_or_missing_events():
    event = {
        "site_id": "a",
        "event_type": "sunrise",
        "distance_band": "source-band-a",
        "tier_a_time_s": 0,
        "tier_b_time_s": 1,
        "tier_b_sigma_s": 1,
    }

    blocked = calibrate([event], provenance={"test": True}, authentic_tierb=False)
    malformed = calibrate(
        [{**event, "tier_b_sigma_s": 0}], provenance={"tierb": "authentic"}, authentic_tierb=True
    )

    assert blocked["status"] == "BLOCKED"
    assert malformed["status"] == "BLOCKED"
    assert malformed["missing_events"]
