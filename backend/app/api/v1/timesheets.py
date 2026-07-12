from calendar import monthrange
from datetime import date, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.api.v1.admin_utils import day_bounds
from app.api.v1.team_auth import apply_employee_scope, ensure_employee_access
from app.core.responses import success_response
from app.database.session import get_db
from app.models import AdminUser, Employee, Screenshot, TeamMember, TimeAdjustmentRequest, WorkSession

router = APIRouter(prefix="/timesheets", tags=["timesheets"])


def timesheet_rows(
    db: Session,
    company_id,
    start_day: date,
    end_day: date,
    employee_id: UUID | None = None,
    team_id: UUID | None = None,
    current_admin: AdminUser | None = None,
):
    start, _ = day_bounds(start_day)
    _, end = day_bounds(end_day)
    session_statement = (
        select(
            Employee.id,
            Employee.name,
            func.date(WorkSession.started_at).label("work_date"),
            func.min(WorkSession.started_at),
            func.max(WorkSession.ended_at),
            func.coalesce(func.sum(WorkSession.active_seconds), 0),
            func.coalesce(func.sum(WorkSession.idle_seconds), 0),
            func.coalesce(func.sum(WorkSession.deducted_seconds), 0),
        )
        .join(WorkSession, WorkSession.employee_id == Employee.id)
        .where(Employee.company_id == company_id, WorkSession.started_at.between(start, end))
        .group_by(Employee.id, Employee.name, func.date(WorkSession.started_at))
        .order_by(func.date(WorkSession.started_at).desc(), Employee.name)
    )
    if current_admin is not None:
        session_statement = apply_employee_scope(session_statement, db, current_admin, Employee.id, team_id)
    if employee_id:
        if current_admin is not None:
            ensure_employee_access(db, current_admin, employee_id, team_id)
        session_statement = session_statement.where(Employee.id == employee_id)

    result_by_key: dict[tuple[UUID, date], dict] = {}
    for row in db.execute(session_statement).all():
        work_date = row[2] if isinstance(row[2], date) else date.fromisoformat(str(row[2]))
        key = (row[0], work_date)
        result_by_key[key] = {
            "employee_id": str(row[0]),
            "employee_name": row[1],
            "date": work_date.isoformat(),
            "start_time": row[3].isoformat() if row[3] else None,
            "end_time": row[4].isoformat() if row[4] else None,
            "active_seconds": max(0, int(row[5]) - int(row[7])),
            "idle_seconds": int(row[6]),
            "deducted_seconds": int(row[7]),
            "adjustment_seconds": 0,
        }

    adjustment_statement = (
        select(
            Employee.id,
            Employee.name,
            TimeAdjustmentRequest.requested_date,
            func.coalesce(func.sum(TimeAdjustmentRequest.approved_seconds), 0),
        )
        .join(Employee, Employee.id == TimeAdjustmentRequest.employee_id)
        .where(
            TimeAdjustmentRequest.company_id == company_id,
            TimeAdjustmentRequest.status == "approved",
            TimeAdjustmentRequest.requested_date >= start_day,
            TimeAdjustmentRequest.requested_date <= end_day,
        )
        .group_by(Employee.id, Employee.name, TimeAdjustmentRequest.requested_date)
        .order_by(TimeAdjustmentRequest.requested_date.desc(), Employee.name)
    )
    if current_admin is not None:
        adjustment_statement = apply_employee_scope(adjustment_statement, db, current_admin, Employee.id, team_id)
    if employee_id:
        adjustment_statement = adjustment_statement.where(Employee.id == employee_id)

    for row in db.execute(adjustment_statement).all():
        work_date = row[2]
        key = (row[0], work_date)
        if key not in result_by_key:
            result_by_key[key] = {
                "employee_id": str(row[0]),
                "employee_name": row[1],
                "date": work_date.isoformat(),
                "start_time": None,
                "end_time": None,
                "active_seconds": 0,
                "idle_seconds": 0,
                "adjustment_seconds": 0,
                "deducted_seconds": 0,
            }
        result_by_key[key]["adjustment_seconds"] += int(row[3])
        result_by_key[key]["active_seconds"] += int(row[3])

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
        screenshot_rows = db.execute(
            select(
                Screenshot.employee_id,
                func.date(Screenshot.captured_at),
                func.count(),
            )
            .where(
                Screenshot.company_id == company_id,
                Screenshot.employee_id.in_(employee_ids),
                Screenshot.captured_at.between(start, end),
                Screenshot.deleted_at.is_(None),
            )
            .group_by(Screenshot.employee_id, func.date(Screenshot.captured_at))
        ).all()
        for screenshot_employee_id, screenshot_date, screenshot_count in screenshot_rows:
            normalized_date = (
                screenshot_date
                if isinstance(screenshot_date, date)
                else date.fromisoformat(str(screenshot_date))
            )
            screenshot_counts[(screenshot_employee_id, normalized_date)] = int(screenshot_count)

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
    return result


@router.get("/daily")
def daily(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    day: date | None = None,
    team_id: UUID | None = None,
):
    target = day or date.today()
    return success_response(data=timesheet_rows(db, current_admin.company_id, target, target, team_id=team_id, current_admin=current_admin))


@router.get("/weekly")
def weekly(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    week_start: date | None = None,
    team_id: UUID | None = None,
):
    start = week_start or (date.today() - timedelta(days=date.today().weekday()))
    return success_response(data=timesheet_rows(db, current_admin.company_id, start, start + timedelta(days=6), team_id=team_id, current_admin=current_admin))


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
    return success_response(data=timesheet_rows(db, current_admin.company_id, start, end, employee_id, team_id=team_id, current_admin=current_admin))
