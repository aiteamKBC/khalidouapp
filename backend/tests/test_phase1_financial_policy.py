"""Phase-1 financial policy accounting.

Covers the paid-scheduled-break / worked-break bank / paid-late-allowance
behaviors gated by ``FinancialPolicyPeriod`` (the dashboard on/off switch).
Every scenario uses an explicit date, a 09:00-17:00 shift with 45 minutes of
paid scheduled breaks (lunch 12:00-12:30, short 15:00-15:15), and asserts to the
second. The final test proves that with the policy inactive the accounting is
unchanged.
"""

from datetime import UTC, date, datetime, time
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.timesheets import timesheet_rows
from app.database.base import Base
from app.core.exceptions import ApiError
from app.models import (
    ActivityEvent,
    Company,
    Device,
    Employee,
    EmployeeWorkProfile,
    TimeAdjustmentRequest,
    WorkSession,
)
from app.models.payroll import FinancialPolicyPeriod
from app.services.attendance import DELAYED_BREAK_REQUEST, calculate_daily_attendance
from app.services.financial_policy import (
    financial_policy_active,
    financial_policy_status,
    set_financial_policy_enabled,
)
from app.services.time_adjustments import create_employee_time_adjustment_request

WORK_DATE = date(2026, 9, 10)
SHIFT = 8 * 60 * 60


@pytest.fixture()
def ctx():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db: Session = sessionmaker(bind=engine, expire_on_commit=False)()
    company = Company(name="Policy Co", status="active")
    db.add(company)
    db.flush()
    employee = Employee(
        company_id=company.id,
        name="Policy Employee",
        email="policy@example.com",
        employee_code="POL-1",
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
        device_name="Policy Device",
        installation_id="policy-device",
        operating_system="Windows 11",
        agent_version="1.0.0",
        status="active",
    )
    db.add_all([profile, device])
    db.commit()
    try:
        yield db, company, employee, device
    finally:
        db.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


def _activate_policy(db, company, *, effective=WORK_DATE, ends_on=None):
    db.add(FinancialPolicyPeriod(company_id=company.id, starts_on=effective, ends_on=ends_on))
    db.commit()


def _dt(h, m=0):
    return datetime(2026, 9, 10, h, m, tzinfo=UTC)


def _session_with_events(db, employee, device, *, start, end, idle_windows):
    """Create one work session whose worked time is [start,end] minus idle_windows."""
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
    events = [
        ActivityEvent(
            company_id=employee.company_id,
            employee_id=employee.id,
            device_id=device.id,
            session_id=session.id,
            event_type="session_started",
            event_timestamp=start,
            idempotency_key=f"start-{uuid4().hex[:8]}",
        )
    ]
    for idx, (istart, iend) in enumerate(idle_windows):
        events.append(
            ActivityEvent(
                company_id=employee.company_id,
                employee_id=employee.id,
                device_id=device.id,
                session_id=session.id,
                event_type="idle_started",
                event_timestamp=istart,
                idempotency_key=f"idle-s-{idx}-{uuid4().hex[:8]}",
            )
        )
        events.append(
            ActivityEvent(
                company_id=employee.company_id,
                employee_id=employee.id,
                device_id=device.id,
                session_id=session.id,
                event_type="idle_ended",
                event_timestamp=iend,
                idempotency_key=f"idle-e-{idx}-{uuid4().hex[:8]}",
            )
        )
    events.append(
        ActivityEvent(
            company_id=employee.company_id,
            employee_id=employee.id,
            device_id=device.id,
            session_id=session.id,
            event_type="session_ended",
            event_timestamp=end,
            idempotency_key=f"end-{uuid4().hex[:8]}",
        )
    )
    db.add_all(events)
    db.commit()
    return session


def _calc(db, employee):
    row, _ = calculate_daily_attendance(
        db, employee=employee, work_date=WORK_DATE, now=datetime(2026, 9, 11, tzinfo=UTC)
    )
    return row


def test_full_scheduled_day_pays_eight_hours_with_paid_breaks(ctx):
    db, company, employee, device = ctx
    _activate_policy(db, company)
    # Rest both scheduled breaks; work the remaining 7h15.
    session = _session_with_events(
        db, employee, device, start=_dt(9), end=_dt(17),
        idle_windows=[(_dt(12), _dt(12, 30)), (_dt(15), _dt(15, 15))],
    )
    row = _calc(db, employee)
    assert row.normal_worked_seconds == 7 * 3600 + 15 * 60
    assert row.paid_break_seconds == 45 * 60
    assert row.total_payable_seconds == SHIFT
    sources = row.calculation_sources
    assert sources["earned_break_credit_seconds"] == 0
    assert sources["financial_policy_active"] is True


