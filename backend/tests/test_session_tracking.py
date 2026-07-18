from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database.base import Base
from app.models import ActivityEvent, Company, Device, Employee, WorkSession
from app.schemas.session import HeartbeatRequest, SessionEndRequest, SessionStartRequest
from app.services.session_tracking import (
    end_session,
    get_current_session,
    record_heartbeat,
    start_or_get_session,
)


@pytest.fixture()
def tracking_context():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(
        bind=engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )
    db: Session = testing_session()

    company = Company(name="Session Tracking Company", status="active")
    db.add(company)
    db.flush()
    employee = Employee(
        company_id=company.id,
        name="Tracked Employee",
        email="tracked@example.com",
        employee_code="TRACKED",
        timezone="UTC",
        status="active",
    )
    db.add(employee)
    db.flush()
    device = Device(
        company_id=company.id,
        employee_id=employee.id,
        device_name="Tracked Device",
        installation_id="tracked-installation",
        operating_system="Windows 11",
        agent_version="1.0.0",
        status="active",
    )
    db.add(device)
    db.commit()

    try:
        yield db, device
    finally:
        db.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_duplicate_session_end_keeps_original_end_state(tracking_context):
    db, device = tracking_context
    started_at = datetime.now(UTC) - timedelta(minutes=10)
    session = WorkSession(
        company_id=device.company_id,
        employee_id=device.employee_id,
        device_id=device.id,
        started_at=started_at,
        status="active",
        active_seconds=120,
        idle_seconds=10,
    )
    db.add(session)
    db.commit()

    first_event_id = uuid4()
    first_ended_at = datetime.now(UTC)
    original = end_session(
        db,
        device=device,
        session_id=session.id,
        payload=SessionEndRequest(
            event_id=first_event_id,
            ended_at=first_ended_at,
            active_seconds=321,
            idle_seconds=45,
            reason="Paused by employee",
        ),
    )["session"]

    retried = end_session(
        db,
        device=device,
        session_id=session.id,
        payload=SessionEndRequest(
            event_id=uuid4(),
            ended_at=first_ended_at + timedelta(hours=1),
            active_seconds=999,
            idle_seconds=888,
            reason="Late retry with different values",
        ),
    )["session"]

    assert retried["ended_at"] == original["ended_at"]
    assert retried["active_seconds"] == original["active_seconds"] == 321
    assert retried["idle_seconds"] == original["idle_seconds"] == 45
    assert retried["updated_at"] == original["updated_at"]
    assert db.scalar(
        select(func.count()).select_from(ActivityEvent).where(
            ActivityEvent.session_id == session.id,
            ActivityEvent.event_type == "session_ended",
        )
    ) == 1
    end_event = db.scalar(
        select(ActivityEvent).where(
            ActivityEvent.session_id == session.id,
            ActivityEvent.event_type == "session_ended",
        )
    )
    assert end_event is not None
    assert end_event.idempotency_key == str(first_event_id)


def test_session_can_start_again_after_end(tracking_context):
    db, device = tracking_context
    first_started_at = datetime.now(UTC) - timedelta(minutes=5)
    first = start_or_get_session(
        db,
        device,
        SessionStartRequest(started_at=first_started_at),
    )
    first_session_id = first["session"]["id"]
    assert first["created"] is True

    ended_at = datetime.now(UTC)
    current_session = get_current_session(db, device)
    assert current_session is not None
    ended = end_session(
        db,
        device=device,
        session_id=current_session.id,
        payload=SessionEndRequest(
            event_id=uuid4(),
            ended_at=ended_at,
            active_seconds=240,
            idle_seconds=30,
            reason="Pause before resume",
        ),
    )
    assert ended["session"]["status"] == "ended"
    assert get_current_session(db, device) is None

    restarted = start_or_get_session(
        db,
        device,
        SessionStartRequest(started_at=ended_at + timedelta(seconds=1)),
    )

    assert restarted["created"] is True
    assert restarted["session"]["id"] != first_session_id
    assert restarted["session"]["status"] == "active"
    assert restarted["session"]["ended_at"] is None
    assert restarted["session"]["active_seconds"] == 0
    assert restarted["session"]["idle_seconds"] == 0
    assert str(get_current_session(db, device).id) == restarted["session"]["id"]


def test_offline_session_is_not_returned_as_current(tracking_context):
    db, device = tracking_context
    offline = WorkSession(
        company_id=device.company_id,
        employee_id=device.employee_id,
        device_id=device.id,
        started_at=datetime.now(UTC) - timedelta(hours=2),
        status="offline",
        active_seconds=3600,
        idle_seconds=0,
    )
    db.add(offline)
    db.commit()

    assert get_current_session(db, device) is None

    restarted = start_or_get_session(
        db,
        device,
        SessionStartRequest(started_at=datetime.now(UTC)),
    )
    db.refresh(offline)

    assert restarted["created"] is True
    assert restarted["session"]["id"] != str(offline.id)
    assert offline.ended_at is not None
    assert offline.status == "ended"


def test_heartbeat_after_local_day_changes_restarts_session(tracking_context):
    db, device = tracking_context
    started_at = datetime(2026, 7, 16, 9, 0, tzinfo=UTC)
    heartbeat_at = datetime(2026, 7, 17, 10, 0, tzinfo=UTC)
    stale = WorkSession(
        company_id=device.company_id,
        employee_id=device.employee_id,
        device_id=device.id,
        started_at=started_at,
        status="active",
        active_seconds=3600,
        idle_seconds=0,
    )
    db.add(stale)
    db.commit()

    result = record_heartbeat(
        db,
        device=device,
        session_id=stale.id,
        payload=HeartbeatRequest(
            event_id=uuid4(),
            timestamp=heartbeat_at,
            status="active",
            active_seconds=30 * 60 * 60,
            idle_seconds=0,
            agent_version="1.0.0",
        ),
    )
    db.refresh(stale)

    assert result["restarted"] is True
    assert result["session"]["id"] != str(stale.id)
    assert result["session"]["started_at"] == heartbeat_at.isoformat()
    assert result["session"]["active_seconds"] == 0
    assert stale.status == "ended"
    assert stale.ended_at.replace(tzinfo=UTC) == datetime(2026, 7, 17, 0, 0, tzinfo=UTC)
