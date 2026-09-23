"""Regression coverage for the 1.1.95 sleep/hibernate false-overtime incident.

Version 1.1.95 credited a multi-hour freeze as active work; on resume its
cumulative active counter jumped by ~the frozen duration. The workday timeline
used to treat that jump as observed work, which surfaced as overnight overtime.

These tests pin the safeguard in ``activity_timeline._offline_gaps``:
* an untrusted (<= 1.1.95) counter jump across a long gap becomes UNTRACKED,
  never worked and never idle, so it is not paid as overtime;
* a supported client (1.1.96) with honest counters, and any client with
  continuous queued heartbeats, keep their legitimate offline work;
* a new local day never becomes payable from a non-working heartbeat alone.
"""

from datetime import UTC, date, datetime, time, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database.base import Base
from app.models import (
    ActivityEvent,
    Company,
    Device,
    Employee,
    EmployeeWorkProfile,
    WorkSession,
)
from app.schemas.session import HeartbeatRequest, SessionStartRequest
from app.services.activity_timeline import build_workday_timeline
from app.services.attendance import calculate_daily_attendance
from app.services.session_tracking import record_heartbeat, start_or_get_session

DAY = date(2026, 9, 10)


@pytest.fixture()
def ctx():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db: Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    company = Company(name="OT Co", status="active")
    db.add(company)
    db.flush()
    employee = Employee(
        company_id=company.id, name="OT Emp", email="ot@example.com",
        employee_code="OT-1", timezone="UTC", status="active",
    )
    db.add(employee)
    db.flush()
    db.add(
        EmployeeWorkProfile(
            company_id=company.id, employee_id=employee.id,
            shift_start=time(9, 0), shift_end=time(17, 0),
            working_days=[0, 1, 2, 3, 4], weekly_off_days=[5, 6],
            required_daily_minutes=480, late_grace_minutes=15, overtime_enabled=True,
        )
    )
    device = Device(
        company_id=company.id, employee_id=employee.id, device_name="OT Device",
        installation_id="ot-device", operating_system="Windows 11",
        agent_version="1.1.95", status="active",
    )
    db.add(device)
    db.commit()
    try:
        yield db, company, employee, device
    finally:
        db.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


def _at(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=UTC)


def _session(db, employee, device, *, started_at, ended_at):
    session = WorkSession(
        company_id=employee.company_id, employee_id=employee.id, device_id=device.id,
        timezone="UTC", started_at=started_at, ended_at=ended_at,
        status="ended" if ended_at else "active", active_seconds=0, idle_seconds=0,
    )
    db.add(session)
    db.flush()
    db.add(
        ActivityEvent(
            company_id=employee.company_id, employee_id=employee.id, device_id=device.id,
            session_id=session.id, event_type="session_started", event_timestamp=started_at,
            idempotency_key=f"start-{uuid4().hex[:8]}",
        )
    )
    return session


def _heartbeat(db, session, *, at, active, idle, version):
    db.add(
        ActivityEvent(
            company_id=session.company_id, employee_id=session.employee_id,
            device_id=session.device_id, session_id=session.id, event_type="heartbeat",
            event_timestamp=at,
            payload={
                "status": "active",
                "active_seconds": active,
                "idle_seconds": idle,
                "agent_version": version,
            },
            idempotency_key=f"hb-{uuid4().hex[:8]}",
        )
    )


def _timeline(db, employee, *, now):
    return build_workday_timeline(
        db,
        company_id=employee.company_id,
        employee_id=employee.id,
        timezone_name="UTC",
        target_date=DAY,
        now=now,
    )


def test_1195_hibernate_gap_with_ten_hour_jump_is_untracked_not_overtime(ctx):
    db, company, employee, device = ctx
    # Session opened the previous evening; the machine hibernated overnight and
    # resumed the next morning. The 1.1.95 client credited the freeze as active,
    # so the active counter jumped ~9h59m across the gap.
    session = _session(
        db, employee, device,
        started_at=_at("2026-09-09T22:00:00"),
        ended_at=_at("2026-09-10T08:04:00"),
    )
    _heartbeat(db, session, at=_at("2026-09-09T22:05:00"), active=300, idle=0, version="1.1.95")
    _heartbeat(db, session, at=_at("2026-09-10T08:04:00"), active=300 + 35940, idle=0, version="1.1.95")
    db.commit()

    timeline = _timeline(db, employee, now=_at("2026-09-10T08:05:00"))
    # The frozen overnight span on the new day is not credited as worked.
    assert timeline["worked_seconds"] == 0

    row, _ = calculate_daily_attendance(
        db, employee=employee, work_date=DAY, now=_at("2026-09-10T08:05:00")
    )
    assert row.recorded_overtime_seconds == 0
    assert row.pre_shift_extra_seconds == 0
    assert row.post_shift_extra_seconds == 0


