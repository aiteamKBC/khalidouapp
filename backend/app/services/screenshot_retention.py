from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Screenshot, TrackingSettings
from app.storage.local import LocalScreenshotStorage


def cleanup_expired_screenshots(
    db: Session,
    *,
    now: datetime | None = None,
    batch_size: int = 200,
) -> int:
    """Delete expired screenshot files and soft-delete their database records.

    Work is committed in bounded batches. A single unbounded transaction could
    exceed PostgreSQL's idle-in-transaction timeout on a large backlog, roll
    back after the files were already unlinked, and leave the records forever
    "live" — so every later run re-selected the same rows and never made
    progress. Committing each batch guarantees forward progress.
    """
    current_time = now or datetime.now(UTC)
    storage = LocalScreenshotStorage()
    deleted = 0
    tracking_rows = db.scalars(select(TrackingSettings)).all()
    for tracking in tracking_rows:
        cutoff = current_time - timedelta(days=max(1, tracking.screenshot_retention_days))
        while True:
            screenshots = db.scalars(
                select(Screenshot)
                .where(
                    Screenshot.company_id == tracking.company_id,
                    Screenshot.captured_at < cutoff,
                    Screenshot.deleted_at.is_(None),
                )
                .limit(batch_size)
            ).all()
            if not screenshots:
                break
            for screenshot in screenshots:
                storage.delete(screenshot.storage_path)
                if screenshot.thumbnail_path:
                    storage.delete(screenshot.thumbnail_path)
                screenshot.deleted_at = current_time
                screenshot.status = "expired"
                db.add(screenshot)
                deleted += 1
            # Persist this batch before moving on so an interruption in a later
            # batch cannot strand the rows already unlinked from storage.
            db.commit()
    return deleted
