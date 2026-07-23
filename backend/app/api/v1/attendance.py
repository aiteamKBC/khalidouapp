from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

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
    Employee,
    PayrollRun,
    Screenshot,
    Team,
    TeamMember,
)
from app.services.audit import record_audit_log
from app.services.attendance import (
    cached_daily_attendance,
    calculate_daily_attendance,
    serialize_daily_attendance,
)
from app.services.permissions import require_capability

router = APIRouter(prefix="/attendance", tags=["attendance"])


class AttendanceCorrectionUpdate(BaseModel):
    start_time: time | None = None
    end_time: time | None = None
    payable_minutes_delta: int = Field(default=0, ge=-1440, le=1440)
    reason: str = Field(min_length=3, max_length=2000)

    @model_validator(mode="after")
    def require_a_change(self):
        if (
            self.start_time is None
            and self.end_time is None
            and self.payable_minutes_delta == 0
        ):
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


@router.get("/daily")
def daily_attendance(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
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
    rows = []
    for employee in employees:
        attendance, _ = cached_daily_attendance(
            db,
            employee=employee,
            work_date=selected_day,
            now=datetime.now(UTC),
            max_age_seconds=20,
        )
        if status and attendance.status != status:
            continue
        if late_only and attendance.deductible_late_seconds <= 0:
            continue
        if missing_check_in and not any(
            item.get("code") == "missing_check_in" for item in attendance.issues or []
        ):
            continue
        if overtime_only and attendance.recorded_overtime_seconds <= 0:
            continue
        if unexplained_idle and attendance.idle_seconds <= 0:
            continue
        if leave_only and not attendance.leave_status:
            continue
        data = serialize_daily_attendance(attendance)
        data.update(
            {
                "employee_name": employee.name,
                "employee_email": employee.email,
                "job_title": employee.job_title,
                "team_names": team_names.get(employee.id, []),
            }
        )
        rows.append(data)
    db.commit()
    return success_response(data={"date": selected_day.isoformat(), "rows": rows})


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
        payload.start_time
        and payload.end_time
        and payload.end_time <= payload.start_time
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
        "end_at": correction.corrected_end_at.isoformat()
        if correction.corrected_end_at
        else None,
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
        )
    ).all()
    for captured_at in captured_values:
        local_day = captured_at.astimezone(timezone).date()
        screenshot_days[local_day] = screenshot_days.get(local_day, 0) + 1

    rows: list[dict] = []
    cursor = start_date
    now = datetime.now(UTC)
    while cursor <= end_date:
        attendance, _ = cached_daily_attendance(
            db,
            employee=employee,
            work_date=cursor,
            now=now,
            max_age_seconds=20,
        )
        item = serialize_daily_attendance(attendance)
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
                "approved_overtime_seconds": sum(
                    row["approved_overtime_seconds"] for row in rows
                ),
                "screenshots": sum(row["screenshot_count"] for row in rows),
            },
            "rows": rows,
        }
    )
