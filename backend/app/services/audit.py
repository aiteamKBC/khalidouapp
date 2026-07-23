from typing import Any
from uuid import UUID

from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AdminUser, AuditLog


_FINANCIAL_AUDIT_ENTITY_TYPES = {
    "employee_work_profile",
    "payroll_adjustment",
    "payroll_entry",
    "payroll_run",
}
_FINANCIAL_AUDIT_KEYS = {
    "amount",
    "hourly_rate",
    "overtime_rate_multiplier",
    "calculation_snapshot",
}
_REDACTED_FINANCIAL_VALUE = "[REDACTED_FINANCIAL_VALUE]"


def redact_financial_audit_details(value: Any) -> Any:
    """Remove compensation values while preserving useful audit structure."""
    if isinstance(value, dict):
        return {
            key: (
                _REDACTED_FINANCIAL_VALUE
                if key in _FINANCIAL_AUDIT_KEYS
                or key.endswith("_amount")
                or "salary" in key
                else redact_financial_audit_details(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_financial_audit_details(item) for item in value]
    return value


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
    safe_details = (
        redact_financial_audit_details(details)
        if details is not None and entity_type in _FINANCIAL_AUDIT_ENTITY_TYPES
        else details
    )
    db.add(
        AuditLog(
            company_id=current_admin.company_id,
            admin_user_id=current_admin.id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_name=entity_name,
            ip_address=request_ip(request),
            details=safe_details,
        )
    )
