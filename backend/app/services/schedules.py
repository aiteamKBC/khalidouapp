from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Employee, EmployeeWorkProfile, WorkScheduleOverride


def timezone_for(employee: Employee) -> ZoneInfo:
    try:
        return ZoneInfo(employee.timezone or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _clock(value: str | time | None) -> time | None:
    if value is None or isinstance(value, time):
        return value
    return datetime.strptime(str(value)[:5], "%H:%M").time()


def _latest_day_override(
    db: Session, employee: Employee, work_date: date
) -> WorkScheduleOverride | None:
    employee_override = db.scalar(
        select(WorkScheduleOverride)
        .where(
            WorkScheduleOverride.company_id == employee.company_id,
            WorkScheduleOverride.employee_id == employee.id,
            WorkScheduleOverride.effective_date == work_date,
            WorkScheduleOverride.permanent.is_(False),
        )
        .order_by(WorkScheduleOverride.created_at.desc())
    )
    if employee_override is not None:
        return employee_override
    return db.scalar(
        select(WorkScheduleOverride)
        .where(
            WorkScheduleOverride.company_id == employee.company_id,
            WorkScheduleOverride.scope == "company",
            WorkScheduleOverride.effective_date == work_date,
            WorkScheduleOverride.permanent.is_(False),
        )
        .order_by(WorkScheduleOverride.created_at.desc())
    )


def effective_schedule(
    db: Session,
    employee: Employee,
    profile: EmployeeWorkProfile,
    work_date: date,
) -> dict:
    override = _latest_day_override(db, employee, work_date)
    shift_start = profile.shift_start
    shift_end = profile.shift_end
    break_rules = list(profile.break_rules or [])
    if override is not None:
        if override.override_type in {"shift", "both"}:
            shift_start = override.shift_start or shift_start
            shift_end = override.shift_end or shift_end
        if override.override_type in {"breaks", "both"} and override.break_rules is not None:
            break_rules = list(override.break_rules)

    scheduled_day = work_date.weekday() in set(profile.working_days or [0, 1, 2, 3, 4])
    if override and override.override_type in {"shift", "both"}:
        scheduled_day = True
    zone = timezone_for(employee)
    start_at = (
        datetime.combine(work_date, shift_start, tzinfo=zone).astimezone(UTC)
        if scheduled_day and shift_start
        else None
    )
    end_at = (
        datetime.combine(work_date, shift_end, tzinfo=zone).astimezone(UTC)
        if scheduled_day and shift_end
        else None
    )
    if start_at and end_at and end_at <= start_at:
        end_at += timedelta(days=1)

    breaks = []
    for rule in break_rules:
        start_clock = _clock(rule.get("start_time"))
        end_clock = _clock(rule.get("end_time"))
        if not start_clock or not end_clock:
            continue
        break_start = datetime.combine(work_date, start_clock, tzinfo=zone).astimezone(UTC)
        break_end = datetime.combine(work_date, end_clock, tzinfo=zone).astimezone(UTC)
        if break_end <= break_start:
            break_end += timedelta(days=1)
        if start_at and end_at:
            break_start = max(start_at, break_start)
            break_end = min(end_at, break_end)
        if break_end <= break_start:
            continue
        breaks.append(
            {
                "name": str(rule.get("name") or "Break"),
                "paid": bool(rule.get("paid")),
                "start_at": break_start,
                "end_at": break_end,
                "seconds": int((break_end - break_start).total_seconds()),
            }
        )
    return {
        "scheduled_day": scheduled_day,
        "start_at": start_at,
        "end_at": end_at,
        "breaks": breaks,
        "timezone": zone.key,
        "override_id": str(override.id) if override else None,
        "override_reason": override.reason if override else None,
    }


def overlap_seconds(
    start_at: datetime, end_at: datetime, window_start: datetime, window_end: datetime
) -> int:
    return max(0, int((min(end_at, window_end) - max(start_at, window_start)).total_seconds()))
