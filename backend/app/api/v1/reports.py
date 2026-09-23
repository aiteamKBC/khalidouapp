import csv
import re
from datetime import UTC, date, datetime, time, timedelta
from io import StringIO
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.api.v1.team_auth import accessible_employee_ids_statement, apply_employee_scope
from app.core.responses import success_response
from app.database.session import get_db
from app.models import AdminUser, Employee, Screenshot, TimeAdjustmentRequest, WorkSession
from app.services.attendance import accountable_idle_totals
from app.services.employee_archive import current_employee_clause
from app.services.permissions import require_capability

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/summary")
def summary(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    team_id: UUID | None = None,
    employee_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
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
    # The headline cards must reflect the same team/employee/date filters as the
    # charts, so the summary is filtered identically instead of company-wide (W9).
    if employee_id is not None:
        screenshots_query = screenshots_query.where(Screenshot.employee_id == employee_id)
    if date_from is not None:
        screenshots_query = screenshots_query.where(
            Screenshot.captured_at >= datetime.combine(date_from, time.min, tzinfo=UTC)
        )
    if date_to is not None:
        screenshots_query = screenshots_query.where(
            Screenshot.captured_at
            < datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=UTC)
        )
    screenshots = db.scalar(screenshots_query) or 0
    report_rows = employee_report(
        current_admin,
        db,
        team_id=team_id,
        employee_id=employee_id,
        date_from=date_from,
        date_to=date_to,
    )["data"]
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
    employee_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
):
    require_capability(current_admin, "reports.view")
    # Date bounds live in the session join so employees with no in-range work
    # still appear with zero; the same bounds scope idle and adjustments below,
    # so every reported number honours the team/employee/date filters (W9).
    session_join = WorkSession.employee_id == Employee.id
    if date_from is not None:
        session_join = and_(
            session_join,
            WorkSession.started_at >= datetime.combine(date_from, time.min, tzinfo=UTC),
        )
    if date_to is not None:
        session_join = and_(
            session_join,
            WorkSession.started_at
            < datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=UTC),
        )
    statement = (
        select(
            Employee.id,
            Employee.name,
            Employee.email,
            func.coalesce(func.sum(WorkSession.active_seconds), 0),
        )
        .outerjoin(WorkSession, session_join)
        .where(Employee.company_id == current_admin.company_id)
        .group_by(Employee.id, Employee.name, Employee.email)
        .order_by(Employee.name)
    )
    if employee_id is not None:
        statement = statement.where(Employee.id == employee_id)
    else:
        statement = statement.where(current_employee_clause())
    statement = apply_employee_scope(statement, db, current_admin, Employee.id, team_id)
    rows = db.execute(statement).all()
    idle_by_employee = accountable_idle_totals(
        db,
        company_id=current_admin.company_id,
        employee_ids={row[0] for row in rows},
        start_date=date_from,
        end_date=date_to,
    )
    adjustment_statement = (
        select(
            TimeAdjustmentRequest.employee_id,
            func.coalesce(func.sum(TimeAdjustmentRequest.approved_seconds), 0),
        )
        .where(
            TimeAdjustmentRequest.company_id == current_admin.company_id,
            TimeAdjustmentRequest.status == "approved",
            TimeAdjustmentRequest.request_type != "delayed_break",
        )
        .group_by(TimeAdjustmentRequest.employee_id)
    )
    if employee_id is not None:
        adjustment_statement = adjustment_statement.where(
            TimeAdjustmentRequest.employee_id == employee_id
        )
    if date_from is not None:
        adjustment_statement = adjustment_statement.where(
            TimeAdjustmentRequest.requested_date >= date_from
        )
    if date_to is not None:
        adjustment_statement = adjustment_statement.where(
            TimeAdjustmentRequest.requested_date <= date_to
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


_CSV_PLAIN_NUMBER = re.compile(r"^-?(?:\d+\.?\d*|\.\d+)$")


def _csv_safe(value: object) -> object:
    """Neutralize spreadsheet formula injection for one CSV cell (W10)."""
    if not isinstance(value, str) or not value:
        return value
    if value[0] in "=+-@\t\r" and not _CSV_PLAIN_NUMBER.match(value):
        return "'" + value
    return value


@router.get("/export.csv")
def export_csv(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    team_id: UUID | None = None,
    employee_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
):
    require_capability(current_admin, "reports.export")
    # The export shares the full filter contract with the report so its rows
    # match what is on screen (W9), and every cell is guarded against spreadsheet
    # formula injection (W10).
    rows = employee_report(
        current_admin,
        db,
        team_id=team_id,
        employee_id=employee_id,
        date_from=date_from,
        date_to=date_to,
    )["data"]
    fieldnames = [
        "employee_id",
        "name",
        "email",
        "active_seconds",
        "idle_seconds",
        "total_seconds",
    ]
    output = StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(
        {key: _csv_safe(row.get(key)) for key in fieldnames} for row in rows
    )
    return Response(content=output.getvalue(), media_type="text/csv")
