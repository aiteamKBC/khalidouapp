from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.api.v1.admin_utils import apply_pagination, count_for, pagination_meta, serialize_device
from app.api.v1.team_auth import apply_employee_scope, ensure_employee_access
from app.core.exceptions import ApiError
from app.core.responses import success_response
from app.database.session import get_db
from app.models import AdminUser, Device
from app.schemas.admin import DeviceUpdate
from app.services.audit import record_audit_log

router = APIRouter(prefix="/devices", tags=["devices"])


def get_device_or_404(db: Session, company_id: UUID, device_id: UUID) -> Device:
    device = db.scalar(select(Device).where(Device.id == device_id, Device.company_id == company_id))
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
    return success_response(data=[serialize_device(device) for device in devices], meta=pagination_meta(total, page, page_size))


@router.get("/{device_id}")
def get_device(device_id: UUID, current_admin: Annotated[AdminUser, Depends(get_current_admin)], db: Annotated[Session, Depends(get_db)]):
    return success_response(data=serialize_device(get_accessible_device_or_404(db, current_admin, device_id)))


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
        device.status = payload.status
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


@router.post("/{device_id}/revoke")
def revoke_device(device_id: UUID, request: Request, current_admin: Annotated[AdminUser, Depends(get_current_admin)], db: Annotated[Session, Depends(get_db)]):
    from app.api.v1.team_auth import require_general_admin

    require_general_admin(current_admin)
    device = get_device_or_404(db, current_admin.company_id, device_id)
    device.status = "revoked"
    device.revoked_at = datetime.now(UTC)
    db.add(device)
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
