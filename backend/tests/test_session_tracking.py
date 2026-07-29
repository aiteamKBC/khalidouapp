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
    ActivityEventRequest,
    HeartbeatRequest,
    PauseStartRequest,
    SessionEndRequest,
    SessionStartRequest,
)
from app.services.session_tracking import (
    end_session,
    get_current_session,
    record_agent_event,
    record_heartbeat,
    resume_paid_pause,
    start_paid_pause,
    start_or_get_session,
)
from app.services.activity_timeline import build_workday_timeline


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


def test_foreground_activity_is_reduced_to_safe_usage_metadata(tracking_context):
    db, device = tracking_context
    started = start_or_get_session(
        db,
        device,
        SessionStartRequest(started_at=datetime.now(UTC) - timedelta(minutes=1)),
    )
    event_id = uuid4()

    record_agent_event(
        db,
        device=device,
        session_id=UUID(started["session"]["id"]),
        payload=ActivityEventRequest(
            event_id=event_id,
            event_type="foreground_activity",
            event_timestamp=datetime.now(UTC),
            payload={
                "application_name": "  Google   Chrome ",
                "process_name": "chrome",
                "site_domain": "www.example.com",
                "ended_at": datetime.now(UTC).isoformat(),
                "duration_seconds": 9_999,
                "full_url": "https://example.com/private?secret=value",
                "window_title": "Sensitive page title",
            },
        ),
    )

    event = db.scalar(select(ActivityEvent).where(ActivityEvent.idempotency_key == str(event_id)))
    assert event is not None
    assert event.payload == {
        "application_name": "Google Chrome",
        "process_name": "chrome",
        "site_domain": "example.com",
        "ended_at": event.payload["ended_at"],
        "duration_seconds": 300,
    }
    assert "full_url" not in event.payload
    assert "window_title" not in event.payload


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


def test_update_installation_checkpoints_without_ending_session(tracking_context):
    db, device = tracking_context
    session = WorkSession(
        company_id=device.company_id,
        employee_id=device.employee_id,
        device_id=device.id,
        started_at=datetime.now(UTC) - timedelta(minutes=10),
        status="active",
        active_seconds=120,
        idle_seconds=10,
    )
    db.add(session)
    db.commit()

    checkpoint_at = datetime.now(UTC)
    response = end_session(
        db,
        device=device,
        session_id=session.id,
        payload=SessionEndRequest(
            event_id=uuid4(),
            ended_at=checkpoint_at,
            active_seconds=321,
            idle_seconds=45,
            reason="Khaliduo update installation",
        ),
    )["session"]

    db.refresh(session)
    db.refresh(device)
    assert response["id"] == str(session.id)
    assert response["status"] == "active"
    assert response["ended_at"] is None
    assert session.ended_at is None
    assert session.active_seconds == 321
    assert session.idle_seconds == 45
    assert device.last_seen_at is not None
    assert get_current_session(db, device).id == session.id
    assert (
        db.scalar(
            select(func.count())
            .select_from(ActivityEvent)
            .where(
                ActivityEvent.session_id == session.id,
                ActivityEvent.event_type == "session_ended",
            )
        )
        == 0
    )


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
    # Nothing proves the employee worked past the session start, so the day ends
    # there rather than banking every unattended hour up to midnight.
    assert stale.ended_at.replace(tzinfo=UTC) == started_at
    next_session = get_current_session(db, device)
    assert next_session is not None
    started_event = db.scalar(
        select(ActivityEvent).where(
            ActivityEvent.session_id == next_session.id,
            ActivityEvent.event_type == "session_started",
        )
    )
    assert started_event is not None
    assert started_event.payload["source"] == "automatic_start"
    assert "continued_from_previous_day" not in started_event.payload
    assert "continued_session_started_at" not in started_event.payload

    timeline = build_workday_timeline(
        db,
        company_id=device.company_id,
        employee_id=device.employee_id,
        timezone_name="UTC",
        target_date=heartbeat_at.date(),
        now=heartbeat_at + timedelta(minutes=1),
        device_id=device.id,
    )
    assert timeline["continued_from_previous_day"] is False
    assert timeline["continued_session_started_at"] is None


