import logging
from datetime import UTC, date, datetime, time, timedelta
from threading import Lock
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from app.api.deps import get_current_admin
from app.api.v1.team_auth import (
    accessible_employee_ids_statement,
    ensure_employee_access,
)
from app.core.responses import success_response
from app.database.session import get_db
from app.core.exceptions import ApiError
from app.models import (
    AdminUser,
    AttendanceCorrection,
    DailyAttendance,
    Employee,
    LeaveRequest,
    OvertimeRecord,
    PayrollRun,
    Screenshot,
    Team,
    TeamMember,
    TimeAdjustmentRequest,
    WorkSession,
)
from app.services.activity_timeline import (
    SessionLiveness,
    local_today,
    open_session_liveness,
)
from app.services.audit import record_audit_log
from app.services.attendance import (
    cached_daily_attendance,
    calculate_daily_attendance,
    serialize_daily_attendance,
)
from app.services.permissions import require_capability
from app.services.schedules import (
    effective_schedules_for_employees,
    effective_schedules_for_range,
)
from app.services.work_profiles import get_or_create_work_profile

router = APIRouter(prefix="/attendance", tags=["attendance"])
ACTIVE_SESSION_STATUSES = {"active", "idle", "locked", "sleeping"}
logger = logging.getLogger(__name__)
_daily_refresh_lock = Lock()
_daily_refreshes: set[tuple[int, UUID, date]] = set()


class AttendanceCorrectionUpdate(BaseModel):
    start_time: time | None = None
    end_time: time | None = None
    payable_minutes_delta: int = Field(default=0, ge=-1440, le=1440)
    reason: str = Field(min_length=3, max_length=2000)

    @model_validator(mode="after")
    def require_a_change(self):
        if self.start_time is None and self.end_time is None and self.payable_minutes_delta == 0:
            raise ValueError("Enter a corrected time or a payable-time adjustment.")
        return self


def _ensure_unlocked_payroll_day(
    db: Session,
    *,
    company_id: UUID,
    work_date: date,
) -> None:
    locked_run = db.scalar(
        select(PayrollRun.id).where(
            PayrollRun.company_id == company_id,
            PayrollRun.status.in_(["locked", "paid"]),
            PayrollRun.period_start <= work_date,
            PayrollRun.period_end >= work_date,
        )
    )
    if locked_run:
        raise ApiError(
            "PAYROLL_PERIOD_LOCKED",
            "This day belongs to a locked or paid payroll period. Unlock the payroll run first.",
            409,
        )


def _local_correction_at(
    work_date: date,
    value: time | None,
    timezone: ZoneInfo,
    *,
    next_day: bool = False,
) -> datetime | None:
    if value is None:
        return None
    selected_date = work_date + timedelta(days=1) if next_day else work_date
    return datetime.combine(selected_date, value, tzinfo=timezone).astimezone(UTC)


