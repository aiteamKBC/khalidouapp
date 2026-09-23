from datetime import date, time
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_admin
from app.api.v1.admin_utils import apply_pagination, count_for, pagination_meta
from app.api.v1.team_auth import apply_employee_scope, ensure_employee_access
from app.core.exceptions import ApiError
from app.core.responses import success_response
from app.database.session import get_db
from app.models import AdminUser, Employee, ShiftRescheduleRequest
from app.services.audit import record_audit_log
from app.services.employee_archive import current_employee_clause
from app.services.shift_reschedules import (
    base_day_schedule,
    create_emergency_reschedule,
    expire_company_pending,
    require_shift_reschedule_reviewer,
    review_request,
    serialize_base_day,
    serialize_shift_reschedule,
)

router = APIRouter(prefix="/shift-reschedules", tags=["shift-reschedules"])


class ShiftRescheduleReview(BaseModel):
    status: Literal["approved", "rejected"]
    review_reason: str | None = Field(default=None, max_length=1000)


class EmergencyShiftRescheduleCreate(BaseModel):
    employee_id: UUID
    work_date: date
    requested_start: time
    requested_end: time
    reason: str = Field(min_length=3, max_length=1000)


def _audit_details(row: ShiftRescheduleRequest) -> dict:
    return {
        "work_date": row.work_date.isoformat(),
        "requested_start": row.requested_start.strftime("%H:%M"),
        "requested_end": row.requested_end.strftime("%H:%M"),
        "original_start": row.original_start.strftime("%H:%M"),
        "original_end": row.original_end.strftime("%H:%M"),
        "source": row.source,
        "review_reason": row.review_reason,
        "schedule_override_id": str(row.schedule_override_id)
        if row.schedule_override_id
        else None,
    }


@router.get("")
def list_shift_reschedules(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    status: str | None = None,
    employee_id: UUID | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
):
    require_shift_reschedule_reviewer(current_admin)
    if expire_company_pending(db, current_admin.company_id):
        db.commit()
    statement = (
        select(ShiftRescheduleRequest)
        .join(Employee, Employee.id == ShiftRescheduleRequest.employee_id)
        .where(ShiftRescheduleRequest.company_id == current_admin.company_id)
        .order_by(ShiftRescheduleRequest.created_at.desc())
    )
    statement = apply_employee_scope(
        statement, db, current_admin, ShiftRescheduleRequest.employee_id
    )
    if employee_id is not None:
        ensure_employee_access(db, current_admin, employee_id)
        statement = statement.where(ShiftRescheduleRequest.employee_id == employee_id)
    else:
        # Same convention as the other request queues: archived employees are
        # hidden by default and still reachable by filtering on the employee.
        statement = statement.where(current_employee_clause())
    if status:
        statement = statement.where(ShiftRescheduleRequest.status == status)
    total = count_for(db, statement)
    rows = db.scalars(
        apply_pagination(
            statement.options(
                selectinload(ShiftRescheduleRequest.employee),
                selectinload(ShiftRescheduleRequest.reviewed_by),
                selectinload(ShiftRescheduleRequest.created_by),
            ),
            page,
            page_size,
        )
    ).all()
    return success_response(
        data=[serialize_shift_reschedule(row) for row in rows],
        meta=pagination_meta(total, page, page_size),
    )


@router.get("/day")
def shift_reschedule_day(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    employee_id: UUID,
    work_date: date = Query(alias="date"),
):
    """The employee's normal shift for a date (used by the emergency form)."""
    require_shift_reschedule_reviewer(current_admin)
    employee = ensure_employee_access(db, current_admin, employee_id)
    base = base_day_schedule(db, employee, work_date)
    db.commit()
    return success_response(data=serialize_base_day(work_date, base))


@router.post("/emergency")
def create_emergency(
    payload: EmergencyShiftRescheduleCreate,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_shift_reschedule_reviewer(current_admin)
    employee = ensure_employee_access(db, current_admin, payload.employee_id)
    row = create_emergency_reschedule(
        db,
        admin=current_admin,
        employee=employee,
        work_date=payload.work_date,
        requested_start=payload.requested_start,
        requested_end=payload.requested_end,
        reason=payload.reason,
    )
    record_audit_log(
        db,
        current_admin,
        "created_emergency",
        "shift_reschedule_request",
        entity_id=row.id,
        entity_name=employee.name,
        details=_audit_details(row),
    )
    db.commit()
    db.refresh(row)
    return success_response(data=serialize_shift_reschedule(row))


@router.patch("/{request_id}")
def review_shift_reschedule(
    request_id: UUID,
    payload: ShiftRescheduleReview,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_shift_reschedule_reviewer(current_admin)
    row = db.scalar(
        select(ShiftRescheduleRequest)
        .where(
            ShiftRescheduleRequest.id == request_id,
            ShiftRescheduleRequest.company_id == current_admin.company_id,
        )
        .with_for_update()
    )
    if row is None:
        raise ApiError("SHIFT_RESCHEDULE_NOT_FOUND", "Shift reschedule was not found.", 404)
    employee = ensure_employee_access(db, current_admin, row.employee_id)
    review_request(
        db,
        admin=current_admin,
        row=row,
        status=payload.status,
        review_reason=payload.review_reason,
    )
    record_audit_log(
        db,
        current_admin,
        payload.status,
        "shift_reschedule_request",
        entity_id=row.id,
        entity_name=employee.name,
        details=_audit_details(row),
    )
    db.commit()
    db.refresh(row)
    return success_response(data=serialize_shift_reschedule(row))
