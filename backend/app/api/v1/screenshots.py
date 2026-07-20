from datetime import date
from shutil import disk_usage
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.api.v1.admin_utils import apply_pagination, count_for, day_bounds, pagination_meta, temporary_screenshot_url
from app.api.v1.team_auth import (
    accessible_team_ids_statement,
    apply_employee_scope,
    ensure_employee_access,
    ensure_team_access,
    is_general_admin,
)
from app.core.config import settings
from app.core.exceptions import ApiError
from app.core.responses import success_response
from app.database.session import get_db
from app.models import AdminUser, Screenshot, WorkSession
from app.services.audit import record_audit_log
from app.services.permissions import require_capability
from app.services.projects import get_project_or_404, get_task_or_404
from app.services.screenshots import serialize_screenshot
from app.storage.local import LocalScreenshotStorage

router = APIRouter(prefix="/screenshots", tags=["screenshots"])


def get_screenshot_or_404(db: Session, company_id: UUID, screenshot_id: UUID) -> Screenshot:
    screenshot = db.scalar(
        select(Screenshot).where(
            Screenshot.id == screenshot_id,
            Screenshot.company_id == company_id,
            Screenshot.deleted_at.is_(None),
        )
    )
    if screenshot is None:
        raise ApiError("SCREENSHOT_NOT_FOUND", "Screenshot was not found.", 404)
    return screenshot


def get_accessible_screenshot_or_404(
    db: Session,
    current_admin: AdminUser,
    screenshot_id: UUID,
) -> Screenshot:
    screenshot = get_screenshot_or_404(db, current_admin.company_id, screenshot_id)
    ensure_employee_access(db, current_admin, screenshot.employee_id)
    if screenshot.team_id is not None:
        ensure_team_access(db, current_admin, screenshot.team_id)
    return screenshot


def serialize_with_url(screenshot: Screenshot) -> dict:
    data = serialize_screenshot(screenshot)
    data["temporary_url"] = temporary_screenshot_url(screenshot)
    data["thumbnail_url"] = (
        f"/api/v1/screenshots/{screenshot.id}/thumbnail"
        if screenshot.thumbnail_path
        else data["temporary_url"]
    )
    return data


@router.get("")
def list_screenshots(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    employee_id: UUID | None = None,
    session_id: UUID | None = None,
    team_id: UUID | None = None,
    project_id: UUID | None = None,
    task_id: UUID | None = None,
    day: date | None = None,
    start_time: date | None = None,
    end_time: date | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
):
    statement = select(Screenshot).where(Screenshot.company_id == current_admin.company_id, Screenshot.deleted_at.is_(None))
    statement = apply_employee_scope(statement, db, current_admin, Screenshot.employee_id, team_id)
    if team_id:
        ensure_team_access(db, current_admin, team_id)
        statement = statement.where(or_(Screenshot.team_id.is_(None), Screenshot.team_id == team_id))
    elif not is_general_admin(current_admin):
        statement = statement.where(
            or_(
                Screenshot.team_id.is_(None),
                Screenshot.team_id.in_(accessible_team_ids_statement(current_admin)),
            )
        )
    if employee_id:
        ensure_employee_access(db, current_admin, employee_id, team_id)
        statement = statement.where(Screenshot.employee_id == employee_id)
    if session_id:
        statement = statement.where(Screenshot.session_id == session_id)
    if project_id:
        get_project_or_404(db, current_admin, project_id)
        statement = statement.where(Screenshot.project_id == project_id)
    if task_id:
        get_task_or_404(db, current_admin, task_id)
        statement = statement.where(Screenshot.task_id == task_id)
    if day:
        start, end = day_bounds(day)
        statement = statement.where(Screenshot.captured_at.between(start, end))
    if start_time:
        statement = statement.where(Screenshot.captured_at >= day_bounds(start_time)[0])
    if end_time:
        statement = statement.where(Screenshot.captured_at <= day_bounds(end_time)[1])
    statement = statement.order_by(Screenshot.captured_at.desc())
    total = count_for(db, statement)
    screenshots = db.scalars(apply_pagination(statement, page, page_size)).all()
    return success_response(data=[serialize_with_url(item) for item in screenshots], meta=pagination_meta(total, page, page_size))