def _empty_attendance_item(
    *,
    employee: Employee,
    work_date: date,
    schedule: dict,
    leave: LeaveRequest | None,
    employee_today: date,
    calculated_at: datetime,
) -> dict:
    """Serialize a day with no attendance sources without rebuilding a timeline."""
    scheduled_start_at = schedule["start_at"]
    scheduled_end_at = schedule["end_at"]
    expected_seconds = (
        int((scheduled_end_at - scheduled_start_at).total_seconds())
        if scheduled_start_at and scheduled_end_at
        else 0
    )
    if leave is not None:
        status = "approved_leave"
        payable_seconds = expected_seconds if leave.leave_type != "unpaid" else 0
        issues: list[dict] = []
    elif not schedule["scheduled_day"]:
        status = "off_day"
        payable_seconds = 0
        issues = []
    else:
        status = "not_started" if work_date >= employee_today else "absent"
        payable_seconds = 0
        issues = [{"code": "missing_check_in", "seconds": expected_seconds}]

    return {
        "id": f"empty:{employee.id}:{work_date.isoformat()}",
        "employee_id": str(employee.id),
        "date": work_date.isoformat(),
        "timezone": schedule["timezone"],
        "scheduled_start_at": (
            scheduled_start_at.isoformat() if scheduled_start_at is not None else None
        ),
        "scheduled_end_at": (
            scheduled_end_at.isoformat() if scheduled_end_at is not None else None
        ),
        "actual_first_activity_at": None,
        "actual_last_activity_at": None,
        "actual_sign_out_at": None,
        "is_running": False,
        "continued_from_previous_day": False,
        "continued_session_started_at": None,
        "normal_worked_seconds": 0,
        "paid_break_seconds": 0,
        "unpaid_break_seconds": 0,
        "recorded_idle_seconds": 0,
        "paid_idle_grace_seconds": 0,
        "idle_seconds": 0,
        "approved_manual_seconds": 0,
        "pending_manual_seconds": 0,
        "rejected_manual_seconds": 0,
        "raw_late_seconds": 0,
        "deductible_late_seconds": 0,
        "early_leave_seconds": 0,
        "pre_shift_extra_seconds": 0,
        "post_shift_extra_seconds": 0,
        "recorded_overtime_seconds": 0,
        "approved_overtime_seconds": 0,
        "unapproved_overtime_seconds": 0,
        "total_payable_seconds": payable_seconds,
        "status": status,
        "leave_status": leave.leave_type if leave is not None else None,
        "approved_early_leave_seconds": 0,
        "attendance_adjustment_seconds": 0,
        "attendance_correction": None,
        "issues": issues,
        "calculation_sources": {
            "schedule_override_id": schedule["override_id"],
            "leave_request_id": str(leave.id) if leave is not None else None,
            "fast_empty_day": True,
        },
        "calculated_at": calculated_at.isoformat(),
    }


def _employee_statement(
    db: Session,
    admin: AdminUser,
    *,
    team_id: UUID | None,
    employee_id: UUID | None,
    query: str | None,
):
    statement = (
        select(Employee)
        .options(selectinload(Employee.work_profile))
        .where(Employee.company_id == admin.company_id, Employee.status != "deleted")
        .order_by(Employee.name)
    )
    scope = accessible_employee_ids_statement(db, admin, team_id)
    if scope is not None:
        statement = statement.where(Employee.id.in_(scope))
    if employee_id:
        statement = statement.where(Employee.id == employee_id)
    if query:
        pattern = f"%{query.strip()}%"
        statement = statement.where(Employee.name.ilike(pattern) | Employee.email.ilike(pattern))
    return statement


def _team_names(db: Session, employee_ids: list[UUID]) -> dict[UUID, list[str]]:
    result: dict[UUID, list[str]] = {}
    if not employee_ids:
        return result
    for employee_id, name in db.execute(
        select(TeamMember.employee_id, Team.name)
        .join(Team, Team.id == TeamMember.team_id)
        .where(
            TeamMember.employee_id.in_(employee_ids),
            TeamMember.status == "active",
            Team.status != "deleted",
        )
        .order_by(Team.name)
    ).all():
        result.setdefault(employee_id, []).append(name)
    return result


def _screenshot_counts_for_day(
    db: Session,
    *,
    company_id: UUID,
    employees: list[Employee],
    work_date: date,
) -> dict[UUID, int]:
    """Count visible screenshots on each employee's local calendar day."""
    if not employees:
        return {}

    employee_timezones: dict[UUID, ZoneInfo] = {}
    for employee in employees:
        try:
            employee_timezones[employee.id] = ZoneInfo(employee.timezone or "UTC")
        except ZoneInfoNotFoundError:
            employee_timezones[employee.id] = ZoneInfo("UTC")

    # One UTC envelope safely covers the requested local date for every timezone.
    range_start = datetime.combine(work_date - timedelta(days=1), time.min, tzinfo=UTC)
    range_end = datetime.combine(work_date + timedelta(days=2), time.min, tzinfo=UTC)
    counts = {employee.id: 0 for employee in employees}
    captures = db.execute(
        select(Screenshot.employee_id, Screenshot.captured_at).where(
            Screenshot.company_id == company_id,
            Screenshot.employee_id.in_(counts),
            Screenshot.captured_at >= range_start,
            Screenshot.captured_at < range_end,
            Screenshot.deleted_at.is_(None),
        )
    ).all()
    for captured_employee_id, captured_at in captures:
        captured_utc = (
            captured_at.replace(tzinfo=UTC)
            if captured_at.tzinfo is None
            else captured_at.astimezone(UTC)
        )
        if captured_utc.astimezone(employee_timezones[captured_employee_id]).date() == work_date:
            counts[captured_employee_id] += 1
    return counts


