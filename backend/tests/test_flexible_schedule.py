"""Flexible schedules: the daily hours can be worked at any time of day.

A flexible employee owes ``required_daily_minutes`` (8h here) anywhere inside an
optional allowed window. Normal time ends once work plus banked rest reaches the
target; later work is extra time. There is no lateness or early leave, and the
paid break minutes (45 here) are a bank of rest the employee can take at any
time. Every scenario uses 2026-09-10 (a Thursday, a working day) in UTC.
"""

from datetime import UTC, date, datetime, time
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.exceptions import ApiError
from app.database.base import Base
from app.models import (
    ActivityEvent,
    Company,
    Device,
    Employee,
    EmployeeWorkProfile,
    LeaveRequest,
    OvertimeRecord,
    WorkSession,
)
from app.services.attendance import calculate_daily_attendance
from app.services.schedules import effective_schedule
from app.services.session_tracking import sync_session_time_buckets
from app.services.shift_reschedules import base_day_schedule, create_employee_request
from app.services.time_adjustments import create_employee_time_adjustment_request
from app.services.work_profiles import refresh_profile_completed_at, resolve_day_policy

WORK_DATE = date(2026, 9, 10)
HOUR = 3600
TARGET = 8 * HOUR
BANK = 45 * 60


@pytest.fixture()
def ctx():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db: Session = sessionmaker(bind=engine, expire_on_commit=False)()
    company = Company(name="Flexible Co", status="active")
    db.add(company)
    db.flush()
    employee = Employee(
        company_id=company.id,
        name="Flexible Employee",
        email="flexible@example.com",
        employee_code="FLX-1",
        timezone="UTC",
        status="active",
    )
    db.add(employee)
    db.flush()
    profile = EmployeeWorkProfile(
        company_id=company.id,
        employee_id=employee.id,
        shift_start=time(9, 0),
        shift_end=time(17, 0),
        working_days=[0, 1, 2, 3, 4],
        weekly_off_days=[5, 6],
        required_daily_minutes=480,
        late_grace_minutes=15,
        overtime_enabled=True,
        schedule_type="flexible",
        weekly_early_leave_minutes=120,
        break_rules=[
            {"name": "Lunch", "start_time": "12:00", "end_time": "12:30",
             "minutes": 30, "paid": True},
            {"name": "Short break", "start_time": "15:00", "end_time": "15:15",
             "minutes": 15, "paid": True},
        ],
    )
    device = Device(
        company_id=company.id,
        employee_id=employee.id,
        device_name="Flexible Device",
        installation_id="flexible-device",
        operating_system="Windows 11",
        agent_version="1.0.0",
        status="active",
        timezone="UTC",
    )
    db.add_all([profile, device])
    db.commit()
    try:
        yield db, employee, profile, device
    finally:
        db.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


def _dt(h, m=0):
    return datetime(2026, 9, 10, h, m, tzinfo=UTC)


def _event(employee, device, session, event_type, at):
    return ActivityEvent(
        company_id=employee.company_id,
        employee_id=employee.id,
        device_id=device.id,
        session_id=session.id,
        event_type=event_type,
        event_timestamp=at,
        idempotency_key=f"{event_type}-{uuid4().hex[:10]}",
    )


def _work(db, employee, device, *, start, end, idle=(), pauses=()):
    """One session worked from start to end, minus the idle and Pause windows."""
    session = WorkSession(
        company_id=employee.company_id,
        employee_id=employee.id,
        device_id=device.id,
        started_at=start,
        ended_at=end,
        status="ended",
        active_seconds=int((end - start).total_seconds()),
        idle_seconds=0,
    )
    db.add(session)
    db.flush()
    events = [_event(employee, device, session, "session_started", start)]
    for idle_start, idle_end in idle:
        events.append(_event(employee, device, session, "idle_started", idle_start))
        events.append(_event(employee, device, session, "idle_ended", idle_end))
    for pause_start, pause_end in pauses:
        events.append(_event(employee, device, session, "manual_pause_started", pause_start))
        events.append(_event(employee, device, session, "manual_pause_ended", pause_end))
    events.append(_event(employee, device, session, "session_ended", end))
    db.add_all(events)
    db.commit()
    return session


