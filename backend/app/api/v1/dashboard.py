from datetime import UTC, date, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.api.v1.admin_utils import day_bounds, get_company_settings
from app.api.v1.team_auth import accessible_employee_ids_statement
from app.core.responses import success_response
from app.database.session import get_db
from app.models import AdminUser, Device, Employee, Screenshot, TimeAdjustmentRequest, WorkSession

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary")
def summary(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    team_id: UUID | None = None,
):
    settings = get_company_settings(db, current_admin.company_id)
    offline_cutoff = datetime.now(UTC) - timedelta(minutes=settings.offline_threshold_minutes)
    start, end = day_bounds(date.today())

    employee_scope = accessible_employee_ids_statement(db, current_admin, team_id)

    def scoped(statement, employee_column):
        return statement.where(employee_column.in_(employee_scope)) if employee_scope is not None else statement

    total_employees_query = scoped(
        select(func.count()).select_from(Employee).where(
            Employee.company_id == current_admin.company_id
        ),
        Employee.id,
    )
    online_employees_query = scoped(
        select(func.count(func.distinct(Device.employee_id))).where(
            Device.company_id == current_admin.company_id,
            Device.last_seen_at >= offline_cutoff,
            Device.revoked_at.is_(None),
        ),
        Device.employee_id,
    )
    idle_employees_query = scoped(
        select(func.count(func.distinct(WorkSession.employee_id))).where(
            WorkSession.company_id == current_admin.company_id,
            WorkSession.status == "idle",
            WorkSession.ended_at.is_(None),
        ),
        WorkSession.employee_id,
    )
    tracked_seconds_query = scoped(
        select(
            func.coalesce(func.sum(WorkSession.active_seconds + WorkSession.idle_seconds), 0)
        ).where(
            WorkSession.company_id == current_admin.company_id,
            WorkSession.started_at.between(start, end),
        ),
        WorkSession.employee_id,
    )
    adjustment_seconds_query = scoped(
        select(func.coalesce(func.sum(TimeAdjustmentRequest.approved_seconds), 0)).where(
            TimeAdjustmentRequest.company_id == current_admin.company_id,
            TimeAdjustmentRequest.status == "approved",
            TimeAdjustmentRequest.requested_date == date.today(),
        ),
        TimeAdjustmentRequest.employee_id,
    )
    screenshots_today_query = scoped(
        select(func.count()).where(
            Screenshot.company_id == current_admin.company_id,
            Screenshot.captured_at.between(start, end),
            Screenshot.deleted_at.is_(None),
        ),
        Screenshot.employee_id,
    )
    (
        total_employees,
        online_employees,
        idle_employees,
        tracked_seconds,
        adjustment_seconds,
        screenshots_today,
    ) = db.execute(
        select(
            total_employees_query.scalar_subquery(),
            online_employees_query.scalar_subquery(),
            idle_employees_query.scalar_subquery(),
            tracked_seconds_query.scalar_subquery(),
            adjustment_seconds_query.scalar_subquery(),
            screenshots_today_query.scalar_subquery(),
        )
    ).one()

    return success_response(
        data={
            "total_employees": total_employees,
            "online_employees": online_employees,
            "idle_employees": idle_employees,
            "offline_employees": max(0, total_employees - online_employees),
            "total_hours_today": round((tracked_seconds + adjustment_seconds) / 3600, 2),
            "screenshots_today": screenshots_today,
        }
    )
