from datetime import UTC, date, datetime, time

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database.base import Base
from app.models import (
    ActivityEvent,
    AdminUser,
    AttendanceCorrection,
    Company,
    Device,
    Employee,
    EmployeeWorkProfile,
    TimeAdjustmentRequest,
    OvertimeRecord,
    WorkScheduleOverride,
    WorkSession,
)
from app.services.attendance import calculate_daily_attendance
from app.services.payroll import calculate_employee_metrics


@pytest.fixture()
def attendance_context():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db: Session = sessionmaker(bind=engine, expire_on_commit=False)()
    company = Company(name="Attendance Company", status="active")
    db.add(company)
    db.flush()
    employee = Employee(
        company_id=company.id,
        name="Attendance Employee",
        email="attendance@example.com",
        employee_code="ATT-1",
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
            {
                "name": "Lunch",
                "start_time": "12:00",
                "end_time": "12:30",
                "minutes": 30,
                "paid": True,
            }
        ],
    )
    device = Device(
        company_id=company.id,
        employee_id=employee.id,
        device_name="Attendance Device",
        installation_id="attendance-device",
        operating_system="Windows 11",
        agent_version="1.0.0",
        status="active",
    )
    admin = AdminUser(
        company_id=company.id,
        name="Attendance Admin",
        email="attendance-admin@example.com",
        password_hash="test",
        role="general_admin",
        status="active",
        data_scope="company",
    )
    db.add_all([profile, device, admin])
    db.commit()
    try:
        yield db, employee, device, admin
    finally:
        db.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


def _session(db, employee, device, started_at, ended_at):
    row = WorkSession(
        company_id=employee.company_id,
        employee_id=employee.id,
        device_id=device.id,
        started_at=started_at,
        ended_at=ended_at,
        status="ended",
        active_seconds=int((ended_at - started_at).total_seconds()),
        idle_seconds=0,
    )
    db.add(row)
    db.flush()
    return row


def test_multiple_sessions_keep_raw_lateness_and_unapproved_overtime_separate(
    attendance_context,
):
    db, employee, device, _ = attendance_context
    work_date = date(2026, 7, 21)
    first = _session(
        db,
        employee,
        device,
        datetime(2026, 7, 21, 9, 20, tzinfo=UTC),
        datetime(2026, 7, 21, 12, 0, tzinfo=UTC),
    )
    _session(
        db,
        employee,
        device,
        datetime(2026, 7, 21, 12, 30, tzinfo=UTC),
        datetime(2026, 7, 21, 18, 0, tzinfo=UTC),
    )
    overtime = OvertimeRecord(
        company_id=employee.company_id,
        employee_id=employee.id,
        work_session_id=first.id,
        work_date=work_date,
        overtime_enabled_snapshot=True,
        recorded_extra_seconds=3600,
        approved_seconds=0,
        status="recorded",
    )
    db.add(overtime)
    db.commit()

    row, timeline = calculate_daily_attendance(
        db,
        employee=employee,
        work_date=work_date,
        now=datetime(2026, 7, 22, tzinfo=UTC),
    )

    assert len({item["session_id"] for item in timeline["intervals"]}) == 2
    assert row.raw_late_seconds == 20 * 60
    assert row.deductible_late_seconds == 5 * 60
    assert row.normal_worked_seconds == 7 * 3600 + 10 * 60
    assert row.paid_break_seconds == 30 * 60
    assert row.recorded_overtime_seconds == 3600
    assert row.approved_overtime_seconds == 0
    assert row.unapproved_overtime_seconds == 3600
    assert row.total_payable_seconds == 7 * 3600 + 40 * 60
    assert row.actual_sign_out_at.replace(tzinfo=UTC) == datetime(
        2026, 7, 21, 18, 0, tzinfo=UTC
    )

    overtime.status = "approved"
    overtime.approved_seconds = 3600
    db.commit()
    approved, _ = calculate_daily_attendance(
        db,
        employee=employee,
        work_date=work_date,
        now=datetime(2026, 7, 22, tzinfo=UTC),
    )
    assert approved.approved_overtime_seconds == 3600
    assert approved.total_payable_seconds == 8 * 3600 + 40 * 60


