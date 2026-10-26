from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.security import create_device_token, create_employee_access_token, hash_token
from app.database.base import Base
from app.database.session import get_db
from app.main import app
from app.models import Company, Device, DeviceToken, Employee


@pytest.fixture()
def appearance_client(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret_key", "appearance-test-jwt-key-not-production")
    monkeypatch.setattr(settings, "device_token_secret", "appearance-test-device-key-not-production")
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = Session(engine, expire_on_commit=False)
    companies = [Company(name=f"Company {i}", status="active") for i in range(2)]
    db.add_all(companies)
    db.flush()
    employees = [Employee(company_id=company.id, name=f"Employee {i}", email=f"user{i}@example.test", employee_code=str(i), status="active") for i, company in enumerate([companies[0], companies[0], companies[1]])]
    db.add_all(employees)
    db.flush()
    employee = employees[0]
    device = Device(company_id=employee.company_id, employee_id=employee.id, device_name="Test desktop", installation_id=str(uuid4()), operating_system="Windows", agent_version="test", status="active")
    db.add(device)
    db.flush()
    device_token = create_device_token(device_id=device.id, employee_id=employee.id, company_id=employee.company_id)
    db.add(DeviceToken(company_id=employee.company_id, device_id=device.id, token_hash=hash_token(device_token), issued_at=datetime.now(UTC)))
    db.commit()
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    web_headers = [{"Authorization": "Bearer " + create_employee_access_token(employee_id=e.id, company_id=e.company_id)} for e in employees]
    yield client, web_headers, {"Authorization": "Bearer " + device_token}, db, device
    app.dependency_overrides.pop(get_db, None)
    client.close()
    db.close()
    engine.dispose()


def test_dashboard_and_desktop_share_one_persisted_preference(appearance_client):
    client, web, desktop, *_ = appearance_client
    assert client.get("/api/v1/employee-auth/appearance", headers=web[0]).json()["data"] == {}
    response = client.patch("/api/v1/employee-auth/appearance", headers=web[0], json={"skin": "forest", "mode": "light"})
    assert response.status_code == 200
    assert client.get("/api/v1/agent/appearance", headers=desktop).json()["data"] == {"skin": "forest", "mode": "light"}
    assert client.patch("/api/v1/agent/appearance", headers=desktop, json={"mode": "dark"}).status_code == 200
    assert client.get("/api/v1/employee-auth/appearance", headers=web[0]).json()["data"] == {"skin": "forest", "mode": "dark"}


def test_appearance_isolated_by_employee_and_company(appearance_client):
    client, web, desktop, *_ = appearance_client
    client.patch("/api/v1/agent/appearance", headers=desktop, json={"skin": "ember"})
    for headers in web[1:]:
        assert client.get("/api/v1/employee-auth/appearance", headers=headers).json()["data"] == {}
    assert client.patch("/api/v1/employee-auth/appearance", headers=web[1], json={"employee_id": "other", "skin": "forest"}).status_code == 422


@pytest.mark.parametrize("payload", [{"skin": "unknown"}, {"mode": "unknown"}, {"skin": None}, {"mode": None}])
def test_invalid_preferences_rejected(appearance_client, payload):
    client, web, *_ = appearance_client
    assert client.patch("/api/v1/employee-auth/appearance", headers=web[0], json=payload).status_code == 422
    assert client.get("/api/v1/employee-auth/appearance", headers=web[0]).json()["data"] == {}


def test_authentication_required_and_revoked_device_cannot_change_theme(appearance_client):
    client, web, desktop, db, device = appearance_client
    for path in ["/api/v1/employee-auth/appearance", "/api/v1/agent/appearance"]:
        assert client.get(path).status_code == 401
        assert client.patch(path, json={"skin": "ember"}).status_code == 401
    device.revoked_at = datetime.now(UTC)
    db.commit()
    assert client.patch("/api/v1/agent/appearance", headers=desktop, json={"skin": "ember"}).status_code == 401
    assert client.get("/api/v1/employee-auth/appearance", headers=web[0]).json()["data"] == {}
