from datetime import UTC, date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_admin
from app.api.v1.team_auth import (
    accessible_employee_ids_statement,
    ensure_employee_access,
)
from app.core.responses import success_response
from app.database.session import get_db
from app.models import AdminUser, Employee, Team, TeamMember
from app.services.attendance import (
    cached_daily_attendance,
    calculate_daily_attendance,
    serialize_daily_attendance,
)
from app.services.permissions import require_capability

router = APIRouter(prefix="/attendance", tags=["attendance"])


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