def _calc(db, employee):
    row, _ = calculate_daily_attendance(
        db, employee=employee, work_date=WORK_DATE, now=datetime(2026, 9, 11, tzinfo=UTC)
    )
    return row


def test_eight_hours_in_the_afternoon_and_evening_is_a_full_day(ctx):
    db, employee, _, device = ctx
    _work(db, employee, device, start=_dt(13), end=_dt(21))
    row = _calc(db, employee)
    assert row.normal_worked_seconds == TARGET
    assert row.total_payable_seconds == TARGET
    assert row.recorded_overtime_seconds == 0
    assert row.raw_late_seconds == 0
    assert row.early_leave_seconds == 0
    assert row.status == "present"
    assert row.calculation_sources["schedule_type"] == "flexible"
    assert row.calculation_sources["flexible_target_reached_at"] == _dt(21).isoformat()


def test_a_short_day_pays_only_the_hours_worked_and_is_not_early_leave(ctx):
    db, employee, _, device = ctx
    _work(db, employee, device, start=_dt(10), end=_dt(16, 30))
    row = _calc(db, employee)
    assert row.normal_worked_seconds == 6 * HOUR + 30 * 60
    assert row.total_payable_seconds == 6 * HOUR + 30 * 60
    assert row.early_leave_seconds == 0
    assert row.status == "present"
    assert row.calculation_sources["flexible_target_reached_at"] is None


def test_work_after_the_target_is_extra_time_and_creates_overtime(ctx):
    db, employee, _, device = ctx
    session = _work(db, employee, device, start=_dt(8), end=_dt(18))
    sync_session_time_buckets(db, session, at=datetime(2026, 9, 11, tzinfo=UTC))
    db.commit()
    db.refresh(session)
    assert session.normal_seconds == TARGET
    assert session.extra_seconds == 2 * HOUR
    record = db.scalar(select(OvertimeRecord).where(OvertimeRecord.work_session_id == session.id))
    assert record is not None
    assert record.recorded_extra_seconds == 2 * HOUR
    assert record.status == "pending"

    row = _calc(db, employee)
    assert row.normal_worked_seconds == TARGET
    assert row.post_shift_extra_seconds == 2 * HOUR
    # Extra time is paid only once the overtime is approved.
    assert row.total_payable_seconds == TARGET


def test_rest_up_to_the_break_bank_is_paid_and_counts_toward_the_target(ctx):
    db, employee, _, device = ctx
    _work(db, employee, device, start=_dt(9), end=_dt(17), idle=[(_dt(11), _dt(11, 45))])
    row = _calc(db, employee)
    assert row.normal_worked_seconds == 7 * HOUR + 15 * 60
    assert row.paid_break_seconds == BANK
    assert row.idle_seconds == 0
    assert row.total_payable_seconds == TARGET
    assert row.calculation_sources["break_bank_seconds"] == BANK
    assert row.calculation_sources["flexible_target_reached_at"] == _dt(17).isoformat()


def test_idle_beyond_the_bank_is_not_paid_past_the_daily_grace(ctx):
    db, employee, _, device = ctx
    _work(db, employee, device, start=_dt(9), end=_dt(17), idle=[(_dt(11), _dt(12, 15))])
    row = _calc(db, employee)
    # 6h45 worked + 45m bank + 15m daily idle grace; the last 15m is deductible.
    assert row.normal_worked_seconds == 6 * HOUR + 45 * 60
    assert row.paid_break_seconds == BANK
    assert row.idle_seconds == 15 * 60
    assert row.total_payable_seconds == 7 * HOUR + 45 * 60


