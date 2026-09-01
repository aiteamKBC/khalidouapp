from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable


def _count(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        return 0
    return min(1_000_000, max(0, value))


def classify_input_integrity_observation(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {
            "state": "unknown",
            "confidence": 0,
            "real_events": 0,
            "injected_events": 0,
        }
    if value.get("sensor_available") is not True:
        return {
            "state": "unavailable",
            "confidence": 100,
            "real_events": 0,
            "injected_events": 0,
        }

    real_events = _count(value.get("real_mouse_events")) + _count(
        value.get("real_keyboard_events")
    )
    injected_events = _count(value.get("injected_mouse_events")) + _count(
        value.get("injected_keyboard_events")
    )
    total_events = real_events + injected_events
    injected_ratio = injected_events / total_events if total_events else 0.0

    if injected_events >= 4 and real_events == 0:
        state = "suspicious"
        confidence = min(99, 80 + injected_events)
    elif injected_events >= 10 and injected_ratio >= 0.9:
        state = "suspicious"
        confidence = min(95, round(injected_ratio * 100))
    elif injected_events:
        state = "review"
        confidence = min(79, max(40, round(injected_ratio * 100)))
    else:
        state = "clear"
        confidence = 90 if real_events else 70

    return {
        "state": state,
        "confidence": confidence,
        "real_events": real_events,
        "injected_events": injected_events,
    }


def summarize_input_integrity(
    observations: Iterable[tuple[datetime, Any]],
) -> dict[str, Any]:
    classified = [
        (observed_at, classify_input_integrity_observation(value))
        for observed_at, value in observations
    ]
    if not classified:
        return {
            "state": "unknown",
            "confidence": 0,
            "injected_events": 0,
            "suspicious_reports": 0,
            "observed_at": None,
        }

    classified.sort(key=lambda item: item[0])
    latest_at, latest = classified[-1]
    suspicious = [item for _, item in classified if item["state"] == "suspicious"]
    review = [item for _, item in classified if item["state"] == "review"]
    injected_events = sum(item["injected_events"] for _, item in classified)

    if len(suspicious) >= 2 or (
        len(suspicious) == 1 and suspicious[0]["injected_events"] >= 20
    ):
        state = "suspicious"
        confidence = max(item["confidence"] for item in suspicious)
    elif suspicious or review:
        state = "review"
        confidence = max(item["confidence"] for item in [*suspicious, *review])
    else:
        state = latest["state"]
        confidence = latest["confidence"]

    return {
        "state": state,
        "confidence": confidence,
        "injected_events": injected_events,
        "suspicious_reports": len(suspicious),
        "observed_at": latest_at.isoformat(),
    }