def test_shift_end_stops_normal_pay_even_when_late_employee_has_not_completed_target(
    attendance_context,
):
    db, employee, device, _ = attendance_context
    profile = db.scalar(
        select(EmployeeWorkProfile).where(EmployeeWorkProfile.employee_id == employee.id)
    )
    profile.shift_start = time(10, 0)
    profile.shift_end = time(18, 0)
    profile.late_grace_minutes = 0
    profile.overtime_enabled = False
    session = _session(
        db,
        employee,
        device,
        datetime(2026, 7, 21, 11, 0, tzinfo=UTC),
        datetime(2026, 7, 21, 19, 0, tzinfo=UTC),
    )
    overtime = OvertimeRecord(
        company_id=employee.company_id,
        employee_id=employee.id,
        work_session_id=session.id,
        work_date=date(2026, 7, 21),
        overtime_enabled_snapshot=False,
        recorded_extra_seconds=3600,
        approved_seconds=0,
        status="recorded_not_counted",
    )
    db.add(overtime)
    db.commit()

    recorded, _ = calculate_daily_attendance(
        db,
        employee=employee,
        work_date=date(2026, 7, 21),
        now=datetime(2026, 7, 22, tzinfo=UTC),
    )
    assert recorded.raw_late_seconds == 3600
    assert recorded.normal_worked_seconds == 6 * 3600 + 30 * 60
    assert recorded.paid_break_seconds == 30 * 60
    assert recorded.recorded_overtime_seconds == 3600
    assert recorded.approved_overtime_seconds == 0
    assert recorded.total_payable_seconds == 7 * 3600

    overtime.status = "approved"
    overtime.approved_seconds = 3600
    db.commit()
    approved, _ = calculate_daily_attendance(
        db,
        employee=employee,
        work_date=date(2026, 7, 21),
        now=datetime(2026, 7, 22, tzinfo=UTC),
    )
    assert approved.normal_worked_seconds == 6 * 3600 + 30 * 60
    assert approved.paid_break_seconds == 30 * 60
    assert approved.approved_overtime_seconds == 3600
    assert approved.total_payable_seconds == 8 * 3600


def test_paid_break_is_not_idle_or_double_counted(attendance_context):
    db, employee, device, _ = attendance_context
    work_date = date(2026, 7, 21)
    session = _session(
        db,
        employee,
        device,
        datetime(2026, 7, 21, 9, 0, tzinfo=UTC),
        datetime(2026, 7, 21, 17, 0, tzinfo=UTC),
    )
    db.add_all(
        [
            ActivityEvent(
                company_id=employee.company_id,
                employee_id=employee.id,
                device_id=device.id,
                session_id=session.id,
                event_type="idle_started",
                event_timestamp=datetime(2026, 7, 21, 11, 50, tzinfo=UTC),
                idempotency_key="idle-start",
            ),
            ActivityEvent(
                company_id=employee.company_id,
                employee_id=employee.id,
                device_id=device.id,
                session_id=session.id,
                event_type="idle_ended",
                event_timestamp=datetime(2026, 7, 21, 12, 40, tzinfo=UTC),
                idempotency_key="idle-end",
            ),
        ]
    )
    db.commit()

    row, _ = calculate_daily_attendance(
        db,
        employee=employee,
        work_date=work_date,
        now=datetime(2026, 7, 22, tzinfo=UTC),
    )

    assert row.idle_seconds == 20 * 60
    assert row.paid_break_seconds == 30 * 60
    assert row.normal_worked_seconds == 7 * 3600 + 10 * 60
    assert row.total_payable_seconds == 7 * 3600 + 40 * 60