def test_working_through_lunch_earns_bank_and_is_not_a_consumed_break(ctx):
    db, company, employee, device = ctx
    _activate_policy(db, company)
    # Work the first 20m of lunch, rest the last 10m; short break fully rested.
    _session_with_events(
        db, employee, device, start=_dt(9), end=_dt(17),
        idle_windows=[(_dt(12, 20), _dt(12, 30)), (_dt(15), _dt(15, 15))],
    )
    row = _calc(db, employee)
    sources = row.calculation_sources
    # 20m worked through lunch counts as work, earns 20m bank, and is NOT also
    # counted as a consumed paid break.
    assert sources["worked_break_seconds"] == 20 * 60
    assert sources["earned_break_credit_seconds"] == 20 * 60
    assert row.paid_break_seconds == 25 * 60  # 10m lunch rest + 15m short break
    assert row.normal_worked_seconds == 7 * 3600 + 35 * 60
    assert sources["remaining_break_credit_seconds"] == 20 * 60


def test_saved_break_covers_later_idle_automatically_and_zeroes_the_bank(ctx):
    db, company, employee, device = ctx
    _activate_policy(db, company)
    # Work 20m of lunch (save 20m), then a 20m idle rest later at 16:00-16:20.
    _session_with_events(
        db, employee, device, start=_dt(9), end=_dt(17),
        idle_windows=[
            (_dt(12, 20), _dt(12, 30)),
            (_dt(15), _dt(15, 15)),
            (_dt(16), _dt(16, 20)),
        ],
    )
    row = _calc(db, employee)
    sources = row.calculation_sources
    assert sources["approved_delayed_break_seconds"] == 20 * 60
    assert sources["remaining_break_credit_seconds"] == 0
    assert row.idle_seconds == 0  # the 20m idle is covered by the saved break
    assert row.total_payable_seconds == SHIFT  # no duplicate lunch credit
    timesheet = timesheet_rows(
        db,
        company.id,
        WORK_DATE,
        WORK_DATE,
        employee_id=employee.id,
        include_screenshot_counts=False,
    )[0]
    assert timesheet["adjustment_seconds"] == 0  # covered rest is not manual active work
    assert timesheet["approved_delayed_break_seconds"] == 20 * 60
    assert timesheet["payable_seconds"] == SHIFT


def test_saved_break_cover_never_exceeds_what_was_saved(ctx):
    db, company, employee, device = ctx
    _activate_policy(db, company)
    # Save 20m, then idle 40m later: 20m covered, the other 20m stays idle.
    _session_with_events(
        db, employee, device, start=_dt(9), end=_dt(17),
        idle_windows=[
            (_dt(12, 20), _dt(12, 30)),
            (_dt(15), _dt(15, 15)),
            (_dt(16), _dt(16, 40)),
        ],
    )
    row = _calc(db, employee)
    assert row.calculation_sources["approved_delayed_break_seconds"] == 20 * 60
    assert row.calculation_sources["remaining_break_credit_seconds"] == 0
    # 20m left uncovered: the 15m daily idle grace pays part, 5m stays deductible.
    assert row.idle_seconds == 5 * 60


def test_saved_break_spreads_over_several_later_idle_periods(ctx):
    db, company, employee, device = ctx
    _activate_policy(db, company)
    _session_with_events(
        db, employee, device, start=_dt(9), end=_dt(17),
        idle_windows=[
            (_dt(12, 20), _dt(12, 30)),
            (_dt(13), _dt(13, 10)),
            (_dt(15), _dt(15, 15)),
            (_dt(16), _dt(16, 15)),
        ],
    )
    row = _calc(db, employee)
    # 10m at 13:00 and the first 10m at 16:00 use the 20m; the last 5m falls
    # under the daily idle grace.
    assert row.calculation_sources["approved_delayed_break_seconds"] == 20 * 60
    assert row.calculation_sources["remaining_break_credit_seconds"] == 0
    assert row.idle_seconds == 0
    assert row.total_payable_seconds == SHIFT


def test_saved_break_does_not_cover_idle_before_it_was_saved(ctx):
    db, company, employee, device = ctx
    _activate_policy(db, company)
    # Idle 11:00-11:10 happens before lunch, where the 20m is saved.
    _session_with_events(
        db, employee, device, start=_dt(9), end=_dt(17),
        idle_windows=[
            (_dt(11), _dt(11, 10)),
            (_dt(12, 20), _dt(12, 30)),
            (_dt(15), _dt(15, 15)),
        ],
    )
    sources = _calc(db, employee).calculation_sources
    assert sources["earned_break_credit_seconds"] == 20 * 60
    assert sources["approved_delayed_break_seconds"] == 0
    assert sources["remaining_break_credit_seconds"] == 20 * 60