def _refresh_missing_daily_attendance(
    engine: Engine,
    company_id: UUID,
    employee_ids: tuple[UUID, ...],
    work_date: date,
    refresh_key: tuple[int, UUID, date],
) -> None:
    """Materialize missing roster rows after the HTTP response has been sent."""
    calculated_at = datetime.now(UTC)
    try:
        with Session(engine) as db:
            employees = db.scalars(
                select(Employee)
                .options(selectinload(Employee.work_profile))
                .where(
                    Employee.company_id == company_id,
                    Employee.id.in_(employee_ids),
                    Employee.status != "deleted",
                )
                .order_by(Employee.name)
            ).all()
            for employee in employees:
                existing = db.scalar(
                    select(DailyAttendance).where(
                        DailyAttendance.company_id == company_id,
                        DailyAttendance.employee_id == employee.id,
                        DailyAttendance.work_date == work_date,
                    )
                )
                if existing is not None:
                    continue
                try:
                    cached_daily_attendance(
                        db,
                        employee=employee,
                        work_date=work_date,
                        now=calculated_at,
                        max_age_seconds=45,
                        existing_attendance=None,
                        profile=employee.work_profile,
                    )
                    # Commit each employee independently so polling can reveal
                    # completed rows progressively and one bad row cannot block
                    # the rest of the roster.
                    db.commit()
                except IntegrityError:
                    # A heartbeat or another worker won the materialization
                    # race; the unique employee/day row is already available.
                    db.rollback()
                except Exception:
                    db.rollback()
                    logger.exception(
                        "Unable to refresh daily attendance employee_id=%s work_date=%s",
                        employee.id,
                        work_date,
                    )
    finally:
        with _daily_refresh_lock:
            _daily_refreshes.discard(refresh_key)


def _queue_missing_daily_attendance_refresh(
    background_tasks: BackgroundTasks,
    *,
    db: Session,
    company_id: UUID,
    employee_ids: list[UUID],
    work_date: date,
) -> bool:
    if not employee_ids:
        return False
    engine = db.get_bind()
    refresh_key = (id(engine), company_id, work_date)
    with _daily_refresh_lock:
        if refresh_key in _daily_refreshes:
            return False
        _daily_refreshes.add(refresh_key)
    try:
        background_tasks.add_task(
            _refresh_missing_daily_attendance,
            engine,
            company_id,
            tuple(employee_ids),
            work_date,
            refresh_key,
        )
    except Exception:
        with _daily_refresh_lock:
            _daily_refreshes.discard(refresh_key)
        raise
    return True