def test_1196_honest_counters_after_a_freeze_stay_untracked(ctx):
    db, company, employee, device = ctx
    # 1.1.96's trackingTick discards tick gaps > 60s, so after a freeze its active
    # counter does NOT jump. The unobserved gap is correctly untracked.
    session = _session(
        db, employee, device,
        started_at=_at("2026-09-10T09:00:00"),
        ended_at=_at("2026-09-10T15:00:00"),
    )
    _heartbeat(db, session, at=_at("2026-09-10T09:05:00"), active=300, idle=0, version="1.1.96")
    # Resumed 5 hours later; honest client counter barely advanced.
    _heartbeat(db, session, at=_at("2026-09-10T14:05:00"), active=360, idle=0, version="1.1.96")
    db.commit()

    timeline = _timeline(db, employee, now=_at("2026-09-10T15:00:00"))
    assert timeline["untracked_seconds"] > 4 * 3600
    # Only the ~6 minutes of real, observed work is worked.
    assert timeline["worked_seconds"] <= 15 * 60


def test_1196_network_outage_with_continuous_counter_progress_stays_worked(ctx):
    db, company, employee, device = ctx
    # A real network outage on a supported client: the machine kept running and
    # the counter advanced by the full gap. A single long gap with trusted,
    # gap-covering counter progress remains observed work.
    session = _session(
        db, employee, device,
        started_at=_at("2026-09-10T09:00:00"),
        ended_at=_at("2026-09-10T12:00:00"),
    )
    _heartbeat(db, session, at=_at("2026-09-10T09:05:00"), active=300, idle=0, version="1.1.96")
    _heartbeat(db, session, at=_at("2026-09-10T11:05:00"), active=300 + 7200, idle=0, version="1.1.96")
    db.commit()

    timeline = _timeline(db, employee, now=_at("2026-09-10T12:00:00"))
    # The two trusted hours of offline work are preserved.
    assert timeline["worked_seconds"] >= 2 * 3600


def test_queued_offline_heartbeats_keep_old_client_work(ctx):
    db, company, employee, device = ctx
    # Even on 1.1.95, legitimate offline work delivered as multiple queued
    # heartbeats at short intervals never produces a single long gap, so the
    # safeguard does not touch it.
    session = _session(
        db, employee, device,
        started_at=_at("2026-09-10T09:00:00"),
        ended_at=_at("2026-09-10T09:10:00"),
    )
    base = _at("2026-09-10T09:00:00")
    for minute in range(0, 11):
        _heartbeat(
            db, session, at=base + timedelta(minutes=minute),
            active=minute * 60, idle=0, version="1.1.95",
        )
    db.commit()

    timeline = _timeline(db, employee, now=_at("2026-09-10T09:10:00"))
    assert timeline["worked_seconds"] >= 9 * 60
    assert timeline["untracked_seconds"] == 0


def test_new_day_non_working_heartbeat_does_not_start_a_payable_session(ctx):
    db, company, employee, device = ctx
    started = start_or_get_session(
        db, device, SessionStartRequest(started_at=_at("2026-09-09T22:00:00")),
    )
    from uuid import UUID

    session_id = UUID(started["session"]["id"])
    # An idle heartbeat on the new local day must not open a new (midnight)
    # session — only fresh active input may.
    result = record_heartbeat(
        db, device=device, session_id=session_id,
        payload=HeartbeatRequest(
            event_id=uuid4(),
            timestamp=_at("2026-09-10T03:00:00"),
            status="idle",
            active_seconds=0,
            idle_seconds=3600,
            agent_version="1.1.95",
        ),
    )
    assert result.get("restarted") is not True
    assert result.get("ignored") is True

    new_day_timeline = _timeline(db, employee, now=_at("2026-09-10T03:01:00"))
    assert new_day_timeline["worked_seconds"] == 0


