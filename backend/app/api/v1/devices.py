from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.api.v1.admin_utils import apply_pagination, count_for, pagination_meta, serialize_device
from app.api.v1.team_auth import apply_employee_scope, ensure_employee_access
from app.core.exceptions import ApiError
from app.core.responses import success_response
from app.database.session import get_db
from app.models import AdminUser, Device, DeviceSignInAttempt, DeviceToken, Employee, WorkSession
from app.schemas.admin import DeviceReassignRequest, DeviceUpdate
from app.services.audit import record_audit_log
from app.services.session_tracking import close_open_session

router = APIRouter(prefix="/devices", tags=["devices"])


def get_device_or_404(db: Session, company_id: UUID, device_id: UUID) -> Device:
    device = db.scalar(
        select(Device).where(Device.id == device_id, Device.company_id == company_id)
    )
    if device is None:
        raise ApiError("DEVICE_NOT_FOUND", "Device was not found.", 404)
    return device


def get_accessible_device_or_404(db: Session, current_admin: AdminUser, device_id: UUID) -> Device:
    device = get_device_or_404(db, current_admin.company_id, device_id)
    ensure_employee_access(db, current_admin, device.employee_id)
    return device


@router.get("")
def list_devices(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    status: str | None = None,
    employee_id: UUID | None = None,
    team_id: UUID | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
):
    statement = select(Device).where(Device.company_id == current_admin.company_id)
    statement = apply_employee_scope(statement, db, current_admin, Device.employee_id, team_id)
    if status:
        statement = statement.where(Device.status == status)
    if employee_id:
        ensure_employee_access(db, current_admin, employee_id, team_id)
        statement = statement.where(Device.employee_id == employee_id)
    statement = statement.order_by(Device.registered_at.desc())
    total = count_for(db, statement)
    devices = db.scalars(apply_pagination(statement, page, page_size)).all()
    return success_response(
        data=[serialize_device(device) for device in devices],
        meta=pagination_meta(total, page, page_size),
    )


def serialize_sign_in_attempt(
    attempt: DeviceSignInAttempt, device: Device, names: dict[UUID, str]
) -> dict:
    return {
        "id": str(attempt.id),
        "device_id": str(device.id),
        "device_name": device.device_name,
        "device_status": device.status,
        "employee_id": str(attempt.employee_id),
        "employee_name": names.get(attempt.employee_id),
        "owner_employee_id": str(attempt.owner_employee_id),
        "owner_employee_name": names.get(attempt.owner_employee_id),
        # The computer may have been reassigned since; this is who has it now.
        "current_owner_employee_id": str(device.employee_id),
        "first_attempted_at": attempt.first_attempted_at.isoformat(),
        "last_attempted_at": attempt.last_attempted_at.isoformat(),
        "attempt_count": attempt.attempt_count,
        "ip_address": attempt.ip_address,
        "windows_username": attempt.windows_username,
        "resolved_at": attempt.resolved_at.isoformat() if attempt.resolved_at else None,
        "resolution": attempt.resolution,
    }


@router.get("/sign-in-attempts")
def list_sign_in_attempts(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    include_resolved: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
):
    """Who tried to sign in on a computer registered to someone else."""
    from app.api.v1.team_auth import require_general_admin

    require_general_admin(current_admin)
    statement = (
        select(DeviceSignInAttempt, Device)
        .join(Device, Device.id == DeviceSignInAttempt.device_id)
        .where(DeviceSignInAttempt.company_id == current_admin.company_id)
    )
    if not include_resolved:
        statement = statement.where(DeviceSignInAttempt.resolved_at.is_(None))
    rows = db.execute(
        statement.order_by(DeviceSignInAttempt.last_attempted_at.desc()).limit(limit)
    ).all()
    employee_ids = {
        employee_id
        for attempt, _device in rows
        for employee_id in (attempt.employee_id, attempt.owner_employee_id)
    }
    names = (
        dict(
            db.execute(
                select(Employee.id, Employee.name).where(Employee.id.in_(employee_ids))
            ).all()
        )
        if employee_ids
        else {}
    )
    return success_response(
        data=[serialize_sign_in_attempt(attempt, device, names) for attempt, device in rows]
    )