@router.get("/daily")
def daily_attendance(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    background_tasks: BackgroundTasks,
    day: date | None = None,
    team_id: UUID | None = None,
    employee_id: UUID | None = None,
    status: str | None = None,
    q: str | None = None,
    late_only: bool = False,
    missing_check_in: bool = False,
    overtime_only: bool = False,
    unexplained_idle: bool = False,
    leave_only: bool = False,
    limit: int = Query(default=250, ge=1, le=500),
):
    require_capability(current_admin, "timesheets.view")
    selected_day = day or date.today()
    employees = db.scalars(
        _employee_statement(
            db,
            current_admin,
            team_id=team_id,
            employee_id=employee_id,
            query=q,
        ).limit(limit)
    ).all()
    team_names = _team_names(db, [employee.id for employee in employees])
    screenshot_counts = _screenshot_counts_for_day(
        db,
        company_id=current_admin.company_id,
        employees=employees,
        work_date=selected_day,
    )
    attendance_by_employee = {
        attendance.employee_id: attendance
        for attendance in db.scalars(
            select(DailyAttendance).where(
                DailyAttendance.company_id == current_admin.company_id,
                DailyAttendance.employee_id.in_([employee.id for employee in employees]),
                DailyAttendance.work_date == selected_day,
            )
        ).all()
    }
    missing_employees = [
        employee for employee in employees if employee.id not in attendance_by_employee
    ]
    missing_employee_ids = [employee.id for employee in missing_employees]
    source_employee_ids: set[UUID] = set()
    leave_by_employee: dict[UUID, LeaveRequest] = {}
    schedules_by_employee: dict[UUID, dict] = {}
    calculated_at = datetime.now(UTC)
    current_employee_ids = [
        employee.id
        for employee in employees
        if local_today(employee.timezone, calculated_at) == selected_day
    ]
    open_sessions_by_employee: dict[UUID, list[WorkSession]] = {}
    liveness_by_session: dict[UUID, SessionLiveness] = {}
    if current_employee_ids:
        open_sessions = db.scalars(
            select(WorkSession).where(
                WorkSession.company_id == current_admin.company_id,
                WorkSession.employee_id.in_(current_employee_ids),
                WorkSession.ended_at.is_(None),
                WorkSession.status.in_(ACTIVE_SESSION_STATUSES),
            )
        ).all()
        for session in open_sessions:
            open_sessions_by_employee.setdefault(session.employee_id, []).append(session)
        liveness_by_session = open_session_liveness(
            db,
            company_id=current_admin.company_id,
            sessions=open_sessions,
            now=calculated_at,
        )
    if missing_employee_ids:
        broad_start = datetime.combine(
            selected_day - timedelta(days=1),
            time.min,
            tzinfo=UTC,
        )
        broad_end = datetime.combine(
            selected_day + timedelta(days=2),
            time.min,
            tzinfo=UTC,
        )
        source_employee_ids.update(
            db.scalars(
                select(WorkSession.employee_id)
                .where(
                    WorkSession.company_id == current_admin.company_id,
                    WorkSession.employee_id.in_(missing_employee_ids),
                    WorkSession.started_at < broad_end,
                    or_(WorkSession.ended_at.is_(None), WorkSession.ended_at > broad_start),
                )
                .distinct()
            ).all()
        )
        for model in (TimeAdjustmentRequest, AttendanceCorrection, OvertimeRecord):
            date_column = (
                model.requested_date
                if model is TimeAdjustmentRequest
                else model.work_date
            )
            source_employee_ids.update(
                db.scalars(
                    select(model.employee_id)
                    .where(
                        model.company_id == current_admin.company_id,
                        model.employee_id.in_(missing_employee_ids),
                        date_column == selected_day,
                    )
                    .distinct()
                ).all()
            )
        leaves = db.scalars(
            select(LeaveRequest).where(
                LeaveRequest.company_id == current_admin.company_id,
                LeaveRequest.employee_id.in_(missing_employee_ids),
                LeaveRequest.status == "approved",
                LeaveRequest.start_date <= selected_day,
                LeaveRequest.end_date >= selected_day,
            )
        ).all()
        leave_by_employee = {leave.employee_id: leave for leave in leaves}
        schedules_by_employee = effective_schedules_for_employees(
            db,
            missing_employees,
            selected_day,
            profiles={
                employee.id: employee.work_profile
                for employee in missing_employees
                if employee.work_profile is not None
            },
        )

    rows = []
    refresh_employee_ids: list[UUID] = []
    for employee in employees:
        attendance = attendance_by_employee.get(employee.id)
        if attendance is not None:
            data = serialize_daily_attendance(attendance)
        elif employee.id in source_employee_ids:
            # Rebuilding a complete timeline here caused an N+1 request
            # waterfall (17+ queries per missing employee). Return the roster
            # immediately and materialize these rows after the response.
            refresh_employee_ids.append(employee.id)
            data = _empty_attendance_item(
                employee=employee,
                work_date=selected_day,
                schedule=schedules_by_employee[employee.id],
                leave=leave_by_employee.get(employee.id),
                employee_today=local_today(employee.timezone, calculated_at),
                calculated_at=calculated_at,
            )
            data["refresh_pending"] = True
            data["calculation_sources"]["refresh_pending"] = True
        else:
            data = _empty_attendance_item(
                employee=employee,
                work_date=selected_day,
                schedule=schedules_by_employee[employee.id],
                leave=leave_by_employee.get(employee.id),
                employee_today=local_today(employee.timezone, calculated_at),
                calculated_at=calculated_at,
            )

        employee_today = local_today(employee.timezone, calculated_at)
        if selected_day == employee_today:
            employee_open_sessions = open_sessions_by_employee.get(employee.id, [])
            has_fresh_session = any(
                bool(liveness_by_session[session.id]["is_fresh"])
                for session in employee_open_sessions
            )
            data["is_running"] = has_fresh_session
            if has_fresh_session:
                data["actual_sign_out_at"] = None
            elif data["actual_sign_out_at"] is None:
                stale_signals = [
                    liveness_by_session[session.id]["last_signal_at"]
                    for session in employee_open_sessions
                    if not bool(liveness_by_session[session.id]["is_fresh"])
                    and local_today(
                        employee.timezone,
                        liveness_by_session[session.id]["last_signal_at"],
                    )
                    == selected_day
                ]
                last_signal_at = max(stale_signals, default=None)
                data["actual_sign_out_at"] = (
                    last_signal_at.isoformat() if last_signal_at else data["actual_last_activity_at"]
                )
        else:
            data["is_running"] = False
            if data["actual_sign_out_at"] is None:
                data["actual_sign_out_at"] = data["actual_last_activity_at"]

        if status:
            if status == "late" and int(data["deductible_late_seconds"]) <= 0:
                continue
            if status == "left_early" and int(data["early_leave_seconds"]) <= 0:
                continue
            if status not in {"late", "left_early"} and data["status"] != status:
                continue
        if late_only and int(data["deductible_late_seconds"]) <= 0:
            continue
        if missing_check_in and not any(
            item.get("code") == "missing_check_in" for item in data["issues"]
        ):
            continue
        if overtime_only and int(data["recorded_overtime_seconds"]) <= 0:
            continue
        if unexplained_idle and int(data["idle_seconds"]) <= 0:
            continue
        if leave_only and not data["leave_status"]:
            continue
        data.update(
            {
                "employee_name": employee.name,
                "employee_email": employee.email,
                "job_title": employee.job_title,
                "team_names": team_names.get(employee.id, []),
                "screenshot_count": screenshot_counts.get(employee.id, 0),
                "late_grace_minutes": int(
                    employee.work_profile.late_grace_minutes
                    if employee.work_profile
                    and employee.work_profile.late_grace_minutes is not None
                    else 15
                ),
            }
        )
        rows.append(data)
    refresh_queued = _queue_missing_daily_attendance_refresh(
        background_tasks,
        db=db,
        company_id=current_admin.company_id,
        employee_ids=refresh_employee_ids,
        work_date=selected_day,
    )
    db.commit()
    return success_response(
        data={"date": selected_day.isoformat(), "rows": rows},
        meta={
            "pending_refresh_count": len(refresh_employee_ids),
            "refresh_queued": refresh_queued,
        },
    )


