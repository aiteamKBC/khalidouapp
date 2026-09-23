"""Meeting Mode lifecycle guards and payable accounting."""

from datetime import UTC, date, datetime, time, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.exceptions import ApiError
from app.database.base import Base
from app.models import (
    ActivityEvent,
    AdminUser,
    Company,
    Device,
    Employee,
    EmployeeWorkProfile,
    MeetingRecord,
    TimeAdjustmentRequest,
    WorkSession,
)
from app.services.attendance import calculate_daily_attendance
from app.services.meetings import (
    auto_end_due_meetings,
    end_meeting,
    review_meeting,
    start_meeting,
)

WORK_DATE = date(2026, 9, 10)


@pytest.fixture()
def ctx():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db: Session = sessionmaker(bind=engine, expire_on_commit=False)()
    company = Company(name="Meet Co", status="active")
    db.add(company)
    db.flush()
    employee = Employee(
        company_id=company.id, name="Meet Emp", email="meet@example.com",
        employee_code="MEET-1", timezone="UTC", status="active",
    )
    db.add(employee)
    db.flush()
    profile = EmployeeWorkProfile(
        company_id=company.id, employee_id=employee.id,
        shift_start=time(9, 0), shift_end=time(17, 0),
        working_days=[0, 1, 2, 3, 4], weekly_off_days=[5, 6],
        required_daily_minutes=480, late_grace_minutes=15, overtime_enabled=True,
        break_rules=[
            {"name": "Lunch", "start_time": "12:00", "end_time": "12:30", "minutes": 30, "paid": True},
            {"name": "Short break", "start_time": "15:00", "end_time": "15:15", "minutes": 15, "paid": True},
        ],
    )
    device = Device(
        company_id=company.id, employee_id=employee.id, device_name="Meet Device",
        installation_id="meet-device", operating_system="Windows 11",
        agent_version="1.0.0", status="active",
    )
    admin = AdminUser(
        company_id=company.id, name="Meet Admin", email="meetadmin@example.com",
        password_hash="x", role="hr", status="active", data_scope="company",
    )
    db.add_all([profile, device, admin])
    db.commit()
    try:
        yield db, company, employee, device, admin
    finally:
        db.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


def _dt(h, m=0):
    return datetime(2026, 9, 10, h, m, tzinfo=UTC)


def _session_with_idle(db, employee, device, *, start, end, idle_windows):
    session = WorkSession(
        company_id=employee.company_id, employee_id=employee.id, device_id=device.id,
        started_at=start, ended_at=end, status="ended",
        active_seconds=int((end - start).total_seconds()), idle_seconds=0,
    )
    db.add(session)
    db.flush()
    events = [ActivityEvent(
        company_id=employee.company_id, employee_id=employee.id, device_id=device.id,
        session_id=session.id, event_type="session_started", event_timestamp=start,
        idempotency_key=f"s-{uuid4().hex[:8]}",
    )]
    for i, (a, b) in enumerate(idle_windows):
        events.append(ActivityEvent(
            company_id=employee.company_id, employee_id=employee.id, device_id=device.id,
            session_id=session.id, event_type="idle_started", event_timestamp=a,
            idempotency_key=f"is-{i}-{uuid4().hex[:8]}"))
        events.append(ActivityEvent(
            company_id=employee.company_id, employee_id=employee.id, device_id=device.id,
            session_id=session.id, event_type="idle_ended", event_timestamp=b,
            idempotency_key=f"ie-{i}-{uuid4().hex[:8]}"))
    events.append(ActivityEvent(
        company_id=employee.company_id, employee_id=employee.id, device_id=device.id,
        session_id=session.id, event_type="session_ended", event_timestamp=end,
        idempotency_key=f"e-{uuid4().hex[:8]}"))
    db.add_all(events)
    db.commit()
    return session


def _calc(db, employee):
    row, _ = calculate_daily_attendance(
        db, employee=employee, work_date=WORK_DATE, now=datetime(2026, 9, 11, tzinfo=UTC))
    return row


# ---- lifecycle guards -------------------------------------------------------

