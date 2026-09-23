"""End-to-end Meeting Mode over HTTP: desktop start/end -> admin list -> review."""

from datetime import UTC, datetime, time, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import create_device_token, create_jwt_token, hash_token
from app.database.base import Base
from app.database.session import get_db
from app.main import app
from app.models import AdminUser, Company, Device, DeviceToken, Employee, EmployeeWorkProfile


@pytest.fixture()
def flow():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    db = factory()
    company = Company(name="Meeting Flow Co", status="active")
    db.add(company)
    db.flush()
    employee = Employee(
        company_id=company.id, name="Flow Employee", email="flow@example.com",
        employee_code="FLOW-1", timezone="UTC", status="active",
    )
    db.add(employee)
    db.flush()
    # A shift covering the whole day, every day, so the test never depends on
    # the wall clock it runs at.
    db.add(EmployeeWorkProfile(
        company_id=company.id, employee_id=employee.id,
        shift_start=time(0, 0), shift_end=time(23, 59),
        working_days=[0, 1, 2, 3, 4, 5, 6], weekly_off_days=[],
        required_daily_minutes=480, break_rules=[],
    ))
    device = Device(
        company_id=company.id, employee_id=employee.id, device_name="Flow Device",
        installation_id="flow-device", operating_system="Windows 11",
        agent_version="9.9.9", status="active",
    )
    admin = AdminUser(
        company_id=company.id, name="Flow HR", email="flowhr@example.com",
        password_hash="x", role="hr", status="active", data_scope="company",
    )
    db.add_all([device, admin])
    db.flush()
    device_token = create_device_token(
        device_id=device.id, company_id=company.id, employee_id=employee.id,
    )
    db.add(DeviceToken(company_id=company.id, device_id=device.id, token_hash=hash_token(device_token)))
    db.commit()
    admin_token = create_jwt_token(
        subject=admin.id, company_id=company.id, token_type="access",
        expires_delta=timedelta(minutes=30), extra_claims={"role": admin.role},
    )
    data = {
        "device_id": str(device.id),
        "device_headers": {"Authorization": f"Bearer {device_token}"},
        "admin_headers": {"Authorization": f"Bearer {admin_token}"},
    }
    db.close()
    try:
        yield TestClient(app), data
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_meeting_start_end_list_and_approve_over_http(flow):
    client, data = flow
    now = datetime.now(UTC).replace(microsecond=0)
    # Keep the whole meeting on today's local date and inside the 00:00-23:59 shift.
    started = max(now - timedelta(minutes=45), now.replace(hour=0, minute=0, second=1))
    key = str(uuid4())

    start = client.post(
        "/api/v1/agent/meetings",
        headers=data["device_headers"],
        json={
            "device_id": data["device_id"],
            "idempotency_key": key,
            "title": "Client call",
            "reason": "Weekly sync with the client",
            "started_at": started.isoformat(),
            "expected_end_at": (started + timedelta(minutes=60)).isoformat(),
        },
    )
    assert start.status_code == 200, start.text
    body = start.json()["data"]
    assert body["lifecycle_state"] == "active"
    assert body["status"] == "pending"

    # Listing while it runs must NOT close it before its expected end.
    running = client.get("/api/v1/agent/meetings", headers=data["device_headers"])
    assert running.status_code == 200, running.text
    assert running.json()["data"][0]["lifecycle_state"] == "active"
    admin_running = client.get("/api/v1/meetings", headers=data["admin_headers"])
    assert admin_running.status_code == 200, admin_running.text
    assert admin_running.json()["data"][0]["lifecycle_state"] == "active"

    end = client.post(
        "/api/v1/agent/meetings/end",
        headers=data["device_headers"],
        json={"device_id": data["device_id"], "idempotency_key": key, "ended_at": now.isoformat()},
    )
    assert end.status_code == 200, end.text
    ended = end.json()["data"]
    assert ended["lifecycle_state"] == "ended"
    assert ended["recorded_seconds"] == int((now - started).total_seconds())
    assert ended["recorded_seconds"] > 0

    pending = client.get("/api/v1/meetings?status=pending", headers=data["admin_headers"])
    assert pending.status_code == 200, pending.text
    rows = pending.json()["data"]
    assert [row["idempotency_key"] for row in rows] == [key]
    assert rows[0]["employee_name"] == "Flow Employee"

    review = client.patch(
        f"/api/v1/meetings/{rows[0]['id']}",
        headers=data["admin_headers"],
        json={"status": "approved", "admin_note": "ok"},
    )
    assert review.status_code == 200, review.text
    assert review.json()["data"]["status"] == "approved"
    assert review.json()["data"]["approved_seconds"] == ended["recorded_seconds"]