@router.get("/storage-status")
def screenshot_storage_status(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
):
    if not is_general_admin(current_admin):
        raise ApiError("FORBIDDEN", "General admin access is required.", 403)
    root = settings.screenshot_storage_path.resolve()
    root.mkdir(parents=True, exist_ok=True)
    total, used, free = disk_usage(root)
    used_percent = round((used / total) * 100, 1) if total else 0
    return success_response(
        data={
            "total_bytes": total,
            "used_bytes": used,
            "free_bytes": free,
            "used_percent": used_percent,
            "warning_percent": settings.screenshot_storage_warning_percent,
            "healthy": used_percent < settings.screenshot_storage_warning_percent,
        }
    )


@router.get("/{screenshot_id}")
def get_screenshot(screenshot_id: UUID, current_admin: Annotated[AdminUser, Depends(get_current_admin)], db: Annotated[Session, Depends(get_db)]):
    return success_response(data=serialize_with_url(get_accessible_screenshot_or_404(db, current_admin, screenshot_id)))


@router.get("/{screenshot_id}/file")
def get_screenshot_file(screenshot_id: UUID, current_admin: Annotated[AdminUser, Depends(get_current_admin)], db: Annotated[Session, Depends(get_db)]):
    screenshot = get_accessible_screenshot_or_404(db, current_admin, screenshot_id)
    path = (settings.screenshot_storage_path / screenshot.storage_path).resolve()
    if not path.exists():
        raise ApiError("SCREENSHOT_FILE_NOT_FOUND", "Screenshot file was not found in private storage.", 404)
    return FileResponse(path, media_type=screenshot.mime_type)


@router.get("/{screenshot_id}/thumbnail")
def get_screenshot_thumbnail(
    screenshot_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    screenshot = get_accessible_screenshot_or_404(db, current_admin, screenshot_id)
    relative_path = screenshot.thumbnail_path or screenshot.storage_path
    path = (settings.screenshot_storage_path / relative_path).resolve()
    if not path.exists():
        raise ApiError("SCREENSHOT_FILE_NOT_FOUND", "Screenshot preview was not found.", 404)
    media_type = "image/jpeg" if screenshot.thumbnail_path else screenshot.mime_type
    return FileResponse(path, media_type=media_type)


@router.delete("/{screenshot_id}")
def delete_screenshot(screenshot_id: UUID, request: Request, current_admin: Annotated[AdminUser, Depends(get_current_admin)], db: Annotated[Session, Depends(get_db)]):
    require_capability(current_admin, "screenshots.manage")
    screenshot = get_accessible_screenshot_or_404(db, current_admin, screenshot_id)
    from datetime import UTC, datetime

    screenshot.deleted_at = datetime.now(UTC)
    screenshot.status = "deleted"
    session = db.scalar(
        select(WorkSession).where(
            WorkSession.id == screenshot.session_id,
            WorkSession.company_id == screenshot.company_id,
        )
    )
    deducted_seconds = 0
    if session is not None and screenshot.deleted_time_seconds == 0:
        effective_active = max(0, session.active_seconds - session.deducted_seconds)
        deducted_seconds = min(effective_active, max(0, screenshot.tracked_seconds))
        session.deducted_seconds += deducted_seconds
        screenshot.deleted_time_seconds = deducted_seconds
        db.add(session)
    db.add(screenshot)
    db.commit()
    LocalScreenshotStorage().delete(screenshot.storage_path)
    if screenshot.thumbnail_path:
        LocalScreenshotStorage().delete(screenshot.thumbnail_path)
    record_audit_log(
        db,
        current_admin,
        "deleted",
        "screenshot",
        entity_id=screenshot.id,
        entity_name=screenshot.storage_path,
        details={
            "employee_id": str(screenshot.employee_id),
            "captured_at": screenshot.captured_at.isoformat(),
            "deducted_seconds": deducted_seconds,
        },
        request=request,
    )
    db.commit()
    return success_response(data={"deleted": True, "deducted_seconds": deducted_seconds})
