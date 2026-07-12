from datetime import date
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ApiError
from app.models import Device, TimeAdjustmentRequest
from app.services.session_tracking import get_current_session


def serialize_time_adjustment_request(row: TimeAdjustmentRequest) -> dict:
    return {
        "id": str(row.id),
        "company_id": str(row.company_id),
        "employee_id": str(row.employee_id),
        "employee_name": row.employee.name if row.employee else "",
        "device_id": str(row.device_id) if row.device_id else None,
        "work_session_id": str(row.work_session_id) if row.work_session_id else None,
        "requested_date": row.requested_date.isoformat(),
        "requested_seconds": row.requested_seconds,
        "requested_minutes": round(row.requested_seconds / 60),
        "approved_seconds": row.approved_seconds,
        "approved_minutes": round(row.approved_seconds / 60) if row.approved_seconds else None,
        "reason": row.reason,
        "status": row.status,
        "reviewed_by_admin_user_id": str(row.reviewed_by_admin_user_id) if row.reviewed_by_admin_user_id else None,
        "reviewed_by_name": row.reviewed_by.name if row.reviewed_by else None,
        "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
        "admin_note": row.admin_note,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }


def create_employee_time_adjustment_request(
    db: Session,
    *,
    device: Device,
    requested_date: date,
    requested_minutes: int,
    reason: str,
) -> TimeAdjustmentRequest:
    current_session = get_current_session(db, device)
    row = TimeAdjustmentRequest(
        company_id=device.company_id,
        employee_id=device.employee_id,
        device_id=device.id,
        work_session_id=current_session.id if current_session else None,
        requested_date=requested_date,
        requested_seconds=requested_minutes * 60,
        reason=reason.strip(),
        status="pending",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_time_adjustment_or_404(
    db: Session,
    company_id: UUID,
    request_id: UUID,
) -> TimeAdjustmentRequest:
    row = db.scalar(
        select(TimeAdjustmentRequest).where(
            TimeAdjustmentRequest.id == request_id,
            TimeAdjustmentRequest.company_id == company_id,
        )
    )
    if row is None:
        raise ApiError("TIME_ADJUSTMENT_NOT_FOUND", "Time adjustment request was not found.", 404)
    return row
