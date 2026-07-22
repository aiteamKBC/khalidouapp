from hashlib import sha256
from io import BytesIO
from pathlib import PurePosixPath
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session
from PIL import Image, UnidentifiedImageError

from app.core.config import settings
from app.core.exceptions import ApiError
from app.models import (
    Device,
    Employee,
    Screenshot,
    ScreenshotCaptureEvent,
    TrackingSettings,
)
from app.schemas.screenshot import (
    ScreenshotCompleteRequest,
    ScreenshotInitiateRequest,
    ScreenshotSkipRequest,
)
from app.services.session_tracking import get_owned_session, utc
from app.services.schedules import effective_schedule, timezone_for
from app.services.work_profiles import get_or_create_work_profile
from app.storage.local import LocalScreenshotStorage

ALLOWED_SCREENSHOT_MIME_TYPES = {"image/jpeg", "image/webp"}


def build_thumbnail(content: bytes, storage_path: str) -> tuple[str, bytes] | None:
    """Create a compact JPEG preview without modifying the evidence-quality original."""
    try:
        with Image.open(BytesIO(content)) as image:
            image.thumbnail(
                (settings.screenshot_thumbnail_width, settings.screenshot_thumbnail_width),
                Image.Resampling.LANCZOS,
            )
            if image.mode != "RGB":
                image = image.convert("RGB")
            output = BytesIO()
            image.save(output, format="JPEG", quality=70, optimize=True, progressive=True)
    except (UnidentifiedImageError, OSError, ValueError):
        return None
    path = str(PurePosixPath(storage_path).with_suffix(".thumb.jpg"))
    return path, output.getvalue()


def extension_for_mime_type(mime_type: str) -> str:
    if mime_type == "image/jpeg":
        return "jpg"
    if mime_type == "image/webp":
        return "webp"
    raise ApiError("INVALID_SCREENSHOT_TYPE", "Unsupported screenshot MIME type.", 400)


def validate_screenshot_size(file_size: int) -> None:
    max_bytes = settings.screenshot_max_file_size_mb * 1024 * 1024
    if file_size > max_bytes:
        raise ApiError(
            "SCREENSHOT_TOO_LARGE",
            "Screenshot exceeds the configured maximum file size.",
            413,
            {"max_bytes": max_bytes},
        )


def build_storage_path(device: Device, payload: ScreenshotInitiateRequest) -> str:
    captured_at = utc(payload.captured_at)
    ext = extension_for_mime_type(payload.mime_type)
    return str(
        PurePosixPath(
            str(device.company_id),
            str(device.employee_id),
            f"{captured_at.year:04d}",
            f"{captured_at.month:02d}",
            f"{captured_at.day:02d}",
            f"{payload.screenshot_id}.{ext}",
        )
    )


def serialize_screenshot(screenshot: Screenshot) -> dict[str, Any]:
    return {
        "id": str(screenshot.id),
        "company_id": str(screenshot.company_id),
        "employee_id": str(screenshot.employee_id),
        "device_id": str(screenshot.device_id),
        "session_id": str(screenshot.session_id) if screenshot.session_id else None,
        "team_id": str(screenshot.team_id) if screenshot.team_id else None,
        "project_id": str(screenshot.project_id) if screenshot.project_id else None,
        "task_id": str(screenshot.task_id) if screenshot.task_id else None,
        "captured_at": utc(screenshot.captured_at).isoformat(),
        "mime_type": screenshot.mime_type,
        "width": screenshot.width,
        "height": screenshot.height,
        "display_id": screenshot.display_id,
        "display_name": screenshot.display_name,
        "file_size": screenshot.file_size,
        "checksum": screenshot.checksum,
        "work_category": screenshot.work_category,
        "power_source": screenshot.power_source,
        "status": screenshot.status,
        "tracked_seconds": screenshot.tracked_seconds,
        "deleted_time_seconds": screenshot.deleted_time_seconds,
        "created_at": utc(screenshot.created_at).isoformat(),
    }


