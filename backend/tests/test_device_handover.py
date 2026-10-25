"""One employee, two computers: only one of them tracks at a time."""

from datetime import UTC, datetime, time
from uuid import UUID, uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database.base import Base
from app.models import Company, Device, Employee, EmployeeWorkProfile, WorkSession
from app.schemas.session import HeartbeatRequest, SessionStartRequest
from app.services.session_tracking import record_heartbeat, start_or_get_session


@pytest.fixture()
def ctx():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db: Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    company = Company(name="Handover Co", status="active")
    db.add(company)
    db.flush()
    employee = Employee(
        company_id=company.id, name="Hybrid Emp", email="hybrid@example.com",
        employee_code="HY-1", timezone="UTC", status="active",
    )
    db.add(employee)
    db.flush()
    db.add(
        EmployeeWorkProfile(
            company_id=company.id, employee_id=employee.id,
            shift_start=time(9, 0), shift_end=time(17, 0),
            working_days=[0, 1, 2, 3, 4], weekly_off_days=[5, 6],
            required_daily_minutes=480, late_grace_minutes=15,
        )
    )
    devices = []
    for name in ("Office PC", "Home Laptop"):
        device = Device(
            company_id=company.id, employee_id=employee.id, device_name=name,
            installation_id=name.lower().replace(" ", "-"), operating_system="Windows 11",
            agent_version="1.1.102", status="active",
        )
        db.add(device)
        devices.append(device)
    db.commit()
    try:
        yield db, devices[0], devices[1]
    finally:
        db.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


def _at(clock: str) -> datetime:
    return datetime.fromisoformat(f"2026-09-10T{clock}:00").replace(tzinfo=UTC)


def _heartbeat(db, device, session_id, clock, status="active"):
    return record_heartbeat(
        db, device=device, session_id=session_id,
        payload=HeartbeatRequest(
            event_id=uuid4(), timestamp=_at(clock), status=status,
            active_seconds=60, idle_seconds=0, agent_version="1.1.102",
        ),
    )


def test_the_old_computer_does_not_take_the_workday_back(ctx):
    db, office, laptop = ctx
    office_session = UUID(
        start_or_get_session(db, office, SessionStartRequest(started_at=_at("09:00")))[
            "session"
        ]["id"]
    )
    laptop_session = UUID(
        start_or_get_session(db, laptop, SessionStartRequest(started_at=_at("10:00")))[
            "session"
        ]["id"]
    )
    assert db.get(WorkSession, office_session).ended_at is not None

    for status in ("active", "idle"):
        result = _heartbeat(db, office, office_session, "10:05", status=status)
        assert result["ignore_reason"] == "tracking_moved_to_another_device"
        assert result["moved_to_device_name"] == "Home Laptop"
        assert result.get("restarted") is False

    # The laptop keeps the only open session.
    assert db.get(WorkSession, laptop_session).ended_at is None


def test_an_explicit_start_on_the_old_computer_takes_it_back(ctx):
    db, office, laptop = ctx
    start_or_get_session(db, office, SessionStartRequest(started_at=_at("09:00")))
    laptop_session = UUID(
        start_or_get_session(db, laptop, SessionStartRequest(started_at=_at("10:00")))[
            "session"
        ]["id"]
    )
    start_or_get_session(db, office, SessionStartRequest(started_at=_at("11:00")))

    result = _heartbeat(db, laptop, laptop_session, "11:05")
    assert result["ignore_reason"] == "tracking_moved_to_another_device"
    assert result["moved_to_device_name"] == "Office PC"