@router.post("/sign-in-attempts/{attempt_id}/dismiss")
def dismiss_sign_in_attempt(
    attempt_id: UUID,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    from app.api.v1.team_auth import require_general_admin

    require_general_admin(current_admin)
    attempt = db.scalar(
        select(DeviceSignInAttempt).where(
            DeviceSignInAttempt.id == attempt_id,
            DeviceSignInAttempt.company_id == current_admin.company_id,
        )
    )
    if attempt is None:
        raise ApiError("SIGN_IN_ATTEMPT_NOT_FOUND", "Sign-in attempt was not found.", 404)
    if attempt.resolved_at is None:
        attempt.resolved_at = datetime.now(UTC)
        attempt.resolution = "dismissed"
        attempt.resolved_by_admin_user_id = current_admin.id
        db.commit()
        record_audit_log(
            db,
            current_admin,
            "dismissed",
            "device_sign_in_attempt",
            entity_id=attempt.id,
            details={"device_id": str(attempt.device_id), "employee_id": str(attempt.employee_id)},
            request=request,
        )
        db.commit()
    return success_response(data={"dismissed": True})


@router.get("/{device_id}")
def get_device(
    device_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    return success_response(
        data=serialize_device(get_accessible_device_or_404(db, current_admin, device_id))
    )


@router.patch("/{device_id}")
def update_device(
    device_id: UUID,
    payload: DeviceUpdate,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    from app.api.v1.team_auth import require_general_admin

    require_general_admin(current_admin)
    device = get_device_or_404(db, current_admin.company_id, device_id)
    if payload.status is not None:
        if payload.status == "revoked":
            raise ApiError(
                "USE_DEVICE_REVOKE",
                "Use the revoke action to revoke a device and invalidate its tokens.",
                400,
            )
        device.status = payload.status
        if payload.status == "active":
            device.revoked_at = None
    db.add(device)
    db.commit()
    db.refresh(device)
    record_audit_log(
        db,
        current_admin,
        "updated",
        "device",
        entity_id=device.id,
        entity_name=device.device_name,
        details=payload.model_dump(exclude_unset=True),
        request=request,
    )
    db.commit()
    return success_response(data=serialize_device(device))


@router.post("/{device_id}/reactivate")
def reactivate_device(
    device_id: UUID,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    from app.api.v1.team_auth import require_general_admin

    require_general_admin(current_admin)
    device = get_device_or_404(db, current_admin.company_id, device_id)
    device.status = "active"
    device.revoked_at = None
    db.add(device)
    db.commit()
    db.refresh(device)
    record_audit_log(
        db,
        current_admin,
        "reactivated",
        "device",
        entity_id=device.id,
        entity_name=device.device_name,
        details={"old_tokens_remain_revoked": True},
        request=request,
    )
    db.commit()
    return success_response(data=serialize_device(device))


@router.post("/{device_id}/reassign")
def reassign_device(
    device_id: UUID,
    payload: DeviceReassignRequest,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Give a computer to another employee.

    The previous owner's session on it ends and its sign-in is revoked, so the
    new employee signs in on it afresh. Work already recorded stays with the
    previous owner.
    """
    from app.api.v1.team_auth import require_general_admin

    require_general_admin(current_admin)
    device = get_device_or_404(db, current_admin.company_id, device_id)
    new_employee = db.scalar(
        select(Employee).where(
            Employee.id == payload.employee_id,
            Employee.company_id == current_admin.company_id,
        )
    )
    if new_employee is None:
        raise ApiError("EMPLOYEE_NOT_FOUND", "Employee was not found.", 404)
    ensure_employee_access(db, current_admin, new_employee.id)
    if new_employee.status != "active":
        raise ApiError("EMPLOYEE_NOT_ACTIVE", "Only an active employee can receive a device.", 400)
    if device.employee_id == new_employee.id:
        raise ApiError(
            "DEVICE_ALREADY_ASSIGNED", "This device already belongs to that employee.", 400
        )

    now = datetime.now(UTC)
    previous_employee_id = device.employee_id
    open_sessions = db.scalars(
        select(WorkSession).where(
            WorkSession.device_id == device.id,
            WorkSession.ended_at.is_(None),
        )
    ).all()
    for session in open_sessions:
        close_open_session(
            db,
            device=device,
            session=session,
            ended_at=now,
            reason="Device reassigned to another employee",
        )
    db.execute(
        update(DeviceToken)
        .where(DeviceToken.device_id == device.id, DeviceToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    device.employee_id = new_employee.id
    device.status = "active"
    device.revoked_at = None
    for attempt in db.scalars(
        select(DeviceSignInAttempt).where(
            DeviceSignInAttempt.device_id == device.id,
            DeviceSignInAttempt.resolved_at.is_(None),
        )
    ).all():
        attempt.resolved_at = now
        attempt.resolution = (
            "reassigned" if attempt.employee_id == new_employee.id else "dismissed"
        )
        attempt.resolved_by_admin_user_id = current_admin.id
    db.commit()
    db.refresh(device)
    record_audit_log(
        db,
        current_admin,
        "reassigned",
        "device",
        entity_id=device.id,
        entity_name=device.device_name,
        details={
            "previous_employee_id": str(previous_employee_id),
            "employee_id": str(new_employee.id),
            "employee_name": new_employee.name,
            "closed_sessions": len(open_sessions),
        },
        request=request,
    )
    db.commit()
    return success_response(data=serialize_device(device))


@router.post("/{device_id}/revoke")
def revoke_device(
    device_id: UUID,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    from app.api.v1.team_auth import require_general_admin

    require_general_admin(current_admin)
    device = get_device_or_404(db, current_admin.company_id, device_id)
    revoked_at = datetime.now(UTC)
    device.status = "revoked"
    device.revoked_at = revoked_at
    db.add(device)
    # Revoke the sign-in tokens too. Only the device row used to change, so
    # Reactivate made the old tokens valid again; now the employee has to
    # sign in on the device again after it is reactivated.
    db.execute(
        update(DeviceToken)
        .where(DeviceToken.device_id == device.id, DeviceToken.revoked_at.is_(None))
        .values(revoked_at=revoked_at)
    )
    db.commit()
    record_audit_log(
        db,
        current_admin,
        "revoked",
        "device",
        entity_id=device.id,
        entity_name=device.device_name,
        request=request,
    )
    db.commit()
    return success_response(data={"revoked": True})