def test_start_meeting_is_idempotent_on_replay(ctx):
    db, company, employee, device, admin = ctx
    kwargs = dict(title="Standup", reason="Daily sync", expected_end_at=_dt(15, 30),
                  idempotency_key="mtg-1", started_at=_dt(15))
    first = start_meeting(db, device=device, **kwargs)
    second = start_meeting(db, device=device, **kwargs)
    assert first.id == second.id
    assert db.query(MeetingRecord).count() == 1


def test_serialize_meeting_exposes_idempotency_key_for_desktop_merge(ctx):
    from app.services.meetings import serialize_meeting

    db, company, employee, device, admin = ctx
    row = start_meeting(db, device=device, title="Call", reason="client sync",
                        expected_end_at=_dt(15, 30), idempotency_key="mtg-key", started_at=_dt(15))
    data = serialize_meeting(row)
    # The desktop merges its durable local record with server rows by this key.
    assert data["idempotency_key"] == "mtg-key"


def test_meeting_queue_payload_is_bound_to_the_enrolled_device(ctx):
    db, company, employee, device, admin = ctx
    with pytest.raises(ApiError) as exc:
        start_meeting(
            db,
            device=device,
            claimed_device_id=uuid4(),
            title="Standup",
            reason="Daily sync",
            expected_end_at=_dt(15, 30),
            idempotency_key="mtg-wrong-device",
            started_at=_dt(15),
        )
    assert exc.value.code == "MEETING_DEVICE_MISMATCH"


def test_overlapping_meeting_is_rejected(ctx):
    db, company, employee, device, admin = ctx
    start_meeting(db, device=device, title="A", reason="first", expected_end_at=_dt(15, 30),
                  idempotency_key="mtg-a", started_at=_dt(15))
    with pytest.raises(ApiError) as exc:
        start_meeting(db, device=device, title="B", reason="second", expected_end_at=_dt(16),
                      idempotency_key="mtg-b", started_at=_dt(15, 10))
    assert exc.value.code == "MEETING_ALREADY_ACTIVE"


def test_offline_replay_cannot_overlap_an_already_ended_meeting(ctx):
    db, company, employee, device, admin = ctx
    start_meeting(
        db,
        device=device,
        title="A",
        reason="first",
        expected_end_at=_dt(15, 30),
        idempotency_key="mtg-ended-a",
        started_at=_dt(15),
    )
    end_meeting(db, device=device, idempotency_key="mtg-ended-a", ended_at=_dt(15, 30))
    with pytest.raises(ApiError) as exc:
        start_meeting(
            db,
            device=device,
            title="B",
            reason="offline replay",
            expected_end_at=_dt(15, 40),
            idempotency_key="mtg-ended-b",
            started_at=_dt(15, 10),
        )
    assert exc.value.code == "MEETING_ALREADY_ACTIVE"


def test_expected_end_before_start_is_rejected(ctx):
    db, company, employee, device, admin = ctx
    with pytest.raises(ApiError) as exc:
        start_meeting(db, device=device, title="A", reason="bad", expected_end_at=_dt(14),
                      idempotency_key="mtg-x", started_at=_dt(15))
    assert exc.value.code == "INVALID_MEETING_END"


def test_expected_end_is_clamped_to_shift_end(ctx):
    db, company, employee, device, admin = ctx
    meeting = start_meeting(db, device=device, title="Late", reason="runs late",
                            expected_end_at=_dt(19), idempotency_key="mtg-late", started_at=_dt(16, 30))
    assert meeting.expected_end_at.replace(tzinfo=UTC) == _dt(17)  # shift ends 17:00


def test_end_meeting_clamps_and_is_idempotent(ctx):
    db, company, employee, device, admin = ctx
    start_meeting(db, device=device, title="A", reason="meet", expected_end_at=_dt(15, 30),
                  idempotency_key="mtg-e", started_at=_dt(15))
    ended = end_meeting(db, device=device, idempotency_key="mtg-e", ended_at=_dt(16))
    assert ended.ended_at.replace(tzinfo=UTC) == _dt(15, 30)  # clamped to expected end
    assert ended.lifecycle_state == "ended"
    again = end_meeting(db, device=device, idempotency_key="mtg-e", ended_at=_dt(16, 30))
    assert again.ended_at.replace(tzinfo=UTC) == _dt(15, 30)  # idempotent, no extension


