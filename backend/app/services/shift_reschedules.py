"""One-day shift reschedule requests.

An employee asks (from the desktop app) to work a different, same-length time
range on one scheduled working day. Super Admin / HR approve or reject it; they
can also create an emergency reschedule that is approved immediately.

Approval materializes an employee-scoped, non-permanent ``WorkScheduleOverride``
(``override_type="both"``) for that date. Every schedule resolver already honors
employee day overrides ahead of team/company ones (``schedules.effective_schedule``
and its batch variants, ``work_profiles.resolve_day_policy`` used by the desktop
config, ``session_tracking.employee_required_daily_seconds`` and payroll), so the
new range drives normal/extra classification, lateness, early leave, required
hours and payroll without a second source of truth.

A request still pending when the employee-local day starts is expired lazily:
it never produced an override, so the normal shift applies, and it is marked
``expired`` whenever it is listed or touched.
"""

from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ApiError
from app.models import (
    AdminUser,
    Employee,
    LeaveRequest,
    ShiftRescheduleRequest,
    WorkScheduleOverride,
    WorkSession,
)
from app.services.permissions import HR_MANAGER, is_super_admin
from app.services.schedules import effective_schedule, timezone_for
from app.services.work_profiles import get_or_create_work_profile

ACTIVE_STATUSES = ("pending", "approved")
EMPLOYEE_NOTICE_DAYS = 2
OVERRIDE_REASON_PREFIX = "Shift reschedule"


def can_review_shift_reschedules(admin: AdminUser) -> bool:
    """Only the protected Super Admin and HR review reschedules (not team leaders)."""
    return is_super_admin(admin) or admin.role == HR_MANAGER


def require_shift_reschedule_reviewer(admin: AdminUser) -> None:
    if not can_review_shift_reschedules(admin):
        raise ApiError(
            "SHIFT_RESCHEDULE_FORBIDDEN",
            "Only the Super Admin or HR can manage shift reschedules.",
            403,
        )


def employee_today(employee: Employee, now: datetime | None = None) -> date:
    return (now or datetime.now(UTC)).astimezone(timezone_for(employee)).date()


def _hhmm(value: time | None) -> str | None:
    return value.strftime("%H:%M") if value else None


def _seconds(value: time) -> int:
    return value.hour * 3600 + value.minute * 60 + value.second


def base_day_schedule(db: Session, employee: Employee, work_date: date) -> dict:
    """The employee's normal (effective) shift for ``work_date`` in local clock time."""
    profile = get_or_create_work_profile(db, employee)
    schedule = effective_schedule(db, employee, profile, work_date)
    start_at = schedule["start_at"]
    end_at = schedule["end_at"]
    if not schedule["scheduled_day"] or not start_at or not end_at:
        return {"scheduled_day": False, "shift_start": None, "shift_end": None,
                "shift_seconds": 0, "break_rules": []}
    zone = timezone_for(employee)
    break_rules = []
    for item in schedule["breaks"]:
        start_clock = item["start_at"].astimezone(zone).time().replace(second=0, microsecond=0)
        end_clock = item["end_at"].astimezone(zone).time().replace(second=0, microsecond=0)
        if end_clock <= start_clock:
            continue
        break_rules.append(
            {
                "name": item["name"],
                "minutes": (_seconds(end_clock) - _seconds(start_clock)) // 60,
                "paid": item["paid"],
                "start_time": _hhmm(start_clock),
                "end_time": _hhmm(end_clock),
            }
        )
    return {
        "scheduled_day": True,
        "shift_start": start_at.astimezone(zone).time().replace(second=0, microsecond=0),
        "shift_end": end_at.astimezone(zone).time().replace(second=0, microsecond=0),
        "shift_seconds": int((end_at - start_at).total_seconds()),
        "break_rules": break_rules,
    }


def serialize_base_day(work_date: date, base: dict) -> dict:
    return {
        "date": work_date.isoformat(),
        "scheduled_day": base["scheduled_day"],
        "shift_start": _hhmm(base["shift_start"]),
        "shift_end": _hhmm(base["shift_end"]),
        "shift_minutes": base["shift_seconds"] // 60,
        "break_rules": base["break_rules"],
    }


def breaks_inside_range(break_rules: list[dict], start: time, end: time) -> list[dict]:
    """Keep breaks at their original clock times only when fully inside the new range."""
    kept = []
    for rule in break_rules:
        try:
            rule_start = datetime.strptime(str(rule.get("start_time"))[:5], "%H:%M").time()
            rule_end = datetime.strptime(str(rule.get("end_time"))[:5], "%H:%M").time()
        except (TypeError, ValueError):
            continue
        if start <= rule_start < rule_end <= end:
            kept.append(dict(rule))
    return kept


