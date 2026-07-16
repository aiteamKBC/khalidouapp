from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.api.v1.admin_utils import apply_pagination, count_for, pagination_meta
from app.api.v1.team_auth import apply_employee_scope, ensure_employee_access
from app.core.exceptions import ApiError
from app.core.responses import success_response
from app.database.session import get_db
from app.models import AdminUser, Employee, LeaveBalance, LeaveRequest
from app.schemas.admin import LeaveBalanceUpdate, LeaveRequestReview, ManualLeaveCreate
from app.services.leave_management import requested_workdays, serialize_balance, serialize_leave_request
from app.services.work_profiles import get_or_create_work_profile
from app.services.permissions import require_capability

router = APIRouter(prefix="/leave-requests", tags=["leave-requests"])


@router.post("/manual")
def record_manual_leave(
    payload: ManualLeaveCreate,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_capability(current_admin, "leave_requests.manage")
    employee = ensure_employee_access(db, current_admin, payload.employee_id)
    if payload.end_date < payload.start_date:
        raise ApiError("INVALID_LEAVE_DATES", "End date must be on or after start date.", 400)
    if payload.start_date.year != payload.end_date.year:
        raise ApiError("LEAVE_YEAR_BOUNDARY", "A holiday entry must stay within one calendar year.", 400)
    profile = get_or_create_work_profile(db, employee)
    days = requested_workdays(payload.start_date, payload.end_date, profile.working_days)
    if days < 1:
        raise ApiError("NO_WORKDAYS", "The selected period contains no employee working days.", 400)
    overlap = db.scalar(
        select(LeaveRequest.id).where(
            LeaveRequest.employee_id == employee.id,
            LeaveRequest.status.in_(["pending", "approved"]),
            LeaveRequest.start_date <= payload.end_date,
            LeaveRequest.end_date >= payload.start_date,
        )
    )
    if overlap:
        raise ApiError("OVERLAPPING_LEAVE_REQUEST", "This employee already has leave in this period.", 409)
    if payload.leave_type == "annual":
        balance = serialize_balance(db, employee, payload.start_date.year)
        if balance["remaining_days"] < days:
            raise ApiError("INSUFFICIENT_LEAVE_CREDIT", "The employee does not have enough holiday credit.", 409)
    row = LeaveRequest(
        company_id=current_admin.company_id,
        employee_id=employee.id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        requested_days=days,
        leave_type=payload.leave_type,
        reason=payload.reason.strip() if payload.reason else "Recorded offline by HR/Admin",
        status="approved",
        reviewed_by_admin_user_id=current_admin.id,
        reviewed_at=datetime.now(UTC),
        review_note="Recorded directly by HR/Admin",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return success_response(data=serialize_leave_request(row))


@router.get("")
def list_leave_requests(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    employee_id: UUID | None = None,
    status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=200),
):
    require_capability(current_admin, "leave_requests.view")
    statement = (
        select(LeaveRequest)
        .join(Employee, Employee.id == LeaveRequest.employee_id)
        .where(LeaveRequest.company_id == current_admin.company_id)
        .order_by(LeaveRequest.created_at.desc())
    )
    statement = apply_employee_scope(statement, db, current_admin, LeaveRequest.employee_id)
    if employee_id:
        ensure_employee_access(db, current_admin, employee_id)
        statement = statement.where(LeaveRequest.employee_id == employee_id)
    if status:
        statement = statement.where(LeaveRequest.status == status)
    total = count_for(db, statement)
    rows = db.scalars(apply_pagination(statement, page, page_size)).all()
    return success_response(
        data=[serialize_leave_request(row) for row in rows],
        meta=pagination_meta(total, page, page_size),
    )


@router.patch("/{request_id}")
def review_leave_request(
    request_id: UUID,
    payload: LeaveRequestReview,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_capability(current_admin, "leave_requests.manage")
    row = db.scalar(
        select(LeaveRequest).where(
            LeaveRequest.id == request_id,
            LeaveRequest.company_id == current_admin.company_id,
        )
    )
    if row is None:
        raise ApiError("LEAVE_REQUEST_NOT_FOUND", "Holiday request was not found.", 404)
    ensure_employee_access(db, current_admin, row.employee_id)
    if row.status != "pending":
        raise ApiError("LEAVE_REQUEST_REVIEWED", "This holiday request was already reviewed.", 409)
    if payload.status == "approved" and row.leave_type == "annual":
        balance = serialize_balance(db, row.employee, row.start_date.year)
        if balance["remaining_days"] < row.requested_days:
            raise ApiError("INSUFFICIENT_LEAVE_CREDIT", "The employee does not have enough holiday credit.", 409)
    row.status = payload.status
    row.review_note = payload.review_note
    row.reviewed_by_admin_user_id = current_admin.id
    row.reviewed_at = datetime.now(UTC)
    db.add(row)
    db.commit()
    db.refresh(row)
    return success_response(data=serialize_leave_request(row))


@router.get("/balances/{employee_id}")
def get_leave_balance(
    employee_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    year: int = Query(default=datetime.now(UTC).year, ge=2000, le=2200),
):
    require_capability(current_admin, "leave_requests.view")
    employee = ensure_employee_access(db, current_admin, employee_id)
    return success_response(data=serialize_balance(db, employee, year))


@router.put("/balances/{employee_id}")
def update_leave_balance(
    employee_id: UUID,
    payload: LeaveBalanceUpdate,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    year: int = Query(default=datetime.now(UTC).year, ge=2000, le=2200),
):
    require_capability(current_admin, "leave_requests.manage")
    employee = ensure_employee_access(db, current_admin, employee_id)
    serialize_balance(db, employee, year)
    balance = db.scalar(select(LeaveBalance).where(LeaveBalance.employee_id == employee_id, LeaveBalance.year == year))
    balance.credit_days = payload.credit_days
    balance.manually_adjusted = True
    db.add(balance)
    db.commit()
    return success_response(data=serialize_balance(db, employee, year))
