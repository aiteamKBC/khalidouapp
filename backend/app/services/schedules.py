from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import false, or_, select
from sqlalchemy.orm import Session

from app.models import Employee, EmployeeWorkProfile, TeamMember, WorkScheduleOverride


def timezone_for(employee: Employee, timezone_name: str | None = None) -> ZoneInfo:
    try:
        return ZoneInfo(timezone_name or employee.timezone or "UTC")
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
    team_ids = select(TeamMember.team_id).where(
        TeamMember.employee_id == employee.id, TeamMember.status == "active"
    )
    team_override = db.scalar(
        select(WorkScheduleOverride)
        .where(
            WorkScheduleOverride.company_id == employee.company_id,
            WorkScheduleOverride.team_id.in_(team_ids),
            WorkScheduleOverride.effective_date == work_date,
            WorkScheduleOverride.permanent.is_(False),
        )
        .order_by(WorkScheduleOverride.created_at.desc())
    )
    if team_override is not None:
        return team_override
    return db.scalar(
        select(WorkScheduleOverride)
        .where(
            WorkScheduleOverride.company_id == employee.company_id,
            WorkScheduleOverride.scope == "company",
            WorkScheduleOverride.employee_id.is_(None),
            WorkScheduleOverride.team_id.is_(None),
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
    *,
    timezone_name: str | None = None,
) -> dict:
    override = _latest_day_override(db, employee, work_date)
    return _schedule_from_override(
        employee,
        profile,
        work_date,
        override,
        timezone_name=timezone_name,
    )


def _schedule_from_override(
    employee: Employee,
    profile: EmployeeWorkProfile,
    work_date: date,
    override: WorkScheduleOverride | None,
    *,
    timezone_name: str | None = None,
) -> dict:
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
    zone = timezone_for(employee, timezone_name)
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
        "effective_source": (
            "employee_exception"
            if override and override.employee_id
            else "team_exception"
            if override and override.team_id
            else "company_exception"
            if override
            else "employee_profile"
        ),
    }


def effective_schedules_for_range(
    db: Session,
    employee: Employee,
    profile: EmployeeWorkProfile,
    start_date: date,
    end_date: date,
    *,
    timezone_name: str | None = None,
) -> dict[date, dict]:
    """Resolve a bounded period with one override query instead of three per day."""
    if end_date < start_date:
        return {}

    team_ids = list(
        db.scalars(
            select(TeamMember.team_id).where(
                TeamMember.employee_id == employee.id,
                TeamMember.status == "active",
            )
        ).all()
    )
    scope_conditions = [
        WorkScheduleOverride.employee_id == employee.id,
        (WorkScheduleOverride.team_id.in_(team_ids) if team_ids else false()),
        (
            (WorkScheduleOverride.scope == "company")
            & WorkScheduleOverride.employee_id.is_(None)
            & WorkScheduleOverride.team_id.is_(None)
        ),
    ]
    overrides = db.scalars(
        select(WorkScheduleOverride)
        .where(
            WorkScheduleOverride.company_id == employee.company_id,
            WorkScheduleOverride.permanent.is_(False),
            WorkScheduleOverride.effective_date >= start_date,
            WorkScheduleOverride.effective_date <= end_date,
            or_(*scope_conditions),
        )
        .order_by(
            WorkScheduleOverride.effective_date.asc(),
            WorkScheduleOverride.created_at.desc(),
        )
    ).all()

    overrides_by_day: dict[date, dict[str, WorkScheduleOverride]] = {}
    for override in overrides:
        if override.effective_date is None:
            continue
        by_scope = overrides_by_day.setdefault(override.effective_date, {})
        scope = (
            "employee"
            if override.employee_id == employee.id
            else "team"
            if override.team_id in team_ids
            else "company"
        )
        by_scope.setdefault(scope, override)

    schedules: dict[date, dict] = {}
    cursor = start_date
    while cursor <= end_date:
        by_scope = overrides_by_day.get(cursor, {})
        override = by_scope.get("employee") or by_scope.get("team") or by_scope.get("company")
        schedules[cursor] = _schedule_from_override(
            employee,
            profile,
            cursor,
            override,
            timezone_name=timezone_name,
        )
        cursor += timedelta(days=1)
    return schedules


def overlap_seconds(
    start_at: datetime, end_at: datetime, window_start: datetime, window_end: datetime
) -> int:
    return max(0, int((min(end_at, window_end) - max(start_at, window_start)).total_seconds()))