def test_saved_break_requests_are_no_longer_accepted(ctx):
    db, company, employee, device = ctx
    _activate_policy(db, company)
    session = _session_with_events(
        db, employee, device, start=_dt(9), end=_dt(17),
        idle_windows=[(_dt(12, 20), _dt(12, 30)), (_dt(16), _dt(16, 10))],
    )
    with pytest.raises(ApiError) as exc:
        create_employee_time_adjustment_request(
            db,
            device=device,
            requested_date=WORK_DATE,
            requested_minutes=10,
            reason="Claiming my saved break by hand",
            request_type=DELAYED_BREAK_REQUEST,
            work_session_id=session.id,
            source_start_at=_dt(16),
            source_end_at=_dt(16, 10),
        )
    assert exc.value.code == "BREAK_CREDIT_AUTOMATIC"


def test_legacy_approved_request_does_not_pay_idle_twice(ctx):
    db, company, employee, device = ctx
    _activate_policy(db, company)
    session = _session_with_events(
        db, employee, device, start=_dt(9), end=_dt(17),
        idle_windows=[
            (_dt(12, 20), _dt(12, 30)),
            (_dt(15), _dt(15, 15)),
            (_dt(16), _dt(16, 20)),
        ],
    )
    db.add(
        TimeAdjustmentRequest(
            company_id=employee.company_id,
            employee_id=employee.id,
            device_id=device.id,
            work_session_id=session.id,
            request_type=DELAYED_BREAK_REQUEST,
            requested_date=WORK_DATE,
            requested_seconds=20 * 60,
            approved_seconds=20 * 60,
            status="approved",
            source_start_at=_dt(16),
            source_end_at=_dt(16, 20),
            reason="Approved before saved breaks became automatic.",
        )
    )
    db.commit()
    row = _calc(db, employee)
    assert row.calculation_sources["approved_delayed_break_seconds"] == 20 * 60
    assert row.total_payable_seconds == SHIFT


def test_day_after_switching_off_uses_old_accounting(ctx):
    db, company, employee, device = ctx
    # Switched on until the day before WORK_DATE: WORK_DATE is outside the period.
    _activate_policy(db, company, effective=date(2026, 9, 1), ends_on=date(2026, 9, 9))
    _session_with_events(
        db, employee, device, start=_dt(9), end=_dt(17),
        idle_windows=[(_dt(12, 20), _dt(12, 30)), (_dt(16), _dt(16, 20))],
    )
    sources = _calc(db, employee).calculation_sources
    assert sources["financial_policy_active"] is False
    assert sources["approved_delayed_break_seconds"] == 0


def test_switch_periods_never_backfill_or_roll_back(ctx):
    db, company, _employee, _device = ctx
    nov1, dec15, feb1 = date(2026, 11, 1), date(2026, 12, 15), date(2027, 2, 1)

    assert set_financial_policy_enabled(db, company.id, True, admin_user_id=None, today=nov1)
    assert not set_financial_policy_enabled(db, company.id, True, admin_user_id=None, today=nov1)
    assert set_financial_policy_enabled(db, company.id, False, admin_user_id=None, today=dec15)
    assert set_financial_policy_enabled(db, company.id, True, admin_user_id=None, today=feb1)
    db.commit()

    status = financial_policy_status(db, company.id)
    assert status["enabled"] is True
    assert status["active_since"] == "2027-02-01"
    periods = tuple(
        (
            date.fromisoformat(row["starts_on"]),
            date.fromisoformat(row["ends_on"]) if row["ends_on"] else None,
        )
        for row in status["periods"]
    )
    assert financial_policy_active(periods, date(2026, 10, 31)) is False  # no back-fill
    assert financial_policy_active(periods, nov1) is True
    assert financial_policy_active(periods, dec15) is True  # the off day itself stays covered
    assert financial_policy_active(periods, date(2026, 12, 16)) is False
    assert financial_policy_active(periods, date(2027, 1, 31)) is False
    assert financial_policy_active(periods, feb1) is True


def test_switching_back_on_the_next_day_continues_the_same_period(ctx):
    db, company, _employee, _device = ctx
    set_financial_policy_enabled(db, company.id, True, admin_user_id=None, today=date(2026, 11, 1))
    set_financial_policy_enabled(db, company.id, False, admin_user_id=None, today=date(2026, 11, 5))
    set_financial_policy_enabled(db, company.id, True, admin_user_id=None, today=date(2026, 11, 6))
    db.commit()
    status = financial_policy_status(db, company.id)
    assert status["periods"] == [{"starts_on": "2026-11-01", "ends_on": None}]