def test_unsupported_version_flags_update_required(ctx):
    db, company, employee, device = ctx
    started = start_or_get_session(
        db, device, SessionStartRequest(started_at=_at("2026-09-10T09:00:00")),
    )
    from uuid import UUID

    session_id = UUID(started["session"]["id"])
    result = record_heartbeat(
        db, device=device, session_id=session_id,
        payload=HeartbeatRequest(
            event_id=uuid4(),
            timestamp=_at("2026-09-10T09:05:00"),
            status="active",
            active_seconds=300,
            idle_seconds=0,
            agent_version="1.1.95",
        ),
    )
    assert result["update_required"] is True

    supported = record_heartbeat(
        db, device=device, session_id=session_id,
        payload=HeartbeatRequest(
            event_id=uuid4(),
            timestamp=_at("2026-09-10T09:06:00"),
            status="active",
            active_seconds=360,
            idle_seconds=0,
            agent_version="1.1.96",
        ),
    )
    assert supported["update_required"] is False


# ---- administrative session close (incident remediation) --------------------


def _admin(db, company, *, role="general_admin", data_scope="company"):
    from app.models import AdminUser

    admin = AdminUser(
        company_id=company.id, name=f"{role} user", email=f"{role}-{uuid4().hex[:8]}@x.com",
        password_hash="x", role=role, status="active", data_scope=data_scope,
    )
    db.add(admin)
    db.commit()
    return admin


def test_admin_close_ends_live_session_once_and_is_idempotent(ctx):
    from app.api.v1.attendance import AdminSessionCloseRequest, admin_close_session

    db, company, employee, device = ctx
    started = start_or_get_session(
        db, device, SessionStartRequest(started_at=_at("2026-09-10T09:00:00")),
    )
    from uuid import UUID

    session_id = UUID(started["session"]["id"])
    admin = _admin(db, company)

    result = admin_close_session(
        employee_id=employee.id,
        payload=AdminSessionCloseRequest(
            ended_at=_at("2026-09-10T09:30:00"), reason="Verified boundary — 1.1.95 incident"
        ),
        request=None,
        current_admin=admin,
        db=db,
    )
    assert result["data"]["closed"] is True
    closed = db.get(WorkSession, session_id)
    assert closed.ended_at is not None
    first_end = closed.ended_at

    # Idempotent: a second close finds no live session and does not move the end.
    again = admin_close_session(
        employee_id=employee.id,
        payload=AdminSessionCloseRequest(reason="second attempt"),
        request=None,
        current_admin=admin,
        db=db,
    )
    assert again["data"]["closed"] is False
    assert db.get(WorkSession, session_id).ended_at == first_end


def test_stale_heartbeat_cannot_reopen_an_admin_closed_session(ctx):
    from app.api.v1.attendance import AdminSessionCloseRequest, admin_close_session

    db, company, employee, device = ctx
    started = start_or_get_session(
        db, device, SessionStartRequest(started_at=_at("2026-09-10T09:00:00")),
    )
    from uuid import UUID

    session_id = UUID(started["session"]["id"])
    admin = _admin(db, company)
    admin_close_session(
        employee_id=employee.id,
        payload=AdminSessionCloseRequest(
            ended_at=_at("2026-09-10T09:30:00"), reason="admin close"
        ),
        request=None,
        current_admin=admin,
        db=db,
    )
    # A queued heartbeat from before the close (stale) must be ignored, not
    # reopen the session.
    result = record_heartbeat(
        db, device=device, session_id=session_id,
        payload=HeartbeatRequest(
            event_id=uuid4(),
            timestamp=_at("2026-09-10T09:20:00"),
            status="active",
            active_seconds=1200,
            idle_seconds=0,
            agent_version="1.1.96",
        ),
    )
    assert result.get("restarted") is not True
    assert result.get("ignored") is True
    assert db.get(WorkSession, session_id).ended_at is not None


def test_admin_close_requires_device_management_capability(ctx):
    from app.api.v1.attendance import AdminSessionCloseRequest, admin_close_session
    from app.core.exceptions import ApiError

    db, company, employee, device = ctx
    start_or_get_session(
        db, device, SessionStartRequest(started_at=_at("2026-09-10T09:00:00")),
    )
    # A team leader has timesheets.manage but not devices.manage.
    leader = _admin(db, company, role="team_owner", data_scope="assigned_teams")
    with pytest.raises(ApiError) as exc:
        admin_close_session(
            employee_id=employee.id,
            payload=AdminSessionCloseRequest(reason="should be forbidden"),
            request=None,
            current_admin=leader,
            db=db,
        )
    assert exc.value.status_code == 403
