from datetime import UTC, datetime, timedelta
from io import BytesIO
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine, delete, event, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1 import attendance as attendance_api
from app.core.config import settings
from app.core.security import create_device_token, create_employee_access_token, hash_token
from app.core.security import create_jwt_token, hash_password
from app.database.base import Base
from app.database.session import get_db
from app.main import app
from app.services.activity_timeline import local_today
from app.services.request_notifications import request_recipients
from app.services.work_profiles import get_or_create_work_profile
from app.models import (
    AdminUser,
    ActivityEvent,
    Company,
    Device,
    DeviceToken,
    DailyAttendance,
    Employee,
    LeaveRequest,
    OvertimeRecord,
    Project,
    Screenshot,
    Task,
    TaskNotification,
    TaskWorkflowRequest,
    Team,
    TeamMember,
    TeamOwner,
    TimeAdjustmentRequest,
    TrackingSettings,
    WorkSession,
)


@pytest.fixture()
def team_client():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestingSessionLocal = sessionmaker(
        bind=engine, autoflush=False, autocommit=False, expire_on_commit=False
    )

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    db: Session = TestingSessionLocal()

    company = Company(name="Company A", status="active")
    other_company = Company(name="Company B", status="active")
    db.add_all([company, other_company])
    db.flush()

    general_admin = AdminUser(
        company_id=company.id,
        name="General Admin",
        email="general@example.com",
        password_hash=hash_password("ExamplePassword123!"),
        role="general_admin",
        is_super_admin=True,
        status="active",
    )
    owner = AdminUser(
        company_id=company.id,
        name="Team Owner",
        email="owner@example.com",
        password_hash=hash_password("ExamplePassword123!"),
        role="team_owner",
        status="active",
    )
    second_owner = AdminUser(
        company_id=company.id,
        name="Second Owner",
        email="second@example.com",
        password_hash=hash_password("ExamplePassword123!"),
        role="team_owner",
        status="active",
    )
    other_general_admin = AdminUser(
        company_id=other_company.id,
        name="Other Admin",
        email="other@example.com",
        password_hash=hash_password("ExamplePassword123!"),
        role="general_admin",
        status="active",
    )
    db.add_all([general_admin, owner, second_owner, other_general_admin])
    db.flush()

    team_a = Team(company_id=company.id, name="Team A", description=None, status="active")
    team_b = Team(company_id=company.id, name="Team B", description=None, status="active")
    other_team = Team(
        company_id=other_company.id, name="Other Team", description=None, status="active"
    )
    db.add_all([team_a, team_b, other_team])
    db.flush()

    employee_a = Employee(
        company_id=company.id,
        name="Employee A",
        email="a@example.com",
        employee_code="A",
        job_title=None,
        timezone="UTC",
        status="active",
    )
    employee_b = Employee(
        company_id=company.id,
        name="Employee B",
        email="b@example.com",
        employee_code="B",
        job_title=None,
        timezone="UTC",
        status="active",
    )
    shared_employee = Employee(
        company_id=company.id,
        name="Shared Employee",
        email="shared@example.com",
        employee_code="S",
        job_title=None,
        timezone="UTC",
        status="active",
    )
    other_employee = Employee(
        company_id=other_company.id,
        name="Other Employee",
        email="other.employee@example.com",
        employee_code="O",
        job_title=None,
        timezone="UTC",
        status="active",
    )
    db.add_all([employee_a, employee_b, shared_employee, other_employee])
    db.flush()

    # A team manager may also be a tracked employee.  Keep the identities
    # explicitly linked so workflow authorization can prevent self-review.
    owner.employee_id = employee_a.id

    db.add_all(
        [
            TeamMember(team_id=team_a.id, employee_id=employee_a.id, status="active"),
            TeamMember(team_id=team_b.id, employee_id=employee_b.id, status="active"),
            TeamMember(team_id=team_a.id, employee_id=shared_employee.id, status="active"),
            TeamMember(team_id=team_b.id, employee_id=shared_employee.id, status="active"),
            TeamMember(team_id=other_team.id, employee_id=other_employee.id, status="active"),
            TeamOwner(team_id=team_a.id, admin_user_id=owner.id),
            TeamOwner(team_id=team_a.id, admin_user_id=second_owner.id),
        ]
    )
    db.flush()

    project_a = Project(
        company_id=company.id,
        team_id=team_a.id,
        name="Project A",
        description=None,
        status="active",
    )
    project_b = Project(
        company_id=company.id,
        team_id=team_b.id,
        name="Project B",
        description=None,
        status="active",
    )
    db.add_all([project_a, project_b])
    db.flush()

    task_a = Task(
        company_id=company.id,
        project_id=project_a.id,
        name="Task A",
        description=None,
        status="active",
    )
    task_b = Task(
        company_id=company.id,
        project_id=project_b.id,
        name="Task B",
        description=None,
        status="active",
    )
    db.add_all([task_a, task_b])
    db.flush()

    now = datetime.now(UTC)
    device_a = Device(
        company_id=company.id,
        employee_id=employee_a.id,
        device_name="Device A",
        installation_id="install-a",
        operating_system="Windows 11",
        agent_version="1.0.0",
        status="active",
        registered_at=now,
    )
    device_b = Device(
        company_id=company.id,
        employee_id=employee_b.id,
        device_name="Device B",
        installation_id="install-b",
        operating_system="Windows 11",
        agent_version="1.0.0",
        status="active",
        registered_at=now,
    )
    db.add_all([device_a, device_b])
    db.flush()
    device_token = create_device_token(
        device_id=device_a.id,
        company_id=company.id,
        employee_id=employee_a.id,
    )
    db.add(
        DeviceToken(
            company_id=company.id, device_id=device_a.id, token_hash=hash_token(device_token)
        )
    )

    session_a = WorkSession(
        company_id=company.id,
        employee_id=employee_a.id,
        device_id=device_a.id,
        started_at=now,
        status="active",
        active_seconds=120,
        idle_seconds=10,
        team_id=team_a.id,
        project_id=project_a.id,
        task_id=task_a.id,
    )
    session_b = WorkSession(
        company_id=company.id,
        employee_id=employee_b.id,
        device_id=device_b.id,
        started_at=now,
        status="active",
        active_seconds=240,
        idle_seconds=20,
        team_id=team_b.id,
        project_id=project_b.id,
        task_id=task_b.id,
    )
    db.add_all([session_a, session_b])
    db.flush()

    screenshot_a = Screenshot(
        id=uuid4(),
        company_id=company.id,
        employee_id=employee_a.id,
        device_id=device_a.id,
        session_id=session_a.id,
        captured_at=now,
        storage_path="a.jpg",
        mime_type="image/jpeg",
        width=100,
        height=100,
        file_size=10,
        checksum="a" * 64,
        status="completed",
        team_id=team_a.id,
        project_id=project_a.id,
        task_id=task_a.id,
    )
    screenshot_b = Screenshot(
        id=uuid4(),
        company_id=company.id,
        employee_id=employee_b.id,
        device_id=device_b.id,
        session_id=session_b.id,
        captured_at=now,
        storage_path="b.jpg",
        mime_type="image/jpeg",
        width=100,
        height=100,
        file_size=10,
        checksum="b" * 64,
        status="completed",
        team_id=team_b.id,
        project_id=project_b.id,
        task_id=task_b.id,
    )
    db.add_all(
        [
            screenshot_a,
            screenshot_b,
            TrackingSettings(company_id=company.id),
            TrackingSettings(company_id=other_company.id),
        ]
    )
    db.commit()

    def token(admin: AdminUser) -> str:
        return create_jwt_token(
            subject=admin.id,
            company_id=admin.company_id,
            token_type="access",
            expires_delta=timedelta(minutes=30),
            extra_claims={"role": admin.role},
        )

    data = {
        "general_headers": {"Authorization": f"Bearer {token(general_admin)}"},
        "owner_headers": {"Authorization": f"Bearer {token(owner)}"},
        "second_owner_headers": {"Authorization": f"Bearer {token(second_owner)}"},
        "other_headers": {"Authorization": f"Bearer {token(other_general_admin)}"},
        "general_admin": general_admin,
        "owner": owner,
        "second_owner": second_owner,
        "team_a": team_a,
        "team_b": team_b,
        "other_team": other_team,
        "employee_a": employee_a,
        "employee_b": employee_b,
        "shared_employee": shared_employee,
        "other_employee": other_employee,
        "screenshot_a": screenshot_a,
        "screenshot_b": screenshot_b,
        "session_a": session_a,
        "project_a": project_a,
        "project_b": project_b,
        "task_a": task_a,
        "task_b": task_b,
        "device_headers": {"Authorization": f"Bearer {device_token}"},
        "session_factory": TestingSessionLocal,
    }
    db.close()

    try:
        yield TestClient(app), data
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(engine)


def test_attendance_detail_enforces_team_and_company_isolation(team_client):
    client, data = team_client
    today = local_today("UTC").isoformat()

    own_team = client.get(
        f"/api/v1/attendance/employee/{data['employee_a'].id}/{today}",
        headers=data["owner_headers"],
    )
    assert own_team.status_code == 200

    other_team = client.get(
        f"/api/v1/attendance/employee/{data['employee_b'].id}/{today}",
        headers=data["owner_headers"],
    )
    assert other_team.status_code in {403, 404}

    other_company = client.get(
        f"/api/v1/attendance/employee/{data['other_employee'].id}/{today}",
        headers=data["general_headers"],
    )
    assert other_company.status_code in {403, 404}


def test_daily_attendance_includes_start_grace_for_dashboard_alerts(team_client):
    client, data = team_client
    response = client.get(
        "/api/v1/attendance/daily",
        params={"day": local_today("UTC").isoformat()},
        headers=data["general_headers"],
    )

    assert response.status_code == 200
    employee_row = next(
        row
        for row in response.json()["data"]["rows"]
        if row["employee_id"] == str(data["employee_a"].id)
    )
    assert employee_row["late_grace_minutes"] == 15


def test_daily_attendance_list_reuses_materialized_row(team_client, monkeypatch):
    client, data = team_client
    today = local_today("UTC")
    with data["session_factory"]() as db:
        db.add(
            DailyAttendance(
                company_id=data["employee_a"].company_id,
                employee_id=data["employee_a"].id,
                work_date=today,
                timezone="UTC",
                normal_worked_seconds=321,
                status="present",
                issues=[],
                calculation_sources={"test": "materialized"},
                calculated_at=datetime.now(UTC) - timedelta(hours=1),
            )
        )
        db.commit()

    def unexpected_recalculation(*_args, **_kwargs):
        raise AssertionError("The daily roster must not recalculate a stored employee row")

    monkeypatch.setattr(
        attendance_api,
        "cached_daily_attendance",
        unexpected_recalculation,
    )
    response = client.get(
        "/api/v1/attendance/daily",
        params={
            "day": today.isoformat(),
            "employee_id": str(data["employee_a"].id),
        },
        headers=data["general_headers"],
    )

    assert response.status_code == 200
    rows = response.json()["data"]["rows"]
    assert len(rows) == 1
    assert rows[0]["normal_worked_seconds"] == 321
    assert rows[0]["calculation_sources"] == {"test": "materialized"}


def test_daily_attendance_empty_roster_has_bounded_query_count(team_client):
    client, data = team_client
    with data["session_factory"]() as db:
        engine = db.get_bind()
        for index in range(20):
            employee = Employee(
                company_id=data["employee_a"].company_id,
                name=f"Roster Perf {index:02d}",
                email=f"roster-perf-{index:02d}@example.com",
                employee_code=f"ROSTER-PERF-{index:02d}",
                timezone="UTC",
                status="active",
            )
            db.add(employee)
            db.flush()
            get_or_create_work_profile(db, employee)
        db.commit()

    statements = []

    def count_statement(*_args):
        statements.append(1)

    event.listen(engine, "before_cursor_execute", count_statement)
    try:
        response = client.get(
            "/api/v1/attendance/daily",
            params={
                "day": local_today("UTC").isoformat(),
                "q": "Roster Perf",
            },
            headers=data["general_headers"],
        )
    finally:
        event.remove(engine, "before_cursor_execute", count_statement)

    assert response.status_code == 200
    assert len(response.json()["data"]["rows"]) == 20
    assert len(statements) <= 20


