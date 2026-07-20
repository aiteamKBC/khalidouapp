from typing import Annotated
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

import jwt
from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ApiError
from app.core.security import decode_device_token, decode_jwt_token, hash_token
from app.database.session import get_db
from app.models import AdminUser, Device, DeviceToken, Employee


@dataclass(frozen=True)
class DeviceAuthContext:
    device: Device
    token_record: DeviceToken


def get_bearer_token(authorization: Annotated[str | None, Header()] = None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise ApiError("UNAUTHORIZED", "Missing bearer token.", 401)
    return authorization.split(" ", 1)[1].strip()


def get_current_admin(
    token: Annotated[str, Depends(get_bearer_token)],
    db: Annotated[Session, Depends(get_db)],
) -> AdminUser:
    try:
        payload = decode_jwt_token(token)
    except jwt.PyJWTError:
        raise ApiError("UNAUTHORIZED", "Invalid or expired access token.", 401) from None

    if payload.get("type") != "access":
        raise ApiError("UNAUTHORIZED", "Invalid token type.", 401)

    admin_id = UUID(str(payload["sub"]))
    company_id = UUID(str(payload["company_id"]))
    admin = db.scalar(
        select(AdminUser).where(
            AdminUser.id == admin_id,
            AdminUser.company_id == company_id,
            AdminUser.status == "active",
        )
    )
    if admin is None:
        raise ApiError("UNAUTHORIZED", "Admin user is not active.", 401)
    return admin


def get_current_device(
    token: Annotated[str, Depends(get_bearer_token)],
    db: Annotated[Session, Depends(get_db)],
) -> DeviceAuthContext:
    try:
        payload = decode_device_token(token)
    except jwt.PyJWTError:
        raise ApiError("UNAUTHORIZED", "Invalid or expired device token.", 401) from None

    if payload.get("type") != "device":
        raise ApiError("UNAUTHORIZED", "Invalid token type.", 401)

    device_id = UUID(str(payload["sub"]))
    company_id = UUID(str(payload["company_id"]))

    token_record = db.scalar(
        select(DeviceToken).where(
            DeviceToken.token_hash == hash_token(token),
            DeviceToken.company_id == company_id,
            DeviceToken.revoked_at.is_(None),
        )
    )
    if token_record is None:
        raise ApiError("UNAUTHORIZED", "Device token has been revoked.", 401)
    if token_record.expires_at is not None and token_record.expires_at <= datetime.now(UTC):
        raise ApiError("UNAUTHORIZED", "Device token has expired.", 401)

    device = db.scalar(
        select(Device).where(
            Device.id == device_id,
            Device.company_id == company_id,
            Device.status == "active",
            Device.revoked_at.is_(None),
        )
    )
    if device is None:
        raise ApiError("UNAUTHORIZED", "Device is not active.", 401)

    employee = db.scalar(
        select(Employee).where(
            Employee.id == device.employee_id,
            Employee.company_id == company_id,
            Employee.status == "active",
        )
    )
    if employee is None:
        raise ApiError("UNAUTHORIZED", "Employee account is not active.", 401)

    return DeviceAuthContext(device=device, token_record=token_record)


def get_current_employee(
    token: Annotated[str, Depends(get_bearer_token)],
    db: Annotated[Session, Depends(get_db)],
) -> Employee:
    try:
        payload = decode_jwt_token(token)
    except jwt.PyJWTError:
        raise ApiError("UNAUTHORIZED", "Invalid or expired employee access token.", 401) from None

    if payload.get("type") != "employee_access":
        raise ApiError("UNAUTHORIZED", "Invalid employee token type.", 401)

    employee = db.scalar(
        select(Employee).where(
            Employee.id == UUID(str(payload["sub"])),
            Employee.company_id == UUID(str(payload["company_id"])),
            Employee.status == "active",
        )
    )
    if employee is None:
        raise ApiError("UNAUTHORIZED", "Employee account is not active.", 401)
    return employee
