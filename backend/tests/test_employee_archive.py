"""Archiving fired/resigned employees.

HR / Super Admin archive an employee with a reason and an inclusive last
working day. Archived employees disappear from current views, lose desktop and
portal access, and are paid only through their last working day; closed payroll
keeps them as records, and restore re-employs them (without reviving tokens).
"""

from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import create_device_token, create_jwt_token, hash_password, hash_token
from app.database.base import Base
from app.database.session import get_db
from app.main import app
from app.models import (
    AdminUser,
    Company,
    Device,
    DeviceToken,
    Employee,
    EmployeeWorkProfile,
    PayrollEntry,
    PayrollRun,
    Team,
    TeamMember,
    WorkSession,
)
from app.services.payroll import get_or_create_run, refresh_run_entries


PASSWORD = "Portal-Secret-123!"


def _token(admin: AdminUser) -> dict[str, str]:
    token = create_jwt_token(
        subject=admin.id,
        company_id=admin.company_id,
        token_type="access",
        expires_delta=timedelta(minutes=30),
        extra_claims={"role": admin.role},
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def archive_context():
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
    db: Session = factory()
    company = Company(name="Archive Co", status="active")
    db.add(company)
    db.flush()
    team = Team(company_id=company.id, name="Ops", status="active")
    hr = AdminUser(
        company_id=company.id,
        name="HR Lead",
        email="hr@example.com",
        password_hash="x",
        role="hr",
        status="active",
        data_scope="company",
    )
    general = AdminUser(
        company_id=company.id,
        name="General Admin",
        email="general@example.com",
        password_hash="x",
        role="general_admin",
        status="active",
        data_scope="company",
    )
    super_admin = AdminUser(
        company_id=company.id,
        name="Owner",
        email="owner@example.com",
        password_hash="x",
        role="general_admin",
        status="active",
        data_scope="company",
        is_super_admin=True,
    )
    employee = Employee(
        company_id=company.id,
        name="Leaving Employee",
        email="leaving@example.com",
        employee_code="LEAVE-1",
        timezone="UTC",
        status="active",
        start_date=date(2026, 1, 1),
        portal_password_hash=hash_password(PASSWORD),
    )
    stayer = Employee(
        company_id=company.id,
        name="Staying Employee",
        email="staying@example.com",
        employee_code="STAY-1",
        timezone="UTC",
        status="active",
        start_date=date(2026, 1, 1),
    )
    db.add_all([team, hr, general, super_admin, employee, stayer])
    db.flush()
    for person in (employee, stayer):
        db.add(TeamMember(team_id=team.id, employee_id=person.id, status="active"))
        db.add(
            EmployeeWorkProfile(
                company_id=company.id,
                employee_id=person.id,
                shift_start=time(9, 0),
                shift_end=time(17, 0),
                working_days=[0, 1, 2, 3, 4],
                weekly_off_days=[5, 6],
                required_daily_minutes=480,
                late_grace_minutes=15,
                break_rules=[],
                salary_amount=Decimal("3000"),
                salary_currency="EGP",
                salary_type="monthly",
            )
        )
    device = Device(
        company_id=company.id,
        employee_id=employee.id,
        device_name="Leaving PC",
        installation_id="leaving-pc",
        operating_system="Windows 11",
        agent_version="9.9.9",
        status="active",
    )
    db.add(device)
    db.flush()
    device_token = create_device_token(
        device_id=device.id, company_id=company.id, employee_id=employee.id
    )
    db.add(
        DeviceToken(
            company_id=company.id, device_id=device.id, token_hash=hash_token(device_token)
        )
    )
    db.commit()
    data = {
        "factory": factory,
        "company": company,
        "hr": hr,
        "general": general,
        "super_admin": super_admin,
        "employee": employee,
        "stayer": stayer,
        "device": device,
        "device_headers": {"Authorization": f"Bearer {device_token}"},
    }
    db.close()
    try:
        yield TestClient(app), data
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(engine)
        engine.dispose()


def _archive(client, admin, employee_id, last_day="2026-08-10", reason="resigned"):
    return client.post(
        f"/api/v1/people/employee/{employee_id}/archive",
        headers=_token(admin),
        json={"reason": reason, "last_working_day": last_day},
    )


def _ids(response) -> set[str]:
    assert response.status_code == 200, response.text
    return {
        (item["employee"]["id"] if "employee" in item else item["id"])
        for item in response.json()["data"]
    }


def test_archive_hides_employee_from_current_views(archive_context):
    client, data = archive_context
    employee_id = str(data["employee"].id)
    headers = _token(data["hr"])
    assert employee_id in _ids(client.get("/api/v1/employees-overview", headers=headers))

    archived = _archive(client, data["hr"], employee_id, reason="fired")
    assert archived.status_code == 200, archived.text
    body = archived.json()["data"]
    assert body["archived"] is True
    assert body["archive_reason"] == "fired"
    assert body["last_working_day"] == "2026-08-10"

    stayer_id = str(data["stayer"].id)
    for path in (
        "/api/v1/employees-overview",
        "/api/v1/employees-monitoring",
        "/api/v1/employees",
    ):
        ids = _ids(client.get(path, headers=headers))
        assert employee_id not in ids, path
        assert stayer_id in ids, path

    # The archive itself and explicit lookups still find them.
    assert employee_id in _ids(
        client.get("/api/v1/employees-overview?include_archived=true", headers=headers)
    )
    assert employee_id in _ids(
        client.get(f"/api/v1/employees-overview?employee_id={employee_id}", headers=headers)
    )
    assert employee_id in _ids(client.get("/api/v1/employees?status=archived", headers=headers))
    listing = client.get("/api/v1/people/archived-employees", headers=headers)
    assert listing.status_code == 200
    rows = listing.json()["data"]
    assert [row["id"] for row in rows] == [employee_id]
    assert rows[0]["archive_reason"] == "fired"
    assert rows[0]["last_working_day"] == "2026-08-10"
    assert rows[0]["archived_by"]["name"] == "HR Lead"
    assert listing.json()["meta"]["can_restore"] is True

    db = data["factory"]()
    try:
        employee = db.get(Employee, data["employee"].id)
        assert employee.status == "archived"
        assert employee.archived_by_admin_user_id == data["hr"].id
    finally:
        db.close()


def test_archive_revokes_desktop_and_portal_access(archive_context):
    client, data = archive_context
    before = client.get("/api/v1/agent/config", headers=data["device_headers"])
    assert before.status_code == 200, before.text

    assert _archive(client, data["hr"], data["employee"].id).status_code == 200

    after = client.get("/api/v1/agent/config", headers=data["device_headers"])
    assert after.status_code == 401
    assert after.json()["error"]["code"] == "DEVICE_REENROLLMENT_REQUIRED"
    login = client.post(
        "/api/v1/employee-auth/login",
        json={"email": "leaving@example.com", "password": PASSWORD},
    )
    assert login.status_code in {401, 403}

    db = data["factory"]()
    try:
        device = db.get(Device, data["device"].id)
        assert device.status == "revoked"
        assert all(
            token.revoked_at is not None
            for token in db.scalars(
                select(DeviceToken).where(DeviceToken.device_id == device.id)
            ).all()
        )
    finally:
        db.close()


def test_only_hr_or_super_admin_can_archive_and_restore(archive_context):
    client, data = archive_context
    employee_id = data["employee"].id

    forbidden = _archive(client, data["general"], employee_id)
    assert forbidden.status_code == 403

    assert _archive(client, data["super_admin"], employee_id).status_code == 200
    general_restore = client.post(
        f"/api/v1/people/employee/{employee_id}/restore", headers=_token(data["general"])
    )
    assert general_restore.status_code == 403
    listing = client.get(
        "/api/v1/people/archived-employees", headers=_token(data["general"])
    )
    assert listing.json()["meta"]["can_restore"] is False


def test_archive_requires_reason_and_valid_last_working_day(archive_context):
    client, data = archive_context
    employee_id = data["employee"].id
    headers = _token(data["hr"])
    missing = client.post(f"/api/v1/people/employee/{employee_id}/archive", headers=headers)
    assert missing.status_code == 422
    bad_reason = _archive(client, data["hr"], employee_id, reason="retired")
    assert bad_reason.status_code == 422
    future = (datetime.now(UTC).date() + timedelta(days=3)).isoformat()
    assert _archive(client, data["hr"], employee_id, last_day=future).status_code == 400
    before_start = _archive(client, data["hr"], employee_id, last_day="2025-12-31")
    assert before_start.status_code == 400


def _session(db, employee_id, device_id, company_id, day: date) -> None:
    start = datetime.combine(day, time(9, 0), tzinfo=UTC)
    db.add(
        WorkSession(
            company_id=company_id,
            employee_id=employee_id,
            device_id=device_id,
            started_at=start,
            ended_at=start + timedelta(hours=8),
            status="ended",
            active_seconds=8 * 3600,
            idle_seconds=0,
        )
    )


def _run(db, data, first: date, last: date) -> PayrollRun:
    return get_or_create_run(
        db,
        company_id=data["company"].id,
        month=first.replace(day=1),
        admin_user_id=data["hr"].id,
        period_start=first,
        period_end=last,
    )


def test_payroll_and_attendance_stop_after_last_working_day(archive_context):
    client, data = archive_context
    db = data["factory"]()
    try:
        # Monday 3 Aug (before) and Thursday 20 Aug (after the last day).
        for day in (date(2026, 8, 3), date(2026, 8, 20)):
            _session(db, data["employee"].id, data["device"].id, data["company"].id, day)
        db.commit()
    finally:
        db.close()

    assert _archive(client, data["hr"], data["employee"].id, last_day="2026-08-10").status_code == 200

    db = data["factory"]()
    try:
        run = _run(db, data, date(2026, 8, 1), date(2026, 8, 31))
        entries = {entry.employee_id: entry for entry in refresh_run_entries(db, run)}
        db.commit()
        entry = entries[data["employee"].id]
        # Only 1–10 Aug counts: 6 working days (3–7, 10) and the 3 Aug session.
        assert entry.expected_work_days == 6
        assert entry.worked_days == 1
        assert entry.worked_seconds == 8 * 3600
        # Monthly salary pro-rated by 10 of 30 payroll days.
        assert entry.base_salary == Decimal("1000.00")
        assert entry.calculation_snapshot["last_working_day"] == "2026-08-10"
        # The colleague is unaffected.
        assert entries[data["stayer"].id].base_salary == Decimal("3000.00")

        # A later period no longer includes the archived employee at all.
        september = _run(db, data, date(2026, 9, 1), date(2026, 9, 30))
        september_ids = {entry.employee_id for entry in refresh_run_entries(db, september)}
        db.commit()
        assert data["employee"].id not in september_ids
        assert data["stayer"].id in september_ids
    finally:
        db.close()

    ledger = client.get(
        f"/api/v1/attendance/employee/{data['employee'].id}",
        params={"start_date": "2026-08-01", "end_date": "2026-08-31"},
        headers=_token(data["hr"]),
    )
    assert ledger.status_code == 200, ledger.text
    ledger_rows = ledger.json()["data"]["rows"]
    assert ledger_rows
    assert max(row["date"] for row in ledger_rows) == "2026-08-10"


def test_closed_payroll_keeps_archived_employee_but_draft_drops_them(archive_context):
    client, data = archive_context
    db = data["factory"]()
    try:
        locked = _run(db, data, date(2026, 7, 1), date(2026, 7, 31))
        refresh_run_entries(db, locked)
        locked.status = "locked"
        draft = _run(db, data, date(2026, 8, 1), date(2026, 8, 31))
        refresh_run_entries(db, draft)
        db.commit()
        locked_id, draft_id = locked.id, draft.id
    finally:
        db.close()

    # Last day falls before the August draft run starts.
    assert _archive(client, data["hr"], data["employee"].id, last_day="2026-07-31").status_code == 200

    db = data["factory"]()
    try:
        locked = db.get(PayrollRun, locked_id)
        draft = db.get(PayrollRun, draft_id)
        locked_ids = {entry.employee_id for entry in refresh_run_entries(db, locked)}
        draft_ids = {entry.employee_id for entry in refresh_run_entries(db, draft)}
        db.commit()
        assert data["employee"].id in locked_ids
        assert data["employee"].id not in draft_ids
        stored_draft_ids = set(
            db.scalars(
                select(PayrollEntry.employee_id).where(PayrollEntry.payroll_run_id == draft_id)
            ).all()
        )
        assert data["employee"].id not in stored_draft_ids
        assert data["stayer"].id in stored_draft_ids
    finally:
        db.close()


def test_restore_returns_employee_without_reviving_device_tokens(archive_context):
    client, data = archive_context
    employee_id = str(data["employee"].id)
    headers = _token(data["hr"])
    assert _archive(client, data["hr"], employee_id).status_code == 200

    restored = client.post(f"/api/v1/people/employee/{employee_id}/restore", headers=headers)
    assert restored.status_code == 200, restored.text
    assert restored.json()["data"]["archived"] is False

    assert employee_id in _ids(client.get("/api/v1/employees-overview", headers=headers))
    assert client.get("/api/v1/people/archived-employees", headers=headers).json()["data"] == []
    db = data["factory"]()
    try:
        employee = db.get(Employee, UUID(employee_id))
        assert employee.status == "active"
        assert employee.archive_reason is None
        assert employee.last_working_day is None
        assert employee.archived_at is None
    finally:
        db.close()

    # The old desktop token stays revoked: the employee signs in again.
    still_blocked = client.get("/api/v1/agent/config", headers=data["device_headers"])
    assert still_blocked.status_code == 401
    login = client.post(
        "/api/v1/employee-auth/login",
        json={"email": "leaving@example.com", "password": PASSWORD},
    )
    assert login.status_code == 200, login.text


def test_archive_cancels_pending_shift_reschedules(archive_context):
    from datetime import time as clock

    from app.models import ShiftRescheduleRequest

    client, data = archive_context
    employee = data["employee"]
    db = data["factory"]()
    try:
        db.add(ShiftRescheduleRequest(
            company_id=employee.company_id, employee_id=employee.id,
            work_date=date(2099, 1, 7), requested_start=clock(12, 0), requested_end=clock(20, 0),
            original_start=clock(10, 0), original_end=clock(18, 0),
            reason="appointment", status="pending", source="employee",
        ))
        db.commit()
    finally:
        db.close()

    assert _archive(client, data["hr"], str(employee.id)).status_code == 200

    queue = client.get("/api/v1/shift-reschedules", headers=_token(data["hr"]))
    assert queue.status_code == 200, queue.text
    assert queue.json()["data"] == []
    db = data["factory"]()
    try:
        row = db.scalar(select(ShiftRescheduleRequest))
        assert row.status == "cancelled"
    finally:
        db.close()