def get_owned_screenshot(db: Session, device: Device, screenshot_id: UUID) -> Screenshot:
    screenshot = db.scalar(
        select(Screenshot).where(
            Screenshot.id == screenshot_id,
            Screenshot.company_id == device.company_id,
            Screenshot.employee_id == device.employee_id,
            Screenshot.device_id == device.id,
        )
    )
    if screenshot is None:
        raise ApiError("SCREENSHOT_NOT_FOUND", "Screenshot was not found for this device.", 404)
    return screenshot


def initiate_screenshot(
    db: Session, device: Device, payload: ScreenshotInitiateRequest
) -> dict[str, Any]:
    validate_screenshot_size(payload.file_size)
    if payload.power_source != "ac":
        raise ApiError(
            "SCREENSHOT_AC_POWER_REQUIRED",
            "Screenshot capture is allowed only while the device reports AC power.",
            409,
        )
    tracking_settings = db.scalar(
        select(TrackingSettings).where(TrackingSettings.company_id == device.company_id)
    )
    if tracking_settings is not None and not tracking_settings.screenshot_enabled:
        raise ApiError(
            "SCREENSHOT_CAPTURE_DISABLED",
            "Screenshot capture is disabled by company policy.",
            403,
        )
    session = get_owned_session(db, device, payload.session_id) if payload.session_id else None
    existing = db.scalar(
        select(Screenshot).where(
            Screenshot.id == payload.screenshot_id,
            Screenshot.company_id == device.company_id,
        )
    )
    if existing is not None:
        return {
            "screenshot": serialize_screenshot(existing),
            "upload_url": f"/api/v1/agent/screenshots/{existing.id}/upload",
            "duplicate": True,
        }

    employee = db.get(Employee, device.employee_id)
    if employee is None or employee.status != "active":
        raise ApiError(
            "SCREENSHOT_EMPLOYEE_INACTIVE",
            "This device is not assigned to an active employee.",
            403,
        )
    category = "unknown"
    if employee is not None:
        captured_at = utc(payload.captured_at)
        profile = get_or_create_work_profile(db, employee)
        local_day = captured_at.astimezone(timezone_for(employee)).date()
        schedule = effective_schedule(db, employee, profile, local_day)
        if schedule["start_at"] and schedule["end_at"]:
            category = (
                "scheduled_shift"
                if schedule["start_at"] <= captured_at <= schedule["end_at"]
                else "off_shift"
            )
        else:
            category = "off_shift"

    screenshot = Screenshot(
        id=payload.screenshot_id,
        company_id=device.company_id,
        employee_id=device.employee_id,
        device_id=device.id,
        session_id=session.id if session else None,
        team_id=session.team_id if session else None,
        project_id=session.project_id if session else None,
        task_id=session.task_id if session else None,
        captured_at=utc(payload.captured_at),
        storage_path=build_storage_path(device, payload),
        thumbnail_path=None,
        mime_type=payload.mime_type,
        width=payload.width,
        height=payload.height,
        display_id=payload.display_id,
        display_name=payload.display_name,
        file_size=payload.file_size,
        checksum=payload.checksum.lower(),
        work_category=category,
        power_source=payload.power_source,
        status="initiated",
        tracked_seconds=0,
    )
    if tracking_settings is not None:
        screenshot.tracked_seconds = max(
            1,
            round(
                tracking_settings.screenshot_interval_minutes
                * 60
                / max(1, tracking_settings.screenshots_per_interval * payload.display_count)
            ),
        )
    db.add(screenshot)
    db.add(
        ScreenshotCaptureEvent(
            company_id=device.company_id,
            employee_id=device.employee_id,
            device_id=device.id,
            session_id=session.id if session else None,
            screenshot_id=screenshot.id,
            event_key=f"captured:{screenshot.id}",
            occurred_at=utc(payload.captured_at),
            outcome="captured",
            reason=None,
            work_category=category,
            power_source=payload.power_source,
            tracking_status=session.status if session else "device_active",
        )
    )
    db.commit()
    db.refresh(screenshot)

    return {
        "screenshot": serialize_screenshot(screenshot),
        "upload_url": f"/api/v1/agent/screenshots/{screenshot.id}/upload",
        "duplicate": False,
    }