def test_idle_gap_over_four_hours_starts_a_new_sign_in(tracking_context):
    db, device = tracking_context
    session_started_at = datetime(2026, 7, 21, 9, 0, tzinfo=UTC)
    idle_started_at = datetime(2026, 7, 21, 10, 0, tzinfo=UTC)
    returned_at = idle_started_at + timedelta(hours=4, seconds=1)
    started = start_or_get_session(
        db,
        device,
        SessionStartRequest(started_at=session_started_at),
    )
    previous_session_id = UUID(started["session"]["id"])
    record_agent_event(
        db,
        device=device,
        session_id=previous_session_id,
        payload=ActivityEventRequest(
            event_id=uuid4(),
            event_type="idle_started",
            event_timestamp=idle_started_at,
            payload={"idle_seconds": 120},
        ),
    )
    previous_session = db.get(WorkSession, previous_session_id)
    previous_session.idle_seconds = 4 * 60 * 60
    db.commit()

    return_event_id = uuid4()
    return_payload = ActivityEventRequest(
        event_id=return_event_id,
        event_type="idle_ended",
        event_timestamp=returned_at,
        payload={"idle_seconds": 4 * 60 * 60},
    )
    resumed = record_agent_event(
        db,
        device=device,
        session_id=previous_session_id,
        payload=return_payload,
    )

    db.refresh(previous_session)
    assert resumed["restarted"] is True
    assert resumed["restart_reason"] == "long_idle"
    assert resumed["session"]["id"] != str(previous_session_id)
    assert resumed["session"]["started_at"] == returned_at.isoformat()
    assert resumed["session"]["active_seconds"] == 0
    assert resumed["session"]["idle_seconds"] == 0
    assert previous_session.status == "ended"
    assert previous_session.ended_at.replace(tzinfo=UTC) == idle_started_at
    assert previous_session.idle_seconds == 120
    assert get_current_session(db, device).id == UUID(resumed["session"]["id"])

    retried = record_agent_event(
        db,
        device=device,
        session_id=previous_session_id,
        payload=return_payload,
    )
    assert retried["duplicate"] is True
    assert retried["session"]["id"] == resumed["session"]["id"]


def test_idle_gap_of_exactly_four_hours_keeps_the_same_session(tracking_context):
    db, device = tracking_context
    session_started_at = datetime(2026, 7, 21, 9, 0, tzinfo=UTC)
    idle_started_at = datetime(2026, 7, 21, 10, 0, tzinfo=UTC)
    returned_at = idle_started_at + timedelta(hours=4)
    started = start_or_get_session(
        db,
        device,
        SessionStartRequest(started_at=session_started_at),
    )
    session_id = UUID(started["session"]["id"])
    record_agent_event(
        db,
        device=device,
        session_id=session_id,
        payload=ActivityEventRequest(
            event_id=uuid4(),
            event_type="idle_started",
            event_timestamp=idle_started_at,
            payload={"idle_seconds": 0},
        ),
    )

    resumed = record_agent_event(
        db,
        device=device,
        session_id=session_id,
        payload=ActivityEventRequest(
            event_id=uuid4(),
            event_type="idle_ended",
            event_timestamp=returned_at,
            payload={"idle_seconds": 4 * 60 * 60},
        ),
    )

    assert resumed["session"]["id"] == str(session_id)
    assert resumed["session"]["status"] == "active"
    assert resumed["session"]["ended_at"] is None


def test_long_idle_across_midnight_signs_out_at_idle_start(tracking_context):
    db, device = tracking_context
    session_started_at = datetime(2026, 7, 20, 22, 0, tzinfo=UTC)
    idle_started_at = datetime(2026, 7, 20, 23, 0, tzinfo=UTC)
    idle_heartbeat_at = datetime(2026, 7, 21, 2, 0, tzinfo=UTC)
    returned_at = datetime(2026, 7, 21, 3, 0, 1, tzinfo=UTC)
    started = start_or_get_session(
        db,
        device,
        SessionStartRequest(started_at=session_started_at),
    )
    session_id = UUID(started["session"]["id"])
    record_agent_event(
        db,
        device=device,
        session_id=session_id,
        payload=ActivityEventRequest(
            event_id=uuid4(),
            event_type="idle_started",
            event_timestamp=idle_started_at,
            payload={"idle_seconds": 60},
        ),
    )

    idle_heartbeat = record_heartbeat(
        db,
        device=device,
        session_id=session_id,
        payload=HeartbeatRequest(
            event_id=uuid4(),
            timestamp=idle_heartbeat_at,
            status="idle",
            active_seconds=3600,
            idle_seconds=3 * 60 * 60,
            agent_version="1.0.0",
        ),
    )
    assert idle_heartbeat.get("restarted") is not True
    assert idle_heartbeat["session"]["id"] == str(session_id)

    resumed = record_agent_event(
        db,
        device=device,
        session_id=session_id,
        payload=ActivityEventRequest(
            event_id=uuid4(),
            event_type="idle_ended",
            event_timestamp=returned_at,
            payload={
                "idle_started_at": idle_started_at.isoformat(),
                "idle_gap_seconds": 4 * 60 * 60 + 1,
                "idle_seconds_before_gap": 60,
            },
        ),
    )

    previous_session = db.get(WorkSession, session_id)
    assert previous_session.status == "ended"
    assert previous_session.ended_at.replace(tzinfo=UTC) == idle_started_at
    assert previous_session.idle_seconds == 60
    assert resumed["restarted"] is True
    assert resumed["session"]["started_at"] == returned_at.isoformat()


