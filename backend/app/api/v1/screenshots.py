from datetime import UTC, date, datetime, timedelta
from shutil import disk_usage
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.api.v1.admin_utils import (
    apply_pagination,
    count_for,
    day_bounds,
    get_company_settings,
    pagination_meta,
    temporary_screenshot_url,
)
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
from app.models import AdminUser, Device, Employee, Screenshot, ScreenshotCaptureEvent, WorkSession
from app.services.audit import record_audit_log
from app.services.permissions import require_capability
from app.services.projects import get_project_or_404, get_task_or_404
from app.services.screenshots import build_thumbnail, serialize_screenshot
from app.storage.local import LocalScreenshotStorage

router = APIRouter(prefix="/screenshots", tags=["screenshots"])


def _local_day_bounds(value: date, timezone_name: str | None) -> tuple[datetime, datetime]:
    try:
        timezone = ZoneInfo(timezone_name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        timezone = ZoneInfo("UTC")
    local_start = datetime.combine(value, datetime.min.time(), tzinfo=timezone)
    return local_start.astimezone(UTC), (local_start + timedelta(days=1)).astimezone(UTC)


def _employee_timezone_rows(
    db: Session,
    company_id: UUID,
    employee_ids: list[UUID] | None = None,
) -> list[tuple[UUID, str]]:
    statement = select(Employee.id, Employee.timezone).where(Employee.company_id == company_id)
    if employee_ids is not None:
        statement = statement.where(Employee.id.in_(employee_ids))
    return [
        (employee_id, timezone_name or "UTC")
        for employee_id, timezone_name in db.execute(statement)
    ]


def _local_day_condition(
    value: date,
    employee_rows: list[tuple[UUID, str]],
    *,
    employee_column,
    timestamp_column,
):
    employees_by_timezone: dict[str, list[UUID]] = {}
    for employee_id, timezone_name in employee_rows:
        employees_by_timezone.setdefault(timezone_name, []).append(employee_id)
    conditions = []
    for timezone_name, employee_ids in employees_by_timezone.items():
        start, end = _local_day_bounds(value, timezone_name)
        conditions.append(
            and_(
                employee_column.in_(employee_ids),
                timestamp_column >= start,
                timestamp_column < end,
            )
        )
    return or_(*conditions) if conditions else employee_column.is_(None)


def _local_day_overlap_condition(
    value: date,
    employee_rows: list[tuple[UUID, str]],
    *,
    employee_column,
    started_column,
    ended_column,
):
    employees_by_timezone: dict[str, list[UUID]] = {}
    for employee_id, timezone_name in employee_rows:
        employees_by_timezone.setdefault(timezone_name, []).append(employee_id)
    conditions = []
    for timezone_name, employee_ids in employees_by_timezone.items():
        start, end = _local_day_bounds(value, timezone_name)
        conditions.append(
            and_(
                employee_column.in_(employee_ids),
                started_column < end,
                or_(ended_column.is_(None), ended_column >= start),
            )
        )
    return or_(*conditions) if conditions else employee_column.is_(None)


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
    # The thumbnail endpoint also creates a compact preview for legacy captures
    # on first access; never make a grid silently fall back to the full file.
    data["thumbnail_url"] = f"/api/v1/screenshots/{screenshot.id}/thumbnail"
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
    work_category: Literal["scheduled_shift", "off_shift", "unknown"] | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
):
    statement = select(Screenshot).where(
        Screenshot.company_id == current_admin.company_id, Screenshot.deleted_at.is_(None)
    )
    statement = apply_employee_scope(statement, db, current_admin, Screenshot.employee_id, team_id)
    if team_id:
        ensure_team_access(db, current_admin, team_id)
        statement = statement.where(
            or_(Screenshot.team_id.is_(None), Screenshot.team_id == team_id)
        )
    elif not is_general_admin(current_admin):
        statement = statement.where(
            or_(
                Screenshot.team_id.is_(None),
                Screenshot.team_id.in_(accessible_team_ids_statement(current_admin)),
            )
        )
    selected_employee_rows: list[tuple[UUID, str]] | None = None
    if employee_id:
        employee = ensure_employee_access(db, current_admin, employee_id, team_id)
        selected_employee_rows = [(employee.id, employee.timezone or "UTC")]
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
        employee_rows = selected_employee_rows or _employee_timezone_rows(
            db,
            current_admin.company_id,
        )
        statement = statement.where(
            _local_day_condition(
                day,
                employee_rows,
                employee_column=Screenshot.employee_id,
                timestamp_column=Screenshot.captured_at,
            )
        )
    if start_time:
        start = (
            _local_day_bounds(start_time, selected_employee_rows[0][1])[0]
            if selected_employee_rows
            else day_bounds(start_time)[0]
        )
        statement = statement.where(Screenshot.captured_at >= start)
    if end_time:
        end = (
            _local_day_bounds(end_time, selected_employee_rows[0][1])[1]
            if selected_employee_rows
            else day_bounds(end_time)[1]
        )
        statement = statement.where(Screenshot.captured_at < end)
    if work_category:
        statement = statement.where(Screenshot.work_category == work_category)
    statement = statement.order_by(Screenshot.captured_at.desc())
    total = count_for(db, statement)
    screenshots = db.scalars(apply_pagination(statement, page, page_size)).all()
    return success_response(
        data=[serialize_with_url(item) for item in screenshots],
        meta=pagination_meta(total, page, page_size),
    )


