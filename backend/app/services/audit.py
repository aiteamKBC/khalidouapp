from typing import Any
from uuid import UUID

from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AdminUser, AuditLog


def request_ip(request: Request | None) -> str | None:
    if request is None or request.client is None:
        return None
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host


def record_audit_log(
    db: Session,
    current_admin: AdminUser,
    action: str,
    entity_type: str,
    *,
    entity_id: UUID | None = None,
    entity_name: str | None = None,
    details: dict[str, Any] | None = None,
    request: Request | None = None,
) -> None:
    db.add(
        AuditLog(
            company_id=current_admin.company_id,
            admin_user_id=current_admin.id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_name=entity_name,
            ip_address=request_ip(request),
            details=details,
        )
    )