@router.get("/employee/{employee_id}/{work_date}")
def employee_day_detail(
    employee_id: UUID,
    work_date: date,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    team_id: UUID | None = None,
):
    require_capability(current_admin, "timesheets.view")
    employee = ensure_employee_access(db, current_admin, employee_id, team_id)
    attendance, timeline = calculate_daily_attendance(
        db,
        employee=employee,
        work_date=work_date,
        now=datetime.now(UTC),
    )
    db.commit()
    data = serialize_daily_attendance(attendance, timeline=timeline)
    data["screenshot_count"] = _screenshot_counts_for_day(
        db,
        company_id=current_admin.company_id,
        employees=[employee],
        work_date=work_date,
    ).get(employee.id, 0)
    data.update(
        {
            "employee_name": employee.name,
            "employee_email": employee.email,
            "job_title": employee.job_title,
        }
    )
    return success_response(data=data)


@router.patch("/employee/{employee_id}/{work_date}/correction")
def update_employee_day_correction(
    employee_id: UUID,
    work_date: date,
    payload: AttendanceCorrectionUpdate,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    team_id: UUID | None = None,
):
    require_capability(current_admin, "timesheets.manage")
    employee = ensure_employee_access(db, current_admin, employee_id, team_id)
    _ensure_unlocked_payroll_day(
        db,
        company_id=current_admin.company_id,
        work_date=work_date,
    )
    try:
        timezone = ZoneInfo(employee.timezone or "UTC")
    except ZoneInfoNotFoundError:
        timezone = ZoneInfo("UTC")
    next_day_end = bool(
        payload.start_time and payload.end_time and payload.end_time <= payload.start_time
    )
    corrected_start = _local_correction_at(work_date, payload.start_time, timezone)
    corrected_end = _local_correction_at(
        work_date,
        payload.end_time,
        timezone,
        next_day=next_day_end,
    )
    correction = db.scalar(
        select(AttendanceCorrection).where(
            AttendanceCorrection.company_id == current_admin.company_id,
            AttendanceCorrection.employee_id == employee.id,
            AttendanceCorrection.work_date == work_date,
        )
    )
    before = None
    if correction is None:
        correction = AttendanceCorrection(
            company_id=current_admin.company_id,
            employee_id=employee.id,
            work_date=work_date,
            reason=payload.reason.strip(),
            updated_by_admin_user_id=current_admin.id,
        )
    else:
        before = {
            "start_at": correction.corrected_start_at.isoformat()
            if correction.corrected_start_at
            else None,
            "end_at": correction.corrected_end_at.isoformat()
            if correction.corrected_end_at
            else None,
            "payable_minutes_delta": int(correction.payable_seconds_delta / 60),
            "reason": correction.reason,
        }
    correction.corrected_start_at = corrected_start
    correction.corrected_end_at = corrected_end
    correction.payable_seconds_delta = payload.payable_minutes_delta * 60
    correction.reason = payload.reason.strip()
    correction.updated_by_admin_user_id = current_admin.id
    db.add(correction)
    db.flush()
    attendance, timeline = calculate_daily_attendance(
        db,
        employee=employee,
        work_date=work_date,
        now=datetime.now(UTC),
    )
    record_audit_log(
        db,
        current_admin,
        "attendance_correction_saved",
        "attendance_correction",
        entity_id=employee.id,
        entity_name=f"{employee.name} · {work_date.isoformat()}",
        details={
            "before": before,
            "after": {
                "start_at": corrected_start.isoformat() if corrected_start else None,
                "end_at": corrected_end.isoformat() if corrected_end else None,
                "payable_minutes_delta": payload.payable_minutes_delta,
                "reason": payload.reason.strip(),
            },
        },
        request=request,
    )
    db.commit()
    data = serialize_daily_attendance(attendance, timeline=timeline)
    data["screenshot_count"] = _screenshot_counts_for_day(
        db,
        company_id=current_admin.company_id,
        employees=[employee],
        work_date=work_date,
    ).get(employee.id, 0)
    data.update(
        {
            "employee_name": employee.name,
            "employee_email": employee.email,
            "job_title": employee.job_title,
        }
    )
    return success_response(data=data)