@router.get("/folders")
def list_screenshot_folders(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    day: date,
    employee_id: UUID | None = None,
    team_id: UUID | None = None,
    work_category: Literal["scheduled_shift", "off_shift", "unknown"] | None = None,
    folder_status: Literal[
        "active_now",
        "worked",
        "no_work",
        "with_screenshots",
        "empty",
    ]
    | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=8, ge=1, le=250),
    preview_limit: int = Query(default=3, ge=1, le=3),
):
    """Return one folder per visible employee, including employees with no captures."""
    require_capability(current_admin, "screenshots.view")
    company_employee_rows = _employee_timezone_rows(db, current_admin.company_id)

    screenshot_match_filters = [
        Screenshot.company_id == current_admin.company_id,
        Screenshot.employee_id == Employee.id,
        Screenshot.deleted_at.is_(None),
        _local_day_condition(
            day,
            company_employee_rows,
            employee_column=Screenshot.employee_id,
            timestamp_column=Screenshot.captured_at,
        ),
    ]
    if team_id:
        screenshot_match_filters.append(
            or_(Screenshot.team_id.is_(None), Screenshot.team_id == team_id)
        )
    elif not is_general_admin(current_admin):
        screenshot_match_filters.append(
            or_(
                Screenshot.team_id.is_(None),
                Screenshot.team_id.in_(accessible_team_ids_statement(current_admin)),
            )
        )
    if work_category:
        screenshot_match_filters.append(Screenshot.work_category == work_category)

    has_screenshots = select(Screenshot.id).where(*screenshot_match_filters).exists()
    has_work = (
        select(WorkSession.id)
        .where(
            WorkSession.company_id == current_admin.company_id,
            WorkSession.employee_id == Employee.id,
            _local_day_overlap_condition(
                day,
                company_employee_rows,
                employee_column=WorkSession.employee_id,
                started_column=WorkSession.started_at,
                ended_column=WorkSession.ended_at,
            ),
        )
        .exists()
    )
    company_settings = get_company_settings(db, current_admin.company_id)
    online_cutoff = datetime.now(UTC) - timedelta(
        minutes=company_settings.offline_threshold_minutes
    )
    has_live_device = (
        select(Device.id)
        .where(
            Device.company_id == current_admin.company_id,
            Device.employee_id == Employee.id,
            Device.status != "revoked",
            Device.last_seen_at >= online_cutoff,
        )
        .exists()
    )
    has_active_session = (
        select(WorkSession.id)
        .where(
            WorkSession.company_id == current_admin.company_id,
            WorkSession.employee_id == Employee.id,
            WorkSession.ended_at.is_(None),
            WorkSession.status == "active",
        )
        .exists()
    )
    is_active_now = has_live_device & has_active_session

    employee_statement = select(Employee).where(
        Employee.company_id == current_admin.company_id,
        Employee.archived_at.is_(None),
        Employee.status == "active",
    )
    employee_statement = apply_employee_scope(
        employee_statement,
        db,
        current_admin,
        Employee.id,
        team_id,
    )
    if employee_id:
        ensure_employee_access(db, current_admin, employee_id, team_id)
        employee_statement = employee_statement.where(Employee.id == employee_id)
    if folder_status == "active_now":
        employee_statement = employee_statement.where(is_active_now)
    elif folder_status == "worked":
        employee_statement = employee_statement.where(has_work)
    elif folder_status == "no_work":
        employee_statement = employee_statement.where(~has_work)
    elif folder_status == "with_screenshots":
        employee_statement = employee_statement.where(has_screenshots)
    elif folder_status == "empty":
        employee_statement = employee_statement.where(~has_screenshots)
    employee_statement = employee_statement.order_by(Employee.name.asc(), Employee.id.asc())
    total = count_for(db, employee_statement)
    employees = db.scalars(
        apply_pagination(employee_statement, page, page_size)
    ).all()
    employee_ids = [employee.id for employee in employees]

    screenshots_by_employee: dict[UUID, list[Screenshot]] = {
        employee.id: [] for employee in employees
    }
    screenshot_counts: dict[UUID, int] = {}
    latest_capture: dict[UUID, datetime] = {}
    worked_employee_ids: set[UUID] = set()
    active_employee_ids: set[UUID] = set()

    if employee_ids:
        selected_employee_rows = [
            (employee.id, employee.timezone or "UTC") for employee in employees
        ]
        screenshot_filters = [
            Screenshot.company_id == current_admin.company_id,
            Screenshot.employee_id.in_(employee_ids),
            Screenshot.deleted_at.is_(None),
            _local_day_condition(
                day,
                selected_employee_rows,
                employee_column=Screenshot.employee_id,
                timestamp_column=Screenshot.captured_at,
            ),
        ]
        if team_id:
            screenshot_filters.append(
                or_(Screenshot.team_id.is_(None), Screenshot.team_id == team_id)
            )
        elif not is_general_admin(current_admin):
            screenshot_filters.append(
                or_(
                    Screenshot.team_id.is_(None),
                    Screenshot.team_id.in_(accessible_team_ids_statement(current_admin)),
                )
            )
        if work_category:
            screenshot_filters.append(Screenshot.work_category == work_category)

        count_rows = db.execute(
            select(
                Screenshot.employee_id,
                func.count(Screenshot.id),
                func.max(Screenshot.captured_at),
            )
            .where(*screenshot_filters)
            .group_by(Screenshot.employee_id)
        ).all()
        for row_employee_id, count, latest in count_rows:
            screenshot_counts[row_employee_id] = int(count)
            latest_capture[row_employee_id] = latest

        ranked_previews = (
            select(
                Screenshot.id.label("screenshot_id"),
                func.row_number()
                .over(
                    partition_by=Screenshot.employee_id,
                    order_by=Screenshot.captured_at.desc(),
                )
                .label("preview_rank"),
            )
            .where(*screenshot_filters)
            .subquery()
        )
        preview_rows = db.scalars(
            select(Screenshot)
            .join(ranked_previews, ranked_previews.c.screenshot_id == Screenshot.id)
            .where(ranked_previews.c.preview_rank <= preview_limit)
            .order_by(Screenshot.employee_id.asc(), Screenshot.captured_at.desc())
        ).all()
        for screenshot in preview_rows:
            previews = screenshots_by_employee[screenshot.employee_id]
            if len(previews) < preview_limit:
                previews.append(screenshot)

        worked_employee_ids = set(
            db.scalars(
                select(WorkSession.employee_id)
                .where(
                    WorkSession.company_id == current_admin.company_id,
                    WorkSession.employee_id.in_(employee_ids),
                    _local_day_overlap_condition(
                        day,
                        selected_employee_rows,
                        employee_column=WorkSession.employee_id,
                        started_column=WorkSession.started_at,
                        ended_column=WorkSession.ended_at,
                    ),
                )
                .distinct()
            ).all()
        )
        active_employee_ids = set(
            db.scalars(
                select(Employee.id).where(
                    Employee.id.in_(employee_ids),
                    is_active_now,
                )
            ).all()
        )

    return success_response(
        data=[
            {
                "employee_id": str(employee.id),
                "employee_name": employee.name,
                "employee_email": employee.email,
                "job_title": employee.job_title,
                "worked": employee.id in worked_employee_ids,
                "active_now": employee.id in active_employee_ids,
                "screenshot_count": screenshot_counts.get(employee.id, 0),
                "latest_capture": latest_capture.get(employee.id).isoformat()
                if latest_capture.get(employee.id)
                else None,
                "previews": [
                    serialize_with_url(screenshot)
                    for screenshot in screenshots_by_employee[employee.id]
                ],
            }
            for employee in employees
        ],
        meta=pagination_meta(total, page, page_size),
    )


