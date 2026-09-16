from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.services.screenshot_retention as retention
from app.database.base import Base
from app.models import Company, Screenshot, TrackingSettings


class _FakeStorage:
    """Records deletions without touching the filesystem."""

    deleted: list[str] = []

    def __init__(self) -> None:
        pass

    def delete(self, path: str) -> bool:
        _FakeStorage.deleted.append(path)
        return True


@pytest.fixture()
def db_session(monkeypatch):
    monkeypatch.setattr(retention, "LocalScreenshotStorage", _FakeStorage)
    _FakeStorage.deleted = []
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(
        bind=engine, autoflush=False, autocommit=False, expire_on_commit=False
    )
    db: Session = testing_session()
    try:
        yield db
    finally:
        db.close()


def _screenshot(company_id, captured_at):
    return Screenshot(
        company_id=company_id,
        employee_id=uuid4(),
        device_id=uuid4(),
        captured_at=captured_at,
        storage_path=f"a/b/{uuid4()}.jpg",
        thumbnail_path=f"a/b/{uuid4()}-thumb.jpg",
        mime_type="image/jpeg",
        width=100,
        height=100,
        file_size=1000,
        checksum=uuid4().hex,
        work_category="unknown",
    )


def test_cleanup_batches_and_expires_all_old_screenshots(db_session):
    company = Company(name="Retention Co", status="active")
    db_session.add(company)
    db_session.flush()
    db_session.add(
        TrackingSettings(company_id=company.id, screenshot_retention_days=1)
    )

    now = datetime(2026, 9, 10, tzinfo=UTC)
    old = now - timedelta(days=5)
    fresh = now - timedelta(hours=1)
    for _ in range(5):
        db_session.add(_screenshot(company.id, old))
    recent = _screenshot(company.id, fresh)
    db_session.add(recent)
    db_session.commit()

    # batch_size smaller than the backlog forces multiple committed batches.
    deleted = retention.cleanup_expired_screenshots(db_session, now=now, batch_size=2)

    assert deleted == 5
    expired = db_session.scalars(
        select(Screenshot).where(Screenshot.status == "expired")
    ).all()
    assert len(expired) == 5
    assert all(s.deleted_at is not None for s in expired)
    # Each expired row's file + thumbnail were handed to storage.delete.
    assert len(_FakeStorage.deleted) == 10
    # The recent screenshot is untouched.
    db_session.refresh(recent)
    assert recent.deleted_at is None
    assert recent.status != "expired"


def test_cleanup_is_idempotent_on_already_expired_rows(db_session):
    company = Company(name="Retention Co2", status="active")
    db_session.add(company)
    db_session.flush()
    db_session.add(
        TrackingSettings(company_id=company.id, screenshot_retention_days=1)
    )
    now = datetime(2026, 9, 10, tzinfo=UTC)
    db_session.add(_screenshot(company.id, now - timedelta(days=3)))
    db_session.commit()

    first = retention.cleanup_expired_screenshots(db_session, now=now)
    second = retention.cleanup_expired_screenshots(db_session, now=now)
    assert first == 1
    # Already soft-deleted rows are excluded, so a second pass does no work
    # (and cannot loop forever).
    assert second == 0
