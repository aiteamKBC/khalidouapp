from datetime import date

import pytest

from app.api.v1.employee_portal import period_summary
from app.core.exceptions import ApiError
from app.schemas.agent import AgentTaskCreate
from app.services.projects import validate_task_dates


def test_period_summary_uses_one_point_per_active_hour() -> None:
    summary = period_summary(
        [
            {
                "active_seconds": 3600,
                "idle_seconds": 600,
                "adjustment_seconds": 900,
                "deducted_seconds": 300,
                "screenshot_count": 4,
            },
            {
                "active_seconds": 1800,
                "idle_seconds": 0,
                "adjustment_seconds": 0,
                "deducted_seconds": 0,
                "screenshot_count": 2,
            },
        ],
        {"pending": 1200, "rejected": 600},
    )

    assert summary["active_seconds"] == 5400
    assert summary["points"] == 1.5
    assert summary["tracked_active_seconds"] == 4500
    assert summary["manual_approved_seconds"] == 900
    assert summary["manual_pending_seconds"] == 1200
    assert summary["manual_rejected_seconds"] == 600
    assert summary["deducted_seconds"] == 300
    assert summary["screenshot_count"] == 6


def test_employee_task_stage_is_restricted() -> None:
    with pytest.raises(ValueError):
        AgentTaskCreate(name="Private task", stage="review")


def test_task_deadline_cannot_precede_start_date() -> None:
    with pytest.raises(ApiError) as exc_info:
        validate_task_dates(date(2026, 7, 12), date(2026, 7, 11))
    assert exc_info.value.code == "INVALID_TASK_DATES"
    validate_task_dates(date(2026, 7, 11), date(2026, 7, 12))
