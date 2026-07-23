from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database.base import Base
from app.core.exceptions import ApiError
from app.models import (
    ActivityEvent,
    Company,
    Device,
    Employee,
    EmployeeWorkProfile,
    OvertimeRecord,
    PauseBalance,
    PauseSession,
    WorkSession,
)
from app.schemas.session import (
    HeartbeatRequest,
    PauseStartRequest,
    SessionEndRequest,
    SessionStartRequest,
)
from app.services.session_tracking import (
    end_session,
    get_current_session,
    record_heartbeat,
    start_paid_pause,
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
    assert (
        db.scalar(
            select(func.count())
            .select_from(ActivityEvent)
            .where(
                ActivityEvent.session_id == session.id,
                ActivityEvent.event_type == "session_ended",
            )
        )
        == 1
    )
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


def test_paid_pause_auto_resumes_and_consumes_daily_balance(tracking_context):
    db, device = tracking_context
    started = start_or_get_session(
        db,
        device,
        SessionStartRequest(started_at=datetime.now(UTC) - timedelta(minutes=5)),
    )
    session_id = started["session"]["id"]

    paused = start_paid_pause(
        db,
        device=device,
        session_id=UUID(session_id),
        payload=PauseStartRequest(requested_minutes=3, idempotency_key="pause-test"),
    )

    assert paused["pause"]["active_pause"] is not None
    assert paused["pause"]["remaining_seconds"] == 7 * 60

    pause = db.scalar(select(PauseSession).where(PauseSession.work_session_id == UUID(session_id)))
    assert pause is not None
    pause.scheduled_end_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()

    heartbeat = record_heartbeat(
        db,
        device=device,
        session_id=UUID(session_id),
        payload=HeartbeatRequest(
            event_id=uuid4(),
            timestamp=datetime.now(UTC),
            status="active",
            active_seconds=5 * 60,
            idle_seconds=0,
            agent_version="1.0.0",
        ),
    )

    assert heartbeat["pause"]["active_pause"] is None
    assert heartbeat["pause"]["used_seconds"] == 3 * 60
    assert heartbeat["session"]["paid_pause_seconds"] == 3 * 60
    assert (
        db.scalar(
            select(func.count())
            .select_from(ActivityEvent)
            .where(
                ActivityEvent.session_id == UUID(session_id),
                ActivityEvent.event_type == "paid_pause_auto_resumed",
            )
        )
        == 1
    )


def test_paid_pause_rejects_requests_after_daily_balance_is_used(tracking_context):
    db, device = tracking_context
    started = start_or_get_session(
        db,
        device,
        SessionStartRequest(started_at=datetime.now(UTC) - timedelta(minutes=5)),
    )
    balance = db.scalar(
        select(PauseBalance).where(
            PauseBalance.employee_id == device.employee_id,
            PauseBalance.work_date == datetime.now(UTC).date(),
        )
    )
    assert balance is not None
    balance.used_seconds = 10 * 60
    db.commit()

    with pytest.raises(ApiError) as error:
        start_paid_pause(
            db,
            device=device,
            session_id=UUID(started["session"]["id"]),
            payload=PauseStartRequest(requested_minutes=1, idempotency_key="pause-exhausted"),
        )

    assert error.value.code == "PAUSE_BALANCE_EXHAUSTED"


def test_heartbeat_splits_normal_and_overtime_when_employee_is_eligible(tracking_context):
    db, device = tracking_context
    profile = EmployeeWorkProfile(
        company_id=device.company_id,
        employee_id=device.employee_id,
        shift_start=datetime.strptime("10:00", "%H:%M").time(),
        shift_end=datetime.strptime("18:00", "%H:%M").time(),
        required_daily_minutes=8 * 60,
        overtime_enabled=True,
    )
    db.add(profile)
    started_at = datetime(2026, 7, 21, 11, 0, tzinfo=UTC)
    heartbeat_at = datetime(2026, 7, 21, 19, 0, tzinfo=UTC)
    started = start_or_get_session(
        db,
        device,
        SessionStartRequest(started_at=started_at),
    )
    db.commit()

    heartbeat = record_heartbeat(
        db,
        device=device,
        session_id=UUID(started["session"]["id"]),
        payload=HeartbeatRequest(
            event_id=uuid4(),
            timestamp=heartbeat_at,
            status="active",
            active_seconds=8 * 60 * 60,
            idle_seconds=0,
            agent_version="1.0.0",
        ),
    )

    overtime = db.scalar(
        select(OvertimeRecord).where(
            OvertimeRecord.work_session_id == UUID(started["session"]["id"])
        )
    )
    assert heartbeat["workday"]["normal_seconds"] == 7 * 60 * 60
    assert heartbeat["workday"]["extra_seconds"] == 60 * 60
    assert heartbeat["workday"]["extra_time_status"] == "pending_overtime"
    assert overtime is not None
    assert overtime.status == "pending"
    assert overtime.recorded_extra_seconds == 60 * 60


def test_time_before_and_after_shift_never_counts_as_normal_work(tracking_context):
    db, device = tracking_context
    profile = EmployeeWorkProfile(
        company_id=device.company_id,
        employee_id=device.employee_id,
        shift_start=datetime.strptime("10:00", "%H:%M").time(),
        shift_end=datetime.strptime("18:00", "%H:%M").time(),
        required_daily_minutes=8 * 60,
        overtime_enabled=False,
    )
    db.add(profile)
    started_at = datetime(2026, 7, 21, 9, 0, tzinfo=UTC)
    heartbeat_at = datetime(2026, 7, 21, 19, 0, tzinfo=UTC)
    started = start_or_get_session(
        db,
        device,
        SessionStartRequest(started_at=started_at),
    )
    db.commit()

    heartbeat = record_heartbeat(
        db,
        device=device,
        session_id=UUID(started["session"]["id"]),
        payload=HeartbeatRequest(
            event_id=uuid4(),
            timestamp=heartbeat_at,
            status="active",
            active_seconds=10 * 60 * 60,
            idle_seconds=0,
            agent_version="1.0.0",
        ),
    )

    assert heartbeat["workday"]["normal_seconds"] == 8 * 60 * 60
    assert heartbeat["workday"]["extra_seconds"] == 2 * 60 * 60
    assert heartbeat["workday"]["extra_time_status"] == "recorded_not_counted"


def test_active_time_before_shift_is_extra_even_without_completed_shift_time(
    tracking_context,
):
    db, device = tracking_context
    db.add(
        EmployeeWorkProfile(
            company_id=device.company_id,
            employee_id=device.employee_id,
            shift_start=datetime.strptime("10:00", "%H:%M").time(),
            shift_end=datetime.strptime("18:00", "%H:%M").time(),
            required_daily_minutes=8 * 60,
            overtime_enabled=False,
        )
    )
    started_at = datetime(2026, 7, 21, 1, 0, tzinfo=UTC)
    heartbeat_at = datetime(2026, 7, 21, 2, 0, tzinfo=UTC)
    started = start_or_get_session(
        db,
        device,
        SessionStartRequest(started_at=started_at),
    )
    db.commit()

    heartbeat = record_heartbeat(
        db,
        device=device,
        session_id=UUID(started["session"]["id"]),
        payload=HeartbeatRequest(
            event_id=uuid4(),
            timestamp=heartbeat_at,
            status="active",
            active_seconds=60 * 60,
            idle_seconds=0,
            agent_version="1.0.0",
        ),
    )

    assert heartbeat["workday"]["normal_seconds"] == 0
    assert heartbeat["workday"]["extra_seconds"] == 60 * 60
    assert heartbeat["workday"]["extra_time_status"] == "recorded_not_counted"


def test_workday_totals_continue_across_restarted_sessions(tracking_context):
    db, device = tracking_context
    profile = EmployeeWorkProfile(
        company_id=device.company_id,
        employee_id=device.employee_id,
        shift_start=datetime.strptime("09:00", "%H:%M").time(),
        shift_end=datetime.strptime("17:00", "%H:%M").time(),
        required_daily_minutes=8 * 60,
        overtime_enabled=False,
    )
    db.add(profile)
    first_started_at = datetime(2026, 7, 21, 9, 0, tzinfo=UTC)
    first_ended_at = datetime(2026, 7, 21, 11, 0, tzinfo=UTC)
    first = start_or_get_session(
        db,
        device,
        SessionStartRequest(started_at=first_started_at),
    )
    end_session(
        db,
        device=device,
        session_id=UUID(first["session"]["id"]),
        payload=SessionEndRequest(
            ended_at=first_ended_at,
            active_seconds=2 * 60 * 60,
            idle_seconds=0,
            reason="Application restarted",
        ),
    )
    second_started_at = datetime(2026, 7, 21, 12, 0, tzinfo=UTC)
    second = start_or_get_session(
        db,
        device,
        SessionStartRequest(started_at=second_started_at),
    )

    heartbeat = record_heartbeat(
        db,
        device=device,
        session_id=UUID(second["session"]["id"]),
        payload=HeartbeatRequest(
            event_id=uuid4(),
            timestamp=second_started_at + timedelta(minutes=30),
            status="active",
            active_seconds=30 * 60,
            idle_seconds=0,
            agent_version="1.0.0",
        ),
    )

    assert heartbeat["workday"]["normal_seconds"] == 2 * 60 * 60 + 30 * 60
    assert heartbeat["workday"]["extra_seconds"] == 0


def test_session_end_cannot_replace_newer_server_totals_with_stale_client_values(
    tracking_context,
):
    db, device = tracking_context
    session = WorkSession(
        company_id=device.company_id,
        employee_id=device.employee_id,
        device_id=device.id,
        started_at=datetime.now(UTC) - timedelta(minutes=20),
        status="active",
        active_seconds=600,
        idle_seconds=90,
    )
    db.add(session)
    db.commit()

    ended = end_session(
        db,
        device=device,
        session_id=session.id,
        payload=SessionEndRequest(
            event_id=uuid4(),
            ended_at=datetime.now(UTC),
            active_seconds=10,
            idle_seconds=5,
            reason="Client restarted during an application update",
        ),
    )["session"]

    assert ended["active_seconds"] == 600
    assert ended["idle_seconds"] == 90
