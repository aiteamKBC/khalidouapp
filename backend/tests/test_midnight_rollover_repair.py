"""The data migration that removes unattended hours banked by the old rollover."""

import importlib.util
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database.base import Base
from app.models import (
    ActivityEvent,
    Company,
    DailyAttendance,
    Device,
    Employee,
    WorkSession,
)

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260729_000050_repair_midnight_rollover_workdays.py"
)
MULTIDAY_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260803_000053_repair_multiday_stale_sessions.py"
)
INVARIANT_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260805_000054_enforce_time_ledger_invariants.py"
)
CAIRO = "Africa/Cairo"


def load_migration():
    spec = importlib.util.spec_from_file_location("repair_midnight_rollover", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_migration(db: Session) -> None:
    """Run the migration's upgrade against the test session's connection."""
    module = load_migration()
    connection = db.connection()
    module.op = Operations(MigrationContext.configure(connection))
    module.upgrade()


def run_multiday_migration(db: Session) -> None:
    spec = importlib.util.spec_from_file_location(
        "repair_multiday_stale_sessions",
        MULTIDAY_MIGRATION_PATH,
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    connection = db.connection()
    module.op = Operations(MigrationContext.configure(connection))
    module.upgrade()


def run_invariant_migration(db: Session) -> None:
    spec = importlib.util.spec_from_file_location(
        "enforce_time_ledger_invariants",
        INVARIANT_MIGRATION_PATH,
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    connection = db.connection()
    module.op = Operations(MigrationContext.configure(connection))
    module.upgrade()


@pytest.fixture()
def repair_context():
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

    company = Company(name="Rollover Company", status="active")
    db.add(company)
    db.flush()
    employee = Employee(
        company_id=company.id,
        name="Overnight Employee",
        email="overnight@example.com",
        employee_code="OVERNIGHT",
        timezone=CAIRO,
        status="active",
    )
    db.add(employee)
    db.flush()
    device = Device(
        company_id=company.id,
        employee_id=employee.id,
        device_name="Overnight Device",
        installation_id="overnight-installation",
        operating_system="Windows 11",
        agent_version="1.0.0",
        status="active",
    )
    db.add(device)
    db.commit()

    try:
        yield db, employee, device
    finally:
        db.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


def add_session(db, employee, device, *, started_at, ended_at, active_seconds, idle_seconds=0):
    session = WorkSession(
        company_id=employee.company_id,
        employee_id=employee.id,
        device_id=device.id,
        timezone=CAIRO,
        started_at=started_at,
        ended_at=ended_at,
        status="ended" if ended_at else "active",
        active_seconds=active_seconds,
        idle_seconds=idle_seconds,
    )
    db.add(session)
    db.commit()
    return session


def add_worked_heartbeat(db, employee, device, session, at, key):
    db.add(
        ActivityEvent(
            company_id=employee.company_id,
            employee_id=employee.id,
            device_id=device.id,
            session_id=session.id,
            event_type="heartbeat",
            event_timestamp=at,
            payload={"status": "active"},
            idempotency_key=key,
        )
    )
    db.commit()


def test_session_ended_at_midnight_is_pulled_back_to_the_last_real_activity(repair_context):
    db, employee, device = repair_context
    # 2026-07-28 10:35 Cairo (+03:00) through local midnight, the exact shape the
    # rollover produced for an unattended machine.
    session = add_session(
        db,
        employee,
        device,
        started_at=datetime(2026, 7, 28, 7, 35, tzinfo=UTC),
        ended_at=datetime(2026, 7, 28, 21, 0, tzinfo=UTC),
        active_seconds=48146,
    )
    last_worked_at = datetime(2026, 7, 28, 15, 30, tzinfo=UTC)
    add_worked_heartbeat(db, employee, device, session, last_worked_at, "worked-1")

    run_migration(db)
    db.refresh(session)

    assert session.ended_at.replace(tzinfo=UTC) == last_worked_at
    duration = int((last_worked_at - datetime(2026, 7, 28, 7, 35, tzinfo=UTC)).total_seconds())
    assert session.active_seconds == duration


def test_session_started_at_midnight_is_pushed_to_the_first_real_activity(repair_context):
    db, employee, device = repair_context
    midnight_utc = datetime(2026, 7, 28, 21, 0, tzinfo=UTC)  # 2026-07-29 00:00 Cairo
    session = add_session(
        db,
        employee,
        device,
        started_at=midnight_utc,
        ended_at=datetime(2026, 7, 29, 15, 0, tzinfo=UTC),
        active_seconds=28493,
    )
    first_worked_at = datetime(2026, 7, 29, 7, 9, tzinfo=UTC)  # 10:09 Cairo
    add_worked_heartbeat(db, employee, device, session, first_worked_at, "worked-1")
    add_worked_heartbeat(
        db, employee, device, session, datetime(2026, 7, 29, 12, 0, tzinfo=UTC), "worked-2"
    )

    run_migration(db)
    db.refresh(session)

    assert session.started_at.replace(tzinfo=UTC) == first_worked_at


def test_a_midnight_session_without_any_proven_work_collapses(repair_context):
    db, employee, device = repair_context
    started = datetime(2026, 7, 28, 7, 35, tzinfo=UTC)
    session = add_session(
        db,
        employee,
        device,
        started_at=started,
        ended_at=datetime(2026, 7, 28, 21, 0, tzinfo=UTC),
        active_seconds=48146,
        idle_seconds=0,
    )

    run_migration(db)
    db.refresh(session)

    assert session.ended_at.replace(tzinfo=UTC) == started
    assert session.active_seconds == 0
    assert session.idle_seconds == 0


def test_a_normal_session_is_left_alone(repair_context):
    db, employee, device = repair_context
    started = datetime(2026, 7, 29, 7, 9, tzinfo=UTC)
    ended = datetime(2026, 7, 29, 15, 30, tzinfo=UTC)
    session = add_session(
        db, employee, device, started_at=started, ended_at=ended, active_seconds=30060
    )

    run_migration(db)
    db.refresh(session)

    assert session.started_at.replace(tzinfo=UTC) == started
    assert session.ended_at.replace(tzinfo=UTC) == ended
    assert session.active_seconds == 30060


def test_attendance_snapshots_for_repaired_days_are_dropped(repair_context):
    db, employee, device = repair_context
    session = add_session(
        db,
        employee,
        device,
        started_at=datetime(2026, 7, 28, 7, 35, tzinfo=UTC),
        ended_at=datetime(2026, 7, 28, 21, 0, tzinfo=UTC),
        active_seconds=48146,
    )
    add_worked_heartbeat(
        db, employee, device, session, datetime(2026, 7, 28, 15, 30, tzinfo=UTC), "worked-1"
    )
    db.add(
        DailyAttendance(
            company_id=employee.company_id,
            employee_id=employee.id,
            work_date=date(2026, 7, 28),
            timezone=CAIRO,
            calculated_at=datetime.now(UTC),
        )
    )
    db.add(
        DailyAttendance(
            company_id=employee.company_id,
            employee_id=employee.id,
            work_date=date(2026, 7, 28) + timedelta(days=1),
            timezone=CAIRO,
            calculated_at=datetime.now(UTC),
        )
    )
    db.commit()

    run_migration(db)

    remaining = db.scalars(
        select(DailyAttendance).where(DailyAttendance.employee_id == employee.id)
    ).all()
    assert remaining == []


def test_multiday_stale_session_is_repaired_to_its_last_proven_activity(repair_context):
    db, employee, device = repair_context
    started_at = datetime(2026, 7, 20, 6, 0, tzinfo=UTC)
    heartbeat_at = started_at + timedelta(minutes=13)
    session = add_session(
        db,
        employee,
        device,
        started_at=started_at,
        ended_at=started_at + timedelta(days=5),
        active_seconds=13 * 60,
    )
    add_worked_heartbeat(db, employee, device, session, heartbeat_at, "multiday-worked")
    for work_date in (date(2026, 7, 20), date(2026, 7, 22)):
        db.add(
            DailyAttendance(
                company_id=employee.company_id,
                employee_id=employee.id,
                work_date=work_date,
                timezone=CAIRO,
                calculated_at=datetime.now(UTC),
            )
        )
    db.commit()

    run_multiday_migration(db)
    db.refresh(session)

    assert session.ended_at.replace(tzinfo=UTC) == heartbeat_at
    assert session.active_seconds == 13 * 60
    assert db.scalars(
        select(DailyAttendance).where(DailyAttendance.employee_id == employee.id)
    ).all() == []


def test_time_ledger_migration_closes_overnight_open_session_and_enforces_one_open(
    repair_context,
):
    db, employee, device = repair_context
    # Base.metadata reflects the new schema. Remove the new index to emulate
    # revision 53 before running revision 54 against SQLite.
    db.execute(text("DROP INDEX uq_work_sessions_device_single_open"))
    started_at = datetime(2026, 7, 20, 6, 0, tzinfo=UTC)
    last_worked_at = started_at + timedelta(hours=1)
    stale = add_session(
        db,
        employee,
        device,
        started_at=started_at,
        ended_at=None,
        active_seconds=60 * 60,
    )
    add_worked_heartbeat(
        db,
        employee,
        device,
        stale,
        last_worked_at,
        "invariant-last-worked",
    )

    run_invariant_migration(db)
    db.refresh(stale)

    assert stale.status == "ended"
    assert stale.ended_at.replace(tzinfo=UTC) == last_worked_at

    first_open = WorkSession(
        company_id=employee.company_id,
        employee_id=employee.id,
        device_id=device.id,
        timezone=CAIRO,
        started_at=datetime.now(UTC),
        status="active",
    )
    db.add(first_open)
    db.commit()
    db.add(
        WorkSession(
            company_id=employee.company_id,
            employee_id=employee.id,
            device_id=device.id,
            timezone=CAIRO,
            started_at=datetime.now(UTC) + timedelta(seconds=1),
            status="active",
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_time_ledger_migration_recovers_valid_signals_after_an_impossible_old_end(
    repair_context,
):
    db, employee, device = repair_context
    db.execute(text("DROP INDEX uq_work_sessions_device_single_open"))
    db.execute(text("PRAGMA ignore_check_constraints = ON"))
    started_at = datetime.now(UTC) - timedelta(minutes=2)
    recovered_end = started_at + timedelta(seconds=45)
    session = add_session(
        db,
        employee,
        device,
        started_at=started_at,
        ended_at=started_at - timedelta(days=2),
        active_seconds=45,
    )
    add_worked_heartbeat(
        db,
        employee,
        device,
        session,
        recovered_end,
        "valid-signal-after-impossible-end",
    )
    db.execute(text("PRAGMA ignore_check_constraints = OFF"))

    run_invariant_migration(db)
    db.refresh(session)

    assert session.status == "ended"
    assert session.ended_at.replace(tzinfo=UTC) == recovered_end
    assert session.active_seconds == 45
