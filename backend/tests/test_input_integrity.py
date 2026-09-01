from datetime import UTC, datetime, timedelta

from app.services.input_integrity import (
    classify_input_integrity_observation,
    summarize_input_integrity,
)


def observation(*, real: int = 0, injected: int = 0, available: bool = True):
    return {
        "sensor": "windows_low_level_input",
        "sensor_available": available,
        "observed_seconds": 30,
        "real_mouse_events": real,
        "real_keyboard_events": 0,
        "injected_mouse_events": injected,
        "injected_keyboard_events": 0,
    }


def test_injected_only_input_is_suspicious():
    result = classify_input_integrity_observation(observation(injected=8))
    assert result["state"] == "suspicious"
    assert result["injected_events"] == 8


def test_real_work_with_some_automation_requires_review_not_automatic_action():
    result = classify_input_integrity_observation(observation(real=50, injected=2))
    assert result["state"] == "review"


def test_two_injected_only_reports_raise_a_high_confidence_warning():
    now = datetime.now(UTC)
    result = summarize_input_integrity(
        [
            (now - timedelta(seconds=30), observation(injected=6)),
            (now, observation(injected=6)),
        ]
    )
    assert result["state"] == "suspicious"
    assert result["suspicious_reports"] == 2


def test_missing_sensor_is_explicit_and_never_called_suspicious():
    result = summarize_input_integrity([(datetime.now(UTC), observation(available=False))])
    assert result["state"] == "unavailable"