def serialize_shift_reschedule(row: ShiftRescheduleRequest) -> dict:
    return {
        "id": str(row.id),
        "company_id": str(row.company_id),
        "employee_id": str(row.employee_id),
        "employee_name": row.employee.name if row.employee else "",
        "employee_code": row.employee.employee_code if row.employee else None,
        "work_date": row.work_date.isoformat(),
        "requested_start": _hhmm(row.requested_start),
        "requested_end": _hhmm(row.requested_end),
        "original_start": _hhmm(row.original_start),
        "original_end": _hhmm(row.original_end),
        "duration_minutes": (_seconds(row.requested_end) - _seconds(row.requested_start)) // 60,
        "reason": row.reason,
        "status": row.status,
        "source": row.source,
        "created_by_admin_user_id": str(row.created_by_admin_user_id)
        if row.created_by_admin_user_id
        else None,
        "created_by_name": row.created_by.name if row.created_by else None,
        "reviewed_by_admin_user_id": str(row.reviewed_by_admin_user_id)
        if row.reviewed_by_admin_user_id
        else None,
        "reviewed_by_name": row.reviewed_by.name if row.reviewed_by else None,
        "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
        "review_reason": row.review_reason,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def is_expired(row: ShiftRescheduleRequest, employee: Employee, now: datetime | None = None) -> bool:
    return row.status == "pending" and row.work_date <= employee_today(employee, now)


def expire_stale_requests(
    db: Session, rows: list[ShiftRescheduleRequest], now: datetime | None = None
) -> bool:
    """Mark pending rows whose day has started as expired. Returns True if any changed."""
    changed = False
    for row in rows:
        employee = row.employee or db.get(Employee, row.employee_id)
        if employee is not None and is_expired(row, employee, now):
            row.status = "expired"
            db.add(row)
            changed = True
    if changed:
        db.flush()
    return changed


def expire_company_pending(
    db: Session, company_id, *, employee_id=None, now: datetime | None = None
) -> bool:
    statement = select(ShiftRescheduleRequest).where(
        ShiftRescheduleRequest.company_id == company_id,
        ShiftRescheduleRequest.status == "pending",
        # A request can only have expired if its date is no later than the
        # furthest-ahead timezone's today; this bounds the scan.
        ShiftRescheduleRequest.work_date <= (now or datetime.now(UTC)).date() + timedelta(days=1),
    )
    if employee_id is not None:
        statement = statement.where(ShiftRescheduleRequest.employee_id == employee_id)
    return expire_stale_requests(db, list(db.scalars(statement).all()), now)


def _validate_range(
    db: Session,
    employee: Employee,
    work_date: date,
    requested_start: time,
    requested_end: time,
    *,
    exclude_request_id=None,
    now: datetime | None = None,
) -> dict:
    requested_start = requested_start.replace(second=0, microsecond=0)
    requested_end = requested_end.replace(second=0, microsecond=0)
    if requested_end <= requested_start:
        raise ApiError(
            "SHIFT_RESCHEDULE_CROSSES_MIDNIGHT",
            "The new shift must start and end on the same day and cannot cross midnight.",
            422,
        )
    base = base_day_schedule(db, employee, work_date)
    if not base["scheduled_day"]:
        raise ApiError(
            "SHIFT_RESCHEDULE_NOT_WORKING_DAY",
            "A shift can only be rescheduled on a scheduled working day.",
            422,
        )
    requested_seconds = _seconds(requested_end) - _seconds(requested_start)
    if requested_seconds != base["shift_seconds"]:
        raise ApiError(
            "SHIFT_RESCHEDULE_LENGTH_MISMATCH",
            f"The new shift must be exactly {base['shift_seconds'] // 60} minutes long, "
            "the same as the normal shift for that day.",
            422,
        )
    if requested_start == base["shift_start"] and requested_end == base["shift_end"]:
        raise ApiError(
            "SHIFT_RESCHEDULE_UNCHANGED",
            "The new shift is the same as the normal shift for that day.",
            422,
        )
    on_leave = db.scalar(
        select(LeaveRequest.id).where(
            LeaveRequest.company_id == employee.company_id,
            LeaveRequest.employee_id == employee.id,
            LeaveRequest.status == "approved",
            LeaveRequest.start_date <= work_date,
            LeaveRequest.end_date >= work_date,
        )
    )
    if on_leave:
        raise ApiError(
            "SHIFT_RESCHEDULE_ON_LEAVE",
            "A shift cannot be rescheduled on a day with approved leave.",
            422,
        )
    existing_rows = list(
        db.scalars(
            select(ShiftRescheduleRequest).where(
                ShiftRescheduleRequest.company_id == employee.company_id,
                ShiftRescheduleRequest.employee_id == employee.id,
                ShiftRescheduleRequest.work_date == work_date,
                ShiftRescheduleRequest.status.in_(ACTIVE_STATUSES),
            )
        ).all()
    )
    expire_stale_requests(db, existing_rows, now)
    if any(
        row.status in ACTIVE_STATUSES and row.id != exclude_request_id for row in existing_rows
    ):
        raise ApiError(
            "SHIFT_RESCHEDULE_DUPLICATE",
            "There is already a pending or approved shift reschedule for that day.",
            409,
        )
    return base


def _lock_employee(db: Session, employee: Employee) -> None:
    # Serialize same-employee reschedule writes so two devices/admins cannot
    # both pass the one-per-day check (PostgreSQL row lock; no-op on SQLite).
    db.execute(select(Employee.id).where(Employee.id == employee.id).with_for_update())


def _materialize_override(
    db: Session, row: ShiftRescheduleRequest, admin: AdminUser, base: dict
) -> WorkScheduleOverride:
    override = WorkScheduleOverride(
        company_id=row.company_id,
        employee_id=row.employee_id,
        team_id=None,
        scope="employee",
        override_type="both",
        effective_date=row.work_date,
        permanent=False,
        shift_start=row.requested_start,
        shift_end=row.requested_end,
        break_rules=breaks_inside_range(
            base["break_rules"], row.requested_start, row.requested_end
        ),
        reason=f"{OVERRIDE_REASON_PREFIX}: {row.reason}",
        created_by_admin_user_id=admin.id,
    )
    db.add(override)
    db.flush()
    row.schedule_override_id = override.id
    return override


def apply_schedule_change(
    db: Session, employee: Employee, work_date: date, now: datetime | None = None
) -> None:
    """Re-classify already-recorded work after the day's shift changed.

    Only today (or earlier) can have recorded work; future days need nothing.
    Session normal/extra buckets are re-synced against the new schedule and the
    derived daily attendance row is rebuilt.
    """
    from app.services.attendance import refresh_daily_attendance_range
    from app.services.session_tracking import sync_session_time_buckets

    at = now or datetime.now(UTC)
    if work_date > employee_today(employee, at):
        return
    zone = timezone_for(employee)
    day_start = datetime.combine(work_date, time.min, tzinfo=zone).astimezone(UTC)
    day_end = datetime.combine(work_date + timedelta(days=1), time.min, tzinfo=zone).astimezone(UTC)
    sessions = db.scalars(
        select(WorkSession)
        .where(
            WorkSession.company_id == employee.company_id,
            WorkSession.employee_id == employee.id,
            WorkSession.started_at >= day_start,
            WorkSession.started_at < day_end,
        )
        .order_by(WorkSession.started_at)
    ).all()
    seen_devices = set()
    for session in sessions:
        # sync_session_time_buckets re-classifies every session of that
        # device-day, so one call per device is enough.
        if session.device_id in seen_devices:
            continue
        seen_devices.add(session.device_id)
        sync_session_time_buckets(db, session, at=at)
    db.flush()
    refresh_daily_attendance_range(
        db, employee=employee, start_date=work_date, end_date=work_date, now=at
    )


def create_employee_request(
    db: Session,
    *,
    employee: Employee,
    work_date: date,
    requested_start: time,
    requested_end: time,
    reason: str,
    now: datetime | None = None,
) -> ShiftRescheduleRequest:
    reason = (reason or "").strip()
    if not reason:
        raise ApiError("SHIFT_RESCHEDULE_REASON_REQUIRED", "A reason is required.", 422)
    earliest = employee_today(employee, now) + timedelta(days=EMPLOYEE_NOTICE_DAYS)
    if work_date < earliest:
        raise ApiError(
            "SHIFT_RESCHEDULE_NOTICE_PERIOD",
            f"A shift reschedule must be requested at least {EMPLOYEE_NOTICE_DAYS} days ahead "
            f"(earliest {earliest.isoformat()}).",
            422,
        )
    _lock_employee(db, employee)
    base = _validate_range(db, employee, work_date, requested_start, requested_end, now=now)
    row = ShiftRescheduleRequest(
        company_id=employee.company_id,
        employee_id=employee.id,
        work_date=work_date,
        requested_start=requested_start.replace(second=0, microsecond=0),
        requested_end=requested_end.replace(second=0, microsecond=0),
        original_start=base["shift_start"],
        original_end=base["shift_end"],
        reason=reason,
        status="pending",
        source="employee",
    )
    db.add(row)
    db.flush()
    return row


def cancel_employee_request(
    db: Session, *, employee: Employee, row: ShiftRescheduleRequest, now: datetime | None = None
) -> ShiftRescheduleRequest:
    if row.employee_id != employee.id:
        raise ApiError("SHIFT_RESCHEDULE_NOT_FOUND", "Shift reschedule was not found.", 404)
    if expire_stale_requests(db, [row], now):
        raise ApiError(
            "SHIFT_RESCHEDULE_EXPIRED",
            "This request expired because its day has already started.",
            409,
        )
    if row.status != "pending":
        raise ApiError(
            "SHIFT_RESCHEDULE_NOT_PENDING", "Only a pending request can be cancelled.", 409
        )
    row.status = "cancelled"
    db.add(row)
    db.flush()
    return row


def _ensure_not_self(admin: AdminUser, employee_id) -> None:
    if admin.employee_id is not None and admin.employee_id == employee_id:
        raise ApiError(
            "SELF_REVIEW_FORBIDDEN",
            "You cannot review or create a shift reschedule for yourself.",
            403,
        )


def review_request(
    db: Session,
    *,
    admin: AdminUser,
    row: ShiftRescheduleRequest,
    status: str,
    review_reason: str | None,
    now: datetime | None = None,
) -> ShiftRescheduleRequest:
    require_shift_reschedule_reviewer(admin)
    _ensure_not_self(admin, row.employee_id)
    at = now or datetime.now(UTC)
    employee = row.employee or db.get(Employee, row.employee_id)
    if row.status == "pending" and is_expired(row, employee, at):
        raise ApiError(
            "SHIFT_RESCHEDULE_EXPIRED",
            "This request expired because its day has already started; the normal shift applies.",
            409,
        )
    if row.status != "pending":
        raise ApiError(
            "SHIFT_RESCHEDULE_REVIEWED", "This shift reschedule was already reviewed.", 409
        )
    note = (review_reason or "").strip() or None
    if status == "rejected":
        if not note:
            raise ApiError(
                "SHIFT_RESCHEDULE_REJECT_REASON_REQUIRED",
                "A reason is required to reject a shift reschedule.",
                422,
            )
    elif status == "approved":
        _lock_employee(db, employee)
        base = _validate_range(
            db,
            employee,
            row.work_date,
            row.requested_start,
            row.requested_end,
            exclude_request_id=row.id,
            now=at,
        )
        _materialize_override(db, row, admin, base)
    else:
        raise ApiError("INVALID_STATUS", "Status must be approved or rejected.", 422)
    row.status = status
    row.review_reason = note
    row.reviewed_by_admin_user_id = admin.id
    row.reviewed_at = at
    db.add(row)
    db.flush()
    if status == "approved":
        apply_schedule_change(db, employee, row.work_date, at)
    return row


def create_emergency_reschedule(
    db: Session,
    *,
    admin: AdminUser,
    employee: Employee,
    work_date: date,
    requested_start: time,
    requested_end: time,
    reason: str,
    now: datetime | None = None,
) -> ShiftRescheduleRequest:
    require_shift_reschedule_reviewer(admin)
    _ensure_not_self(admin, employee.id)
    if employee.status == "archived":
        raise ApiError(
            "EMPLOYEE_ARCHIVED",
            "This employee is archived. Restore them before rescheduling a shift.",
            409,
        )
    at = now or datetime.now(UTC)
    reason = (reason or "").strip()
    if not reason:
        raise ApiError("SHIFT_RESCHEDULE_REASON_REQUIRED", "A reason is required.", 422)
    if work_date < employee_today(employee, at):
        raise ApiError(
            "SHIFT_RESCHEDULE_PAST_DATE",
            "An emergency reschedule can only be created for today or a future date.",
            422,
        )
    _lock_employee(db, employee)
    base = _validate_range(db, employee, work_date, requested_start, requested_end, now=at)
    row = ShiftRescheduleRequest(
        company_id=employee.company_id,
        employee_id=employee.id,
        work_date=work_date,
        requested_start=requested_start.replace(second=0, microsecond=0),
        requested_end=requested_end.replace(second=0, microsecond=0),
        original_start=base["shift_start"],
        original_end=base["shift_end"],
        reason=reason,
        status="approved",
        source="admin",
        created_by_admin_user_id=admin.id,
        reviewed_by_admin_user_id=admin.id,
        reviewed_at=at,
    )
    db.add(row)
    db.flush()
    _materialize_override(db, row, admin, base)
    db.add(row)
    db.flush()
    apply_schedule_change(db, employee, work_date, at)
    return row
