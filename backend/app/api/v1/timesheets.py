from calendar import monthrange
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_admin
from app.api.v1.admin_utils import apply_pagination, count_for, pagination_meta
from app.api.v1.team_auth import apply_employee_scope, ensure_employee_access
from app.core.responses import success_response
from app.database.session import get_db
from app.models import (
    AdminUser,
    DailyAttendance,
    Employee,
    EmployeeWorkProfile,
    LeaveRequest,
    Screenshot,
    TeamMember,
    TimeAdjustmentRequest,
    WorkSession,
)
from app.services.activity_timeline import local_today, session_observation_bounds
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


def _workday_bounds(work_date: date, timezone_name: str | None) -> tuple[datetime, datetime]:
    zone = _zone(timezone_name)
    day_start = datetime.combine(work_date, time.min, tzinfo=zone).astimezone(UTC)
    day_end = datetime.combine(work_date + timedelta(days=1), time.min, tzinfo=zone).astimezone(UTC)
    return day_start, day_end


def _clip_to_workday(
    value: datetime,
    work_date: date,
    timezone_name: str | None,
) -> datetime:
    day_start, day_end = _workday_bounds(work_date, timezone_name)
    return min(max(_utc(value), day_start), day_end)


def _empty_timesheet_item(
    employee_id: UUID,
    employee_name: str,
    timezone_name: str | None,
    work_date: date,
) -> dict:
    return {
        "employee_id": str(employee_id),
        "employee_name": employee_name,
        "timezone": timezone_name or "UTC",
        "date": work_date.isoformat(),
        "start_time": None,
        "end_time": None,
        "leave_status": None,
        "leave_type": None,
        "_start_at": None,
        "_latest_end_at": None,
        "_last_signal_at": None,
        "_has_open_session": False,
        "_has_cross_day_session": False,
        "_sessions": [],
        "_session_count": 0,
        "active_seconds": 0,
        "idle_seconds": 0,
        "_observed_idle_seconds": 0,
        "deducted_seconds": 0,
        "adjustment_seconds": 0,
    }


