from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Screenshot, TrackingSettings
from app.storage.local import LocalScreenshotStorage


def cleanup_expired_screenshots(db: Session, *, now: datetime | None = None) -> int:
    """Delete expired screenshot files and soft-delete their database records."""
    current_time = now or datetime.now(UTC)
    storage = LocalScreenshotStorage()
    deleted = 0
    tracking_rows = db.scalars(select(TrackingSettings)).all()
    for tracking in tracking_rows:
        cutoff = current_time - timedelta(days=max(1, tracking.screenshot_retention_days))
        screenshots = db.scalars(
            select(Screenshot).where(
                Screenshot.company_id == tracking.company_id,
                Screenshot.captured_at < cutoff,
                Screenshot.deleted_at.is_(None),
            )
        ).all()
        for screenshot in screenshots:
            storage.delete(screenshot.storage_path)
            if screenshot.thumbnail_path:
                storage.delete(screenshot.thumbnail_path)
            screenshot.deleted_at = current_time
            screenshot.status = "expired"
            db.add(screenshot)
            deleted += 1
    if deleted:
        db.commit()
    return deleted
