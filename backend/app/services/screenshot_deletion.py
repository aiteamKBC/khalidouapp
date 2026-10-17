"""Deleting a screenshot together with the tracked time it represents.

Each screenshot stands for ``Screenshot.tracked_seconds`` of active work (the
capture interval split across the screenshots and displays of that interval).
Deleting it removes those seconds from the work session's payable time through
``WorkSession.deducted_seconds``, recomputes that day's attendance so payroll
and timesheets drop immediately, and removes the image files.

Shared by the admin screenshots page and the employee portal so both follow the
same rules.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ApiError
from app.models import Employee, Screenshot, WorkSession
from app.models.payroll import PayrollRun
from app.services.attendance import calculate_daily_attendance
from app.services.payroll import FROZEN_RUN_STATUSES
from app.storage.local import LocalScreenshotStorage


def _session_for(db: Session, screenshot: Screenshot) -> WorkSession | None:
    return db.scalar(
        select(WorkSession).where(
            WorkSession.id == screenshot.session_id,
            WorkSession.company_id == screenshot.company_id,
        )
    )


def screenshot_work_date(
    session: WorkSession | None, employee: Employee | None, screenshot: Screenshot
) -> date:
    """The attendance day the screenshot's time belongs to (session local start day)."""
    zone_name = (session.timezone if session else None) or (
        employee.timezone if employee else None
    )
    try:
        zone = ZoneInfo(zone_name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo("UTC")
    moment = session.started_at if session is not None else screenshot.captured_at
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(zone).date()


def ensure_payroll_open_for(db: Session, company_id, work_date: date) -> None:
    """Refuse when the day is inside an approved, locked or paid payroll run."""
    frozen = db.scalar(
        select(PayrollRun.id).where(
            PayrollRun.company_id == company_id,
            PayrollRun.status.in_(sorted(FROZEN_RUN_STATUSES)),
            PayrollRun.period_start <= work_date,
            PayrollRun.period_end >= work_date,
        )
    )
    if frozen:
        raise ApiError(
            "PAYROLL_PERIOD_LOCKED",
            "This screenshot is in a payroll period that has already been approved, "
            "so it can no longer be deleted.",
            409,
        )


def delete_screenshot_with_time(
    db: Session,
    screenshot: Screenshot,
    *,
    require_open_payroll: bool = False,
) -> int:
    """Soft-delete ``screenshot``, deduct its tracked time and remove its files.

    Returns the seconds deducted. Commits.
    """
    session = _session_for(db, screenshot)
    employee = db.get(Employee, screenshot.employee_id)
    work_date = screenshot_work_date(session, employee, screenshot)
    if require_open_payroll:
        ensure_payroll_open_for(db, screenshot.company_id, work_date)

    screenshot.deleted_at = datetime.now(UTC)
    screenshot.status = "deleted"
    deducted_seconds = 0
    if session is not None and screenshot.deleted_time_seconds == 0:
        effective_active = max(0, session.active_seconds - session.deducted_seconds)
        deducted_seconds = min(effective_active, max(0, screenshot.tracked_seconds))
        session.deducted_seconds += deducted_seconds
        screenshot.deleted_time_seconds = deducted_seconds
        db.add(session)
    db.add(screenshot)
    db.commit()
    # Force the affected day's canonical attendance to recompute now so the
    # deduction reaches payroll and timesheets immediately, instead of relying on
    # a past day's immutable cache (W3).
    if deducted_seconds and employee is not None:
        calculate_daily_attendance(db, employee=employee, work_date=work_date)
        db.commit()
    storage = LocalScreenshotStorage()
    storage.delete(screenshot.storage_path)
    if screenshot.thumbnail_path:
        storage.delete(screenshot.thumbnail_path)
    return deducted_seconds