def timesheet_rows(
    db: Session,
    company_id,
    start_day: date,
    end_day: date,
    employee_id: UUID | None = None,
    team_id: UUID | None = None,
    current_admin: AdminUser | None = None,
    device_id: UUID | None = None,
    refresh_current_attendance: bool = True,
    include_screenshot_counts: bool = True,
    include_empty_roster: bool = False,
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
            _empty_timesheet_item(
                row_employee_id,
                employee_name,
                timezone_name,
                work_date,
            ),
        )
        started_at = _utc(session.started_at)
        item["_sessions"].append(session)
        item["_session_count"] += 1
        item["_start_at"] = min(
            value for value in (item["_start_at"], started_at) if value is not None
        )
        item["active_seconds"] += max(
            0,
            int(session.active_seconds) - int(session.deducted_seconds),
        )
        item["idle_seconds"] += int(session.idle_seconds)
        item["_observed_idle_seconds"] += int(session.idle_seconds)
        item["deducted_seconds"] += int(session.deducted_seconds)

    if include_empty_roster:
        roster_statement = select(
            Employee.id,
            Employee.name,
            Employee.timezone,
        ).where(
            Employee.company_id == company_id,
            Employee.status == "active",
        )
        if current_admin is not None:
            roster_statement = apply_employee_scope(
                roster_statement,
                db,
                current_admin,
                Employee.id,
                team_id,
            )
        if employee_id:
            roster_statement = roster_statement.where(Employee.id == employee_id)

        for row_employee_id, employee_name, timezone_name in db.execute(
            roster_statement.order_by(Employee.name)
        ).all():
            result_by_key.setdefault(
                (row_employee_id, start_day),
                _empty_timesheet_item(
                    row_employee_id,
                    employee_name,
                    timezone_name,
                    start_day,
                ),
            )

    leave_statement = (
        select(
            Employee.id,
            Employee.name,
            Employee.timezone,
            LeaveRequest.start_date,
            LeaveRequest.end_date,
            LeaveRequest.leave_type,
        )
        .join(Employee, Employee.id == LeaveRequest.employee_id)
        .where(
            LeaveRequest.company_id == company_id,
            LeaveRequest.status == "approved",
            LeaveRequest.start_date <= end_day,
            LeaveRequest.end_date >= start_day,
        )
        .order_by(LeaveRequest.start_date, Employee.name)
    )
    if current_admin is not None:
        leave_statement = apply_employee_scope(
            leave_statement,
            db,
            current_admin,
            Employee.id,
            team_id,
        )
    if employee_id:
        leave_statement = leave_statement.where(Employee.id == employee_id)

    for row in db.execute(leave_statement).all():
        leave_start = max(start_day, row[3])
        leave_end = min(end_day, row[4])
        leave_day = leave_start
        while leave_day <= leave_end:
            key = (row[0], leave_day)
            item = result_by_key.setdefault(
                key,
                _empty_timesheet_item(row[0], row[1], row[2], leave_day),
            )
            item["leave_status"] = "approved"
            item["leave_type"] = row[5]
            leave_day += timedelta(days=1)

    sessions = [
        session
        for item in result_by_key.values()
        for session in item["_sessions"]
    ]
    if sessions:
        observations_by_session = session_observation_bounds(
            db,
            company_id=company_id,
            sessions=sessions,
        )
        for item in result_by_key.values():
            work_date = date.fromisoformat(item["date"])
            timezone_name = str(item["timezone"])
            for session in item["_sessions"]:
                observation = observations_by_session[session.id]
                effective_end_at = observation["effective_end_at"]
                if _employee_local_date(effective_end_at, timezone_name) != work_date:
                    item["_has_cross_day_session"] = True
                clipped_end_at = _clip_to_workday(
                    effective_end_at,
                    work_date,
                    timezone_name,
                )
                clipped_signal_at = _clip_to_workday(
                    observation["last_signal_at"],
                    work_date,
                    timezone_name,
                )
                item["_last_signal_at"] = max(
                    value for value in (item["_last_signal_at"], clipped_signal_at)
                    if value is not None
                )
                is_fresh_open = (
                    session.ended_at is None
                    and session.status in ACTIVE_SESSION_STATUSES
                    and bool(observation["is_fresh"])
                )
                item["_has_open_session"] = item["_has_open_session"] or is_fresh_open
                if not is_fresh_open:
                    item["_latest_end_at"] = max(
                        value
                        for value in (item["_latest_end_at"], clipped_end_at)
                        if value is not None
                    )

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
                .options(
                    selectinload(Employee.work_profile).load_only(
                        EmployeeWorkProfile.id,
                        EmployeeWorkProfile.employee_id,
                        EmployeeWorkProfile.shift_start,
                        EmployeeWorkProfile.shift_end,
                        EmployeeWorkProfile.working_days,
                        EmployeeWorkProfile.break_rules,
                        EmployeeWorkProfile.late_grace_minutes,
                    )
                )
                .where(
                    Employee.company_id == company_id,
                    Employee.id.in_(employee_ids),
                )
            ).all()
        }
        if employee_ids and refresh_current_attendance
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
        attendance = stored_attendance_by_key.get((row_employee_id, work_date))
        timeline = None
        if refresh_current_attendance and (
            attendance is None
            or work_date == local_today(timezone_name, attendance_now)
        ):
            employee = employees_by_id.get(row_employee_id)
            if employee is None:
                continue
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

        if attendance is not None:
            calculation_sources = attendance.calculation_sources or {}
            item["idle_seconds"] = accountable_idle_seconds(attendance)
            materialized_observed_idle = max(
                0,
                int(
                    calculation_sources.get(
                        "observed_idle_seconds",
                        item["_observed_idle_seconds"],
                    )
                ),
            )
            item["_observed_idle_seconds"] = (
                materialized_observed_idle
                if item["_has_cross_day_session"]
                else max(
                    int(item["_observed_idle_seconds"]),
                    materialized_observed_idle,
                )
            )
            item["start_time"] = (
                _clip_to_workday(
                    attendance.actual_first_activity_at,
                    work_date,
                    timezone_name,
                ).isoformat()
                if attendance.actual_first_activity_at
                else item["start_time"]
            )
            is_running = (
                work_date == local_today(timezone_name, attendance_now)
                and bool(item["_has_open_session"])
            )
            attendance_end = (
                attendance.actual_sign_out_at or attendance.actual_last_activity_at
            )
            clipped_attendance_end = (
                _clip_to_workday(attendance_end, work_date, timezone_name)
                if attendance_end
                else None
            )
            resolved_end = (
                max(
                    value
                    for value in (
                        clipped_attendance_end,
                        item["_latest_end_at"],
                    )
                    if value is not None
                )
                if clipped_attendance_end or item["_latest_end_at"]
                else None
            )
            item["end_time"] = (
                None
                if is_running
                else resolved_end.isoformat()
                if resolved_end
                else item["end_time"]
            )

            # A live session can have authoritative activity events before its
            # cumulative counters are persisted by the next heartbeat.
            if timeline is not None:
                item["active_seconds"] = max(
                    int(item["active_seconds"]),
                    max(
                        0,
                        int(timeline["worked_seconds"])
                        - int(item["deducted_seconds"]),
                    ),
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
            result_by_key[key] = _empty_timesheet_item(
                row[0],
                row[1],
                row[2],
                work_date,
            )
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
    if employee_ids and include_screenshot_counts:
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
        day_start, day_end = _workday_bounds(work_date, str(item["timezone"]))
        workday_capacity_seconds = max(0, int((day_end - day_start).total_seconds()))
        active_seconds = min(
            workday_capacity_seconds,
            max(0, int(item["active_seconds"])),
        )
        idle_seconds = min(
            max(0, workday_capacity_seconds - active_seconds),
            max(0, int(item["idle_seconds"])),
        )
        observed_idle_seconds = min(
            max(0, workday_capacity_seconds - active_seconds),
            max(0, int(item.get("_observed_idle_seconds", idle_seconds))),
        )
        first_observed_at = item.get("_start_at")
        last_observed_at = max(
            (
                value
                for value in (
                    item.get("_latest_end_at"),
                    item.get("_last_signal_at"),
                )
                if value is not None
            ),
            default=None,
        )
        raw_observed_span_seconds = (
            max(0, int((last_observed_at - first_observed_at).total_seconds()))
            if first_observed_at is not None and last_observed_at is not None
            else active_seconds + observed_idle_seconds
        )
        observed_tracked_seconds = active_seconds + observed_idle_seconds
        observed_span_seconds = min(
            workday_capacity_seconds,
            max(raw_observed_span_seconds, observed_tracked_seconds),
        )
        untracked_seconds = max(0, observed_span_seconds - observed_tracked_seconds)
        result.append(
            {
                "employee_id": item["employee_id"],
                "employee_name": item["employee_name"],
                "team_id": str(team_id) if team_id else team_by_employee.get(row_employee_id),
                "date": item["date"],
                "start_time": item["start_time"],
                "end_time": item["end_time"],
                "last_signal_at": (
                    item.get("_last_signal_at").isoformat()
                    if item.get("_last_signal_at")
                    else None
                ),
                "leave_status": item.get("leave_status"),
                "leave_type": item.get("leave_type"),
                "session_count": int(item.get("_session_count", 0)),
                "total_tracked_seconds": active_seconds + idle_seconds,
                "observed_tracked_seconds": observed_tracked_seconds,
                "observed_span_seconds": observed_span_seconds,
                "untracked_seconds": untracked_seconds,
                "active_seconds": active_seconds,
                "idle_seconds": idle_seconds,
                "observed_idle_seconds": observed_idle_seconds,
                "adjustment_seconds": int(item["adjustment_seconds"]),
                "deducted_seconds": int(item["deducted_seconds"]),
                "points": round(active_seconds / 3600, 2),
                "screenshot_count": int(screenshot_count),
            }
        )
    if refresh_current_attendance:
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
            refresh_current_attendance=False,
            include_empty_roster=True,
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
            refresh_current_attendance=False,
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
            refresh_current_attendance=False,
        )
    )


@router.get("/employee-options")
def employee_options(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    team_id: UUID | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=100),
):
    statement = select(Employee.id, Employee.name).where(
        Employee.company_id == current_admin.company_id,
        Employee.status == "active",
    )
    statement = apply_employee_scope(
        statement,
        db,
        current_admin,
        Employee.id,
        team_id,
    )
    total = count_for(db, statement)
    employees = db.execute(
        apply_pagination(statement.order_by(Employee.name, Employee.id), page, page_size)
    ).all()
    return success_response(
        data=[
            {
                "id": str(row_employee_id),
                "name": employee_name,
            }
            for row_employee_id, employee_name in employees
        ],
        meta=pagination_meta(total, page, page_size),
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
