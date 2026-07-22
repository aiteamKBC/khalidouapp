from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import ApiError
from app.core.security import create_device_token, hash_token
from app.models import Device, DeviceToken, Employee, TrackingSettings
from app.schemas.agent import AgentDeviceInfo


def serialize_tracking_settings(settings_row: TrackingSettings) -> dict[str, Any]:
    return {
        "screenshot_enabled": settings_row.screenshot_enabled,
        "screenshot_interval_minutes": settings_row.screenshot_interval_minutes,
        "screenshots_per_interval": settings_row.screenshots_per_interval,
        "idle_threshold_minutes": settings_row.idle_threshold_minutes,
        "capture_during_idle": settings_row.capture_during_idle,
        "offline_threshold_minutes": settings_row.offline_threshold_minutes,
        "screenshot_retention_days": settings_row.screenshot_retention_days,
    }


def get_or_create_tracking_settings(db: Session, company_id) -> TrackingSettings:
    settings_row = db.scalar(
        select(TrackingSettings).where(TrackingSettings.company_id == company_id)
    )
    if settings_row is not None:
        return settings_row

    settings_row = TrackingSettings(
        company_id=company_id,
        screenshot_interval_minutes=settings.default_screenshot_interval_minutes,
        screenshots_per_interval=settings.default_screenshots_per_interval,
        idle_threshold_minutes=settings.default_idle_threshold_minutes,
        offline_threshold_minutes=settings.default_offline_threshold_minutes,
        screenshot_retention_days=settings.default_screenshot_retention_days,
    )
    db.add(settings_row)
    db.flush()
    return settings_row


def issue_device_token(db: Session, device: Device) -> str:
    token = create_device_token(
        device_id=device.id,
        company_id=device.company_id,
        employee_id=device.employee_id,
    )
    db.add(
        DeviceToken(
            company_id=device.company_id,
            device_id=device.id,
            token_hash=hash_token(token),
        )
    )
    return token


def enroll_employee_device(
    db: Session,
    employee: Employee,
    device_info: AgentDeviceInfo,
    ip_address: str | None = None,
) -> dict[str, Any]:
    """Register or relink a device and issue the standard device bearer token."""
    if employee.status != "active":
        raise ApiError("EMPLOYEE_NOT_ACTIVE", "Employee is not active.", 400)

    device = db.scalar(
        select(Device).where(
            Device.company_id == employee.company_id,
            Device.installation_id == device_info.installation_id,
        )
    )
    if device is None:
        device = Device(
            company_id=employee.company_id,
            employee_id=employee.id,
            device_name=device_info.device_name,
            installation_id=device_info.installation_id,
            operating_system=device_info.operating_system,
            agent_version=device_info.agent_version,
            windows_username=device_info.windows_username,
            last_ip_address=ip_address,
            status="active",
            last_seen_at=datetime.now(UTC),
        )
        db.add(device)
        db.flush()
    elif device.revoked_at is not None or device.status == "revoked":
        raise ApiError("DEVICE_REVOKED", "This device has been revoked.", 403)
    elif device.employee_id != employee.id:
        raise ApiError(
            "DEVICE_ALREADY_ENROLLED",
            "This installation is already linked to another employee.",
            409,
        )
    else:
        device.employee_id = employee.id
        device.device_name = device_info.device_name
        device.operating_system = device_info.operating_system
        device.agent_version = device_info.agent_version
        device.windows_username = device_info.windows_username
        device.last_ip_address = ip_address or device.last_ip_address
        device.status = "active"
        device.last_seen_at = datetime.now(UTC)

    token = issue_device_token(db, device)
    settings_row = get_or_create_tracking_settings(db, employee.company_id)
    db.commit()

    return {
        "company_id": str(employee.company_id),
        "employee": {
            "id": str(employee.id),
            "name": employee.name,
            "email": employee.email,
            "timezone": employee.timezone,
        },
        "device": {
            "id": str(device.id),
            "name": device.device_name,
            "installation_id": device.installation_id,
            "status": device.status,
        },
        "device_token": token,
        "token_type": "bearer",
        "settings": serialize_tracking_settings(settings_row),
    }


def refresh_device_token(db: Session, device: Device, token_record: DeviceToken) -> dict[str, Any]:
    token_record.revoked_at = datetime.now(UTC)
    db.add(token_record)

    token = issue_device_token(db, device)
    db.commit()

    return {
        "device_token": token,
        "token_type": "bearer",
    }