def test_attendance_correction_preserves_raw_evidence_and_adjusts_payable_time(
    attendance_context,
):
    db, employee, device, admin = attendance_context
    work_date = date(2026, 7, 21)
    _session(
        db,
        employee,
        device,
        datetime(2026, 7, 21, 9, 30, tzinfo=UTC),
        datetime(2026, 7, 21, 16, 30, tzinfo=UTC),
    )
    db.add(
        AttendanceCorrection(
            company_id=employee.company_id,
            employee_id=employee.id,
            work_date=work_date,
            corrected_start_at=datetime(2026, 7, 21, 9, 0, tzinfo=UTC),
            corrected_end_at=datetime(2026, 7, 21, 17, 0, tzinfo=UTC),
            payable_seconds_delta=3600,
            reason="Approved customer call from another device",
            updated_by_admin_user_id=admin.id,
        )
    )
    db.commit()

    row, _ = calculate_daily_attendance(
        db,
        employee=employee,
        work_date=work_date,
        now=datetime(2026, 7, 22, tzinfo=UTC),
    )

    assert row.actual_first_activity_at.replace(tzinfo=UTC) == datetime(
        2026, 7, 21, 9, 0, tzinfo=UTC
    )
    assert row.actual_last_activity_at.replace(tzinfo=UTC) == datetime(
        2026, 7, 21, 17, 0, tzinfo=UTC
    )
    assert row.total_payable_seconds == 8 * 3600
    assert row.calculation_sources["raw_first_activity_at"].startswith(
        "2026-07-21T09:30:00"
    )
    assert row.calculation_sources["raw_last_activity_at"].startswith(
        "2026-07-21T16:30:00"
    )
    assert row.calculation_sources["attendance_adjustment_seconds"] == 3600


def test_one_day_employee_override_changes_only_selected_date(attendance_context):
    db, employee, device, admin = attendance_context
    work_date = date(2026, 7, 21)
    db.add(
        WorkScheduleOverride(
            company_id=employee.company_id,
            employee_id=employee.id,
            scope="employee",
            override_type="shift",
            effective_date=work_date,
            permanent=False,
            shift_start=time(10, 0),
            shift_end=time(18, 0),
            reason="One-day late shift",
            created_by_admin_user_id=admin.id,
        )
    )
    _session(
        db,
        employee,
        device,
        datetime(2026, 7, 21, 10, 0, tzinfo=UTC),
        datetime(2026, 7, 21, 18, 0, tzinfo=UTC),
    )
    db.commit()

    selected, _ = calculate_daily_attendance(
        db,
        employee=employee,
        work_date=work_date,
        now=datetime(2026, 7, 22, tzinfo=UTC),
    )
    following, _ = calculate_daily_attendance(
        db,
        employee=employee,
        work_date=date(2026, 7, 22),
        now=datetime(2026, 7, 22, 12, tzinfo=UTC),
    )

    assert selected.scheduled_start_at.hour == 10
    assert selected.scheduled_end_at.hour == 18
    assert following.scheduled_start_at.hour == 9
    assert following.scheduled_end_at.hour == 17


def test_early_leave_is_stored_and_approved_permission_excuses_it(attendance_context):
    db, employee, device, admin = attendance_context
    work_date = date(2026, 7, 21)
    session = _session(
        db,
        employee,
        device,
        datetime(2026, 7, 21, 9, 0, tzinfo=UTC),
        datetime(2026, 7, 21, 16, 0, tzinfo=UTC),
    )
    db.commit()

    unexcused, _ = calculate_daily_attendance(
        db,
        employee=employee,
        work_date=work_date,
        now=datetime(2026, 7, 22, tzinfo=UTC),
    )
    assert unexcused.early_leave_seconds == 3600

    db.add(
        TimeAdjustmentRequest(
            company_id=employee.company_id,
            employee_id=employee.id,
            device_id=device.id,
            work_session_id=session.id,
            request_type="early_leave",
            requested_date=work_date,
            source_start_at=datetime(2026, 7, 21, 16, 0, tzinfo=UTC),
            source_end_at=datetime(2026, 7, 21, 17, 0, tzinfo=UTC),
            requested_seconds=3600,
            approved_seconds=3600,
            reason="Approved appointment",
            status="approved",
            reviewed_by_admin_user_id=admin.id,
        )
    )
    db.commit()

    excused, _ = calculate_daily_attendance(
        db,
        employee=employee,
        work_date=work_date,
        now=datetime(2026, 7, 22, tzinfo=UTC),
    )
    assert excused.early_leave_seconds == 0
    assert excused.total_payable_seconds == 8 * 3600
    assert (
        excused.calculation_sources["approved_early_leave_seconds"]
        == 3600
    )


