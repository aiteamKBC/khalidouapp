import pytest

from app.schemas.admin import TrackingSettingsUpdate


def test_idle_threshold_accepts_exactly_ten_minutes():
    payload = TrackingSettingsUpdate(idle_threshold_minutes=10)

    assert payload.idle_threshold_minutes == 10


@pytest.mark.parametrize("minutes", [1, 9, 11, 120])
def test_idle_threshold_normalizes_older_dashboard_values(minutes):
    payload = TrackingSettingsUpdate(idle_threshold_minutes=minutes)

    assert payload.idle_threshold_minutes == 10
