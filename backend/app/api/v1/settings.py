from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.api.v1.admin_utils import get_company_settings
from app.api.v1.team_auth import require_general_admin
from app.core.responses import success_response
from app.database.session import get_db
from app.models import AdminUser
from app.schemas.admin import TrackingSettingsUpdate
from app.services.audit import record_audit_log
from app.services.device_enrollment import serialize_tracking_settings

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/tracking")
def get_tracking_settings(current_admin: Annotated[AdminUser, Depends(get_current_admin)], db: Annotated[Session, Depends(get_db)]):
    return success_response(data=serialize_tracking_settings(get_company_settings(db, current_admin.company_id)))


@router.patch("/tracking")
def update_tracking_settings(
    payload: TrackingSettingsUpdate,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_general_admin(current_admin)
    settings = get_company_settings(db, current_admin.company_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(settings, key, value)
    db.add(settings)
    db.commit()
    db.refresh(settings)
    record_audit_log(
        db,
        current_admin,
        "updated",
        "tracking_settings",
        entity_name="Company tracking settings",
        details=payload.model_dump(exclude_unset=True),
        request=request,
    )
    db.commit()
    return success_response(data=serialize_tracking_settings(settings))