def test_arriving_ten_minutes_late_credits_a_ten_minute_paid_allowance(ctx):
    db, company, employee, device = ctx
    _activate_policy(db, company)
    _session_with_events(
        db, employee, device, start=_dt(9, 10), end=_dt(17),
        idle_windows=[(_dt(12), _dt(12, 30)), (_dt(15), _dt(15, 15))],
    )
    row = _calc(db, employee)
    assert row.raw_late_seconds == 10 * 60
    assert row.calculation_sources["paid_late_allowance_seconds"] == 10 * 60
    assert row.total_payable_seconds == SHIFT


def test_arriving_twenty_minutes_late_caps_allowance_and_keeps_excess_visible(ctx):
    db, company, employee, device = ctx
    _activate_policy(db, company)
    _session_with_events(
        db, employee, device, start=_dt(9, 20), end=_dt(17),
        idle_windows=[(_dt(12), _dt(12, 30)), (_dt(15), _dt(15, 15))],
    )
    row = _calc(db, employee)
    assert row.raw_late_seconds == 20 * 60
    assert row.calculation_sources["paid_late_allowance_seconds"] == 15 * 60
    assert row.deductible_late_seconds == 5 * 60  # excess lateness stays visible
    assert row.total_payable_seconds == 7 * 3600 + 55 * 60


def test_policy_inactive_keeps_old_accounting(ctx):
    db, company, employee, device = ctx
    # Effective date in the future: policy inactive for WORK_DATE.
    _activate_policy(db, company, effective=date(2026, 12, 1))
    _session_with_events(
        db, employee, device, start=_dt(9, 10), end=_dt(17),
        idle_windows=[(_dt(12), _dt(12, 30)), (_dt(15), _dt(15, 15))],
    )
    row = _calc(db, employee)
    # No paid late allowance; the 10 late minutes are simply unpaid → 7h50.
    assert row.calculation_sources["paid_late_allowance_seconds"] == 0
    assert row.calculation_sources["earned_break_credit_seconds"] == 0
    assert row.total_payable_seconds == 7 * 3600 + 50 * 60


def test_payroll_materializes_a_meeting_day_it_would_otherwise_skip(ctx):
    """A day known only through a MeetingRecord must still get an attendance row.

    Payroll builds attendance for days it can see through sessions, adjustments,
    overtime, or leave. A meeting whose employee-local ``work_date`` differs from
    its session's local date (a timezone-boundary case) would otherwise be
    invisible to payroll and its approved payable time dropped. Passing the
    meeting date into ``calculate_employee_metrics`` materializes that day.
    """
    from app.models import DailyAttendance, MeetingRecord
    from app.services.payroll import calculate_employee_metrics
    from app.services.work_profiles import get_or_create_work_profile

    db, company, employee, device = ctx
    _activate_policy(db, company)
    db.add(
        MeetingRecord(
            company_id=company.id,
            employee_id=employee.id,
            device_id=device.id,
            idempotency_key="mtg-reconcile-1",
            work_date=WORK_DATE,
            title="Client call",
            reason="Offline sync",
            started_at=_dt(10),
            expected_end_at=_dt(11),
            ended_at=_dt(11),
            lifecycle_state="ended",
            status="approved",
            approved_seconds=3600,
        )
    )
    db.commit()

    # No stored attendance and no sessions for the day.
    assert (
        db.query(DailyAttendance)
        .filter(DailyAttendance.employee_id == employee.id, DailyAttendance.work_date == WORK_DATE)
        .one_or_none()
        is None
    )

    profile = get_or_create_work_profile(db, employee)
    calculate_employee_metrics(
        db,
        company_id=company.id,
        employee=employee,
        profile=profile,
        first=WORK_DATE,
        last=WORK_DATE,
        overrides=[],
        sessions=[],
        adjustments=[],
        overtime_records=[],
        approved_leave=[],
        meeting_dates={WORK_DATE},
    )

    # The meeting day is materialized and the approved bounded period is payable
    # even without a WorkSession row.
    attendance = (
        db.query(DailyAttendance)
        .filter(DailyAttendance.employee_id == employee.id, DailyAttendance.work_date == WORK_DATE)
        .one_or_none()
    )
    assert attendance is not None
    assert attendance.total_payable_seconds == 3600
    assert attendance.calculation_sources["approved_meeting_seconds"] == 3600
