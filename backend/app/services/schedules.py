from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import false, or_, select
from sqlalchemy.orm import Session

from app.models import AuditLog, Employee, EmployeeWorkProfile, TeamMember, WorkScheduleOverride
from app.services.work_profiles import DEFAULT_WORKING_DAYS


_PROFILE_SCHEDULE_FIELDS = (
    "shift_start",
    "shift_end",
    "working_days",
    "weekly_off_days",
    "break_rules",
)


def timezone_for(employee: Employee, timezone_name: str | None = None) -> ZoneInfo:
    try:
        return ZoneInfo(timezone_name or employee.timezone or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _clock(value: str | time | None) -> time | None:
    if value is None or isinstance(value, time):
        return value
    return datetime.strptime(str(value)[:5], "%H:%M").time()


def _profile_schedule_values(profile: EmployeeWorkProfile) -> dict:
    return {field: getattr(profile, field) for field in _PROFILE_SCHEDULE_FIELDS}


def profile_schedule_audits_by_employee(
    db: Session,
    employees: list[Employee],
) -> dict:
    if not employees:
        return {}
    employee_ids = [employee.id for employee in employees]
    company_ids = {employee.company_id for employee in employees}
    rows = db.scalars(
        select(AuditLog)
        .where(
            AuditLog.company_id.in_(company_ids),
            AuditLog.entity_type == "employee_work_profile",
            AuditLog.entity_id.in_(employee_ids),
            AuditLog.action == "updated",
        )
        .order_by(AuditLog.created_at.desc())
    ).all()
    by_employee: dict = {}
    for row in rows:
        if row.entity_id is not None:
            by_employee.setdefault(row.entity_id, []).append(row)
    return by_employee


def _profile_schedule_values_as_of(
    employee: Employee,
    profile: EmployeeWorkProfile,
    work_date: date,
    audits: list[AuditLog] | None,
    *,
    timezone_name: str | None = None,
) -> dict:
    values = _profile_schedule_values(profile)
    history_applied = False
    if not audits:
        values["_history_applied"] = False
        return values
    zone = timezone_for(employee, timezone_name)
    for audit in audits:
        changed_at = audit.created_at
        if changed_at.tzinfo is None:
            changed_at = changed_at.replace(tzinfo=UTC)
        if work_date >= changed_at.astimezone(zone).date():
            continue
        details = audit.details or {}
        old_values = details.get("old") or {}
        new_values = details.get("new") or {}
        for field in _PROFILE_SCHEDULE_FIELDS:
            if field in new_values and field in old_values:
                values[field] = old_values[field]
                history_applied = True
    values["_history_applied"] = history_applied
    return values


def profile_schedule_history_applies(
    employee: Employee,
    profile: EmployeeWorkProfile,
    work_date: date,
    audits: list[AuditLog] | None,
    *,
    timezone_name: str | None = None,
) -> bool:
    return bool(
        _profile_schedule_values_as_of(
            employee,
            profile,
            work_date,
            audits,
            timezone_name=timezone_name,
        )["_history_applied"]
    )


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
    employee_today = datetime.now(UTC).astimezone(timezone_for(employee, timezone_name)).date()
    audits_by_employee = (
        profile_schedule_audits_by_employee(db, [employee]) if work_date < employee_today else {}
    )
    return _schedule_from_override(
        employee,
        profile,
        work_date,
        override,
        profile_values=_profile_schedule_values_as_of(
            employee,
            profile,
            work_date,
            audits_by_employee.get(employee.id),
            timezone_name=timezone_name,
        ),
        timezone_name=timezone_name,
    )


def effective_schedules_for_employees(
    db: Session,
    employees: list[Employee],
    work_date: date,
    *,
    profiles: dict | None = None,
    memberships_by_employee: dict | None = None,
) -> dict:
    """Resolve one workday for many employees with two shared queries."""
    if not employees:
        return {}

    employee_ids = [employee.id for employee in employees]
    if memberships_by_employee is None:
        memberships_by_employee = {employee_id: [] for employee_id in employee_ids}
        membership_rows = db.execute(
            select(TeamMember.employee_id, TeamMember.team_id).where(
                TeamMember.employee_id.in_(employee_ids),
                TeamMember.status == "active",
            )
        ).all()
        for employee_id, team_id in membership_rows:
            memberships_by_employee.setdefault(employee_id, []).append(team_id)
    team_ids = {
        team_id
        for employee_id in employee_ids
        for team_id in memberships_by_employee.get(employee_id, [])
    }
    company_ids = {employee.company_id for employee in employees}
    historical_employees = [
        employee
        for employee in employees
        if work_date < datetime.now(UTC).astimezone(timezone_for(employee)).date()
    ]
    audits_by_employee = profile_schedule_audits_by_employee(db, historical_employees)

    scope_conditions = [
        WorkScheduleOverride.employee_id.in_(employee_ids),
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
            WorkScheduleOverride.company_id.in_(company_ids),
            WorkScheduleOverride.permanent.is_(False),
            WorkScheduleOverride.effective_date == work_date,
            or_(*scope_conditions),
        )
        .order_by(WorkScheduleOverride.created_at.desc())
    ).all()

    employee_overrides: dict = {}
    company_overrides: dict = {}
    for override in overrides:
        if override.employee_id is not None:
            employee_overrides.setdefault(override.employee_id, override)
        elif override.team_id is None:
            company_overrides.setdefault(override.company_id, override)

    schedules = {}
    for employee in employees:
        profile = (profiles or {}).get(employee.id) or employee.work_profile
        if profile is None:
            from app.services.work_profiles import get_or_create_work_profile

            profile = get_or_create_work_profile(db, employee)
        employee_team_ids = set(memberships_by_employee.get(employee.id, []))
        team_override = next(
            (
                override
                for override in overrides
                if override.team_id is not None
                and override.team_id in employee_team_ids
            ),
            None,
        )
        override = (
            employee_overrides.get(employee.id)
            or team_override
            or company_overrides.get(employee.company_id)
        )
        schedules[employee.id] = _schedule_from_override(
            employee,
            profile,
            work_date,
            override,
            profile_values=_profile_schedule_values_as_of(
                employee,
                profile,
                work_date,
                audits_by_employee.get(employee.id),
            ),
        )
    return schedules


