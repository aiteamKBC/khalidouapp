"""HR payroll access regression tests.

The capability layer already grants HR ``payroll.view``/``payroll.manage``; the
defect that blocked HR from *using* payroll was data-scope handling:

1. The admin profile payload omitted ``data_scope``/``permission_mode``, so the
   dashboard fell back to ``assigned_teams`` for every HR user and emptied the
   payroll sheet/selector.
2. A new HR row created via the model default landed on ``assigned_teams``
   instead of company scope, 403'ing settings/run-status and scoping the sheet
   to owned teams only.

These tests lock both fixes without broadening any other role.
"""

from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database.base import Base
from app.models import AdminUser, Company, Employee
from app.api.v1.auth import _admin_profile_data
from app.services.permissions import PAYROLL_PERMISSION_KEYS, capabilities_for_admin


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db: Session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


def _company(db) -> Company:
    company = Company(name="HR Co", status="active")
    db.add(company)
    db.flush()
    return company


def _admin(db, company, role, **kwargs) -> AdminUser:
    admin = AdminUser(
        company_id=company.id,
        name=f"{role} user",
        email=f"{role}-{uuid4().hex[:8]}@example.com",
        password_hash="x",
        role=role,
        status="active",
        **kwargs,
    )
    db.add(admin)
    db.flush()
    return admin


def test_new_hr_row_defaults_to_company_scope(db_session):
    company = _company(db_session)
    hr = _admin(db_session, company, "hr")
    assert hr.data_scope == "company"


def test_new_team_owner_still_defaults_to_assigned_teams(db_session):
    company = _company(db_session)
    owner = _admin(db_session, company, "team_owner")
    assert owner.data_scope == "assigned_teams"


def test_hr_keeps_payroll_capabilities(db_session):
    company = _company(db_session)
    hr = _admin(db_session, company, "hr")
    caps = set(capabilities_for_admin(hr))
    assert PAYROLL_PERMISSION_KEYS <= caps


def test_non_hr_non_super_admin_cannot_hold_payroll(db_session):
    company = _company(db_session)
    owner = _admin(db_session, company, "team_owner")
    caps = set(capabilities_for_admin(owner))
    assert not (PAYROLL_PERMISSION_KEYS & caps)


def test_admin_profile_payload_exposes_scope_and_mode(db_session):
    company = _company(db_session)
    hr = _admin(db_session, company, "hr")
    tracked = Employee(
        company_id=company.id,
        name="HR Person",
        email=f"hr-emp-{uuid4().hex[:8]}@example.com",
        employee_code=f"HR-{uuid4().hex[:6]}",
        timezone="UTC",
        status="active",
    )
    db_session.add(tracked)
    db_session.flush()
    hr.employee_id = tracked.id
    db_session.flush()

    payload = _admin_profile_data(db_session, hr, tracked)
    # The dashboard reads these fields; when absent it forced HR to
    # assigned_teams and hid every payroll amount.
    assert payload["data_scope"] == "company"
    assert payload["permission_mode"] == "role"
    assert set(PAYROLL_PERMISSION_KEYS) <= set(payload["permissions"])
