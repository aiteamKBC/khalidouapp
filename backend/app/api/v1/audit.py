from typing import Annotated

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
):
    require_general_admin(current_admin)
    statement = (
        select(AuditLog)
        .where(AuditLog.company_id == current_admin.company_id)
        .order_by(AuditLog.created_at.desc())
    )
    total = count_for(db, statement)
    rows = db.scalars(apply_pagination(statement, page, page_size)).all()
    return success_response(
        data=[serialize_audit_log(row) for row in rows],
        meta=pagination_meta(total, page, page_size),
    )
