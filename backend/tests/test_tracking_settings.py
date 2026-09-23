import pytest

from app.schemas.admin import TrackingSettingsUpdate


@pytest.mark.parametrize("minutes", [1, 10, 11, 15, 120])
def test_idle_threshold_accepts_configured_value(minutes):
    # The detection threshold is company-configurable and no longer force-pinned
    # to 10; the policy default (applied when unset) is 15.
    payload = TrackingSettingsUpdate(idle_threshold_minutes=minutes)

    assert payload.idle_threshold_minutes == minutes


@pytest.mark.parametrize("minutes", [0, 121, -5])
def test_idle_threshold_rejects_out_of_range_values(minutes):
    with pytest.raises(ValueError):
        TrackingSettingsUpdate(idle_threshold_minutes=minutes)


def test_idle_threshold_unset_stays_none():
    payload = TrackingSettingsUpdate()

    assert payload.idle_threshold_minutes is None
