from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends
from fastapi import Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.api.v1.admin_utils import apply_pagination, count_for, pagination_meta
from app.api.v1.team_auth import require_general_admin
from app.core.responses import success_response
from app.database.session import get_db
from app.models import AdminUser, AuditLog

router = APIRouter(prefix="/audit-log", tags=["audit-log"])


def serialize_audit_log(row: AuditLog) -> dict:
    details = None
    if row.details:
        details = ", ".join(f"{key}: {value}" for key, value in row.details.items())
    return {
        "id": str(row.id),
        "at": row.created_at.isoformat(),
        "user_id": str(row.admin_user_id) if row.admin_user_id else "",
        "user_name": row.admin_user.name if row.admin_user else "System",
        "action": row.action,
        "entity_type": row.entity_type,
        "entity_id": str(row.entity_id) if row.entity_id else None,
        "entity_name": row.entity_name or "",
        "ip": row.ip_address or "",
        "details": details,
    }


@router.get("")
def list_audit_log(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=200),
    user_id: UUID | None = None,
    action: str | None = None,
    entity_type: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    tz: str | None = None,
):
    require_general_admin(current_admin)
    # Filters are applied server-side so search reaches the full history, not
    # just the first loaded page, and pagination stays bounded (W11). The From/To
    # day boundaries are computed in the viewer's timezone so an event whose
    # displayed day is D is matched by a filter of D, even when its UTC instant
    # falls on the neighbouring calendar day (W12). The To date is inclusive of
    # its whole day (exclusive next-day boundary).
    try:
        zone = ZoneInfo(tz) if tz else UTC
    except (ZoneInfoNotFoundError, ValueError):
        zone = UTC
    statement = select(AuditLog).where(AuditLog.company_id == current_admin.company_id)
    if user_id is not None:
        statement = statement.where(AuditLog.admin_user_id == user_id)
    if action:
        statement = statement.where(AuditLog.action == action)
    if entity_type:
        statement = statement.where(AuditLog.entity_type == entity_type)
    if date_from is not None:
        statement = statement.where(
            AuditLog.created_at
            >= datetime.combine(date_from, time.min, tzinfo=zone).astimezone(UTC)
        )
    if date_to is not None:
        statement = statement.where(
            AuditLog.created_at
            < datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=zone).astimezone(UTC)
        )
    statement = statement.order_by(AuditLog.created_at.desc())
    total = count_for(db, statement)
    rows = db.scalars(apply_pagination(statement, page, page_size)).all()

    # Distinct filter options over the whole company history (small, bounded)
    # so the UI can offer actions/entities that are not on the current page.
    company_scope = AuditLog.company_id == current_admin.company_id
    available_actions = sorted(
        value
        for value in db.scalars(
            select(AuditLog.action).where(company_scope).distinct()
        ).all()
        if value
    )
    available_entity_types = sorted(
        value
        for value in db.scalars(
            select(AuditLog.entity_type).where(company_scope).distinct()
        ).all()
        if value
    )

    meta = pagination_meta(total, page, page_size)
    meta["available_actions"] = available_actions
    meta["available_entity_types"] = available_entity_types
    return success_response(
        data=[serialize_audit_log(row) for row in rows],
        meta=meta,
    )