def _schedule_from_override(
    employee: Employee,
    profile: EmployeeWorkProfile,
    work_date: date,
    override: WorkScheduleOverride | None,
    *,
    profile_values: dict | None = None,
    timezone_name: str | None = None,
) -> dict:
    schedule_values = profile_values or _profile_schedule_values(profile)
    shift_start = _clock(schedule_values["shift_start"])
    shift_end = _clock(schedule_values["shift_end"])
    break_rules = list(schedule_values["break_rules"] or [])
    if override is not None:
        if override.override_type in {"shift", "both"}:
            shift_start = override.shift_start or shift_start
            shift_end = override.shift_end or shift_end
        if override.override_type in {"breaks", "both"} and override.break_rules is not None:
            break_rules = list(override.break_rules)

    weekday = work_date.weekday()
    working_days = set(
        schedule_values["working_days"]
        if schedule_values["working_days"] is not None
        else DEFAULT_WORKING_DAYS
    )
    weekly_off_days = set(schedule_values["weekly_off_days"] or [])
    explicit_weekly_off = weekday in weekly_off_days
    scheduled_day = weekday in working_days and not explicit_weekly_off
    # A shift exception may change the hours for a working day, but it must not
    # turn an explicitly configured weekly off into regular scheduled work.
    if (
        override
        and override.override_type in {"shift", "both"}
        and not explicit_weekly_off
    ):
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
        "profile_history_applied": bool(schedule_values.get("_history_applied", False)),
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

    employee_today = datetime.now(UTC).astimezone(timezone_for(employee, timezone_name)).date()
    audits_by_employee = (
        profile_schedule_audits_by_employee(db, [employee]) if start_date < employee_today else {}
    )

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
            profile_values=_profile_schedule_values_as_of(
                employee,
                profile,
                cursor,
                audits_by_employee.get(employee.id),
                timezone_name=timezone_name,
            ),
            timezone_name=timezone_name,
        )
        cursor += timedelta(days=1)
    return schedules


def overlap_seconds(
    start_at: datetime, end_at: datetime, window_start: datetime, window_end: datetime
) -> int:
    return max(0, int((min(end_at, window_end) - max(start_at, window_start)).total_seconds()))