def test_auto_end_closes_meetings_past_expected_end(ctx):
    db, company, employee, device, admin = ctx
    start_meeting(db, device=device, title="A", reason="meet", expected_end_at=_dt(15, 30),
                  idempotency_key="mtg-auto", started_at=_dt(15))
    closed = auto_end_due_meetings(db, now=_dt(16))
    assert closed == 1
    row = db.query(MeetingRecord).one()
    assert row.lifecycle_state == "ended"
    assert row.ended_at.replace(tzinfo=UTC) == _dt(15, 30)


def test_late_offline_end_shortens_an_auto_ended_meeting(ctx):
    db, company, employee, device, admin = ctx
    start_meeting(db, device=device, title="A", reason="meet", expected_end_at=_dt(16),
                  idempotency_key="mtg-late-end", started_at=_dt(15))
    auto_end_due_meetings(db, now=_dt(16, 30))
    # The device ended at 15:15 while offline; its End arrives after the auto-end.
    ended = end_meeting(db, device=device, idempotency_key="mtg-late-end", ended_at=_dt(15, 15))
    assert ended.ended_at.replace(tzinfo=UTC) == _dt(15, 15)
    # A replay with a later time never lengthens it again.
    again = end_meeting(db, device=device, idempotency_key="mtg-late-end", ended_at=_dt(15, 45))
    assert again.ended_at.replace(tzinfo=UTC) == _dt(15, 15)


# ---- accounting -------------------------------------------------------------

def _work_with_meeting_gap(db, employee, device, meeting_idle):
    # Works the whole shift except lunch, short break, and the meeting window.
    return _session_with_idle(
        db, employee, device, start=_dt(9), end=_dt(17),
        idle_windows=[(_dt(12), _dt(12, 30)), (_dt(15), _dt(15, 15)), meeting_idle],
    )


def test_pending_meeting_is_provisional_then_paid_on_approval(ctx):
    db, company, employee, device, admin = ctx
    _work_with_meeting_gap(db, employee, device, (_dt(15, 30), _dt(16, 30)))
    meeting = start_meeting(db, device=device, title="Client call", reason="1h client call",
                            expected_end_at=_dt(16, 30), idempotency_key="mtg-acc", started_at=_dt(15, 30))
    end_meeting(db, device=device, idempotency_key="mtg-acc", ended_at=_dt(16, 30))

    row = _calc(db, employee)
    sources = row.calculation_sources
    # Pending: the meeting hour is provisional — not paid, not deducted.
    assert sources["pending_meeting_seconds"] == 3600
    assert sources["approved_meeting_seconds"] == 0
    assert row.idle_seconds == 0
    payable_pending = row.total_payable_seconds
    assert payable_pending == 7 * 3600  # 6h15 work + 45m break, meeting unpaid

    review_meeting(db, admin=admin, meeting=meeting, status="approved",
                   approved_seconds=None, note="ok")
    db.commit()
    row2 = _calc(db, employee)
    assert row2.calculation_sources["approved_meeting_seconds"] == 3600
    assert row2.total_payable_seconds == 8 * 3600  # meeting hour now paid once

    # A generic untimestamped manual credit cannot pay the same already-covered
    # meeting/shift deficit a second time or inflate the visible classifications.
    db.add(
        TimeAdjustmentRequest(
            company_id=company.id,
            employee_id=employee.id,
            device_id=device.id,
            request_type="manual_time",
            requested_date=WORK_DATE,
            requested_seconds=3600,
            approved_seconds=3600,
            reason="Duplicate generic correction",
            status="approved",
        )
    )
    db.commit()
    row3 = _calc(db, employee)
    assert row3.approved_manual_seconds == 0
    assert row3.calculation_sources["approved_manual_requested_seconds"] == 3600
    assert row3.total_payable_seconds == 8 * 3600


