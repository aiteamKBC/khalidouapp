from datetime import UTC, date, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.api.v1.admin_utils import apply_pagination, count_for, pagination_meta
from app.api.v1.team_auth import apply_employee_scope, ensure_employee_access
from app.core.exceptions import ApiError
from app.core.responses import success_response
from app.database.session import get_db
from app.models import AdminUser, Employee, TimeAdjustmentRequest
from app.schemas.admin import TimeAdjustmentBulkReview, TimeAdjustmentReview
from app.services.audit import record_audit_log
from app.services.attendance import refresh_daily_attendance_range
from app.services.permissions import is_super_admin, require_capability
from app.services.time_adjustments import (
    get_time_adjustment_or_404,
    serialize_time_adjustment_request,
)

router = APIRouter(prefix="/time-adjustment-requests", tags=["time-adjustment-requests"])


@router.get("")
def list_time_adjustment_requests(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    employee_id: UUID | None = None,
    team_id: UUID | None = None,
    status: str | None = None,
    request_group: Literal["time", "early_leave"] | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
):
    require_capability(
        current_admin,
        "leave_requests.view" if request_group == "early_leave" else "time_requests.view",
    )
    statement = (
        select(TimeAdjustmentRequest)
        .join(Employee, Employee.id == TimeAdjustmentRequest.employee_id)
        .where(TimeAdjustmentRequest.company_id == current_admin.company_id)
        .order_by(TimeAdjustmentRequest.created_at.desc())
    )
    statement = apply_employee_scope(
        statement, db, current_admin, TimeAdjustmentRequest.employee_id, team_id
    )
    if employee_id:
        ensure_employee_access(db, current_admin, employee_id, team_id)
        statement = statement.where(TimeAdjustmentRequest.employee_id == employee_id)
    if status:
        statement = statement.where(TimeAdjustmentRequest.status == status)
    if request_group == "early_leave":
        statement = statement.where(TimeAdjustmentRequest.request_type == "early_leave")
    elif request_group == "time":
        statement = statement.where(TimeAdjustmentRequest.request_type != "early_leave")
    total = count_for(db, statement)
    rows = db.scalars(apply_pagination(statement, page, page_size)).all()
    return success_response(
        data=[serialize_time_adjustment_request(row) for row in rows],
        meta=pagination_meta(total, page, page_size),
    )


@router.post("/bulk-review")
def bulk_review_time_adjustment_requests(
    payload: TimeAdjustmentBulkReview,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    capability = (
        "leave_requests.manage"
        if payload.request_group == "early_leave"
        else "time_requests.manage"
    )
    require_capability(current_admin, capability)

    statement = (
        select(TimeAdjustmentRequest)
        .join(Employee, Employee.id == TimeAdjustmentRequest.employee_id)
        .where(
            TimeAdjustmentRequest.company_id == current_admin.company_id,
            TimeAdjustmentRequest.status == "pending",
        )
        .order_by(TimeAdjustmentRequest.created_at)
    )
    statement = apply_employee_scope(
        statement,
        db,
        current_admin,
        TimeAdjustmentRequest.employee_id,
        payload.team_id,
    )
    if payload.request_group == "early_leave":
        statement = statement.where(TimeAdjustmentRequest.request_type == "early_leave")
    else:
        statement = statement.where(TimeAdjustmentRequest.request_type != "early_leave")
    if payload.employee_id is not None:
        ensure_employee_access(db, current_admin, payload.employee_id, payload.team_id)
        statement = statement.where(
            TimeAdjustmentRequest.employee_id == payload.employee_id
        )
    if not payload.all_filtered:
        statement = statement.where(TimeAdjustmentRequest.id.in_(payload.request_ids))

    rows = db.scalars(statement.with_for_update()).all()
    selected_count = (
        len(rows) if payload.all_filtered else len(set(payload.request_ids))
    )
    skipped_self_review = 0
    if current_admin.employee_id is not None and not is_super_admin(current_admin):
        eligible_rows = []
        for row in rows:
            if row.employee_id == current_admin.employee_id:
                skipped_self_review += 1
            else:
                eligible_rows.append(row)
        rows = eligible_rows

    reviewed_at = datetime.now(UTC)
    employee_ids = {row.employee_id for row in rows}
    employees = {
        employee.id: employee
        for employee in db.scalars(
            select(Employee).where(
                Employee.company_id == current_admin.company_id,
                Employee.id.in_(employee_ids),
            )
        ).all()
    }
    affected_days: set[tuple[UUID, date]] = set()
    reviewed_ids: list[str] = []
    for row in rows:
        row.status = payload.status
        row.approved_seconds = (
            row.requested_seconds if payload.status == "approved" else None
        )
        row.admin_note = payload.admin_note
        row.reviewed_by_admin_user_id = current_admin.id
        row.reviewed_at = reviewed_at
        db.add(row)
        reviewed_ids.append(str(row.id))
        affected_days.add((row.employee_id, row.requested_date))
        employee = employees[row.employee_id]
        record_audit_log(
            db,
            current_admin,
            payload.status,
            "time_adjustment_request",
            entity_id=row.id,
            entity_name=employee.email,
            details={
                "requested_minutes": round(row.requested_seconds / 60),
                "approved_minutes": (
                    round(row.requested_seconds / 60)
                    if payload.status == "approved"
                    else None
                ),
                "bulk_review": True,
            },
            request=request,
        )

    db.flush()
    for employee_id, work_date in affected_days:
        refresh_daily_attendance_range(
            db,
            employee=employees[employee_id],
            start_date=work_date,
            end_date=work_date,
            now=reviewed_at,
        )
    db.commit()
    reviewed_count = len(reviewed_ids)
    return success_response(
        data={
            "reviewed_count": reviewed_count,
            "skipped_count": max(0, selected_count - reviewed_count),
            "skipped_self_review_count": skipped_self_review,
            "reviewed_ids": reviewed_ids,
            "status": payload.status,
        }
    )


@router.patch("/{request_id}")
def review_time_adjustment_request(
    request_id: UUID,
    payload: TimeAdjustmentReview,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    row = get_time_adjustment_or_404(db, current_admin.company_id, request_id)
    require_capability(
        current_admin,
        "leave_requests.manage"
        if row.request_type == "early_leave"
        else "time_requests.manage",
    )
    employee = ensure_employee_access(db, current_admin, row.employee_id)
    if row.status != "pending":
        raise ApiError(
            "TIME_REQUEST_REVIEWED",
            "This time request was already reviewed.",
            409,
        )
    if current_admin.employee_id == row.employee_id and not is_super_admin(current_admin):
        raise ApiError(
            "SELF_REVIEW_FORBIDDEN",
            "You cannot review your own time request.",
            403,
        )
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
    db.flush()
    refresh_daily_attendance_range(
        db,
        employee=employee,
        start_date=row.requested_date,
        end_date=row.requested_date,
        now=row.reviewed_at,
    )
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
    db.refresh(row)
    return success_response(data=serialize_time_adjustment_request(row))