def test_overnight_session_ends_at_the_last_active_heartbeat(tracking_context):
    db, device = tracking_context
    started_at = datetime(2026, 7, 16, 9, 0, tzinfo=UTC)
    last_worked_at = datetime(2026, 7, 16, 17, 30, tzinfo=UTC)
    session = WorkSession(
        company_id=device.company_id,
        employee_id=device.employee_id,
        device_id=device.id,
        started_at=started_at,
        status="active",
        active_seconds=3600,
        idle_seconds=0,
    )
    db.add(session)
    db.commit()
    db.add(
        ActivityEvent(
            company_id=device.company_id,
            employee_id=device.employee_id,
            device_id=device.id,
            session_id=session.id,
            event_type="heartbeat",
            event_timestamp=last_worked_at,
            payload={"status": "active"},
            idempotency_key="worked-marker",
        )
    )
    db.commit()

    record_heartbeat(
        db,
        device=device,
        session_id=session.id,
        payload=HeartbeatRequest(
            event_id=uuid4(),
            timestamp=datetime(2026, 7, 17, 10, 0, tzinfo=UTC),
            status="active",
            active_seconds=30 * 60 * 60,
            idle_seconds=0,
            agent_version="1.0.0",
        ),
    )
    db.refresh(session)

    assert session.status == "ended"
    assert session.ended_at.replace(tzinfo=UTC) == last_worked_at


def test_idle_beyond_the_threshold_ends_the_session_where_work_stopped(tracking_context):
    db, device = tracking_context
    started_at = datetime(2026, 7, 16, 9, 0, tzinfo=UTC)
    session = WorkSession(
        company_id=device.company_id,
        employee_id=device.employee_id,
        device_id=device.id,
        started_at=started_at,
        status="active",
        active_seconds=600,
        idle_seconds=0,
    )
    db.add(session)
    db.commit()

    result = record_heartbeat(
        db,
        device=device,
        session_id=session.id,
        payload=HeartbeatRequest(
            event_id=uuid4(),
            timestamp=started_at + timedelta(minutes=45),
            status="idle",
            active_seconds=600,
            idle_seconds=45 * 60,
            agent_version="1.0.0",
        ),
    )
    db.refresh(session)

    assert session.status == "ended"
    assert session.ended_at.replace(tzinfo=UTC) == started_at
    assert result["restarted"] is False


def test_heartbeat_accumulates_multiple_idle_episodes(tracking_context):
    db, device = tracking_context
    started_at = datetime(2026, 7, 16, 9, 0, tzinfo=UTC)
    session = WorkSession(
        company_id=device.company_id,
        employee_id=device.employee_id,
        device_id=device.id,
        started_at=started_at,
        status="active",
        active_seconds=0,
        idle_seconds=0,
    )
    db.add(session)
    db.commit()

    heartbeats = [
        (2, "active", 2 * 60, 0),
        (5, "idle", 2 * 60, 3 * 60),
        (9, "active", 6 * 60, 0),
        # The agent counter describes only this idle episode. The backend must
        # retain the first three minutes and derive six cumulative idle minutes.
        (12, "idle", 6 * 60, 3 * 60),
    ]
    for minute, status, active_seconds, idle_seconds in heartbeats:
        record_heartbeat(
            db,
            device=device,
            session_id=session.id,
            payload=HeartbeatRequest(
                event_id=uuid4(),
                timestamp=started_at + timedelta(minutes=minute),
                status=status,
                active_seconds=active_seconds,
                idle_seconds=idle_seconds,
                agent_version="1.1.75",
            ),
        )

    db.refresh(session)
    assert session.status == "idle"
    assert session.ended_at is None
    assert session.active_seconds == 6 * 60
    assert session.idle_seconds == 6 * 60