@router.delete("/employee/{employee_id}/{work_date}/correction")
def delete_employee_day_correction(
    employee_id: UUID,
    work_date: date,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    team_id: UUID | None = None,
):
    require_capability(current_admin, "timesheets.manage")
    employee = ensure_employee_access(db, current_admin, employee_id, team_id)
    _ensure_unlocked_payroll_day(
        db,
        company_id=current_admin.company_id,
        work_date=work_date,
    )
    correction = db.scalar(
        select(AttendanceCorrection).where(
            AttendanceCorrection.company_id == current_admin.company_id,
            AttendanceCorrection.employee_id == employee.id,
            AttendanceCorrection.work_date == work_date,
        )
    )
    if correction is None:
        raise ApiError(
            "ATTENDANCE_CORRECTION_NOT_FOUND",
            "No manual correction exists for this day.",
            404,
        )
    before = {
        "start_at": correction.corrected_start_at.isoformat()
        if correction.corrected_start_at
        else None,
        "end_at": correction.corrected_end_at.isoformat() if correction.corrected_end_at else None,
        "payable_minutes_delta": int(correction.payable_seconds_delta / 60),
        "reason": correction.reason,
    }
    db.delete(correction)
    db.flush()
    attendance, timeline = calculate_daily_attendance(
        db,
        employee=employee,
        work_date=work_date,
        now=datetime.now(UTC),
    )
    record_audit_log(
        db,
        current_admin,
        "attendance_correction_removed",
        "attendance_correction",
        entity_id=employee.id,
        entity_name=f"{employee.name} · {work_date.isoformat()}",
        details={"before": before},
        request=request,
    )
    db.commit()
    data = serialize_daily_attendance(attendance, timeline=timeline)
    data["screenshot_count"] = _screenshot_counts_for_day(
        db,
        company_id=current_admin.company_id,
        employees=[employee],
        work_date=work_date,
    ).get(employee.id, 0)
    data.update(
        {
            "employee_name": employee.name,
            "employee_email": employee.email,
            "job_title": employee.job_title,
        }
    )
    return success_response(data=data)


