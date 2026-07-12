from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.api.v1.admin_utils import apply_pagination, count_for, day_bounds, pagination_meta, serialize_work_session
from app.api.v1.team_auth import (
    accessible_team_ids_statement,
    apply_employee_scope,
    ensure_employee_access,
    ensure_team_access,
    is_general_admin,
)
from app.core.responses import success_response
from app.database.session import get_db
from app.models import AdminUser, Screenshot, WorkSession
from app.services.projects import get_project_or_404, get_task_or_404

router = APIRouter(prefix="/sessions", tags=["sessions"])


def serialize_session_with_counts(db: Session, session: WorkSession) -> dict:
    data = serialize_work_session(session)
    data["screenshot_count"] = db.scalar(
        select(func.count()).where(Screenshot.session_id == session.id, Screenshot.deleted_at.is_(None))
    ) or 0
    return data


@router.get("")
def list_sessions(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    employee_id: UUID | None = None,
    team_id: UUID | None = None,
    project_id: UUID | None = None,
    task_id: UUID | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
):
    statement = select(WorkSession).where(WorkSession.company_id == current_admin.company_id)
    statement = apply_employee_scope(statement, db, current_admin, WorkSession.employee_id, team_id)
    if team_id:
        ensure_team_access(db, current_admin, team_id)
        statement = statement.where(or_(WorkSession.team_id.is_(None), WorkSession.team_id == team_id))
    elif not is_general_admin(current_admin):
        statement = statement.where(
            or_(
                WorkSession.team_id.is_(None),
                WorkSession.team_id.in_(accessible_team_ids_statement(current_admin)),
            )
        )
    if employee_id:
        ensure_employee_access(db, current_admin, employee_id, team_id)
        statement = statement.where(WorkSession.employee_id == employee_id)
    if project_id:
        get_project_or_404(db, current_admin, project_id)
        statement = statement.where(WorkSession.project_id == project_id)
    if task_id:
        get_task_or_404(db, current_admin, task_id)
        statement = statement.where(WorkSession.task_id == task_id)
    if start_date:
        statement = statement.where(WorkSession.started_at >= day_bounds(start_date)[0])
    if end_date:
        statement = statement.where(WorkSession.started_at <= day_bounds(end_date)[1])
    statement = statement.order_by(WorkSession.started_at.desc())
    total = count_for(db, statement)
    sessions = db.scalars(apply_pagination(statement, page, page_size)).all()
    return success_response(
        data=[serialize_session_with_counts(db, session) for session in sessions],
        meta=pagination_meta(total, page, page_size),
    )