def test_attendance_range_stops_at_employee_today(team_client):
    client, data = team_client
    today = local_today("UTC")
    start_date = today - timedelta(days=1)
    end_date = today + timedelta(days=7)

    response = client.get(
        f"/api/v1/attendance/employee/{data['employee_a'].id}",
        params={
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
        },
        headers=data["general_headers"],
    )

    assert response.status_code == 200
    rows = response.json()["data"]["rows"]
    assert [row["date"] for row in rows] == [
        start_date.isoformat(),
        today.isoformat(),
    ]

    db: Session = data["session_factory"]()
    try:
        future_rows = db.scalars(
            select(DailyAttendance).where(
                DailyAttendance.employee_id == data["employee_a"].id,
                DailyAttendance.work_date > today,
            )
        ).all()
        assert future_rows == []
    finally:
        db.close()


def test_attendance_range_does_not_rebuild_empty_historical_days(team_client, monkeypatch):
    client, data = team_client
    today = local_today("UTC")
    start_date = today - timedelta(days=29)
    leave_day = next(
        start_date + timedelta(days=offset)
        for offset in range(29)
        if (start_date + timedelta(days=offset)).weekday() < 5
    )
    db: Session = data["session_factory"]()
    try:
        engine = db.get_bind()
        db.add(
            LeaveRequest(
                company_id=data["employee_a"].company_id,
                employee_id=data["employee_a"].id,
                start_date=leave_day,
                end_date=leave_day,
                requested_days=1,
                leave_type="annual",
                status="approved",
            )
        )
        db.commit()
    finally:
        db.close()

    original_cached_attendance = attendance_api.cached_daily_attendance
    recalculated_dates = []

    def counted_cached_attendance(*args, **kwargs):
        recalculated_dates.append(kwargs["work_date"])
        return original_cached_attendance(*args, **kwargs)

    monkeypatch.setattr(
        attendance_api,
        "cached_daily_attendance",
        counted_cached_attendance,
    )
    statements = []

    def count_statement(*_args):
        statements.append(1)

    event.listen(engine, "before_cursor_execute", count_statement)
    try:
        response = client.get(
            f"/api/v1/attendance/employee/{data['employee_a'].id}",
            params={
                "start_date": start_date.isoformat(),
                "end_date": today.isoformat(),
            },
            headers=data["general_headers"],
        )
    finally:
        event.remove(engine, "before_cursor_execute", count_statement)

    assert response.status_code == 200
    rows = response.json()["data"]["rows"]
    assert len(rows) == 30
    assert len(statements) <= 35
    assert recalculated_dates == [today]
    leave_row = next(row for row in rows if row["date"] == leave_day.isoformat())
    assert leave_row["status"] == "approved_leave"
    assert leave_row["total_payable_seconds"] == 8 * 60 * 60
    historical_weekday = next(
        row
        for row in rows[:-1]
        if datetime.fromisoformat(row["date"]).weekday() < 5
        and row["date"] != leave_day.isoformat()
    )
    assert historical_weekday["status"] == "absent"
    assert historical_weekday["issues"][0]["code"] == "missing_check_in"


def test_team_lead_manages_owned_team_schedule_without_salary_access(team_client):
    client, data = team_client

    scoped_rules = client.get(
        "/api/v1/employees/break-rules",
        headers=data["owner_headers"],
    )
    assert scoped_rules.status_code == 200
    rows = scoped_rules.json()["data"]
    assert {row["employee_id"] for row in rows} == {
        str(data["employee_a"].id),
        str(data["shared_employee"].id),
    }
    assert all("salary_amount" not in row for row in rows)
    assert all("salary_currency" not in row for row in rows)
    assert all("salary_type" not in row for row in rows)
    assert all("overtime_rate_multiplier" not in row for row in rows)

    schedule_update = client.patch(
        f"/api/v1/employees/{data['employee_a'].id}/work-profile",
        json={"shift_start": "10:00:00", "shift_end": "18:00:00"},
        headers=data["owner_headers"],
    )
    assert schedule_update.status_code == 200
    assert schedule_update.json()["data"]["shift_start"] == "10:00"

    salary_update = client.patch(
        f"/api/v1/employees/{data['employee_a'].id}/work-profile",
        json={"salary_amount": 50000},
        headers=data["owner_headers"],
    )
    assert salary_update.status_code == 403

    other_team_update = client.patch(
        f"/api/v1/employees/{data['employee_b'].id}/work-profile",
        json={"shift_start": "10:00:00", "shift_end": "18:00:00"},
        headers=data["owner_headers"],
    )
    assert other_team_update.status_code in {403, 404}

    day = local_today("UTC") + timedelta(days=1)
    team_exception = client.post(
        "/api/v1/payroll/schedule-overrides",
        json={
            "scope": "team",
            "team_id": str(data["team_a"].id),
            "override_type": "shift",
            "effective_date": day.isoformat(),
            "permanent": False,
            "shift_start": "11:00",
            "shift_end": "19:00",
            "reason": "Team coverage",
        },
        headers=data["owner_headers"],
    )
    assert team_exception.status_code == 200

    company_exception = client.post(
        "/api/v1/payroll/schedule-overrides",
        json={
            "scope": "company",
            "override_type": "shift",
            "effective_date": day.isoformat(),
            "permanent": False,
            "shift_start": "11:00",
            "shift_end": "19:00",
            "reason": "Forbidden company coverage",
        },
        headers=data["owner_headers"],
    )
    assert company_exception.status_code == 403


def test_protected_super_admin_keeps_company_wide_schedule_and_payroll_access(team_client):
    client, data = team_client
    rules = client.get(
        "/api/v1/employees/break-rules",
        headers=data["general_headers"],
    )
    assert rules.status_code == 200
    assert {row["employee_id"] for row in rules.json()["data"]} == {
        str(data["employee_a"].id),
        str(data["employee_b"].id),
        str(data["shared_employee"].id),
    }
    assert all("salary_amount" in row for row in rules.json()["data"])

    salary_update = client.patch(
        f"/api/v1/employees/{data['employee_b'].id}/work-profile",
        json={"salary_amount": 50000, "salary_currency": "EGP"},
        headers=data["general_headers"],
    )
    assert salary_update.status_code == 200
    assert salary_update.json()["data"]["salary_amount"] == 50000.0


def test_plain_general_admin_cannot_read_or_change_salary_data(team_client):
    client, data = team_client
    db: Session = data["session_factory"]()
    try:
        plain_general = AdminUser(
            company_id=data["general_admin"].company_id,
            name="Operations Admin",
            email="operations@example.com",
            password_hash=hash_password("ExamplePassword123!"),
            role="general_admin",
            is_super_admin=False,
            status="active",
            permission_mode="role",
            data_scope="company",
        )
        db.add(plain_general)
        db.commit()
        admin_id = plain_general.id
        company_id = plain_general.company_id
    finally:
        db.close()
    token = create_jwt_token(
        subject=admin_id,
        company_id=company_id,
        token_type="access",
        expires_delta=timedelta(minutes=30),
        extra_claims={"role": "general_admin"},
    )
    headers = {"Authorization": f"Bearer {token}"}

    payroll = client.get("/api/v1/payroll/settings", headers=headers)
    rules = client.get("/api/v1/employees/break-rules", headers=headers)
    salary_update = client.patch(
        f"/api/v1/employees/{data['employee_b'].id}/work-profile",
        json={"salary_amount": 70000, "salary_currency": "EGP"},
        headers=headers,
    )

    assert payroll.status_code == 403
    assert rules.status_code == 200
    assert all("salary_amount" not in row for row in rules.json()["data"])
    assert salary_update.status_code == 403


def test_group_schedule_override_validates_every_employee_company(team_client):
    client, data = team_client
    payload = {
        "scope": "employees",
        "override_type": "shift",
        "employee_ids": [str(data["employee_a"].id), str(data["employee_b"].id)],
        "effective_date": (local_today("UTC") + timedelta(days=1)).isoformat(),
        "permanent": False,
        "shift_start": "10:00",
        "shift_end": "18:00",
        "reason": "Group coverage change",
    }
    allowed = client.post(
        "/api/v1/payroll/schedule-overrides",
        json=payload,
        headers=data["general_headers"],
    )
    assert allowed.status_code == 200
    assert allowed.json()["data"]["affected_employees"] == 2

    payload["employee_ids"] = [str(data["other_employee"].id)]
    isolated = client.post(
        "/api/v1/payroll/schedule-overrides",
        json=payload,
        headers=data["general_headers"],
    )
    assert isolated.status_code in {403, 404}


