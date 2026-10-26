"""Screenshot deletion: admins only.

Employees used to delete their own screenshots from the employee portal; that
was removed, so the portal endpoint no longer exists. Admin deletion still
removes the active time the screenshot tracked.
"""

from datetime import UTC, date, datetime, time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import create_employee_access_token
from app.database.base import Base
from app.database.session import get_db
from app.main import app
from app.models import (
    AdminUser,
    Company,
    Device,
    Employee,
    EmployeeWorkProfile,
    Screenshot,
    WorkSession,
)
from app.models.payroll import PayrollRun

WORK_DATE = date(2026, 9, 10)


@pytest.fixture()
def env():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    db: Session = factory()
    company = Company(name="Shot Co", status="active")
    db.add(company)
    db.flush()

    def person(code: str) -> tuple[Employee, Device, WorkSession]:
        employee = Employee(
            company_id=company.id,
            name=f"Employee {code}",
            email=f"{code}@example.com",
            employee_code=code,
            timezone="UTC",
            status="active",
        )
        db.add(employee)
        db.flush()
        db.add(
            EmployeeWorkProfile(
                company_id=company.id,
                employee_id=employee.id,
                shift_start=time(9),
                shift_end=time(17),
                working_days=[0, 1, 2, 3, 4, 5, 6],
                weekly_off_days=[],
                required_daily_minutes=480,
                break_rules=[],
            )
        )
        device = Device(
            company_id=company.id,
            employee_id=employee.id,
            device_name=f"PC {code}",
            installation_id=f"install-{code}",
            operating_system="Windows 11",
            agent_version="1.0.0",
            status="active",
        )
        db.add(device)
        db.flush()
        session = WorkSession(
            company_id=company.id,
            employee_id=employee.id,
            device_id=device.id,
            started_at=datetime(2026, 9, 10, 9, tzinfo=UTC),
            ended_at=datetime(2026, 9, 10, 12, tzinfo=UTC),
            status="ended",
            active_seconds=3 * 3600,
            idle_seconds=0,
        )
        db.add(session)
        db.flush()
        return employee, device, session

    employee, device, session = person("ME-1")
    other, other_device, other_session = person("OTHER-1")
    admin = AdminUser(
        company_id=company.id,
        name="HR",
        email="hr-shots@example.com",
        password_hash="x",
        role="hr",
        status="active",
        data_scope="company",
    )
    db.add(admin)
    db.commit()

    def shot(owner: Employee, owner_device: Device, owner_session: WorkSession, minute: int):
        row = Screenshot(
            company_id=company.id,
            employee_id=owner.id,
            device_id=owner_device.id,
            session_id=owner_session.id,
            captured_at=datetime(2026, 9, 10, 10, minute, tzinfo=UTC),
            storage_path=f"tests/{owner.employee_code}-{minute}.png",
            mime_type="image/png",
            width=10,
            height=10,
            file_size=10,
            checksum=f"sum-{owner.employee_code}-{minute}",
            status="uploaded",
            tracked_seconds=600,
        )
        db.add(row)
        db.commit()
        return row

    def override_get_db():
        session_ = factory()
        try:
            yield session_
        finally:
            session_.close()

    app.dependency_overrides[get_db] = override_get_db
    headers = {
        "Authorization": "Bearer "
        + create_employee_access_token(employee_id=employee.id, company_id=company.id)
    }
    try:
        yield {
            "client": TestClient(app),
            "db": db,
            "factory": factory,
            "company": company,
            "admin": admin,
            "employee": employee,
            "session": session,
            "other": (other, other_device, other_session),
            "shot": lambda minute: shot(employee, device, session, minute),
            "other_shot": lambda minute: shot(other, other_device, other_session, minute),
            "headers": headers,
        }
    finally:
        app.dependency_overrides.pop(get_db, None)
        db.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_employees_cannot_delete_screenshots(env):
    # Removed on 2026-10-25: only admins delete screenshots (and their time).
    client, headers = env["client"], env["headers"]
    screenshot = env["shot"](0)

    response = client.delete(f"/api/v1/employee-portal/screenshots/{screenshot.id}", headers=headers)
    assert response.status_code in (404, 405)

    with env["factory"]() as db:
        assert db.get(Screenshot, screenshot.id).deleted_at is None
        assert db.get(WorkSession, env["session"].id).deducted_seconds == 0


def test_admin_delete_still_deducts_through_the_shared_service(env):
    from app.core.security import create_jwt_token
    from datetime import timedelta

    client = env["client"]
    admin = env["admin"]
    screenshot = env["shot"](25)
    token = create_jwt_token(
        subject=admin.id,
        company_id=admin.company_id,
        token_type="access",
        expires_delta=timedelta(minutes=30),
        extra_claims={"role": admin.role},
    )
    response = client.delete(
        f"/api/v1/screenshots/{screenshot.id}", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["deducted_seconds"] == 600