@router.get("/capture-events")
def list_capture_events(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    employee_id: UUID | None = None,
    day: date | None = None,
    outcome: Literal["captured", "skipped"] | None = None,
    reason: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
):
    require_capability(current_admin, "screenshots.view")
    statement = (
        select(ScreenshotCaptureEvent, Employee.name)
        .join(Employee, Employee.id == ScreenshotCaptureEvent.employee_id)
        .where(ScreenshotCaptureEvent.company_id == current_admin.company_id)
    )
    statement = apply_employee_scope(
        statement,
        db,
        current_admin,
        ScreenshotCaptureEvent.employee_id,
    )
    selected_employee_rows: list[tuple[UUID, str]] | None = None
    if employee_id:
        employee = ensure_employee_access(db, current_admin, employee_id)
        selected_employee_rows = [(employee.id, employee.timezone or "UTC")]
        statement = statement.where(ScreenshotCaptureEvent.employee_id == employee_id)
    if day:
        employee_rows = selected_employee_rows or _employee_timezone_rows(
            db,
            current_admin.company_id,
        )
        statement = statement.where(
            _local_day_condition(
                day,
                employee_rows,
                employee_column=ScreenshotCaptureEvent.employee_id,
                timestamp_column=ScreenshotCaptureEvent.occurred_at,
            )
        )
    if outcome:
        statement = statement.where(ScreenshotCaptureEvent.outcome == outcome)
    if reason:
        statement = statement.where(ScreenshotCaptureEvent.reason == reason)
    statement = statement.order_by(ScreenshotCaptureEvent.occurred_at.desc())
    total = count_for(db, statement)
    rows = db.execute(apply_pagination(statement, page, page_size)).all()
    return success_response(
        data=[
            {
                "id": str(event.id),
                "employee_id": str(event.employee_id),
                "employee_name": employee_name,
                "device_id": str(event.device_id),
                "session_id": str(event.session_id) if event.session_id else None,
                "screenshot_id": str(event.screenshot_id) if event.screenshot_id else None,
                "occurred_at": event.occurred_at.isoformat(),
                "outcome": event.outcome,
                "reason": event.reason,
                "work_category": event.work_category,
                "power_source": event.power_source,
                "tracking_status": event.tracking_status,
            }
            for event, employee_name in rows
        ],
        meta=pagination_meta(total, page, page_size),
    )


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
def get_screenshot(
    screenshot_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    return success_response(
        data=serialize_with_url(get_accessible_screenshot_or_404(db, current_admin, screenshot_id))
    )


@router.get("/{screenshot_id}/file")
def get_screenshot_file(
    screenshot_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    screenshot = get_accessible_screenshot_or_404(db, current_admin, screenshot_id)
    path = (settings.screenshot_storage_path / screenshot.storage_path).resolve()
    if not path.exists():
        raise ApiError(
            "SCREENSHOT_FILE_NOT_FOUND", "Screenshot file was not found in private storage.", 404
        )
    return FileResponse(path, media_type=screenshot.mime_type)


@router.get("/{screenshot_id}/thumbnail")
def get_screenshot_thumbnail(
    screenshot_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    screenshot = get_accessible_screenshot_or_404(db, current_admin, screenshot_id)
    storage = LocalScreenshotStorage()
    original_path = (settings.screenshot_storage_path / screenshot.storage_path).resolve()
    thumbnail_path = (
        (settings.screenshot_storage_path / screenshot.thumbnail_path).resolve()
        if screenshot.thumbnail_path
        else None
    )

    # Older captures predate stored thumbnails. Materialize a compact preview on
    # the first request so every subsequent grid view avoids the full original.
    if thumbnail_path is None or not thumbnail_path.is_file():
        if not original_path.is_file():
            raise ApiError(
                "SCREENSHOT_FILE_NOT_FOUND",
                "Screenshot preview was not found.",
                404,
            )
        thumbnail = build_thumbnail(original_path.read_bytes(), screenshot.storage_path)
        if thumbnail is not None:
            screenshot.thumbnail_path, thumbnail_content = thumbnail
            thumbnail_path = storage.save(screenshot.thumbnail_path, thumbnail_content)
            db.add(screenshot)
            db.commit()

    path = thumbnail_path if thumbnail_path and thumbnail_path.is_file() else original_path
    if not path.is_file():
        raise ApiError("SCREENSHOT_FILE_NOT_FOUND", "Screenshot preview was not found.", 404)
    media_type = "image/jpeg" if path == thumbnail_path else screenshot.mime_type
    return FileResponse(
        path,
        media_type=media_type,
        headers={
            "Cache-Control": "private, max-age=1800",
            "Vary": "Authorization",
        },
    )


@router.delete("/{screenshot_id}")
def delete_screenshot(
    screenshot_id: UUID,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
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