def test_locked_windows_time_is_not_worked_or_idle(attendance_context):
    db, employee, device, _ = attendance_context
    work_date = date(2026, 7, 21)
    session = _session(
        db,
        employee,
        device,
        datetime(2026, 7, 21, 9, 0, tzinfo=UTC),
        datetime(2026, 7, 21, 17, 0, tzinfo=UTC),
    )
    db.add_all(
        [
            ActivityEvent(
                company_id=employee.company_id,
                employee_id=employee.id,
                device_id=device.id,
                session_id=session.id,
                event_type="screen_locked",
                event_timestamp=datetime(2026, 7, 21, 10, 0, tzinfo=UTC),
                idempotency_key="screen-locked",
            ),
            ActivityEvent(
                company_id=employee.company_id,
                employee_id=employee.id,
                device_id=device.id,
                session_id=session.id,
                event_type="screen_unlocked",
                event_timestamp=datetime(2026, 7, 21, 11, 0, tzinfo=UTC),
                idempotency_key="screen-unlocked",
            ),
        ]
    )
    db.commit()

    row, timeline = calculate_daily_attendance(
        db,
        employee=employee,
        work_date=work_date,
        now=datetime(2026, 7, 22, tzinfo=UTC),
    )
    assert timeline["locked_seconds"] == 3600
    assert row.idle_seconds == 0
    assert row.normal_worked_seconds == 6 * 3600 + 30 * 60
    assert row.paid_break_seconds == 30 * 60


def test_overlapping_restart_sessions_do_not_duplicate_time(attendance_context):
    db, employee, device, _ = attendance_context
    work_date = date(2026, 7, 21)
    _session(
        db,
        employee,
        device,
        datetime(2026, 7, 21, 9, 0, tzinfo=UTC),
        datetime(2026, 7, 21, 12, 0, tzinfo=UTC),
    )
    _session(
        db,
        employee,
        device,
        datetime(2026, 7, 21, 10, 0, tzinfo=UTC),
        datetime(2026, 7, 21, 11, 0, tzinfo=UTC),
    )
    db.commit()

    row, timeline = calculate_daily_attendance(
        db,
        employee=employee,
        work_date=work_date,
        now=datetime(2026, 7, 22, tzinfo=UTC),
    )
    assert timeline["worked_seconds"] == 3 * 3600
    assert row.normal_worked_seconds == 3 * 3600


def test_monthly_payroll_aggregates_canonical_daily_attendance(attendance_context):
    db, employee, device, _ = attendance_context
    work_date = date(2026, 7, 21)
    _session(
        db,
        employee,
        device,
        datetime(2026, 7, 21, 9, 0, tzinfo=UTC),
        datetime(2026, 7, 21, 17, 0, tzinfo=UTC),
    )
    db.commit()
    calculate_daily_attendance(
        db,
        employee=employee,
        work_date=work_date,
        now=datetime(2026, 7, 22, tzinfo=UTC),
    )
    db.commit()

    metrics = calculate_employee_metrics(
        db,
        company_id=employee.company_id,
        employee=employee,
        profile=employee.work_profile,
        first=work_date,
        last=work_date,
        overrides=[],
    )

    assert metrics["expected_work_days"] == 1
    assert metrics["worked_days"] == 1
    assert metrics["worked_seconds"] == 7 * 3600 + 30 * 60
    assert metrics["paid_break_seconds"] == 30 * 60
    assert metrics["normal_seconds"] == 8 * 3600
    assert metrics["total_payable_seconds"] == 8 * 3600
