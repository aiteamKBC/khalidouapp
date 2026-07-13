from datetime import UTC, date, datetime, time
from typing import Any
from uuid import UUID

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import ActivityEvent, Device, Employee, Screenshot, TrackingSettings, WorkSession


def utc_now() -> datetime:
    return datetime.now(UTC)


def day_bounds(value: date) -> tuple[datetime, datetime]:
    return (
        datetime.combine(value, time.min, tzinfo=UTC),
        datetime.combine(value, time.max, tzinfo=UTC),
    )


def pagination_meta(total: int, page: int, page_size: int) -> dict[str, int]:
    return {
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": (total + page_size - 1) // page_size if page_size else 0,
    }


def apply_pagination(statement: Select[tuple[Any]], page: int, page_size: int):
    return statement.offset((page - 1) * page_size).limit(page_size)


def count_for(db: Session, statement: Select[tuple[Any]]) -> int:
    return db.scalar(select(func.count()).select_from(statement.subquery())) or 0


def serialize_employee(employee: Employee, invitation=None) -> dict[str, Any]:
    data = {
        "id": str(employee.id),
        "company_id": str(employee.company_id),
        "name": employee.name,
        "email": employee.email,
        "employee_code": employee.employee_code,
        "department": employee.department,
        "timezone": employee.timezone,
        "status": employee.status,
        "weekly_capacity_minutes": employee.weekly_capacity_minutes,
        "avatar_url": employee.avatar_url,
        "portal_access_enabled": bool(
            employee.portal_password_hash or employee.portal_access_key_hash
        ),
        "portal_access_key_hint": employee.portal_access_key_hint,
        "portal_last_login_at": employee.portal_last_login_at.isoformat() if employee.portal_last_login_at else None,
        "portal_last_login_ip": employee.portal_last_login_ip,
        "portal_last_user_agent": employee.portal_last_user_agent,
        "created_at": employee.created_at.isoformat(),
        "updated_at": employee.updated_at.isoformat(),
    }
    if invitation is not None:
        from app.services.employee_invitations import serialize_employee_invitation

        data["invitation"] = serialize_employee_invitation(invitation)
    return data


def serialize_device(device: Device) -> dict[str, Any]:
    return {
        "id": str(device.id),
        "company_id": str(device.company_id),
        "employee_id": str(device.employee_id),
        "device_name": device.device_name,
        "installation_id": device.installation_id,
        "operating_system": device.operating_system,
        "agent_version": device.agent_version,
        "windows_username": device.windows_username,
        "last_ip_address": device.last_ip_address,
        "status": device.status,
        "last_seen_at": device.last_seen_at.isoformat() if device.last_seen_at else None,
        "registered_at": device.registered_at.isoformat(),
        "revoked_at": device.revoked_at.isoformat() if device.revoked_at else None,
    }


def serialize_work_session(session: WorkSession) -> dict[str, Any]:
    return {
        "id": str(session.id),
        "company_id": str(session.company_id),
        "employee_id": str(session.employee_id),
        "device_id": str(session.device_id),
        "team_id": str(session.team_id) if session.team_id else None,
        "project_id": str(session.project_id) if session.project_id else None,
        "task_id": str(session.task_id) if session.task_id else None,
        "started_at": session.started_at.isoformat(),
        "ended_at": session.ended_at.isoformat() if session.ended_at else None,
        "status": session.status,
        "active_seconds": max(0, session.active_seconds - session.deducted_seconds),
        "raw_active_seconds": session.active_seconds,
        "deducted_seconds": session.deducted_seconds,
        "idle_seconds": session.idle_seconds,
        "created_at": session.created_at.isoformat(),
        "updated_at": session.updated_at.isoformat(),
    }


def serialize_activity_event(event: ActivityEvent) -> dict[str, Any]:
    return {
        "id": str(event.id),
        "company_id": str(event.company_id),
        "employee_id": str(event.employee_id),
        "device_id": str(event.device_id),
        "session_id": str(event.session_id),
        "event_type": event.event_type,
        "event_timestamp": event.event_timestamp.isoformat(),
        "payload": event.payload,
        "idempotency_key": event.idempotency_key,
        "created_at": event.created_at.isoformat(),
    }


def get_company_settings(db: Session, company_id: UUID) -> TrackingSettings:
    settings_row = db.scalar(select(TrackingSettings).where(TrackingSettings.company_id == company_id))
    if settings_row:
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
    db.commit()
    db.refresh(settings_row)
    return settings_row


def temporary_screenshot_url(screenshot: Screenshot) -> str:
    return f"/api/v1/screenshots/{screenshot.id}/file"