def test_schedule_override_rejects_overlapping_breaks(team_client):
    client, data = team_client
    response = client.post(
        "/api/v1/payroll/schedule-overrides",
        json={
            "scope": "employee",
            "override_type": "breaks",
            "employee_id": str(data["employee_a"].id),
            "effective_date": (local_today("UTC") + timedelta(days=1)).isoformat(),
            "permanent": False,
            "break_rules": [
                {
                    "name": "Lunch",
                    "start_time": "13:00",
                    "end_time": "13:30",
                    "minutes": 30,
                    "paid": True,
                },
                {
                    "name": "Short break",
                    "start_time": "13:00",
                    "end_time": "13:30",
                    "minutes": 30,
                    "paid": True,
                },
            ],
            "reason": "Overlapping break regression check",
        },
        headers=data["general_headers"],
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "OVERLAPPING_BREAKS"


def test_team_day_override_applies_to_members_and_employee_override_wins(team_client):
    client, data = team_client
    day = local_today("UTC") + timedelta(days=1)
    team_override = client.post(
        "/api/v1/payroll/schedule-overrides",
        json={
            "scope": "team",
            "team_id": str(data["team_a"].id),
            "override_type": "shift",
            "effective_date": day.isoformat(),
            "permanent": False,
            "shift_start": "10:00",
            "shift_end": "18:00",
            "reason": "Team coverage",
        },
        headers=data["general_headers"],
    )
    assert team_override.status_code == 200
    assert team_override.json()["data"]["affected_employees"] == 2

    team_schedule = client.get(
        f"/api/v1/attendance/employee/{data['employee_a'].id}/{day.isoformat()}",
        headers=data["general_headers"],
    )
    assert team_schedule.status_code == 200
    assert team_schedule.json()["data"]["scheduled_start_at"].endswith("10:00:00+00:00")

    employee_override = client.post(
        "/api/v1/payroll/schedule-overrides",
        json={
            "scope": "employee",
            "employee_id": str(data["employee_a"].id),
            "override_type": "shift",
            "effective_date": day.isoformat(),
            "permanent": False,
            "shift_start": "11:00",
            "shift_end": "19:00",
            "reason": "Employee exception wins",
        },
        headers=data["general_headers"],
    )
    assert employee_override.status_code == 200
    employee_schedule = client.get(
        f"/api/v1/attendance/employee/{data['employee_a'].id}/{day.isoformat()}",
        headers=data["general_headers"],
    )
    assert employee_schedule.json()["data"]["scheduled_start_at"].endswith("11:00:00+00:00")


def test_cancelling_today_override_restores_normal_schedule_immediately(team_client):
    client, data = team_client
    today = local_today("UTC")
    db: Session = data["session_factory"]()
    try:
        profile = get_or_create_work_profile(db, data["employee_a"])
        profile.working_days = sorted(set(profile.working_days or []) | {today.weekday()})
        profile.weekly_off_days = [
            weekday for weekday in (profile.weekly_off_days or []) if weekday != today.weekday()
        ]
        db.commit()
    finally:
        db.close()
    created = client.post(
        "/api/v1/payroll/schedule-overrides",
        json={
            "scope": "employee",
            "override_type": "shift",
            "employee_id": str(data["employee_a"].id),
            "effective_date": today.isoformat(),
            "permanent": False,
            "shift_start": "10:00",
            "shift_end": "18:00",
            "reason": "Temporary coverage test",
        },
        headers=data["general_headers"],
    )
    assert created.status_code == 200

    changed = client.get(
        f"/api/v1/attendance/employee/{data['employee_a'].id}/{today.isoformat()}",
        headers=data["general_headers"],
    )
    assert changed.status_code == 200
    assert changed.json()["data"]["scheduled_start_at"].endswith("10:00:00+00:00")

    deleted = client.delete(
        f"/api/v1/payroll/schedule-overrides/{created.json()['data']['id']}",
        headers=data["general_headers"],
    )
    assert deleted.status_code == 200

    restored = client.get(
        f"/api/v1/attendance/employee/{data['employee_a'].id}/{today.isoformat()}",
        headers=data["general_headers"],
    )
    assert restored.status_code == 200
    assert restored.json()["data"]["scheduled_start_at"].endswith("10:00:00+00:00")


def test_payroll_overtime_decision_updates_daily_source_records(team_client):
    client, data = team_client
    work_date = local_today("UTC")
    payroll_month = (
        (work_date.replace(day=28) + timedelta(days=4)).replace(day=1)
        if work_date.day >= 26
        else work_date.replace(day=1)
    )
    db: Session = data["session_factory"]()
    try:
        db.add(
            OvertimeRecord(
                company_id=data["employee_a"].company_id,
                employee_id=data["employee_a"].id,
                work_session_id=data["session_a"].id,
                work_date=work_date,
                overtime_enabled_snapshot=True,
                recorded_extra_seconds=3600,
                approved_seconds=0,
                status="pending",
            )
        )
        db.commit()
    finally:
        db.close()

    sheet = client.get(
        f"/api/v1/payroll/sheet?month={payroll_month.strftime('%Y-%m')}",
        headers=data["general_headers"],
    )
    assert sheet.status_code == 200
    entry = next(
        item
        for item in sheet.json()["data"]["entries"]
        if item["employee_id"] == str(data["employee_a"].id)
    )
    decision = client.patch(
        f"/api/v1/payroll/entries/{entry['id']}",
        json={"overtime_decision": "paid", "overtime_note": "Approved by HR"},
        headers=data["general_headers"],
    )
    assert decision.status_code == 200
    assert decision.json()["data"]["approved_overtime_seconds"] == 3600

    db = data["session_factory"]()
    try:
        overtime = db.scalar(
            select(OvertimeRecord).where(
                OvertimeRecord.employee_id == data["employee_a"].id,
                OvertimeRecord.work_date == work_date,
            )
        )
        attendance = db.scalar(
            select(DailyAttendance).where(
                DailyAttendance.employee_id == data["employee_a"].id,
                DailyAttendance.work_date == work_date,
            )
        )
        assert overtime.status == "approved"
        assert overtime.approved_seconds == 3600
        assert attendance.approved_overtime_seconds == 3600
    finally:
        db.close()


def add_fixture_task(
    data,
    *,
    name: str,
    stage: str,
    project_key: str = "project_a",
    assignee_key: str | None = "employee_a",
) -> str:
    """Insert workflow fixtures without coupling picker tests to admin transitions."""
    db: Session = data["session_factory"]()
    try:
        project = data[project_key]
        assignee = data[assignee_key] if assignee_key else None
        task = Task(
            company_id=project.company_id,
            project_id=project.id,
            assignee_employee_id=assignee.id if assignee else None,
            name=name,
            description=None,
            status="active",
            stage=stage,
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        return str(task.id)
    finally:
        db.close()


def admin_task_notifications(
    client: TestClient, headers: dict[str, str], task_id: str
) -> list[dict]:
    response = client.get("/api/v1/notifications", headers=headers)
    assert response.status_code == 200
    return [row for row in response.json()["data"] if row["task_id"] == task_id]


def task_workflow_requests(data, task_id: str) -> list[dict]:
    db: Session = data["session_factory"]()
    try:
        rows = db.scalars(
            select(TaskWorkflowRequest)
            .where(TaskWorkflowRequest.task_id == UUID(task_id))
            .order_by(TaskWorkflowRequest.created_at)
        ).all()
        return [
            {
                "id": str(row.id),
                "requested_by_employee_id": str(row.requested_by_employee_id),
                "request_type": row.request_type,
                "from_stage": row.from_stage,
                "requested_stage": row.requested_stage,
                "status": row.status,
                "request_note": row.request_note,
                "decision_note": row.decision_note,
                "return_stage": row.return_stage,
                "reviewed_by_admin_user_id": (
                    str(row.reviewed_by_admin_user_id) if row.reviewed_by_admin_user_id else None
                ),
            }
            for row in rows
        ]
    finally:
        db.close()


def admin_notification_request_ids(data, admin_id, task_id: str) -> set[str | None]:
    db: Session = data["session_factory"]()
    try:
        rows = db.scalars(
            select(TaskNotification).where(
                TaskNotification.admin_user_id == admin_id,
                TaskNotification.task_id == UUID(task_id),
            )
        ).all()
        return {str(row.workflow_request_id) if row.workflow_request_id else None for row in rows}
    finally:
        db.close()


def create_assigned_employee_task(client: TestClient, data, name: str) -> dict:
    response = client.post(
        "/api/v1/tasks",
        headers=data["general_headers"],
        json={
            "project_id": str(data["project_a"].id),
            "assignee_employee_id": str(data["employee_a"].id),
            "name": name,
            "stage": "assigned",
        },
    )
    assert response.status_code == 200
    return response.json()["data"]


def submit_employee_task_for_review(client: TestClient, data, name: str) -> dict:
    task = create_assigned_employee_task(client, data, name)
    started = client.patch(
        f"/api/v1/agent/tasks/{task['id']}",
        headers=data["device_headers"],
        json={"stage": "in_progress"},
    )
    assert started.status_code == 200
    submitted = client.patch(
        f"/api/v1/agent/tasks/{task['id']}",
        headers=data["device_headers"],
        json={"stage": "ready_for_review", "note": "Ready for checking"},
    )
    assert submitted.status_code == 200
    assert submitted.json()["data"]["stage"] == "ready_for_review"
    return submitted.json()["data"]


def test_general_admin_can_access_all_company_teams(team_client):
    client, data = team_client

    response = client.get("/api/v1/teams", headers=data["general_headers"])

    assert response.status_code == 200
    names = {team["name"] for team in response.json()["data"]}
    assert {"Team A", "Team B"}.issubset(names)
    assert "Other Team" not in names


def test_team_owner_can_access_assigned_team(team_client):
    client, data = team_client

    response = client.get(f"/api/v1/teams/{data['team_a'].id}", headers=data["owner_headers"])

    assert response.status_code == 200
    assert response.json()["data"]["name"] == "Team A"


def test_team_owner_cannot_access_unassigned_team(team_client):
    client, data = team_client

    response = client.get(f"/api/v1/teams/{data['team_b'].id}", headers=data["owner_headers"])

    assert response.status_code == 403


def test_team_owner_cannot_retrieve_screenshots_from_another_team(team_client):
    client, data = team_client

    detail = client.get(
        f"/api/v1/screenshots/{data['screenshot_b'].id}", headers=data["owner_headers"]
    )
    filtered = client.get(
        f"/api/v1/screenshots?team_id={data['team_b'].id}", headers=data["owner_headers"]
    )

    assert detail.status_code == 403
    assert filtered.status_code == 403


def test_screenshot_folders_include_empty_employees_for_selected_day(team_client):
    client, data = team_client
    day = datetime.now(UTC).date().isoformat()
    with data["session_factory"]() as db:
        latest = db.get(Screenshot, data["screenshot_a"].id)
        db.add(
            Screenshot(
                company_id=latest.company_id,
                employee_id=latest.employee_id,
                device_id=latest.device_id,
                session_id=latest.session_id,
                captured_at=latest.captured_at - timedelta(minutes=1),
                storage_path="a-older.jpg",
                mime_type="image/jpeg",
                width=100,
                height=100,
                file_size=10,
                checksum="c" * 64,
                status="completed",
                team_id=latest.team_id,
                project_id=latest.project_id,
                task_id=latest.task_id,
            )
        )
        db.commit()

    response = client.get(
        f"/api/v1/screenshots/folders?day={day}&page_size=250&preview_limit=1",
        headers=data["general_headers"],
    )

    assert response.status_code == 200
    folders = {row["employee_name"]: row for row in response.json()["data"]}
    assert set(folders) == {"Employee A", "Employee B", "Shared Employee"}
    assert folders["Employee A"]["worked"] is True
    assert folders["Employee A"]["screenshot_count"] == 2
    assert len(folders["Employee A"]["previews"]) == 1
    assert folders["Employee A"]["previews"][0]["id"] == str(data["screenshot_a"].id)
    assert folders["Shared Employee"]["worked"] is False
    assert folders["Shared Employee"]["screenshot_count"] == 0
    assert folders["Shared Employee"]["previews"] == []


def test_screenshot_folders_respect_team_owner_scope(team_client):
    client, data = team_client
    day = datetime.now(UTC).date().isoformat()

    response = client.get(
        f"/api/v1/screenshots/folders?day={day}&page_size=10",
        headers=data["owner_headers"],
    )

    assert response.status_code == 200
    names = {row["employee_name"] for row in response.json()["data"]}
    assert names == {"Employee A", "Shared Employee"}


def test_screenshot_day_uses_employee_timezone_across_monitoring_views(team_client):
    client, data = team_client
    with data["session_factory"]() as db:
        employee = db.get(Employee, data["employee_a"].id)
        screenshot = db.get(Screenshot, data["screenshot_a"].id)
        employee.timezone = "Africa/Cairo"
        # 22:30 UTC on July 26 is 01:30 on the employee's July 27 workday.
        screenshot.captured_at = datetime(2026, 7, 26, 22, 30, tzinfo=UTC)
        db.add_all([employee, screenshot])
        db.commit()

    local_day = client.get(
        f"/api/v1/screenshots?employee_id={data['employee_a'].id}&day=2026-07-27",
        headers=data["general_headers"],
    )
    utc_calendar_day = client.get(
        f"/api/v1/screenshots?employee_id={data['employee_a'].id}&day=2026-07-26",
        headers=data["general_headers"],
    )
    folders = client.get(
        f"/api/v1/screenshots/folders?employee_id={data['employee_a'].id}&day=2026-07-27",
        headers=data["general_headers"],
    )

    assert local_day.status_code == 200
    assert local_day.json()["meta"]["total"] == 1
    assert utc_calendar_day.status_code == 200
    assert utc_calendar_day.json()["meta"]["total"] == 0
    assert folders.status_code == 200
    assert folders.json()["data"][0]["screenshot_count"] == 1


def test_thumbnail_endpoint_materializes_legacy_preview(team_client, tmp_path, monkeypatch):
    client, data = team_client
    monkeypatch.setattr(settings, "screenshot_storage_path", tmp_path)
    source = BytesIO()
    Image.new("RGB", (1920, 1080), color=(25, 50, 75)).save(
        source,
        format="JPEG",
        quality=90,
    )
    (tmp_path / "a.jpg").write_bytes(source.getvalue())

    response = client.get(
        f"/api/v1/screenshots/{data['screenshot_a'].id}/thumbnail",
        headers=data["general_headers"],
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["cache-control"] == "private, max-age=1800"
    thumbnail = tmp_path / "a.thumb.jpg"
    assert thumbnail.is_file()
    assert thumbnail.stat().st_size < len(source.getvalue())
    with Image.open(BytesIO(response.content)) as preview:
        assert preview.width <= settings.screenshot_thumbnail_width
        assert preview.height <= settings.screenshot_thumbnail_width


def test_screenshot_folder_smart_filters_are_applied_before_pagination(team_client):
    client, data = team_client
    day = datetime.now(UTC).date().isoformat()

    with_screenshots = client.get(
        f"/api/v1/screenshots/folders?day={day}&folder_status=with_screenshots&page_size=1",
        headers=data["general_headers"],
    )
    empty = client.get(
        f"/api/v1/screenshots/folders?day={day}&folder_status=empty&page_size=10",
        headers=data["general_headers"],
    )
    no_work = client.get(
        f"/api/v1/screenshots/folders?day={day}&folder_status=no_work&page_size=10",
        headers=data["general_headers"],
    )

    assert with_screenshots.status_code == 200
    assert with_screenshots.json()["meta"]["total"] == 2
    assert len(with_screenshots.json()["data"]) == 1
    assert with_screenshots.json()["data"][0]["screenshot_count"] > 0
    assert empty.status_code == 200
    assert {row["employee_name"] for row in empty.json()["data"]} == {"Shared Employee"}
    assert no_work.status_code == 200
    assert {row["employee_name"] for row in no_work.json()["data"]} == {"Shared Employee"}


def test_desktop_agent_can_only_load_its_own_recent_screenshots(team_client, tmp_path, monkeypatch):
    client, data = team_client
    monkeypatch.setattr(settings, "screenshot_storage_path", tmp_path)
    (tmp_path / "a.jpg").write_bytes(b"employee-a-image")
    (tmp_path / "b.jpg").write_bytes(b"employee-b-image")

    recent = client.get(
        "/api/v1/agent/screenshots/recent",
        headers=data["device_headers"],
    )
    own_file = client.get(
        f"/api/v1/agent/screenshots/{data['screenshot_a'].id}/file",
        headers=data["device_headers"],
    )
    other_file = client.get(
        f"/api/v1/agent/screenshots/{data['screenshot_b'].id}/file",
        headers=data["device_headers"],
    )

    assert recent.status_code == 200
    assert [row["id"] for row in recent.json()["data"]] == [str(data["screenshot_a"].id)]
    assert own_file.status_code == 200
    assert own_file.content == b"employee-a-image"
    assert other_file.status_code == 404


def test_agent_task_list_includes_employee_time_per_task(team_client):
    client, data = team_client
    task_id = add_fixture_task(
        data,
        name="Timed desktop task",
        stage="assigned",
        assignee_key="employee_a",
    )
    work_day = local_today("UTC")
    started_at = datetime.combine(work_day, datetime.min.time(), tzinfo=UTC).replace(hour=10)
    db: Session = data["session_factory"]()
    try:
        employee = db.get(Employee, data["employee_a"].id)
        profile = get_or_create_work_profile(db, employee)
        profile.shift_start = datetime.min.time().replace(hour=9)
        profile.shift_end = datetime.min.time().replace(hour=17)
        profile.working_days = [work_day.weekday()]
        session = WorkSession(
            company_id=data["employee_a"].company_id,
            employee_id=data["employee_a"].id,
            device_id=data["session_a"].device_id,
            team_id=data["team_a"].id,
            project_id=data["project_a"].id,
            task_id=UUID(task_id),
            started_at=started_at,
            ended_at=started_at + timedelta(minutes=3),
            status="ended",
            active_seconds=100,
            idle_seconds=5,
            deducted_seconds=20,
        )
        db.add(session)
        db.flush()
        db.add_all(
            [
                ActivityEvent(
                    company_id=session.company_id,
                    employee_id=session.employee_id,
                    device_id=session.device_id,
                    session_id=session.id,
                    event_type="idle_started",
                    event_timestamp=started_at + timedelta(minutes=1),
                    idempotency_key=str(uuid4()),
                ),
                ActivityEvent(
                    company_id=session.company_id,
                    employee_id=session.employee_id,
                    device_id=session.device_id,
                    session_id=session.id,
                    event_type="idle_ended",
                    event_timestamp=started_at + timedelta(minutes=1, seconds=5),
                    idempotency_key=str(uuid4()),
                ),
            ]
        )
        db.commit()
    finally:
        db.close()

    response = client.get("/api/v1/agent/tasks", headers=data["device_headers"])

    assert response.status_code == 200
    task = next(row for row in response.json()["data"] if row["id"] == task_id)
    assert task["active_seconds"] == 80
    assert task["idle_seconds"] == 5
    assert task["tracked_seconds"] == 85


def test_team_owner_cannot_retrieve_employees_from_another_team(team_client):
    client, data = team_client

    detail = client.get(f"/api/v1/employees/{data['employee_b'].id}", headers=data["owner_headers"])
    filtered = client.get(
        f"/api/v1/employees?team_id={data['team_b'].id}", headers=data["owner_headers"]
    )

    assert detail.status_code == 403
    assert filtered.status_code == 403


def test_revoked_device_token_requires_desktop_reenrollment(team_client):
    client, data = team_client
    db: Session = data["session_factory"]()
    try:
        db.execute(delete(DeviceToken).where(DeviceToken.device_id == data["session_a"].device_id))
        db.commit()
    finally:
        db.close()

    response = client.get("/api/v1/agent/summary", headers=data["device_headers"])

    assert response.status_code == 401
    assert response.json()["error"] == {
        "code": "DEVICE_REENROLLMENT_REQUIRED",
        "message": "Device token identity does not match this device.",
        "details": {},
    }


def test_team_owner_cannot_retrieve_reports_from_another_team(team_client):
    client, data = team_client

    response = client.get(
        f"/api/v1/reports/summary?team_id={data['team_b'].id}", headers=data["owner_headers"]
    )

    assert response.status_code == 403


def test_team_owner_can_access_assigned_team_projects_and_tasks(team_client):
    client, data = team_client

    projects_response = client.get("/api/v1/projects", headers=data["owner_headers"])
    tasks_response = client.get("/api/v1/tasks", headers=data["owner_headers"])

    assert projects_response.status_code == 200
    assert {project["name"] for project in projects_response.json()["data"]} == {"Project A"}
    assert tasks_response.status_code == 200
    assert {task["name"] for task in tasks_response.json()["data"]} == {"Task A"}
    assert tasks_response.json()["data"][0]["stage"] == "new_requests"


def test_general_admin_can_move_task_stage(team_client):
    client, data = team_client
    task = create_assigned_employee_task(client, data, "General admin stage update")

    response = client.patch(
        f"/api/v1/tasks/{task['id']}",
        headers=data["general_headers"],
        json={"stage": "in_progress"},
    )

    assert response.status_code == 200
    assert response.json()["data"]["stage"] == "in_progress"


@pytest.mark.parametrize(
    "stage",
    ["new_requests", "ready_for_review", "completed", "blocked", "rejected", "cancelled"],
)
def test_admin_cannot_create_task_in_a_result_or_pending_stage(team_client, stage):
    client, data = team_client
    response = client.post(
        "/api/v1/tasks",
        headers=data["general_headers"],
        json={
            "project_id": str(data["project_a"].id),
            "name": f"Invalid initial stage {stage}",
            "stage": stage,
        },
    )
    assert response.status_code == 422


def test_database_allows_only_one_pending_workflow_request_per_task(team_client):
    _client, data = team_client
    db: Session = data["session_factory"]()
    try:
        first = TaskWorkflowRequest(
            company_id=data["task_a"].company_id,
            task_id=data["task_a"].id,
            requested_by_employee_id=data["employee_a"].id,
            request_type="completion",
            from_stage="in_progress",
            requested_stage="completed",
            status="pending",
        )
        db.add(first)
        db.commit()
        db.add(
            TaskWorkflowRequest(
                company_id=data["task_a"].company_id,
                task_id=data["task_a"].id,
                requested_by_employee_id=data["employee_a"].id,
                request_type="completion",
                from_stage="in_progress",
                requested_stage="completed",
                status="pending",
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()
    finally:
        db.rollback()
        db.close()


def test_team_owner_cannot_access_unassigned_team_project_tasks(team_client):
    client, data = team_client

    response = client.get(
        f"/api/v1/tasks?team_id={data['team_b'].id}",
        headers=data["owner_headers"],
    )

    assert response.status_code == 403


def test_employee_picker_only_allows_tasks_assigned_to_employee(team_client):
    client, data = team_client

    own_task_id = add_fixture_task(
        data,
        name="Own assigned task",
        stage="assigned",
        assignee_key="employee_a",
    )
    colleague_task_id = add_fixture_task(
        data,
        name="Colleague task",
        stage="assigned",
        assignee_key="shared_employee",
    )
    excluded_ids = {
        add_fixture_task(data, name=f"Excluded {stage}", stage=stage)
        for stage in (
            "completed",
            "rejected",
            "cancelled",
            "blocked",
            "ready_for_review",
            "new_requests",
        )
    }
    other_team_task_id = add_fixture_task(
        data,
        name="Other team available task",
        stage="assigned",
        project_key="project_b",
        assignee_key="employee_b",
    )

    tasks_response = client.get("/api/v1/agent/tasks", headers=data["device_headers"])
    select_response = client.post(
        f"/api/v1/agent/sessions/{data['session_a'].id}/task",
        headers=data["device_headers"],
        json={"task_id": colleague_task_id},
    )
    forbidden_response = client.post(
        f"/api/v1/agent/sessions/{data['session_a'].id}/task",
        headers=data["device_headers"],
        json={"task_id": other_team_task_id},
    )

    assert tasks_response.status_code == 200
    visible_tasks = {task["id"]: task for task in tasks_response.json()["data"]}
    visible_ids = set(visible_tasks)
    assert own_task_id in visible_ids
    assert visible_tasks[own_task_id]["can_update_stage"] is True
    assert colleague_task_id not in visible_ids
    assert excluded_ids.isdisjoint(visible_ids)
    assert str(data["task_a"].id) not in visible_ids
    assert other_team_task_id not in visible_ids
    assert select_response.status_code == 403
    assert forbidden_response.status_code == 403


def test_employee_can_delete_selected_items_from_own_task_checklist(team_client):
    client, data = team_client
    task_id = add_fixture_task(
        data,
        name="Checklist deletion task",
        stage="assigned",
        assignee_key="employee_a",
    )

    first_response = client.post(
        f"/api/v1/agent/tasks/{task_id}/checklist",
        headers=data["device_headers"],
        json={"title": "Delete this item"},
    )
    second_response = client.post(
        f"/api/v1/agent/tasks/{task_id}/checklist",
        headers=data["device_headers"],
        json={"title": "Keep this item"},
    )

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    first_item = next(
        item
        for item in first_response.json()["data"]["checklist"]
        if item["title"] == "Delete this item"
    )

    deleted_response = client.delete(
        f"/api/v1/agent/tasks/{task_id}/checklist/{first_item['id']}",
        headers=data["device_headers"],
    )
    listed_response = client.get(
        "/api/v1/agent/tasks",
        headers=data["device_headers"],
    )

    assert deleted_response.status_code == 200
    assert deleted_response.json()["data"]["deleted"] is True
    assert listed_response.status_code == 200
    task = next(row for row in listed_response.json()["data"] if row["id"] == task_id)
    titles = {item["title"] for item in task["checklist"]}
    assert "Delete this item" not in titles
    assert "Keep this item" in titles


def test_team_leader_self_created_task_activates_without_creation_approval(team_client):
    client, data = team_client
    created = client.post(
        "/api/v1/agent/tasks",
        headers=data["device_headers"],
        json={
            "project_id": str(data["project_a"].id),
            "name": "Employee proposed workflow task",
            "stage": "assigned",
            "priority": "high",
        },
    )
    assert created.status_code == 200
    task = created.json()["data"]
    assert task["stage"] == "assigned"
    assert task["priority"] == "high"
    assert task["created_by_employee_id"] == str(data["employee_a"].id)
    assert task_workflow_requests(data, task["id"]) == []

    listed = client.get("/api/v1/agent/tasks", headers=data["device_headers"])
    selection = client.post(
        f"/api/v1/agent/sessions/{data['session_a'].id}/task",
        headers=data["device_headers"],
        json={"task_id": task["id"]},
    )
    assert task["id"] in {row["id"] for row in listed.json()["data"]}
    assert selection.status_code == 200
    assert admin_task_notifications(client, data["general_headers"], task["id"]) == []
    assert admin_task_notifications(client, data["second_owner_headers"], task["id"]) == []
    assert admin_task_notifications(client, data["owner_headers"], task["id"]) == []

    employee_token = create_employee_access_token(
        employee_id=data["employee_a"].id,
        company_id=data["employee_a"].company_id,
    )
    portal_created = client.post(
        "/api/v1/employee-portal/tasks",
        headers={"Authorization": f"Bearer {employee_token}"},
        json={
            "project_id": str(data["project_a"].id),
            "name": "Team Leader portal task",
        },
    )
    assert portal_created.status_code == 200
    assert portal_created.json()["data"]["stage"] == "assigned"
    assert task_workflow_requests(data, portal_created.json()["data"]["id"]) == []

    started = client.patch(
        f"/api/v1/agent/tasks/{task['id']}",
        headers=data["device_headers"],
        json={"stage": "in_progress"},
    )
    submitted = client.patch(
        f"/api/v1/agent/tasks/{task['id']}",
        headers=data["device_headers"],
        json={"stage": "ready_for_review", "note": "Ready for checking"},
    )
    assert started.status_code == 200
    assert submitted.status_code == 200
    assert submitted.json()["data"]["stage"] == "ready_for_review"
    workflow_requests = task_workflow_requests(data, task["id"])
    assert len(workflow_requests) == 1
    completion_request = workflow_requests[0]
    assert completion_request["request_type"] == "completion"
    assert completion_request["from_stage"] == "in_progress"
    assert completion_request["requested_stage"] == "completed"
    assert completion_request["status"] == "pending"
    assert completion_request["request_note"] == "Ready for checking"

    assert {
        row["type"] for row in admin_task_notifications(client, data["general_headers"], task["id"])
    } == {"task_review_requested"}
    assert {
        row["type"]
        for row in admin_task_notifications(client, data["second_owner_headers"], task["id"])
    } == {"task_review_requested"}
    assert admin_task_notifications(client, data["owner_headers"], task["id"]) == []
    assert completion_request["id"] in admin_notification_request_ids(
        data, data["general_admin"].id, task["id"]
    )
    assert completion_request["id"] in admin_notification_request_ids(
        data, data["second_owner"].id, task["id"]
    )

    self_review = client.post(
        f"/api/v1/tasks/{task['id']}/approve-review",
        headers=data["owner_headers"],
        json={"note": "I cannot approve my own work"},
    )
    completed = client.post(
        f"/api/v1/tasks/{task['id']}/approve-review",
        headers=data["general_headers"],
        json={"note": "Reviewed by the company admin"},
    )
    assert self_review.status_code == 403
    assert completed.status_code == 200
    assert completed.json()["data"]["stage"] == "completed"
    decided_completion_request = task_workflow_requests(data, task["id"])[0]
    assert decided_completion_request["status"] == "approved"
    assert decided_completion_request["decision_note"] == "Reviewed by the company admin"
    assert decided_completion_request["reviewed_by_admin_user_id"] == str(
        data["general_admin"].id
    )


def test_team_member_created_task_still_requires_team_leader_approval(team_client):
    client, data = team_client
    employee_token = create_employee_access_token(
        employee_id=data["shared_employee"].id,
        company_id=data["shared_employee"].company_id,
    )
    created = client.post(
        "/api/v1/employee-portal/tasks",
        headers={"Authorization": f"Bearer {employee_token}"},
        json={
            "project_id": str(data["project_a"].id),
            "name": "Team member proposed task",
            "priority": "medium",
        },
    )

    assert created.status_code == 200
    task = created.json()["data"]
    assert task["stage"] == "new_requests"
    requests = task_workflow_requests(data, task["id"])
    assert len(requests) == 1
    assert requests[0]["request_type"] == "task_creation"
    assert requests[0]["status"] == "pending"

    owner_notifications = admin_task_notifications(
        client, data["owner_headers"], task["id"]
    )
    assert {row["type"] for row in owner_notifications} == {"task_approval_requested"}
    approved = client.post(
        f"/api/v1/tasks/{task['id']}/approve-request",
        headers=data["owner_headers"],
        json={"target_stage": "assigned"},
    )
    assert approved.status_code == 200
    assert approved.json()["data"]["stage"] == "assigned"
    assert task_workflow_requests(data, task["id"])[0]["reviewed_by_admin_user_id"] == str(
        data["owner"].id
    )


def test_legacy_team_leader_self_creation_request_is_activated_without_self_review(team_client):
    client, data = team_client
    db: Session = data["session_factory"]()
    try:
        task = Task(
            company_id=data["employee_a"].company_id,
            project_id=data["project_a"].id,
            assignee_employee_id=data["employee_a"].id,
            created_by_employee_id=data["employee_a"].id,
            name="Legacy Team Leader request",
            stage="new_requests",
            status="active",
        )
        db.add(task)
        db.flush()
        workflow_request = TaskWorkflowRequest(
            company_id=task.company_id,
            task_id=task.id,
            requested_by_employee_id=data["employee_a"].id,
            request_type="task_creation",
            from_stage="new_requests",
            requested_stage="assigned",
            status="pending",
        )
        db.add(workflow_request)
        db.flush()
        db.add(
            TaskNotification(
                company_id=task.company_id,
                admin_user_id=data["general_admin"].id,
                task_id=task.id,
                workflow_request_id=workflow_request.id,
                notification_type="task_approval_requested",
                title="New task needs approval",
                message="Legacy request",
                dedupe_key=f"legacy:{workflow_request.id}",
            )
        )
        db.commit()
        task_id = str(task.id)
    finally:
        db.close()

    notifications = admin_task_notifications(client, data["general_headers"], task_id)
    assert {row["type"] for row in notifications} == {"task_activated"}
    assert {row["workflow_request"]["status"] for row in notifications} == {"approved"}
    request = task_workflow_requests(data, task_id)[0]
    assert request["status"] == "approved"
    assert request["reviewed_by_admin_user_id"] is None
    db = data["session_factory"]()
    try:
        assert db.get(Task, UUID(task_id)).stage == "assigned"
    finally:
        db.close()


@pytest.mark.parametrize("target_stage", ["backlog", "assigned", "in_progress"])
def test_eligible_team_owner_can_return_review_to_an_explicit_active_stage(
    team_client,
    target_stage,
):
    client, data = team_client
    task = submit_employee_task_for_review(client, data, f"Return to {target_stage}")

    self_return = client.post(
        f"/api/v1/tasks/{task['id']}/return-review",
        headers=data["owner_headers"],
        json={"note": "Self review is forbidden", "target_stage": target_stage},
    )
    missing_note = client.post(
        f"/api/v1/tasks/{task['id']}/return-review",
        headers=data["second_owner_headers"],
        json={"target_stage": target_stage},
    )
    invalid_target = client.post(
        f"/api/v1/tasks/{task['id']}/return-review",
        headers=data["second_owner_headers"],
        json={"note": "Invalid terminal target", "target_stage": "completed"},
    )
    returned = client.post(
        f"/api/v1/tasks/{task['id']}/return-review",
        headers=data["second_owner_headers"],
        json={"note": "Please address the review notes", "target_stage": target_stage},
    )

    assert self_return.status_code == 403
    assert missing_note.status_code == 400
    assert invalid_target.status_code == 422
    assert returned.status_code == 200
    assert returned.json()["data"]["stage"] == target_stage
    assert returned.json()["data"]["review_note"] == "Please address the review notes"
    requests = task_workflow_requests(data, task["id"])
    assert len(requests) == 1
    assert requests[0]["status"] == "rejected"
    assert requests[0]["decision_note"] == "Please address the review notes"
    assert requests[0]["return_stage"] == target_stage
    assert requests[0]["reviewed_by_admin_user_id"] == str(data["second_owner"].id)


def test_general_admin_can_review_a_team_managers_own_task(team_client):
    client, data = team_client
    task = submit_employee_task_for_review(client, data, "Manager task for general review")

    self_review = client.post(
        f"/api/v1/tasks/{task['id']}/approve-review",
        headers=data["owner_headers"],
        json={"note": "Self approval should fail"},
    )
    general_review = client.post(
        f"/api/v1/tasks/{task['id']}/approve-review",
        headers=data["general_headers"],
        json={"note": "Reviewed by the general admin"},
    )

    assert self_review.status_code == 403
    assert general_review.status_code == 200
    assert general_review.json()["data"]["stage"] == "completed"
    request = task_workflow_requests(data, task["id"])[0]
    assert request["status"] == "approved"
    assert request["reviewed_by_admin_user_id"] == str(data["general_admin"].id)


def test_blocked_task_requires_reason_stops_tracking_notifies_reviewers_and_can_resume(team_client):
    client, data = team_client
    task = create_assigned_employee_task(client, data, "Task with an external blocker")
    selected = client.post(
        f"/api/v1/agent/sessions/{data['session_a'].id}/task",
        headers=data["device_headers"],
        json={"task_id": task["id"]},
    )
    assert selected.status_code == 200

    missing_reason = client.patch(
        f"/api/v1/agent/tasks/{task['id']}",
        headers=data["device_headers"],
        json={"stage": "blocked"},
    )
    blocked = client.patch(
        f"/api/v1/agent/tasks/{task['id']}",
        headers=data["device_headers"],
        json={"stage": "blocked", "note": "Waiting for the customer credentials"},
    )
    current_session = client.get("/api/v1/agent/sessions/current", headers=data["device_headers"])
    picker = client.get("/api/v1/agent/tasks", headers=data["device_headers"])

    assert missing_reason.status_code == 400
    assert blocked.status_code == 200
    assert blocked.json()["data"]["stage"] == "blocked"
    assert blocked.json()["data"]["blocked_reason"] == "Waiting for the customer credentials"
    assert task_workflow_requests(data, task["id"]) == []
    assert current_session.status_code == 200
    assert current_session.json()["data"]["session"] is None
    assert task["id"] not in {row["id"] for row in picker.json()["data"]}
    assert {
        row["type"] for row in admin_task_notifications(client, data["general_headers"], task["id"])
    } == {"task_blocked"}
    assert {
        row["type"]
        for row in admin_task_notifications(client, data["second_owner_headers"], task["id"])
    } == {"task_blocked"}
    assert admin_task_notifications(client, data["owner_headers"], task["id"]) == []

    missing_resolution = client.patch(
        f"/api/v1/tasks/{task['id']}",
        headers=data["second_owner_headers"],
        json={"stage": "in_progress"},
    )
    resumed = client.patch(
        f"/api/v1/tasks/{task['id']}",
        headers=data["second_owner_headers"],
        json={"stage": "in_progress", "block_resolution_note": "Credentials received"},
    )
    assert missing_resolution.status_code == 400
    assert resumed.status_code == 200
    assert resumed.json()["data"]["stage"] == "in_progress"
    assert resumed.json()["data"]["block_resolution_note"] == "Credentials received"
    assert resumed.json()["data"]["blocked_reason"] is None


def test_generic_admin_patch_cannot_self_close_or_bypass_pending_review(team_client):
    client, data = team_client
    active_task = create_assigned_employee_task(client, data, "Manager terminal protection")

    for terminal_stage in ("completed", "rejected", "cancelled"):
        response = client.patch(
            f"/api/v1/tasks/{active_task['id']}",
            headers=data["owner_headers"],
            json={"stage": terminal_stage},
        )
        assert response.status_code == 403

    pending_task = submit_employee_task_for_review(client, data, "Pending review cannot be patched")
    for headers, stage in (
        (data["second_owner_headers"], "completed"),
        (data["second_owner_headers"], "in_progress"),
        (data["general_headers"], "completed"),
    ):
        response = client.patch(
            f"/api/v1/tasks/{pending_task['id']}",
            headers=headers,
            json={"stage": stage},
        )
        assert response.status_code == 409
    request = task_workflow_requests(data, pending_task["id"])[0]
    assert request["status"] == "pending"
    assert request["reviewed_by_admin_user_id"] is None


def test_desktop_summary_matches_employee_periods_and_profile(team_client):
    client, data = team_client
    response = client.get("/api/v1/agent/summary", headers=data["device_headers"])

    assert response.status_code == 200
    summary = response.json()["data"]
    assert summary["employee"]["id"] == str(data["employee_a"].id)
    assert {"today", "week", "month"}.issubset(summary)
    assert summary["today_timeline"]["is_running"] is True
    assert summary["today_timeline"]["intervals"][0]["type"] == "worked"
    for period_name in ("today", "week", "month"):
        period = summary[period_name]
        assert {
            "tracked_active_seconds",
            "idle_seconds",
            "manual_approved_seconds",
            "manual_pending_seconds",
            "manual_rejected_seconds",
        }.issubset(period)


def test_desktop_summary_recovers_elapsed_work_when_an_update_started_a_new_session(
    team_client,
):
    client, data = team_client
    now = datetime.now(UTC)
    db = data["session_factory"]()
    try:
        prior_session = WorkSession(
            company_id=data["employee_a"].company_id,
            employee_id=data["employee_a"].id,
            device_id=data["session_a"].device_id,
            started_at=now - timedelta(minutes=40),
            ended_at=now - timedelta(minutes=10),
            status="ended",
            active_seconds=0,
            idle_seconds=0,
        )
        db.add(prior_session)
        db.commit()
    finally:
        db.close()

    response = client.get("/api/v1/agent/summary", headers=data["device_headers"])

    assert response.status_code == 200
    summary = response.json()["data"]
    timeline = summary["today_timeline"]
    assert timeline["worked_seconds"] >= 30 * 60
    assert summary["today"]["tracked_active_seconds"] >= timeline["worked_seconds"]
    assert timeline["first_started_at"] is not None
    assert timeline["last_activity_at"] is not None


def test_desktop_today_excludes_idle_on_an_off_day(team_client):
    client, data = team_client
    now = datetime.now(UTC)
    with data["session_factory"]() as db:
        session = db.get(WorkSession, data["session_a"].id)
        employee = db.get(Employee, data["employee_a"].id)
        device = db.get(Device, session.device_id)
        session.started_at = now - timedelta(minutes=30)
        session.status = "idle"
        device.last_seen_at = now
        profile = get_or_create_work_profile(db, employee)
        profile.shift_start = datetime.min.time().replace(hour=9)
        profile.shift_end = datetime.min.time().replace(hour=17)
        profile.working_days = [(now.weekday() + 1) % 7]
        db.add_all(
            [
                ActivityEvent(
                    company_id=session.company_id,
                    employee_id=session.employee_id,
                    device_id=session.device_id,
                    session_id=session.id,
                    event_type="idle_started",
                    event_timestamp=now - timedelta(minutes=20),
                    payload=None,
                    idempotency_key=str(uuid4()),
                ),
                ActivityEvent(
                    company_id=session.company_id,
                    employee_id=session.employee_id,
                    device_id=session.device_id,
                    session_id=session.id,
                    event_type="idle_started",
                    event_timestamp=now - timedelta(minutes=4),
                    payload=None,
                    idempotency_key=str(uuid4()),
                ),
                ActivityEvent(
                    company_id=session.company_id,
                    employee_id=session.employee_id,
                    device_id=session.device_id,
                    session_id=session.id,
                    event_type="idle_ended",
                    event_timestamp=now - timedelta(minutes=5),
                    payload=None,
                    idempotency_key=str(uuid4()),
                ),
            ]
        )
        db.commit()

    response = client.get("/api/v1/agent/summary", headers=data["device_headers"])
    timesheet = client.get(
        f"/api/v1/timesheets/daily?day={local_today('UTC').isoformat()}",
        headers=data["general_headers"],
    )
    timeline_response = client.get(
        "/api/v1/activity/timeline",
        params={
            "employee_id": str(data["employee_a"].id),
            "day": local_today("UTC").isoformat(),
        },
        headers=data["general_headers"],
    )
    employee_overview = client.get(
        "/api/v1/employees-overview",
        params={"employee_id": str(data["employee_a"].id)},
        headers=data["general_headers"],
    )
    dashboard = client.get("/api/v1/dashboard/summary", headers=data["general_headers"])
    team_summary = client.get(
        f"/api/v1/teams/{data['team_a'].id}/summary",
        headers=data["general_headers"],
    )
    employee_report = client.get("/api/v1/reports/employees", headers=data["general_headers"])
    payroll_preview_response = client.get(
        f"/api/v1/employees/{data['employee_a'].id}/payroll-preview",
        params={
            "start_date": local_today("UTC").isoformat(),
            "end_date": local_today("UTC").isoformat(),
        },
        headers=data["general_headers"],
    )

    assert response.status_code == 200
    summary = response.json()["data"]
    assert summary["today_timeline"]["idle_seconds"] == 0
    assert summary["today"]["idle_seconds"] == 0
    assert summary["today"]["eligible_idle_seconds"] == 0
    timesheet_row = next(
        row for row in timesheet.json()["data"] if row["employee_id"] == str(data["employee_a"].id)
    )
    assert timesheet_row["idle_seconds"] == 0
    assert timeline_response.json()["data"]["idle_seconds"] == 0
    overview_row = employee_overview.json()["data"][0]
    assert overview_row["idle_seconds"] == 0
    assert overview_row["worked_today_seconds"] == overview_row["active_seconds"]
    assert overview_row["activity_status"] == "off_shift"
    assert dashboard.status_code == 200
    dashboard_data = dashboard.json()["data"]
    assert dashboard_data["off_shift_employees"] >= 1
    assert dashboard_data["online_employees"] == 0
    assert team_summary.json()["data"]["idle_seconds"] == 0
    team_summary_data = team_summary.json()["data"]
    assert team_summary_data["off_shift_employees"] >= 1
    assert team_summary_data["online_employees"] == 0
    report_row = next(
        row
        for row in employee_report.json()["data"]
        if row["employee_id"] == str(data["employee_a"].id)
    )
    assert report_row["idle_seconds"] == 0
    assert payroll_preview_response.json()["data"]["idle_seconds"] == 0


def test_idle_request_period_is_clipped_at_shift_end_and_tracks_remaining_time(
    team_client,
):
    client, data = team_client
    work_day = local_today("UTC")
    shift_start = datetime.combine(work_day, datetime.min.time(), tzinfo=UTC).replace(hour=10)
    shift_end = shift_start.replace(hour=18)
    idle_start = shift_start.replace(hour=17, minute=1)
    idle_end = shift_end.replace(minute=18)

    with data["session_factory"]() as db:
        session = db.get(WorkSession, data["session_a"].id)
        employee = db.get(Employee, data["employee_a"].id)
        session.started_at = idle_start - timedelta(minutes=20)
        session.ended_at = idle_end + timedelta(minutes=2)
        session.status = "ended"
        profile = get_or_create_work_profile(db, employee)
        profile.shift_start = shift_start.time().replace(tzinfo=None)
        profile.shift_end = shift_end.time().replace(tzinfo=None)
        profile.working_days = [work_day.weekday()]
        profile.weekly_off_days = [weekday for weekday in range(7) if weekday != work_day.weekday()]
        profile.break_rules = []
        db.add_all(
            [
                ActivityEvent(
                    company_id=session.company_id,
                    employee_id=session.employee_id,
                    device_id=session.device_id,
                    session_id=session.id,
                    event_type="idle_started",
                    event_timestamp=idle_start,
                    payload=None,
                    idempotency_key=str(uuid4()),
                ),
                ActivityEvent(
                    company_id=session.company_id,
                    employee_id=session.employee_id,
                    device_id=session.device_id,
                    session_id=session.id,
                    event_type="idle_ended",
                    event_timestamp=idle_end,
                    payload=None,
                    idempotency_key=str(uuid4()),
                ),
            ]
        )
        db.commit()

    summary_response = client.get(
        "/api/v1/agent/summary",
        headers=data["device_headers"],
    )

    assert summary_response.status_code == 200
    periods = summary_response.json()["data"]["idle_request_periods"]
    assert len(periods) == 1
    period = periods[0]
    assert datetime.fromisoformat(period["started_at"]) == idle_start
    assert datetime.fromisoformat(period["ended_at"]) == shift_end
    assert period["duration_seconds"] == 59 * 60
    assert period["available_seconds"] == 59 * 60

    first_request = client.post(
        "/api/v1/agent/time-adjustment-requests",
        headers=data["device_headers"],
        json={
            "requested_date": work_day.isoformat(),
            "request_type": "idle_time",
            "work_session_id": period["work_session_id"],
            "source_start_at": period["started_at"],
            "source_end_at": period["ended_at"],
            "requested_minutes": 30,
            "reason": "Completed offline work during this idle period.",
        },
    )
    assert first_request.status_code == 200

    refreshed_summary = client.get(
        "/api/v1/agent/summary",
        headers=data["device_headers"],
    )
    refreshed_period = refreshed_summary.json()["data"]["idle_request_periods"][0]
    assert refreshed_period["available_seconds"] == 29 * 60

    excessive_request = client.post(
        "/api/v1/agent/time-adjustment-requests",
        headers=data["device_headers"],
        json={
            "requested_date": work_day.isoformat(),
            "request_type": "idle_time",
            "work_session_id": period["work_session_id"],
            "source_start_at": period["started_at"],
            "source_end_at": period["ended_at"],
            "requested_minutes": 30,
            "reason": "Attempting to request more than the remaining time.",
        },
    )
    assert excessive_request.status_code == 422
    assert excessive_request.json()["error"]["code"] == "IDLE_REQUEST_TOO_LONG"

    outside_shift_request = client.post(
        "/api/v1/agent/time-adjustment-requests",
        headers=data["device_headers"],
        json={
            "requested_date": work_day.isoformat(),
            "request_type": "idle_time",
            "work_session_id": period["work_session_id"],
            "source_start_at": idle_start.isoformat(),
            "source_end_at": idle_end.isoformat(),
            "requested_minutes": 1,
            "reason": "The source range must not include time after shift end.",
        },
    )
    assert outside_shift_request.status_code == 422
    assert outside_shift_request.json()["error"]["code"] == "IDLE_PERIOD_NOT_FOUND"

    approved = client.patch(
        f"/api/v1/time-adjustment-requests/{first_request.json()['data']['id']}",
        headers=data["general_headers"],
        json={"status": "approved", "approved_minutes": 30},
    )
    approved_summary = client.get(
        "/api/v1/agent/summary",
        headers=data["device_headers"],
    )
    approved_timeline = approved_summary.json()["data"]["today_timeline"]
    assert approved.status_code == 200
    assert approved_timeline["idle_seconds"] == 29 * 60
    assert approved_timeline["manual_seconds"] == 30 * 60
    assert any(item["type"] == "manual" for item in approved_timeline["intervals"])
    assert approved_summary.json()["data"]["today"]["idle_seconds"] == 29 * 60


def test_workday_timeline_splits_work_idle_and_locked_periods(team_client):
    client, data = team_client
    work_day = local_today(data["employee_a"].timezone)
    started_at = datetime.combine(work_day, datetime.min.time(), tzinfo=UTC) + timedelta(hours=9)
    transitions = [
        ("idle_started", started_at + timedelta(hours=1)),
        ("idle_ended", started_at + timedelta(hours=1, minutes=15)),
        ("screen_locked", started_at + timedelta(hours=2)),
        ("screen_unlocked", started_at + timedelta(hours=2, minutes=5)),
    ]

    db: Session = data["session_factory"]()
    try:
        session = db.get(WorkSession, data["session_a"].id)
        session.started_at = started_at
        session.ended_at = started_at + timedelta(hours=3)
        session.status = "ended"
        for event_type, event_timestamp in transitions:
            db.add(
                ActivityEvent(
                    company_id=session.company_id,
                    employee_id=session.employee_id,
                    device_id=session.device_id,
                    session_id=session.id,
                    event_type=event_type,
                    event_timestamp=event_timestamp,
                    payload=None,
                    idempotency_key=str(uuid4()),
                )
            )
        db.commit()
    finally:
        db.close()

    response = client.get(
        f"/api/v1/activity/timeline?employee_id={data['employee_a'].id}&day={work_day.isoformat()}",
        headers=data["general_headers"],
    )

    assert response.status_code == 200
    timeline = response.json()["data"]
    assert [interval["type"] for interval in timeline["intervals"]] == [
        "worked",
        "idle",
        "worked",
        "locked",
        "worked",
    ]
    assert timeline["worked_seconds"] == 9600
    assert timeline["idle_seconds"] == 900
    assert timeline["locked_seconds"] == 300
    assert timeline["intervals"][0]["task_name"] == "Task A"
    assert timeline["is_running"] is False

    employee_token = create_employee_access_token(
        employee_id=data["employee_a"].id,
        company_id=data["employee_a"].company_id,
    )
    employee_response = client.get(
        "/api/v1/employee-portal/summary",
        headers={"Authorization": f"Bearer {employee_token}"},
    )
    assert employee_response.status_code == 200
    assert employee_response.json()["data"]["today_timeline"]["idle_seconds"] == 900


def test_workday_timeline_stops_stale_open_session_at_last_heartbeat(team_client):
    client, data = team_client
    now = datetime.now(UTC)
    started_at = now - timedelta(minutes=20)
    heartbeat_at = now - timedelta(minutes=10)

    db: Session = data["session_factory"]()
    try:
        session = db.get(WorkSession, data["session_a"].id)
        session.started_at = started_at
        session.updated_at = started_at
        session.ended_at = None
        db.add(
            ActivityEvent(
                company_id=session.company_id,
                employee_id=session.employee_id,
                device_id=session.device_id,
                session_id=session.id,
                event_type="heartbeat",
                event_timestamp=heartbeat_at,
                payload=None,
                idempotency_key=str(uuid4()),
            )
        )
        db.commit()
    finally:
        db.close()

    response = client.get(
        f"/api/v1/activity/timeline?employee_id={data['employee_a'].id}&day={now.date().isoformat()}",
        headers=data["general_headers"],
    )

    timeline = response.json()["data"]
    assert response.status_code == 200
    assert timeline["is_running"] is False
    assert timeline["last_ended_at"] == heartbeat_at.isoformat()
    assert timeline["worked_seconds"] == 600


def test_employee_may_belong_to_multiple_teams(team_client):
    client, data = team_client

    team_a_members = client.get(
        f"/api/v1/teams/{data['team_a'].id}/members", headers=data["general_headers"]
    )
    team_b_members = client.get(
        f"/api/v1/teams/{data['team_b'].id}/members", headers=data["general_headers"]
    )

    shared_id = str(data["shared_employee"].id)
    assert shared_id in {employee["id"] for employee in team_a_members.json()["data"]}
    assert shared_id in {employee["id"] for employee in team_b_members.json()["data"]}


def test_team_may_have_multiple_owners(team_client):
    client, data = team_client

    response = client.get(
        f"/api/v1/teams/{data['team_a'].id}/owners", headers=data["general_headers"]
    )

    assert response.status_code == 200
    assert len(response.json()["data"]) == 2


def test_company_data_isolation_still_works(team_client):
    client, data = team_client

    team_response = client.get(
        f"/api/v1/teams/{data['other_team'].id}", headers=data["general_headers"]
    )
    employees_response = client.get("/api/v1/employees", headers=data["general_headers"])

    assert team_response.status_code == 404
    emails = {employee["email"] for employee in employees_response.json()["data"]}
    assert "other.employee@example.com" not in emails


def test_legacy_employee_enrollment_code_endpoints_are_removed(team_client):
    client, data = team_client

    create_response = client.post(
        f"/api/v1/employees/{data['employee_a'].id}/enrollment-codes",
        headers=data["general_headers"],
        json={"expires_in_days": 7},
    )
    list_response = client.get(
        f"/api/v1/employees/{data['employee_a'].id}/enrollment-codes",
        headers=data["general_headers"],
    )

    assert create_response.status_code == 404
    assert list_response.status_code == 404


def test_general_admin_actions_are_written_to_audit_log(team_client):
    client, data = team_client

    create_response = client.post(
        "/api/v1/teams",
        headers=data["general_headers"],
        json={"name": "Audit Team", "description": "Created in test", "status": "active"},
    )
    audit_response = client.get("/api/v1/audit-log", headers=data["general_headers"])

    assert create_response.status_code == 200
    assert audit_response.status_code == 200
    rows = audit_response.json()["data"]
    assert rows[0]["action"] == "created"
    assert rows[0]["entity_type"] == "team"
    assert rows[0]["entity_name"] == "Audit Team"
    assert rows[0]["user_name"] == "General Admin"


def test_payroll_cycle_settings_custom_range_and_xlsx_export_are_consistent(team_client):
    client, data = team_client

    defaults = client.get("/api/v1/payroll/settings", headers=data["general_headers"])
    updated = client.patch(
        "/api/v1/payroll/settings",
        headers=data["general_headers"],
        json={"cycle_start_day": 27, "cycle_end_day": 26, "timezone": "Africa/Cairo"},
    )
    forbidden = client.patch(
        "/api/v1/payroll/settings",
        headers=data["owner_headers"],
        json={"cycle_start_day": 26, "cycle_end_day": 25, "timezone": "UTC"},
    )
    sheet = client.get(
        "/api/v1/payroll/sheet?month=2026-07&start_date=2026-07-01&end_date=2026-07-03",
        headers=data["general_headers"],
    )
    exported = client.get(
        "/api/v1/payroll/export?month=2026-07&start_date=2026-07-01&end_date=2026-07-03&format=excel",
        headers=data["general_headers"],
    )
    audit = client.get("/api/v1/audit-log", headers=data["general_headers"])

    assert defaults.status_code == 200
    assert defaults.json()["data"]["cycle_start_day"] == 26
    assert updated.status_code == 200
    assert updated.json()["data"] == {
        "cycle_start_day": 27,
        "cycle_end_day": 26,
        "timezone": "Africa/Cairo",
    }
    assert forbidden.status_code == 403
    assert sheet.status_code == 200
    assert sheet.json()["data"]["run"]["period_start"] == "2026-07-01"
    assert sheet.json()["data"]["run"]["period_end"] == "2026-07-03"
    assert exported.status_code == 200
    assert exported.content.startswith(b"PK")
    assert 'filename="payroll-2026-07.xlsx"' in exported.headers["content-disposition"]
    assert any(row["entity_type"] == "payroll_cycle_settings" for row in audit.json()["data"])


def test_visa_bank_export_matches_upload_template_and_requires_bank_details(team_client):
    client, data = team_client
    missing = client.get(
        "/api/v1/payroll/export?month=2026-07&start_date=2026-07-01&end_date=2026-07-03&format=visa",
        headers=data["general_headers"],
    )
    assert missing.status_code == 409
    assert missing.json()["error"]["code"] == "BANK_DETAILS_REQUIRED"

    for index, employee in enumerate(
        (data["employee_a"], data["employee_b"], data["shared_employee"]), start=1
    ):
        response = client.patch(
            f"/api/v1/employees/{employee.id}/work-profile",
            headers=data["general_headers"],
            json={
                "bank_account_number": f"1234567890{index}",
                "bank_employee_id": f"000000000{index}",
            },
        )
        assert response.status_code == 200

    exported = client.get(
        "/api/v1/payroll/export?month=2026-07&start_date=2026-07-01&end_date=2026-07-03&format=visa",
        headers=data["general_headers"],
    )
    assert exported.status_code == 200
    assert exported.headers["content-type"].startswith("application/vnd.ms-excel")
    assert 'filename="visa-payroll-2026-07.xls"' in exported.headers["content-disposition"]
    assert b"Beneficiary Account No." in exported.content
    assert b"Employee ID (Mandatory Field)" in exported.content
    assert b"12345678901" in exported.content


def test_employee_time_adjustment_request_can_be_approved_and_added_to_timesheet(team_client):
    client, data = team_client

    create_response = client.post(
        "/api/v1/agent/time-adjustment-requests",
        headers=data["device_headers"],
        json={
            "requested_date": data["session_a"].started_at.date().isoformat(),
            "requested_minutes": 30,
            "reason": "Forgot to start tracking after a call.",
        },
    )
    request_id = create_response.json()["data"]["id"]
    review_response = client.patch(
        f"/api/v1/time-adjustment-requests/{request_id}",
        headers=data["general_headers"],
        json={"status": "approved", "approved_minutes": 20, "admin_note": "Approved for the call."},
    )
    work_day = data["session_a"].started_at.date().isoformat()
    timesheet_response = client.get(
        f"/api/v1/timesheets/daily?day={work_day}",
        headers=data["general_headers"],
    )

    assert create_response.status_code == 200
    assert review_response.status_code == 200
    assert review_response.json()["data"]["status"] == "approved"
    rows = timesheet_response.json()["data"]
    row = next(item for item in rows if item["employee_id"] == str(data["employee_a"].id))
    assert row["adjustment_seconds"] == 1200
    assert row["active_seconds"] == 1320
    assert row["idle_seconds"] == 0
    assert row["total_tracked_seconds"] == 1320

    repeated_review = client.patch(
        f"/api/v1/time-adjustment-requests/{request_id}",
        headers=data["second_owner_headers"],
        json={"status": "rejected", "admin_note": "Too late."},
    )
    assert repeated_review.status_code == 409


def test_only_super_admin_can_review_their_own_time_request(team_client):
    client, data = team_client

    owner_request = client.post(
        "/api/v1/agent/time-adjustment-requests",
        headers=data["device_headers"],
        json={
            "requested_date": data["session_a"].started_at.date().isoformat(),
            "requested_minutes": 10,
            "reason": "Customer meeting continued while the timer was idle.",
        },
    )
    owner_review = client.patch(
        f"/api/v1/time-adjustment-requests/{owner_request.json()['data']['id']}",
        headers=data["owner_headers"],
        json={"status": "approved", "approved_minutes": 10},
    )

    with data["session_factory"]() as db:
        general_admin = db.get(AdminUser, data["general_admin"].id)
        employee = db.get(Employee, data["employee_b"].id)
        general_admin.employee_id = employee.id
        request = TimeAdjustmentRequest(
            company_id=employee.company_id,
            employee_id=employee.id,
            request_type="manual_time",
            requested_date=data["session_a"].started_at.date(),
            requested_seconds=10 * 60,
            reason="Super admin correction for a completed customer meeting.",
            status="pending",
        )
        db.add_all([general_admin, request])
        db.commit()
        request_id = request.id

    super_admin_review = client.patch(
        f"/api/v1/time-adjustment-requests/{request_id}",
        headers=data["general_headers"],
        json={"status": "approved", "approved_minutes": 10},
    )

    assert owner_review.status_code == 403
    assert owner_review.json()["error"]["code"] == "SELF_REVIEW_FORBIDDEN"
    assert super_admin_review.status_code == 200
    assert super_admin_review.json()["data"]["status"] == "approved"
    assert super_admin_review.json()["data"]["reviewed_by_admin_user_id"] == str(
        data["general_admin"].id
    )


def test_invited_hr_can_manage_a_team_or_join_with_a_member_role(team_client):
    client, data = team_client
    with data["session_factory"]() as db:
        employee = Employee(
            company_id=data["employee_a"].company_id,
            name="Invited HR",
            email="invited.hr@example.com",
            employee_code="HR-INVITED",
            job_title="HR Manager",
            timezone="UTC",
            status="invited",
        )
        db.add(employee)
        db.flush()
        admin = AdminUser(
            company_id=employee.company_id,
            employee_id=employee.id,
            name=employee.name,
            email=employee.email,
            password_hash=hash_password("ExamplePassword123!"),
            role="hr",
            status="invited",
            data_scope="company",
        )
        db.add(admin)
        db.commit()
        admin_id = admin.id
        employee_id = employee.id

    manager_response = client.post(
        f"/api/v1/teams/{data['team_a'].id}/owners",
        headers=data["general_headers"],
        json={"admin_user_id": str(admin_id)},
    )
    lead_response = client.post(
        f"/api/v1/teams/{data['team_b'].id}/members",
        headers=data["general_headers"],
        json={"employee_id": str(employee_id), "status": "active", "role": "team_lead"},
    )
    member_response = client.patch(
        f"/api/v1/teams/{data['team_b'].id}/members/{employee_id}",
        headers=data["general_headers"],
        json={"role": "member"},
    )
    owners_response = client.get(
        f"/api/v1/teams/{data['team_a'].id}/owners",
        headers=data["general_headers"],
    )

    assert manager_response.status_code == 200
    assert lead_response.status_code == 200
    assert member_response.status_code == 200
    assert owners_response.status_code == 200
    invited_owner = next(
        owner for owner in owners_response.json()["data"] if owner["id"] == str(admin_id)
    )
    assert invited_owner["role"] == "hr"
    assert invited_owner["status"] == "invited"

    with data["session_factory"]() as db:
        manager_membership = db.scalar(
            select(TeamMember).where(
                TeamMember.team_id == data["team_a"].id,
                TeamMember.employee_id == employee_id,
            )
        )
        member_membership = db.scalar(
            select(TeamMember).where(
                TeamMember.team_id == data["team_b"].id,
                TeamMember.employee_id == employee_id,
            )
        )
        assert manager_membership is not None
        assert manager_membership.status == "active"
        assert manager_membership.role == "team_manager"
        assert member_membership is not None
        assert member_membership.role == "member"


def test_employee_overview_includes_all_assigned_team_managers(team_client):
    client, data = team_client

    response = client.get(
        f"/api/v1/employees-overview?employee_id={data['shared_employee'].id}",
        headers=data["general_headers"],
    )

    assert response.status_code == 200
    managers = response.json()["data"][0]["managers"]
    assert {manager["name"] for manager in managers} == {"Team Owner", "Second Owner"}
    assert all(
        manager["teams"] == [{"id": str(data["team_a"].id), "name": "Team A"}]
        for manager in managers
    )


def test_timesheets_do_not_load_encrypted_payroll_fields(team_client):
    client, data = team_client
    with data["session_factory"]() as db:
        employee = db.get(Employee, data["employee_a"].id)
        profile = get_or_create_work_profile(db, employee)
        profile_id = profile.id
        db.commit()
        db.execute(
            text(
                "UPDATE employee_work_profiles "
                "SET salary_amount = :invalid_value "
                "WHERE id = :profile_id"
            ),
            {
                "invalid_value": b"invalid-encrypted-payroll-value",
                "profile_id": profile_id.hex,
            },
        )
        db.commit()

    response = client.get(
        "/api/v1/timesheets/daily",
        headers=data["general_headers"],
        params={"day": local_today("UTC").isoformat()},
    )

    assert response.status_code == 200
    assert any(
        row["employee_id"] == str(data["employee_a"].id) for row in response.json()["data"]
    )


def test_employee_overview_uses_materialized_attendance_totals(team_client):
    client, data = team_client
    with data["session_factory"]() as db:
        db.add(
            DailyAttendance(
                company_id=data["employee_a"].company_id,
                employee_id=data["employee_a"].id,
                work_date=local_today("UTC"),
                timezone="UTC",
                normal_worked_seconds=300,
                pre_shift_extra_seconds=60,
                post_shift_extra_seconds=30,
                approved_manual_seconds=120,
                idle_seconds=90,
                calculated_at=datetime.now(UTC),
            )
        )
        db.commit()

    response = client.get(
        f"/api/v1/employees-overview?employee_id={data['employee_a'].id}",
        headers=data["general_headers"],
    )

    assert response.status_code == 200
    overview = response.json()["data"][0]
    assert overview["worked_today_seconds"] == 510
    assert overview["active_seconds"] == 510
    assert overview["idle_seconds"] == 90


def test_employee_overview_distinguishes_idle_break_and_off_shift(team_client, monkeypatch):
    client, data = team_client
    with data["session_factory"]() as db:
        session = db.get(WorkSession, data["session_a"].id)
        device = db.get(Device, session.device_id)
        session.status = "idle"
        device.last_seen_at = datetime.now(UTC)
        db.commit()

    monkeypatch.setattr(
        "app.api.v1.employees.current_idle_contexts",
        lambda *_args, employees, **_kwargs: {
            employee.id: "off_shift" for employee in employees
        },
    )
    outside_shift = client.get(
        f"/api/v1/employees-overview?employee_id={data['employee_a'].id}",
        headers=data["general_headers"],
    )

    assert outside_shift.status_code == 200
    assert outside_shift.json()["data"][0]["activity_status"] == "off_shift"

    monkeypatch.setattr(
        "app.api.v1.employees.current_idle_contexts",
        lambda *_args, employees, **_kwargs: {
            employee.id: "on_break" for employee in employees
        },
    )
    on_break = client.get(
        f"/api/v1/employees-overview?employee_id={data['employee_a'].id}",
        headers=data["general_headers"],
    )

    assert on_break.status_code == 200
    assert on_break.json()["data"][0]["activity_status"] == "on_break"

    monkeypatch.setattr(
        "app.api.v1.employees.current_idle_contexts",
        lambda *_args, employees, **_kwargs: {
            employee.id: "accountable" for employee in employees
        },
    )
    inside_shift = client.get(
        f"/api/v1/employees-overview?employee_id={data['employee_a'].id}",
        headers=data["general_headers"],
    )

    assert inside_shift.status_code == 200
    assert inside_shift.json()["data"][0]["activity_status"] == "idle"


def test_request_recipients_include_all_managers_and_company_hr(team_client):
    _, data = team_client
    with data["session_factory"]() as db:
        hr = AdminUser(
            company_id=data["shared_employee"].company_id,
            name="HR Reviewer",
            email="hr@company.co",
            password_hash=hash_password("ExamplePassword123!"),
            role="hr",
            status="active",
        )
        db.add(hr)
        db.commit()
        employee = db.get(Employee, data["shared_employee"].id)
        recipients = request_recipients(db, employee)

    assert {recipient.name for recipient in recipients} == {
        "Team Owner",
        "Second Owner",
        "HR Reviewer",
    }


def test_first_team_manager_to_review_leave_closes_request(team_client):
    client, data = team_client
    with data["session_factory"]() as db:
        row = LeaveRequest(
            company_id=data["shared_employee"].company_id,
            employee_id=data["shared_employee"].id,
            start_date=datetime.now(UTC).date() + timedelta(days=5),
            end_date=datetime.now(UTC).date() + timedelta(days=5),
            requested_days=1,
            leave_type="unpaid",
            reason="Personal appointment",
            status="pending",
        )
        db.add(row)
        db.commit()
        request_id = row.id

    first_review = client.patch(
        f"/api/v1/leave-requests/{request_id}",
        headers=data["owner_headers"],
        json={"status": "approved", "review_note": "Approved."},
    )
    second_review = client.patch(
        f"/api/v1/leave-requests/{request_id}",
        headers=data["second_owner_headers"],
        json={"status": "rejected", "review_note": "Rejected."},
    )

    assert first_review.status_code == 200
    assert first_review.json()["data"]["status"] == "approved"
    assert second_review.status_code == 409


def test_early_leave_is_separated_from_time_requests_and_worked_time(team_client):
    client, data = team_client
    work_date = data["session_a"].started_at.date()
    with data["session_factory"]() as db:
        db.add_all(
            [
                TimeAdjustmentRequest(
                    company_id=data["employee_a"].company_id,
                    employee_id=data["employee_a"].id,
                    request_type="manual_time",
                    requested_date=work_date,
                    requested_seconds=5 * 60,
                    approved_seconds=5 * 60,
                    reason="Approved missing tracked time",
                    status="approved",
                ),
                TimeAdjustmentRequest(
                    company_id=data["employee_a"].company_id,
                    employee_id=data["employee_a"].id,
                    request_type="early_leave",
                    requested_date=work_date,
                    requested_seconds=30 * 60,
                    approved_seconds=30 * 60,
                    reason="Approved early departure",
                    status="approved",
                ),
            ]
        )
        db.commit()

    time_requests = client.get(
        "/api/v1/time-adjustment-requests?request_group=time&status=approved",
        headers=data["general_headers"],
    )
    early_leave_requests = client.get(
        "/api/v1/time-adjustment-requests?request_group=early_leave&status=approved",
        headers=data["general_headers"],
    )
    timesheet = client.get(
        f"/api/v1/timesheets/daily?day={work_date.isoformat()}",
        headers=data["general_headers"],
    )

    assert time_requests.status_code == 200
    assert {row["request_type"] for row in time_requests.json()["data"]} == {"manual_time"}
    assert early_leave_requests.status_code == 200
    assert {row["request_type"] for row in early_leave_requests.json()["data"]} == {"early_leave"}
    row = next(
        item
        for item in timesheet.json()["data"]
        if item["employee_id"] == str(data["employee_a"].id)
    )
    assert row["adjustment_seconds"] == 5 * 60


def test_employee_start_date_and_leave_balance_overview_are_editable(team_client):
    client, data = team_client
    employee_id = data["employee_a"].id
    updated = client.patch(
        f"/api/v1/employees/{employee_id}",
        headers=data["general_headers"],
        json={"start_date": "2025-01-15"},
    )
    with data["session_factory"]() as db:
        employee = db.get(Employee, employee_id)
        db.add_all(
            [
                LeaveRequest(
                    company_id=employee.company_id,
                    employee_id=employee.id,
                    start_date=datetime(2026, 7, 27).date(),
                    end_date=datetime(2026, 7, 27).date(),
                    requested_days=1,
                    leave_type="annual",
                    reason="Annual holiday",
                    status="approved",
                ),
                LeaveRequest(
                    company_id=employee.company_id,
                    employee_id=employee.id,
                    start_date=datetime(2026, 7, 28).date(),
                    end_date=datetime(2026, 7, 28).date(),
                    requested_days=1,
                    leave_type="sick",
                    reason="Sick leave",
                    status="approved",
                ),
            ]
        )
        db.commit()

    balances = client.get(
        "/api/v1/leave-requests/balances?year=2026",
        headers=data["general_headers"],
    )

    assert updated.status_code == 200
    assert updated.json()["data"]["start_date"] == "2025-01-15"
    assert balances.status_code == 200
    balance = next(
        item for item in balances.json()["data"] if item["employee_id"] == str(employee_id)
    )
    assert balance["used_days"] == 1
    assert balance["remaining_days"] == balance["credit_days"] - 1
    assert balance["taken_dates"] == [
        {
            "date": "2026-07-27",
            "leave_type": "annual",
            "request_id": balance["taken_dates"][0]["request_id"],
        },
        {
            "date": "2026-07-28",
            "leave_type": "sick",
            "request_id": balance["taken_dates"][1]["request_id"],
        },
    ]
