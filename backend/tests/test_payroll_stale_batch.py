"""Payroll rebuilds every stale attendance day in one batched pass.

A work-profile edit marks every day of the period stale. Rebuilding those days
one at a time took minutes against the remote database, so the first admin to
open payroll afterwards hit the client timeout and then PAYROLL_BUSY. The
batched rebuild must produce exactly what the per-day path produced.
"""

from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.services.payroll as payroll_service
from app.database.base import Base
from app.models import (
    AdminUser,
    Company,
    DailyAttendance,
    Device,
    Employee,
    EmployeeWorkProfile,
    LeaveRequest,
    WorkSession,
)
from app.services.payroll import get_or_create_run, refresh_run_entries

PERIOD_FIRST = date(2026, 8, 1)
PERIOD_LAST = date(2026, 8, 31)


def _seed():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    db = factory()
    company = Company(name="Batch Co", status="active")
    db.add(company)
    db.flush()
    admin = AdminUser(
        company_id=company.id,
        name="HR",
        email="hr@example.com",
        password_hash="x",
        role="hr",
        status="active",
        data_scope="company",
    )
    db.add(admin)
    employees = []
    for index, zone in enumerate(("UTC", "Africa/Cairo", "Asia/Dubai")):
        employee = Employee(
            company_id=company.id,
            name=f"Employee {index}",
            email=f"e{index}@example.com",
            employee_code=f"E-{index}",
            timezone=zone,
            status="active",
            start_date=date(2026, 1, 1),
        )
        db.add(employee)
        db.flush()
        db.add(
            EmployeeWorkProfile(
                company_id=company.id,
                employee_id=employee.id,
                shift_start=time(9, 0),
                shift_end=time(17, 0),
                working_days=[0, 1, 2, 3, 6],
                weekly_off_days=[4, 5],
                required_daily_minutes=480,
                late_grace_minutes=15,
                break_rules=[{"start": "13:00", "minutes": 30, "paid": True}],
                salary_amount=Decimal("9000"),
                salary_currency="EGP",
                salary_type="monthly",
            )
        )
        device = Device(
            company_id=company.id,
            employee_id=employee.id,
            device_name=f"PC {index}",
            installation_id=f"pc-{index}",
            operating_system="Windows 11",
            agent_version="9.9.9",
            status="active",
        )
        db.add(device)
        db.flush()
        for offset in range(0, 20, 1 + index):
            day = PERIOD_FIRST + timedelta(days=offset)
            start = datetime.combine(day, time(9, 5 * offset % 50), tzinfo=UTC)
            hours = 6 + (offset + index) % 4
            db.add(
                WorkSession(
                    company_id=company.id,
                    employee_id=employee.id,
                    device_id=device.id,
                    started_at=start,
                    ended_at=start + timedelta(hours=hours),
                    status="ended",
                    active_seconds=hours * 3600 - 600 * (offset % 3),
                    idle_seconds=600 * (offset % 3),
                )
            )
        db.add(
            LeaveRequest(
                company_id=company.id,
                employee_id=employee.id,
                start_date=date(2026, 8, 24),
                end_date=date(2026, 8, 25),
                requested_days=2,
                leave_type="annual",
                status="approved",
            )
        )
        employees.append(employee)
    db.commit()
    return factory, company, admin


def _payroll_snapshot(factory, company, admin):
    db = factory()
    try:
        run = get_or_create_run(
            db,
            company_id=company.id,
            month=PERIOD_FIRST,
            admin_user_id=admin.id,
            period_start=PERIOD_FIRST,
            period_end=PERIOD_LAST,
        )
        entries = refresh_run_entries(db, run)
        db.commit()
        codes = {employee.id: employee.employee_code for employee in db.scalars(select(Employee))}
        snapshot = {
            codes[entry.employee_id]: {
                key: value
                for key, value in entry.calculation_snapshot.items()
                if not key.endswith("_at")
            }
            for entry in entries
        }
        attendance = {
            (codes[row.employee_id], row.work_date): (
                row.normal_worked_seconds,
                row.idle_seconds,
                row.total_payable_seconds,
                row.raw_late_seconds,
                row.deductible_late_seconds,
                row.paid_break_seconds,
                row.unpaid_break_seconds,
            )
            for row in db.scalars(select(DailyAttendance)).all()
        }
        return snapshot, attendance
    finally:
        db.close()


def test_batched_stale_rebuild_matches_the_per_day_path(monkeypatch):
    batched = _payroll_snapshot(*_seed())

    # Force the old behaviour: no bulk rebuild, every stale day recomputed alone.
    monkeypatch.setattr(payroll_service, "calculate_daily_attendance_bulk", lambda *a, **k: {})
    per_day = _payroll_snapshot(*_seed())

    assert batched[1], "the period should materialize attendance rows"
    assert batched == per_day


def test_profile_edit_rebuilds_every_day_in_one_bulk_call(monkeypatch):
    factory, company, admin = _seed()
    first_pass = _payroll_snapshot(factory, company, admin)

    db = factory()
    try:
        for profile in db.scalars(select(EmployeeWorkProfile)).all():
            profile.updated_at = datetime.now(UTC)
        db.commit()
    finally:
        db.close()

    per_day_calls = 0
    original = payroll_service.calculate_daily_attendance

    def counting(*args, **kwargs):
        nonlocal per_day_calls
        per_day_calls += 1
        return original(*args, **kwargs)

    bulk_rebuilt_days = 0
    original_bulk = payroll_service.calculate_daily_attendance_bulk

    def counting_bulk(*args, **kwargs):
        nonlocal bulk_rebuilt_days
        bulk_rebuilt_days += len(kwargs["requests"])
        return original_bulk(*args, **kwargs)

    monkeypatch.setattr(payroll_service, "calculate_daily_attendance", counting)
    monkeypatch.setattr(payroll_service, "calculate_daily_attendance_bulk", counting_bulk)
    second_pass = _payroll_snapshot(factory, company, admin)

    assert per_day_calls == 0
    assert bulk_rebuilt_days == len(first_pass[1])
    assert second_pass == first_pass