def test_pause_is_paid_from_the_bank_before_idle(ctx):
    db, employee, _, device = ctx
    _work(
        db, employee, device, start=_dt(9), end=_dt(17, 30),
        pauses=[(_dt(12), _dt(12, 30))],
        idle=[(_dt(15), _dt(15, 30))],
    )
    row = _calc(db, employee)
    # The 30m Pause and 15m of the idle use up the bank; 15m idle falls in grace.
    assert row.paid_break_seconds == BANK
    assert row.calculation_sources["manual_pause_seconds"] == 0
    assert row.normal_worked_seconds == 7 * HOUR + 15 * 60
    assert row.total_payable_seconds == TARGET


def test_work_outside_the_allowed_window_does_not_count(ctx):
    db, employee, profile, device = ctx
    profile.flexible_window_start = time(7, 0)
    profile.flexible_window_end = time(23, 0)
    db.commit()
    _work(db, employee, device, start=_dt(5), end=_dt(13))
    row = _calc(db, employee)
    assert row.normal_worked_seconds == 6 * HOUR
    assert row.pre_shift_extra_seconds == 2 * HOUR
    assert row.total_payable_seconds == 6 * HOUR


def test_no_work_on_a_working_day_is_absent_and_paid_leave_pays_the_target(ctx):
    db, employee, _, _ = ctx
    row = _calc(db, employee)
    assert row.status == "absent"
    assert {"code": "missing_check_in", "seconds": TARGET} in row.issues

    db.add(
        LeaveRequest(
            company_id=employee.company_id,
            employee_id=employee.id,
            leave_type="annual",
            requested_days=1,
            start_date=WORK_DATE,
            end_date=WORK_DATE,
            status="approved",
        )
    )
    db.commit()
    row = _calc(db, employee)
    assert row.status == "approved_leave"
    assert row.total_payable_seconds == TARGET


def test_off_days_stay_off_days(ctx):
    db, employee, profile, _ = ctx
    saturday = effective_schedule(db, employee, profile, date(2026, 9, 12))
    assert saturday["flexible"] is True
    assert saturday["scheduled_day"] is False
    assert saturday["start_at"] is None


def test_the_day_policy_sends_the_window_and_bank_instead_of_break_times(ctx):
    db, employee, profile, _ = ctx
    policy = resolve_day_policy(db, employee, profile, WORK_DATE)
    assert policy["flexible"] is True
    assert policy["shift_start"] == time(0, 0)
    assert policy["shift_end"] == time(23, 59)
    assert policy["break_rules"] == []
    assert policy["break_bank_minutes"] == 45
    assert policy["required_daily_minutes"] == 480


def test_early_leave_cannot_be_requested(ctx):
    db, employee, _, device = ctx
    with pytest.raises(ApiError) as error:
        create_employee_time_adjustment_request(
            db,
            device=device,
            request_type="early_leave",
            requested_date=WORK_DATE,
            requested_minutes=60,
            reason="Doctor appointment",
            requested_leave_time=time(15, 0),
        )
    assert error.value.code == "EARLY_LEAVE_NOT_FLEXIBLE"


def test_shift_reschedules_do_not_apply(ctx):
    db, employee, _, _ = ctx
    assert base_day_schedule(db, employee, date(2026, 9, 14))["flexible"] is True
    with pytest.raises(ApiError) as error:
        create_employee_request(
            db,
            employee=employee,
            work_date=date(2026, 9, 14),
            requested_start=time(12, 0),
            requested_end=time(20, 0),
            reason="Appointment",
            now=datetime(2026, 9, 10, 9, tzinfo=UTC),
        )
    assert error.value.code == "SHIFT_RESCHEDULE_FLEXIBLE"


def test_saving_a_flexible_profile_keeps_its_daily_hours(ctx):
    _, _, profile, _ = ctx
    profile.required_daily_minutes = 360
    refresh_profile_completed_at(profile)
    # A fixed profile would reset this to the 8h shift length.
    assert profile.required_daily_minutes == 360


def test_a_window_shorter_than_the_daily_hours_is_rejected(ctx):
    _, _, profile, _ = ctx
    profile.flexible_window_start = time(9, 0)
    profile.flexible_window_end = time(15, 0)
    with pytest.raises(ApiError) as error:
        refresh_profile_completed_at(profile)
    assert error.value.code == "INVALID_FLEXIBLE_WINDOW"