def test_meeting_with_activity_pays_once_and_rejection_keeps_work(ctx):
    db, company, employee, device, admin = ctx
    # Meeting 15:30-16:30 but the employee works the first 20m (no idle event
    # until 15:50), then is idle 15:50-16:30.
    _session_with_idle(
        db, employee, device, start=_dt(9), end=_dt(17),
        idle_windows=[(_dt(12), _dt(12, 30)), (_dt(15), _dt(15, 15)), (_dt(15, 50), _dt(16, 30))],
    )
    meeting = start_meeting(db, device=device, title="Workshop", reason="hands-on workshop",
                            expected_end_at=_dt(16, 30), idempotency_key="mtg-mix", started_at=_dt(15, 30))
    end_meeting(db, device=device, idempotency_key="mtg-mix", ended_at=_dt(16, 30))
    review_meeting(db, admin=admin, meeting=meeting, status="approved",
                   approved_seconds=None, note=None)
    db.commit()
    row = _calc(db, employee)
    # Meeting interval paid once: 20m as work + 40m as approved meeting.
    assert row.calculation_sources["approved_meeting_seconds"] == 40 * 60
    assert row.total_payable_seconds == 8 * 3600
    assert row.idle_seconds == 0

    # Now reject a fresh identical meeting scenario: genuine 20m work is kept and
    # the remaining 40m is evaluated as ordinary idle (15m grace, 25m deducted).
    meeting.status = "pending"
    meeting.approved_seconds = None
    db.commit()
    review_meeting(db, admin=admin, meeting=meeting, status="rejected",
                   approved_seconds=None, note="not a real meeting")
    db.commit()
    row2 = _calc(db, employee)
    assert row2.calculation_sources["approved_meeting_seconds"] == 0
    # 40m idle: 15m paid grace, 25m deductible. Work (incl. the 20m) is retained.
    assert row2.calculation_sources["paid_idle_grace_seconds"] == 15 * 60
    assert row2.idle_seconds == 25 * 60


def test_review_rejects_self_review_is_enforced_at_api_only(ctx):
    # The service enforces meeting-must-be-ended and single-decision; self-review
    # is enforced at the API layer (mirrors time-adjustments).
    db, company, employee, device, admin = ctx
    meeting = start_meeting(db, device=device, title="A", reason="meet", expected_end_at=_dt(15, 30),
                            idempotency_key="mtg-r", started_at=_dt(15))
    with pytest.raises(ApiError) as exc:
        review_meeting(db, admin=admin, meeting=meeting, status="approved",
                       approved_seconds=None, note=None)
    assert exc.value.code == "MEETING_NOT_ENDED"


# ---- who may reach the review surface ---------------------------------------

def test_meeting_reviewer_gate_allows_admin_hr_and_team_leaders(ctx):
    from app.api.v1.meetings import _require_meeting_reviewer
    from app.models import Team, TeamOwner

    db, company, employee, device, admin = ctx

    # HR / company-scope admin passes.
    _require_meeting_reviewer(db, admin)

    # A team leader (owns a team) passes even without company data scope.
    team = Team(company_id=company.id, name="Team A", status="active")
    db.add(team)
    db.flush()
    leader = AdminUser(
        company_id=company.id, name="Lead", email="lead@example.com",
        password_hash="x", role="team_owner", status="active",
        data_scope="assigned_teams",
    )
    db.add(leader)
    db.flush()
    db.add(TeamOwner(team_id=team.id, admin_user_id=leader.id))
    db.commit()
    _require_meeting_reviewer(db, leader)  # does not raise

    # A non-leader without company scope is refused.
    plain = AdminUser(
        company_id=company.id, name="Plain", email="plain@example.com",
        password_hash="x", role="team_owner", status="active",
        data_scope="assigned_teams",
    )
    db.add(plain)
    db.commit()
    with pytest.raises(ApiError) as exc:
        _require_meeting_reviewer(db, plain)
    assert exc.value.code == "MEETING_REVIEW_FORBIDDEN"
