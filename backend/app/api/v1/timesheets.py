from calendar import monthrange
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_admin
from app.api.v1.team_auth import apply_employee_scope, ensure_employee_access
from app.core.responses import success_response
from app.database.session import get_db
from app.models import (
    AdminUser,
    DailyAttendance,
    Employee,
    Screenshot,
    TeamMember,
    TimeAdjustmentRequest,
    WorkSession,
)
from app.services.activity_timeline import local_today
from app.services.attendance import accountable_idle_seconds, cached_daily_attendance

router = APIRouter(prefix="/timesheets", tags=["timesheets"])
ACTIVE_SESSION_STATUSES = {"active", "idle", "locked", "sleeping"}


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _zone(timezone_name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(timezone_name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _employee_local_date(value: datetime, timezone_name: str | None) -> date:
    return _utc(value).astimezone(_zone(timezone_name)).date()


def timesheet_rows(
    db: Session,
    company_id,
    start_day: date,
    end_day: date,
    employee_id: UUID | None = None,
    team_id: UUID | None = None,
    current_admin: AdminUser | None = None,
    device_id: UUID | None = None,
):
    # Employees can be up to a calendar day ahead of or behind UTC. Fetch a
    # safe UTC envelope, then assign every row to the employee's local date.
    # SQL func.date(timestamp) silently put Cairo sessions after midnight on
    # the previous UTC day, which made "Today" appear empty in Timesheets.
    start = datetime.combine(start_day - timedelta(days=1), time.min, tzinfo=UTC)
    end = datetime.combine(end_day + timedelta(days=2), time.min, tzinfo=UTC)
    session_statement = (
        select(
            WorkSession,
            Employee.id,
            Employee.name,
            Employee.timezone,
        )
        .join(WorkSession, WorkSession.employee_id == Employee.id)
        .where(
            Employee.company_id == company_id,
            WorkSession.started_at < end,
            or_(WorkSession.ended_at.is_(None), WorkSession.ended_at > start),
        )
        .order_by(WorkSession.started_at.desc(), Employee.name)
    )
    if current_admin is not None:
        session_statement = apply_employee_scope(
            session_statement, db, current_admin, Employee.id, team_id
        )
    if employee_id:
        if current_admin is not None:
            ensure_employee_access(db, current_admin, employee_id, team_id)
        session_statement = session_statement.where(Employee.id == employee_id)
    if device_id:
        session_statement = session_statement.where(WorkSession.device_id == device_id)

    result_by_key: dict[tuple[UUID, date], dict] = {}
    for row in db.execute(session_statement).all():
        session, row_employee_id, employee_name, timezone_name = row
        work_date = _employee_local_date(session.started_at, timezone_name)
        if work_date < start_day or work_date > end_day:
            continue
        key = (row_employee_id, work_date)
        item = result_by_key.setdefault(
            key,
            {
                "employee_id": str(row_employee_id),
                "employee_name": employee_name,
                "timezone": timezone_name or "UTC",
                "date": work_date.isoformat(),
                "_start_at": None,
                "_latest_end_at": None,
                "_has_open_session": False,
                "active_seconds": 0,
                "idle_seconds": 0,
                "deducted_seconds": 0,
                "adjustment_seconds": 0,
            },
        )
        started_at = _utc(session.started_at)
        ended_at = _utc(session.ended_at) if session.ended_at else None
        item["_start_at"] = min(
            value for value in (item["_start_at"], started_at) if value is not None
        )
        if ended_at is not None:
            item["_latest_end_at"] = max(
                value
                for value in (item["_latest_end_at"], ended_at)
                if value is not None
            )
        if session.ended_at is None and session.status in ACTIVE_SESSION_STATUSES:
            item["_has_open_session"] = True
        item["active_seconds"] += max(
            0,
            int(session.active_seconds) - int(session.deducted_seconds),
        )
        item["idle_seconds"] += int(session.idle_seconds)
        item["deducted_seconds"] += int(session.deducted_seconds)

    for item in result_by_key.values():
        item["start_time"] = (
            item["_start_at"].isoformat() if item["_start_at"] else None
        )
        item["end_time"] = (
            None
            if item["_has_open_session"]
            else item["_latest_end_at"].isoformat()
            if item["_latest_end_at"]
            else None
        )

    employee_ids = {key[0] for key in result_by_key}
    employees_by_id = (
        {
            employee.id: employee
            for employee in db.scalars(
                select(Employee)
                .options(selectinload(Employee.work_profile))
                .where(
                    Employee.company_id == company_id,
                    Employee.id.in_(employee_ids),
                )
            ).all()
        }
        if employee_ids
        else {}
    )
    stored_attendance_by_key: dict[tuple[UUID, date], DailyAttendance] = {}
    if employee_ids:
        for attendance in db.scalars(
            select(DailyAttendance).where(
                DailyAttendance.company_id == company_id,
                DailyAttendance.employee_id.in_(employee_ids),
                DailyAttendance.work_date >= start_day,
                DailyAttendance.work_date <= end_day,
            )
        ).all():
            stored_attendance_by_key[(attendance.employee_id, attendance.work_date)] = attendance

    # Raw session idle is a device state, not necessarily accountable idle.
    # Migration 51 clears the derived attendance cache so old days can adopt
    # the sustained-work rule. Rebuild only missing rows here; after the first
    # read they are stored again and historical range reads stay inexpensive.
    attendance_now = datetime.now(UTC)
    for (row_employee_id, work_date), item in result_by_key.items():
        timezone_name = str(item["timezone"])
        employee = employees_by_id.get(row_employee_id)
        if employee is None:
            continue
        attendance = stored_attendance_by_key.get((row_employee_id, work_date))
        timeline = None
        if attendance is None or work_date == local_today(timezone_name, attendance_now):
            attendance, timeline = cached_daily_attendance(
                db,
                employee=employee,
                work_date=work_date,
                now=attendance_now,
                max_age_seconds=30,
                device_id=device_id,
                timezone_name=timezone_name,
                existing_attendance=attendance,
                profile=employee.work_profile,
            )
            stored_attendance_by_key[(row_employee_id, work_date)] = attendance

        item["idle_seconds"] = accountable_idle_seconds(attendance)
        item["start_time"] = (
            _utc(attendance.actual_first_activity_at).isoformat()
            if attendance.actual_first_activity_at
            else item["start_time"]
        )
        calculation_sources = attendance.calculation_sources or {}
        is_running = (
            work_date == local_today(timezone_name, attendance_now)
            and bool(
                timeline["is_running"]
                if timeline is not None
                else calculation_sources.get("is_running", False)
            )
        )
        attendance_end = attendance.actual_sign_out_at or attendance.actual_last_activity_at
        item["end_time"] = (
            None
            if is_running
            else _utc(attendance_end).isoformat()
            if attendance_end
            else item["end_time"]
        )

        # A live session can have authoritative activity events before its
        # cumulative counters are persisted by the next heartbeat.
        if timeline is not None:
            item["active_seconds"] = max(
                int(item["active_seconds"]),
                max(0, int(timeline["worked_seconds"]) - int(item["deducted_seconds"])),
            )

    adjustment_statement = (
        select(
            Employee.id,
            Employee.name,
            Employee.timezone,
            TimeAdjustmentRequest.requested_date,
            func.coalesce(func.sum(TimeAdjustmentRequest.approved_seconds), 0),
        )
        .join(Employee, Employee.id == TimeAdjustmentRequest.employee_id)
        .where(
            TimeAdjustmentRequest.company_id == company_id,
            TimeAdjustmentRequest.status == "approved",
            TimeAdjustmentRequest.request_type != "early_leave",
            TimeAdjustmentRequest.requested_date >= start_day,
            TimeAdjustmentRequest.requested_date <= end_day,
        )
        .group_by(
            Employee.id,
            Employee.name,
            Employee.timezone,
            TimeAdjustmentRequest.requested_date,
        )
        .order_by(TimeAdjustmentRequest.requested_date.desc(), Employee.name)
    )
    if current_admin is not None:
        adjustment_statement = apply_employee_scope(
            adjustment_statement, db, current_admin, Employee.id, team_id
        )
    if employee_id:
        adjustment_statement = adjustment_statement.where(Employee.id == employee_id)

    for row in db.execute(adjustment_statement).all():
        work_date = row[3]
        key = (row[0], work_date)
        if key not in result_by_key:
            result_by_key[key] = {
                "employee_id": str(row[0]),
                "employee_name": row[1],
                "timezone": row[2] or "UTC",
                "date": work_date.isoformat(),
                "start_time": None,
                "end_time": None,
                "active_seconds": 0,
                "idle_seconds": 0,
                "adjustment_seconds": 0,
                "deducted_seconds": 0,
            }
        result_by_key[key]["adjustment_seconds"] += int(row[4])
        result_by_key[key]["active_seconds"] += int(row[4])

    employee_ids = {key[0] for key in result_by_key}
    team_by_employee: dict[UUID, str] = {}
    if employee_ids:
        for member_employee_id, member_team_id in db.execute(
            select(TeamMember.employee_id, TeamMember.team_id).where(
                TeamMember.employee_id.in_(employee_ids),
                TeamMember.status == "active",
            )
        ).all():
            team_by_employee.setdefault(member_employee_id, str(member_team_id))

    screenshot_counts: dict[tuple[UUID, date], int] = {}
    if employee_ids:
        timezone_by_employee = {
            row_employee_id: str(result_by_key[(row_employee_id, work_date)]["timezone"])
            for row_employee_id, work_date in result_by_key
        }
        screenshot_statement = (
            select(
                Screenshot.employee_id,
                Screenshot.captured_at,
            )
            .where(
                Screenshot.company_id == company_id,
                Screenshot.employee_id.in_(employee_ids),
                Screenshot.captured_at >= start,
                Screenshot.captured_at < end,
                Screenshot.deleted_at.is_(None),
            )
        )
        if device_id:
            screenshot_statement = screenshot_statement.where(Screenshot.device_id == device_id)
        screenshot_rows = db.execute(screenshot_statement).all()
        for screenshot_employee_id, captured_at in screenshot_rows:
            normalized_date = _employee_local_date(
                captured_at,
                timezone_by_employee.get(screenshot_employee_id),
            )
            if normalized_date < start_day or normalized_date > end_day:
                continue
            key = (screenshot_employee_id, normalized_date)
            screenshot_counts[key] = screenshot_counts.get(key, 0) + 1

    result = []
    for (row_employee_id, work_date), item in sorted(
        result_by_key.items(),
        key=lambda entry: (entry[0][1], entry[1]["employee_name"]),
        reverse=True,
    ):
        screenshot_count = screenshot_counts.get((row_employee_id, work_date), 0)
        active_seconds = int(item["active_seconds"])
        idle_seconds = int(item["idle_seconds"])
        result.append(
            {
                "employee_id": item["employee_id"],
                "employee_name": item["employee_name"],
                "team_id": str(team_id) if team_id else team_by_employee.get(row_employee_id),
                "date": item["date"],
                "start_time": item["start_time"],
                "end_time": item["end_time"],
                "total_tracked_seconds": active_seconds + idle_seconds,
                "active_seconds": active_seconds,
                "idle_seconds": idle_seconds,
                "adjustment_seconds": int(item["adjustment_seconds"]),
                "deducted_seconds": int(item["deducted_seconds"]),
                "points": round(active_seconds / 3600, 2),
                "screenshot_count": int(screenshot_count),
            }
        )
    db.commit()
    return result


@router.get("/daily")
def daily(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    day: date | None = None,
    team_id: UUID | None = None,
):
    target = day or date.today()
    return success_response(
        data=timesheet_rows(
            db,
            current_admin.company_id,
            target,
            target,
            team_id=team_id,
            current_admin=current_admin,
        )
    )


@router.get("/weekly")
def weekly(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    week_start: date | None = None,
    team_id: UUID | None = None,
):
    start = week_start or (date.today() - timedelta(days=date.today().weekday()))
    return success_response(
        data=timesheet_rows(
            db,
            current_admin.company_id,
            start,
            start + timedelta(days=6),
            team_id=team_id,
            current_admin=current_admin,
        )
    )


@router.get("/monthly")
def monthly(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    month_start: date | None = None,
    team_id: UUID | None = None,
):
    selected = month_start or date.today().replace(day=1)
    start = selected.replace(day=1)
    end = start.replace(day=monthrange(start.year, start.month)[1])
    return success_response(
        data=timesheet_rows(
            db,
            current_admin.company_id,
            start,
            end,
            team_id=team_id,
            current_admin=current_admin,
        )
    )


@router.get("/employee/{employee_id}")
def employee_timesheet(
    employee_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    start_date: date | None = None,
    end_date: date | None = None,
    team_id: UUID | None = None,
):
    start = start_date or date.today()
    end = end_date or start
    return success_response(
        data=timesheet_rows(
            db,
            current_admin.company_id,
            start,
            end,
            employee_id,
            team_id=team_id,
            current_admin=current_admin,
        )
    )