@router.get("/employee/{employee_id}")
def employee_attendance_range(
    employee_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    start_date: date,
    end_date: date,
    team_id: UUID | None = None,
):
    """Return one employee's auditable attendance ledger for a bounded period."""
    require_capability(current_admin, "timesheets.view")
    if end_date < start_date or (end_date - start_date).days > 62:
        raise ApiError(
            "INVALID_ATTENDANCE_PERIOD",
            "Choose an attendance period of up to 63 days.",
            400,
        )
    employee = ensure_employee_access(db, current_admin, employee_id, team_id)
    try:
        timezone = ZoneInfo(employee.timezone or "UTC")
    except ZoneInfoNotFoundError:
        timezone = UTC
    range_start = datetime.combine(start_date, time.min, tzinfo=timezone).astimezone(UTC)
    range_end = datetime.combine(
        end_date + timedelta(days=1),
        time.min,
        tzinfo=timezone,
    ).astimezone(UTC)
    screenshot_days: dict[date, int] = {}
    captured_values = db.scalars(
        select(Screenshot.captured_at).where(
            Screenshot.company_id == current_admin.company_id,
            Screenshot.employee_id == employee.id,
            Screenshot.captured_at >= range_start,
            Screenshot.captured_at < range_end,
            Screenshot.deleted_at.is_(None),
        )
    ).all()
    for captured_at in captured_values:
        captured_utc = (
            captured_at.replace(tzinfo=UTC)
            if captured_at.tzinfo is None
            else captured_at.astimezone(UTC)
        )
        local_day = captured_utc.astimezone(timezone).date()
        screenshot_days[local_day] = screenshot_days.get(local_day, 0) + 1

    now = datetime.now(UTC)
    employee_today = now.astimezone(timezone).date()
    # A monthly ledger is historical evidence, not a forward schedule. Rebuilding
    # every future date on each request made the current month progressively
    # slower and produced rows that could not contain attendance yet.
    ledger_end_date = min(end_date, employee_today)
    existing_by_day = {
        row.work_date: row
        for row in db.scalars(
            select(DailyAttendance).where(
                DailyAttendance.company_id == current_admin.company_id,
                DailyAttendance.employee_id == employee.id,
                DailyAttendance.work_date >= start_date,
                DailyAttendance.work_date <= ledger_end_date,
            )
        ).all()
    }

    schedules_by_day: dict[date, dict] = {}
    leave_by_day: dict[date, LeaveRequest] = {}
    evidence_days = set(screenshot_days)
    if ledger_end_date >= start_date:
        profile = get_or_create_work_profile(db, employee)
        schedules_by_day = effective_schedules_for_range(
            db,
            employee,
            profile,
            start_date,
            ledger_end_date,
            timezone_name=timezone.key,
        )
        approved_leaves = db.scalars(
            select(LeaveRequest).where(
                LeaveRequest.company_id == current_admin.company_id,
                LeaveRequest.employee_id == employee.id,
                LeaveRequest.status == "approved",
                LeaveRequest.start_date <= ledger_end_date,
                LeaveRequest.end_date >= start_date,
            )
        ).all()
        for leave in approved_leaves:
            leave_cursor = max(start_date, leave.start_date)
            leave_end = min(ledger_end_date, leave.end_date)
            while leave_cursor <= leave_end:
                leave_by_day.setdefault(leave_cursor, leave)
                leave_cursor += timedelta(days=1)

        session_rows = db.execute(
            select(WorkSession.started_at, WorkSession.ended_at).where(
                WorkSession.company_id == current_admin.company_id,
                WorkSession.employee_id == employee.id,
                WorkSession.started_at < range_end,
                or_(WorkSession.ended_at.is_(None), WorkSession.ended_at > range_start),
            )
        ).all()
        for started_at, ended_at in session_rows:
            session_start = (
                started_at.replace(tzinfo=UTC) if started_at.tzinfo is None else started_at
            )
            start_day = session_start.astimezone(timezone).date()
            if start_date <= start_day <= ledger_end_date:
                evidence_days.add(start_day)
            if ended_at is not None:
                session_end = ended_at.replace(tzinfo=UTC) if ended_at.tzinfo is None else ended_at
                end_day = session_end.astimezone(timezone).date()
                if start_date <= end_day <= ledger_end_date:
                    evidence_days.add(end_day)

        evidence_days.update(
            db.scalars(
                select(TimeAdjustmentRequest.requested_date).where(
                    TimeAdjustmentRequest.company_id == current_admin.company_id,
                    TimeAdjustmentRequest.employee_id == employee.id,
                    TimeAdjustmentRequest.requested_date >= start_date,
                    TimeAdjustmentRequest.requested_date <= ledger_end_date,
                )
            ).all()
        )
        evidence_days.update(
            db.scalars(
                select(OvertimeRecord.work_date).where(
                    OvertimeRecord.company_id == current_admin.company_id,
                    OvertimeRecord.employee_id == employee.id,
                    OvertimeRecord.work_date >= start_date,
                    OvertimeRecord.work_date <= ledger_end_date,
                )
            ).all()
        )
        evidence_days.update(
            db.scalars(
                select(AttendanceCorrection.work_date).where(
                    AttendanceCorrection.company_id == current_admin.company_id,
                    AttendanceCorrection.employee_id == employee.id,
                    AttendanceCorrection.work_date >= start_date,
                    AttendanceCorrection.work_date <= ledger_end_date,
                )
            ).all()
        )

    rows: list[dict] = []
    cursor = start_date
    while cursor <= ledger_end_date:
        attendance = existing_by_day.get(cursor)
        schedule_history_applied = bool(
            schedules_by_day.get(cursor, {}).get("profile_history_applied", False)
        )
        attendance_has_schedule_history = bool(
            attendance
            and (attendance.calculation_sources or {}).get("profile_history_applied", False)
        )
        if (
            attendance is not None
            and cursor != employee_today
            and (not schedule_history_applied or attendance_has_schedule_history)
        ):
            item = serialize_daily_attendance(attendance)
        elif attendance is not None and schedule_history_applied:
            attendance, _ = calculate_daily_attendance(
                db,
                employee=employee,
                work_date=cursor,
                now=now,
                existing_attendance=attendance,
                profile=profile,
            )
            item = serialize_daily_attendance(attendance)
        elif cursor == employee_today or cursor in evidence_days:
            attendance, _ = cached_daily_attendance(
                db,
                employee=employee,
                work_date=cursor,
                now=now,
                max_age_seconds=5,
                existing_attendance=attendance,
                profile=profile,
            )
            item = serialize_daily_attendance(attendance)
        else:
            item = _empty_attendance_item(
                employee=employee,
                work_date=cursor,
                schedule=schedules_by_day[cursor],
                leave=leave_by_day.get(cursor),
                employee_today=employee_today,
                calculated_at=now,
            )
        item["screenshot_count"] = screenshot_days.get(cursor, 0)
        rows.append(item)
        cursor += timedelta(days=1)
    db.commit()
    return success_response(
        data={
            "employee_id": str(employee.id),
            "employee_name": employee.name,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "summary": {
                "scheduled_days": sum(
                    row["status"] not in {"off_day", "worked_off_day"} for row in rows
                ),
                "worked_days": sum(
                    row["actual_first_activity_at"] is not None
                    or row["approved_manual_seconds"] > 0
                    for row in rows
                ),
                "leave_days": sum(row["leave_status"] is not None for row in rows),
                "normal_seconds": sum(row["normal_worked_seconds"] for row in rows),
                "payable_seconds": sum(row["total_payable_seconds"] for row in rows),
                "idle_seconds": sum(row["idle_seconds"] for row in rows),
                "late_seconds": sum(row["deductible_late_seconds"] for row in rows),
                "approved_overtime_seconds": sum(row["approved_overtime_seconds"] for row in rows),
                "screenshots": sum(row["screenshot_count"] for row in rows),
            },
            "rows": rows,
        }
    )