def test_idle_heartbeat_does_not_reopen_an_ended_session(tracking_context):
    db, device = tracking_context
    started_at = datetime(2026, 7, 16, 9, 0, tzinfo=UTC)
    ended = WorkSession(
        company_id=device.company_id,
        employee_id=device.employee_id,
        device_id=device.id,
        started_at=started_at,
        ended_at=started_at + timedelta(hours=8),
        status="ended",
        active_seconds=600,
        idle_seconds=0,
    )
    db.add(ended)
    db.commit()

    result = record_heartbeat(
        db,
        device=device,
        session_id=ended.id,
        payload=HeartbeatRequest(
            event_id=uuid4(),
            timestamp=started_at + timedelta(hours=20),
            status="idle",
            active_seconds=600,
            idle_seconds=12 * 60 * 60,
            agent_version="1.0.0",
        ),
    )

    assert result["restarted"] is False
    assert result["session"]["id"] == str(ended.id)
    open_sessions = db.scalars(
        select(WorkSession).where(
            WorkSession.employee_id == device.employee_id,
            WorkSession.ended_at.is_(None),
        )
    ).all()
    assert open_sessions == []


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


def test_paid_pause_manual_resume_stays_resumed_and_uses_elapsed_time(tracking_context):
    db, device = tracking_context
    started = start_or_get_session(
        db,
        device,
        SessionStartRequest(started_at=datetime.now(UTC) - timedelta(minutes=5)),
    )
    session_id = UUID(started["session"]["id"])
    paused = start_paid_pause(
        db,
        device=device,
        session_id=session_id,
        payload=PauseStartRequest(requested_minutes=10, idempotency_key="manual-resume-test"),
    )
    pause_id = UUID(paused["pause"]["active_pause"]["id"])
    pause = db.get(PauseSession, pause_id)
    assert pause is not None
    pause.started_at = datetime.now(UTC) - timedelta(minutes=2)
    db.commit()

    resumed = resume_paid_pause(db, device=device, session_id=session_id)
    heartbeat = record_heartbeat(
        db,
        device=device,
        session_id=session_id,
        payload=HeartbeatRequest(
            event_id=uuid4(),
            timestamp=datetime.now(UTC),
            status="active",
            active_seconds=5 * 60,
            idle_seconds=0,
            agent_version="1.0.0",
        ),
    )
    db.refresh(pause)

    assert resumed["pause"]["active_pause"] is None
    assert heartbeat["pause"]["active_pause"] is None
    assert 119 <= pause.used_seconds <= 121
    assert resumed["pause"]["used_seconds"] == pause.used_seconds
    assert (
        db.scalar(
            select(func.count())
            .select_from(ActivityEvent)
            .where(
                ActivityEvent.session_id == session_id,
                ActivityEvent.event_type == "paid_pause_resumed",
            )
        )
        == 1
    )


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


def test_device_timezone_controls_shift_even_when_employee_profile_differs(
    tracking_context,
):
    db, device = tracking_context
    employee = db.get(Employee, device.employee_id)
    assert employee is not None
    employee.timezone = "Africa/Cairo"
    device.timezone = "Europe/London"
    device.timezone_source = "ip_geolocation"
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
    # London is UTC+1 in July, so a 10:00-18:00 London shift is 09:00-17:00 UTC.
    started_at = datetime(2026, 7, 21, 9, 0, tzinfo=UTC)
    heartbeat_at = datetime(2026, 7, 21, 17, 0, tzinfo=UTC)
    started = start_or_get_session(
        db,
        device,
        SessionStartRequest(started_at=started_at),
    )

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

    assert heartbeat["session"]["timezone"] == "Europe/London"
    assert heartbeat["workday"]["normal_seconds"] == 8 * 60 * 60
    assert heartbeat["workday"]["extra_seconds"] == 0


def test_active_session_restarts_when_device_moves_to_another_timezone(
    tracking_context,
):
    db, device = tracking_context
    device.timezone = "Africa/Cairo"
    started_at = datetime(2026, 7, 21, 8, 0, tzinfo=UTC)
    started = start_or_get_session(
        db,
        device,
        SessionStartRequest(started_at=started_at),
    )
    old_session_id = UUID(started["session"]["id"])

    device.timezone = "Europe/London"
    heartbeat_at = started_at + timedelta(hours=1)
    restarted = record_heartbeat(
        db,
        device=device,
        session_id=old_session_id,
        payload=HeartbeatRequest(
            event_id=uuid4(),
            timestamp=heartbeat_at,
            status="active",
            active_seconds=60 * 60,
            idle_seconds=0,
            agent_version="1.0.0",
        ),
    )

    old_session = db.get(WorkSession, old_session_id)
    assert old_session is not None
    assert restarted["restarted"] is True
    assert restarted["session"]["id"] != str(old_session_id)
    assert restarted["session"]["timezone"] == "Europe/London"
    assert old_session.timezone == "Africa/Cairo"
    assert old_session.ended_at is not None


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
    device.timezone = "Africa/Cairo"
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
    first_session = db.get(WorkSession, UUID(first["session"]["id"]))
    first_session.timezone = "Asia/Riyadh"
    db.commit()
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