def record_screenshot_skip(
    db: Session, device: Device, payload: ScreenshotSkipRequest
) -> dict[str, Any]:
    event_key = f"skip:{payload.event_id}"
    existing = db.scalar(
        select(ScreenshotCaptureEvent).where(
            ScreenshotCaptureEvent.device_id == device.id,
            ScreenshotCaptureEvent.event_key == event_key,
        )
    )
    if existing is not None:
        return {"recorded": True, "duplicate": True}
    session = get_owned_session(db, device, payload.session_id) if payload.session_id else None
    employee = db.get(Employee, device.employee_id)
    category = "unknown"
    occurred_at = utc(payload.occurred_at)
    if employee is not None:
        profile = get_or_create_work_profile(db, employee)
        local_day = occurred_at.astimezone(timezone_for(employee)).date()
        schedule = effective_schedule(db, employee, profile, local_day)
        if schedule["start_at"] and schedule["end_at"]:
            category = (
                "scheduled_shift"
                if schedule["start_at"] <= occurred_at <= schedule["end_at"]
                else "off_shift"
            )
        else:
            category = "off_shift"
    db.add(
        ScreenshotCaptureEvent(
            company_id=device.company_id,
            employee_id=device.employee_id,
            device_id=device.id,
            session_id=session.id if session else None,
            screenshot_id=None,
            event_key=event_key,
            occurred_at=occurred_at,
            outcome="skipped",
            reason=payload.reason,
            work_category=category,
            power_source=payload.power_source,
            tracking_status=payload.tracking_status,
        )
    )
    db.commit()
    return {"recorded": True, "duplicate": False, "work_category": category}


def upload_screenshot_content(
    db: Session,
    *,
    device: Device,
    screenshot_id: UUID,
    content: bytes,
    content_type: str | None,
) -> dict[str, Any]:
    screenshot = get_owned_screenshot(db, device, screenshot_id)
    if screenshot.status not in {"initiated", "uploaded", "completed"}:
        raise ApiError("INVALID_SCREENSHOT_STATUS", "Screenshot is not ready for upload.", 400)
    if (
        screenshot.mime_type not in ALLOWED_SCREENSHOT_MIME_TYPES
        or content_type not in ALLOWED_SCREENSHOT_MIME_TYPES
    ):
        raise ApiError("INVALID_SCREENSHOT_TYPE", "Unsupported screenshot MIME type.", 400)

    validate_screenshot_size(len(content))
    checksum = sha256(content).hexdigest()
    if checksum.lower() != screenshot.checksum.lower():
        raise ApiError("CHECKSUM_MISMATCH", "Screenshot checksum does not match metadata.", 400)
    if len(content) != screenshot.file_size:
        raise ApiError("FILE_SIZE_MISMATCH", "Screenshot file size does not match metadata.", 400)

    storage = LocalScreenshotStorage()
    storage.save(screenshot.storage_path, content)
    thumbnail = build_thumbnail(content, screenshot.storage_path)
    if thumbnail is not None:
        screenshot.thumbnail_path, thumbnail_content = thumbnail
        storage.save(screenshot.thumbnail_path, thumbnail_content)
    screenshot.status = "uploaded"
    db.add(screenshot)
    db.commit()
    db.refresh(screenshot)

    return {"screenshot": serialize_screenshot(screenshot)}


def complete_screenshot(
    db: Session,
    *,
    device: Device,
    screenshot_id: UUID,
    payload: ScreenshotCompleteRequest,
) -> dict[str, Any]:
    screenshot = get_owned_screenshot(db, device, screenshot_id)
    if payload.checksum.lower() != screenshot.checksum.lower():
        raise ApiError("CHECKSUM_MISMATCH", "Screenshot checksum does not match metadata.", 400)
    if payload.file_size != screenshot.file_size:
        raise ApiError("FILE_SIZE_MISMATCH", "Screenshot file size does not match metadata.", 400)
    if screenshot.status not in {"uploaded", "completed"}:
        raise ApiError("SCREENSHOT_UPLOAD_INCOMPLETE", "Screenshot upload has not completed.", 400)

    screenshot.status = "completed"
    db.add(screenshot)
    db.commit()
    db.refresh(screenshot)
    return {"screenshot": serialize_screenshot(screenshot)}
