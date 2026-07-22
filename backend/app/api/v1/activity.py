from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.api.v1.admin_utils import (
    apply_pagination,
    count_for,
    pagination_meta,
    serialize_activity_event,
)
from app.api.v1.team_auth import apply_employee_scope, ensure_employee_access
from app.core.responses import success_response
from app.database.session import get_db
from app.models import ActivityEvent, AdminUser
from app.services.activity_timeline import build_workday_timeline

router = APIRouter(prefix="/activity", tags=["activity"])


@router.get("/timeline")
def employee_timeline(
    employee_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    day: date | None = None,
    team_id: UUID | None = None,
):
    employee = ensure_employee_access(db, current_admin, employee_id, team_id)
    return success_response(
        data=build_workday_timeline(
            db,
            company_id=current_admin.company_id,
            employee_id=employee_id,
            timezone_name=employee.timezone,
            target_date=day,
        )
    )


@router.get("")
def list_activity(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    employee_id: UUID | None = None,
    team_id: UUID | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
):
    statement = select(ActivityEvent).where(ActivityEvent.company_id == current_admin.company_id)
    statement = apply_employee_scope(
        statement, db, current_admin, ActivityEvent.employee_id, team_id
    )
    if employee_id:
        ensure_employee_access(db, current_admin, employee_id, team_id)
        statement = statement.where(ActivityEvent.employee_id == employee_id)
    statement = statement.order_by(ActivityEvent.event_timestamp.desc())
    total = count_for(db, statement)
    events = db.scalars(apply_pagination(statement, page, page_size)).all()
    return success_response(
        data=[serialize_activity_event(event) for event in events],
        meta=pagination_meta(total, page, page_size),
    )
