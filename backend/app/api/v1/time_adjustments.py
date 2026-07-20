from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.api.v1.admin_utils import apply_pagination, count_for, pagination_meta
from app.api.v1.team_auth import apply_employee_scope, ensure_employee_access
from app.core.responses import success_response
from app.database.session import get_db
from app.models import AdminUser, Employee, TimeAdjustmentRequest
from app.schemas.admin import TimeAdjustmentReview
from app.services.audit import record_audit_log
from app.services.permissions import require_capability
from app.services.time_adjustments import get_time_adjustment_or_404, serialize_time_adjustment_request

router = APIRouter(prefix="/time-adjustment-requests", tags=["time-adjustment-requests"])


@router.get("")
def list_time_adjustment_requests(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    employee_id: UUID | None = None,
    team_id: UUID | None = None,
    status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
):
    statement = (
        select(TimeAdjustmentRequest)
        .join(Employee, Employee.id == TimeAdjustmentRequest.employee_id)
        .where(TimeAdjustmentRequest.company_id == current_admin.company_id)
        .order_by(TimeAdjustmentRequest.created_at.desc())
    )
    statement = apply_employee_scope(statement, db, current_admin, TimeAdjustmentRequest.employee_id, team_id)
    if employee_id:
        ensure_employee_access(db, current_admin, employee_id, team_id)
        statement = statement.where(TimeAdjustmentRequest.employee_id == employee_id)
    if status:
        statement = statement.where(TimeAdjustmentRequest.status == status)
    total = count_for(db, statement)
    rows = db.scalars(apply_pagination(statement, page, page_size)).all()
    return success_response(
        data=[serialize_time_adjustment_request(row) for row in rows],
        meta=pagination_meta(total, page, page_size),
    )


@router.patch("/{request_id}")
def review_time_adjustment_request(
    request_id: UUID,
    payload: TimeAdjustmentReview,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_capability(current_admin, "time_requests.manage")
    row = get_time_adjustment_or_404(db, current_admin.company_id, request_id)
    ensure_employee_access(db, current_admin, row.employee_id)
    row.status = payload.status
    row.approved_seconds = (
        (payload.approved_minutes * 60)
        if payload.status == "approved" and payload.approved_minutes is not None
        else row.requested_seconds
        if payload.status == "approved"
        else None
    )
    row.admin_note = payload.admin_note
    row.reviewed_by_admin_user_id = current_admin.id
    row.reviewed_at = datetime.now(UTC)
    db.add(row)
    db.commit()
    db.refresh(row)
    record_audit_log(
        db,
        current_admin,
        payload.status,
        "time_adjustment_request",
        entity_id=row.id,
        entity_name=row.employee.email if row.employee else str(row.employee_id),
        details={
            "requested_minutes": round(row.requested_seconds / 60),
            "approved_minutes": round(row.approved_seconds / 60) if row.approved_seconds else None,
        },
        request=request,
    )
    db.commit()
    return success_response(data=serialize_time_adjustment_request(row))
