"""HR / Super Admin can set an employee's remaining holiday days directly."""

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import create_jwt_token
from app.database.base import Base
from app.database.session import get_db
from app.main import app
from app.models import AdminUser, AuditLog, Company, Employee, LeaveRequest


def _token(admin: AdminUser) -> dict:
    token = create_jwt_token(
        subject=admin.id, company_id=admin.company_id, token_type="access",
        expires_delta=timedelta(minutes=30), extra_claims={"role": admin.role},
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def ctx():
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
    company = Company(name="Leave Co", status="active")
    db.add(company)
    db.flush()
    employee = Employee(
        company_id=company.id, name="Old Timer", email="old@example.com",
        employee_code="OLD-1", timezone="UTC", status="active",
        start_date=date(2020, 1, 1), annual_leave_days=21,
    )
    hr = AdminUser(company_id=company.id, name="HR", email="hr@example.com",
                   password_hash="x", role="hr", status="active", data_scope="company")
    leader = AdminUser(company_id=company.id, name="Lead", email="lead@example.com",
                       password_hash="x", role="team_owner", status="active")
    db.add_all([employee, hr, leader])
    db.flush()
    db.add(LeaveRequest(
        company_id=company.id, employee_id=employee.id, leave_type="annual",
        start_date=date(2026, 3, 2), end_date=date(2026, 3, 3), requested_days=2,
        reason="trip", status="approved",
    ))
    db.commit()
    data = {"employee_id": str(employee.id), "hr": _token(hr), "leader": _token(leader),
            "factory": factory}
    db.close()
    try:
        yield TestClient(app), data
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_hr_sets_remaining_days_directly(ctx):
    client, data = ctx
    response = client.put(
        f"/api/v1/leave-requests/balances/{data['employee_id']}?year=2026",
        headers=data["hr"],
        json={"remaining_days": 12},
    )
    assert response.status_code == 200, response.text
    balance = response.json()["data"]
    assert balance["used_days"] == 2
    assert balance["remaining_days"] == 12
    assert balance["credit_days"] == 14

    db = data["factory"]()
    log = db.scalar(select(AuditLog).where(AuditLog.entity_type == "leave_balance"))
    assert log is not None
    db.close()


def test_team_leader_cannot_edit_balances(ctx):
    client, data = ctx
    response = client.put(
        f"/api/v1/leave-requests/balances/{data['employee_id']}?year=2026",
        headers=data["leader"],
        json={"remaining_days": 30},
    )
    assert response.status_code == 403


def test_exactly_one_value_is_required(ctx):
    client, data = ctx
    response = client.put(
        f"/api/v1/leave-requests/balances/{data['employee_id']}?year=2026",
        headers=data["hr"],
        json={"remaining_days": 5, "credit_days": 10},
    )
    assert response.status_code == 422
