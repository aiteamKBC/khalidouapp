import csv
from datetime import date
from io import StringIO
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.api.v1.team_auth import accessible_employee_ids_statement, apply_employee_scope
from app.core.responses import success_response
from app.database.session import get_db
from app.models import AdminUser, Employee, Screenshot, TimeAdjustmentRequest, WorkSession
from app.services.attendance import accountable_idle_totals
from app.services.permissions import require_capability

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/summary")
def summary(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    team_id: UUID | None = None,
):
    require_capability(current_admin, "reports.view")
    employee_scope = accessible_employee_ids_statement(db, current_admin, team_id)

    def scoped(statement, employee_column):
        return (
            statement.where(employee_column.in_(employee_scope))
            if employee_scope is not None
            else statement
        )

    screenshots_query = scoped(
        select(func.count()).where(
            Screenshot.company_id == current_admin.company_id,
            Screenshot.deleted_at.is_(None),
        ),
        Screenshot.employee_id,
    )
    screenshots = db.scalar(screenshots_query) or 0
    report_rows = employee_report(current_admin, db, team_id)["data"]
    return success_response(
        data={
            "total_tracked_seconds": sum(int(item["total_seconds"]) for item in report_rows),
            "screenshots": int(screenshots or 0),
        }
    )


@router.get("/employees")
def employee_report(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    team_id: UUID | None = None,
):
    require_capability(current_admin, "reports.view")
    statement = (
        select(
            Employee.id,
            Employee.name,
            Employee.email,
            func.coalesce(func.sum(WorkSession.active_seconds), 0),
        )
        .outerjoin(WorkSession, WorkSession.employee_id == Employee.id)
        .where(Employee.company_id == current_admin.company_id)
        .group_by(Employee.id, Employee.name, Employee.email)
        .order_by(Employee.name)
    )
    statement = apply_employee_scope(statement, db, current_admin, Employee.id, team_id)
    rows = db.execute(statement).all()
    from app.api.v1.timesheets import timesheet_rows

    timesheet_rows(
        db,
        current_admin.company_id,
        date.today(),
        date.today(),
        team_id=team_id,
        current_admin=current_admin,
    )
    idle_by_employee = accountable_idle_totals(
        db,
        company_id=current_admin.company_id,
        employee_ids={row[0] for row in rows},
    )
    adjustment_statement = (
        select(
            TimeAdjustmentRequest.employee_id,
            func.coalesce(func.sum(TimeAdjustmentRequest.approved_seconds), 0),
        )
        .where(
            TimeAdjustmentRequest.company_id == current_admin.company_id,
            TimeAdjustmentRequest.status == "approved",
        )
        .group_by(TimeAdjustmentRequest.employee_id)
    )
    adjustment_statement = apply_employee_scope(
        adjustment_statement,
        db,
        current_admin,
        TimeAdjustmentRequest.employee_id,
        team_id,
    )
    adjustments = {row[0]: int(row[1]) for row in db.execute(adjustment_statement).all()}
    return success_response(
        data=[
            {
                "employee_id": str(row[0]),
                "name": row[1],
                "email": row[2],
                "active_seconds": int(row[3]) + adjustments.get(row[0], 0),
                "idle_seconds": idle_by_employee.get(row[0], 0),
                "total_seconds": (
                    int(row[3])
                    + adjustments.get(row[0], 0)
                    + idle_by_employee.get(row[0], 0)
                ),
            }
            for row in rows
        ]
    )


@router.get("/export.csv")
def export_csv(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    team_id: UUID | None = None,
):
    require_capability(current_admin, "reports.export")
    rows = employee_report(current_admin, db, team_id)["data"]
    output = StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=[
            "employee_id",
            "name",
            "email",
            "active_seconds",
            "idle_seconds",
            "total_seconds",
        ],
    )
    writer.writeheader()
    writer.writerows(rows)
    return Response(content=output.getvalue(), media_type="text/csv")
