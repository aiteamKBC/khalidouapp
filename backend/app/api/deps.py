from typing import Annotated
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

import jwt
from fastapi import Depends, Header
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import ApiError
from app.core.security import decode_device_token, decode_jwt_token, hash_token
from app.database.session import get_db
from app.models import AdminUser, Device, DeviceToken, Employee

DEVICE_REENROLLMENT_REQUIRED = "Device token identity does not match this device."


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

    try:
        admin_id = UUID(str(payload["sub"]))
        company_id = UUID(str(payload["company_id"]))
    except (KeyError, TypeError, ValueError):
        raise ApiError("UNAUTHORIZED", "Invalid access token claims.", 401) from None
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

    try:
        device_id = UUID(str(payload["sub"]))
        company_id = UUID(str(payload["company_id"]))
        token_employee_id = UUID(str(payload["employee_id"]))
    except (KeyError, TypeError, ValueError):
        raise ApiError("UNAUTHORIZED", "Invalid device token claims.", 401) from None

    device = db.scalar(
        select(Device).where(
            Device.id == device_id,
            Device.company_id == company_id,
            Device.status == "active",
            Device.revoked_at.is_(None),
        )
    )
    if device is None:
        raise ApiError("DEVICE_REENROLLMENT_REQUIRED", DEVICE_REENROLLMENT_REQUIRED, 401)

    token_hash = hash_token(token)
    token_record = db.scalar(
        select(DeviceToken).where(
            DeviceToken.token_hash == token_hash,
            DeviceToken.company_id == company_id,
            DeviceToken.device_id == device_id,
            DeviceToken.revoked_at.is_(None),
        )
    )
    if token_record is None:
        token_history_exists = db.scalar(
            select(DeviceToken.id).where(
                DeviceToken.company_id == company_id,
                DeviceToken.device_id == device_id,
            )
        )
        if (
            token_history_exists is not None
            or not device.legacy_token_bootstrap_allowed
            or device.employee_id != token_employee_id
        ):
            raise ApiError("DEVICE_REENROLLMENT_REQUIRED", DEVICE_REENROLLMENT_REQUIRED, 401)

        bootstrap_claim = db.execute(
            update(Device)
            .where(
                Device.id == device_id,
                Device.company_id == company_id,
                Device.employee_id == token_employee_id,
                Device.status == "active",
                Device.revoked_at.is_(None),
                Device.legacy_token_bootstrap_allowed.is_(True),
            )
            .values(legacy_token_bootstrap_allowed=False)
            .execution_options(synchronize_session="fetch")
        )
        if bootstrap_claim.rowcount != 1:
            # Another request may have claimed the one-time migration window.
            # Accept it only when that same token is now the registered token.
            db.rollback()
            token_record = db.scalar(
                select(DeviceToken).where(
                    DeviceToken.token_hash == token_hash,
                    DeviceToken.company_id == company_id,
                    DeviceToken.device_id == device_id,
                    DeviceToken.revoked_at.is_(None),
                )
            )
            device = db.scalar(
                select(Device).where(
                    Device.id == device_id,
                    Device.company_id == company_id,
                    Device.status == "active",
                    Device.revoked_at.is_(None),
                )
            )
            if token_record is None or device is None:
                raise ApiError(
                    "DEVICE_REENROLLMENT_REQUIRED",
                    DEVICE_REENROLLMENT_REQUIRED,
                    401,
                )
        else:
            issued_at_claim = payload.get("iat")
            try:
                issued_at = datetime.fromtimestamp(int(issued_at_claim), UTC)
            except (TypeError, ValueError, OSError):
                db.rollback()
                raise ApiError(
                    "DEVICE_REENROLLMENT_REQUIRED",
                    DEVICE_REENROLLMENT_REQUIRED,
                    401,
                ) from None
            token_record = DeviceToken(
                company_id=company_id,
                device_id=device_id,
                token_hash=token_hash,
                issued_at=issued_at,
            )
            db.add(token_record)
            try:
                db.commit()
            except IntegrityError:
                # Two agent requests can arrive together after a network outage.
                # The unique token hash makes the bootstrap idempotent.
                db.rollback()
                token_record = db.scalar(
                    select(DeviceToken).where(
                        DeviceToken.token_hash == token_hash,
                        DeviceToken.company_id == company_id,
                        DeviceToken.device_id == device_id,
                        DeviceToken.revoked_at.is_(None),
                    )
                )
                device = db.scalar(
                    select(Device).where(
                        Device.id == device_id,
                        Device.company_id == company_id,
                        Device.status == "active",
                        Device.revoked_at.is_(None),
                    )
                )
                if token_record is None or device is None:
                    raise ApiError(
                        "DEVICE_REENROLLMENT_REQUIRED",
                        DEVICE_REENROLLMENT_REQUIRED,
                        401,
                    ) from None

    if token_record.expires_at is not None and token_record.expires_at <= datetime.now(UTC):
        raise ApiError("DEVICE_REENROLLMENT_REQUIRED", DEVICE_REENROLLMENT_REQUIRED, 401)

    if device.employee_id != token_employee_id:
        # A valid, non-revoked device token is the durable identity for the
        # installation. Repair a stale employee foreign key so an app update
        # or an old data repair does not force every employee to sign in again.
        # Reassignment flows revoke the old token before changing ownership,
        # so this branch only heals an inconsistent active record.
        token_employee = db.scalar(
            select(Employee).where(
                Employee.id == token_employee_id,
                Employee.company_id == company_id,
                Employee.status == "active",
            )
        )
        if token_employee is None:
            raise ApiError("DEVICE_REENROLLMENT_REQUIRED", DEVICE_REENROLLMENT_REQUIRED, 401)
        device.employee_id = token_employee_id
        db.add(device)
        db.commit()
        db.refresh(device)

    employee = db.scalar(
        select(Employee).where(
            Employee.id == device.employee_id,
            Employee.company_id == company_id,
            Employee.status == "active",
        )
    )
    if employee is None:
        raise ApiError("DEVICE_REENROLLMENT_REQUIRED", DEVICE_REENROLLMENT_REQUIRED, 401)

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

    try:
        employee_id = UUID(str(payload["sub"]))
        company_id = UUID(str(payload["company_id"]))
    except (KeyError, TypeError, ValueError):
        raise ApiError("UNAUTHORIZED", "Invalid employee token claims.", 401) from None

    employee = db.scalar(
        select(Employee).where(
            Employee.id == employee_id,
            Employee.company_id == company_id,
            Employee.status == "active",
        )
    )
    if employee is None:
        raise ApiError("UNAUTHORIZED", "Employee account is not active.", 401)
    return employee
