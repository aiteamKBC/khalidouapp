from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.security import create_device_token, hash_token
from app.database.base import Base
from app.database.session import get_db
from app.main import app
from app.models import AuditLog, Company, Device, DeviceToken, Employee


@pytest.fixture()
def diagnostics_client(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret_key", "diag-test-jwt-key-not-production")
    monkeypatch.setattr(settings, "device_token_secret", "diag-test-device-key-not-production")
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    db = Session(engine, expire_on_commit=False)
    company = Company(name="Co", status="active")
    db.add(company)
    db.flush()
    employee = Employee(
        company_id=company.id,
        name="Khaled",
        email="k@example.test",
        employee_code="1",
        status="active",
    )
    db.add(employee)
    db.flush()
    device = Device(
        company_id=company.id,
        employee_id=employee.id,
        device_name="Khaled desktop",
        installation_id=str(uuid4()),
        operating_system="Windows",
        agent_version="test",
        status="active",
    )
    db.add(device)
    db.flush()
    token = create_device_token(
        device_id=device.id, employee_id=employee.id, company_id=company.id
    )
    db.add(
        DeviceToken(
            company_id=company.id,
            device_id=device.id,
            token_hash=hash_token(token),
            issued_at=datetime.now(UTC),
        )
    )
    db.commit()
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    yield client, {"Authorization": "Bearer " + token}, db, device
    app.dependency_overrides.pop(get_db, None)
    client.close()
    db.close()
    engine.dispose()


def test_opening_diagnostics_writes_a_device_audit_row(diagnostics_client):
    client, desktop, db, device = diagnostics_client
    response = client.post(
        "/api/v1/agent/diagnostics/open",
        headers=desktop,
        json={
            "app_version": "2.0.1",
            "network": {"requests": 120, "failures": 18},
            "unsynced": {"pendingEvents": 5},
        },
    )
    assert response.status_code == 200
    row = db.scalar(select(AuditLog).where(AuditLog.action == "diagnostics_mode_opened"))
    assert row is not None
    assert row.company_id == device.company_id
    assert row.admin_user_id is None  # device-originated; shows as "System"
    assert row.entity_type == "device"
    assert row.entity_id == device.id
    assert row.entity_name == "Khaled desktop"
    assert row.details["app_version"] == "2.0.1"
    assert row.details["network"]["failures"] == 18


def test_diagnostics_endpoint_requires_a_device_token(diagnostics_client):
    client, *_ = diagnostics_client
    assert client.post("/api/v1/agent/diagnostics/open", json={}).status_code == 401


def test_diagnostics_tolerates_a_missing_or_non_dict_payload(diagnostics_client):
    client, desktop, db, _ = diagnostics_client
    assert client.post("/api/v1/agent/diagnostics/open", headers=desktop, json={}).status_code == 200
    row = db.scalar(select(AuditLog).where(AuditLog.action == "diagnostics_mode_opened"))
    assert row.details["network"] is None
    assert row.details["unsynced"] is None
