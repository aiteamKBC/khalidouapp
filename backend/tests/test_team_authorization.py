from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.security import create_device_token, create_employee_access_token, hash_token
from app.core.security import create_jwt_token, hash_password
from app.database.base import Base
from app.database.session import get_db
from app.main import app
from app.services.activity_timeline import local_today
from app.models import (
    AdminUser,
    ActivityEvent,
    Company,
    Device,
    DeviceToken,
    DailyAttendance,
    Employee,
    OvertimeRecord,
    Project,
    Screenshot,
    Task,
    TaskNotification,
    TaskWorkflowRequest,
    Team,
    TeamMember,
    TeamOwner,
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


def test_cancelling_today_override_restores_normal_schedule_immediately(team_client):
    client, data = team_client
    today = local_today("UTC")
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
    assert restored.json()["data"]["scheduled_start_at"].endswith("09:00:00+00:00")


def test_payroll_overtime_decision_updates_daily_source_records(team_client):
    client, data = team_client
    work_date = local_today("UTC")
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
        f"/api/v1/payroll/sheet?month={work_date.strftime('%Y-%m')}",
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
    db: Session = data["session_factory"]()
    try:
        db.add(
            WorkSession(
                company_id=data["employee_a"].company_id,
                employee_id=data["employee_a"].id,
                device_id=data["session_a"].device_id,
                team_id=data["team_a"].id,
                project_id=data["project_a"].id,
                task_id=UUID(task_id),
                started_at=datetime.now(UTC),
                status="ended",
                active_seconds=100,
                idle_seconds=5,
                deducted_seconds=20,
            )
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


def test_employee_task_requires_request_approval_then_non_self_completion_review(team_client):
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
    assert task["stage"] == "new_requests"
    assert task["priority"] == "high"
    assert task["created_by_employee_id"] == str(data["employee_a"].id)
    creation_requests = task_workflow_requests(data, task["id"])
    assert len(creation_requests) == 1
    assert creation_requests[0] == {
        "id": creation_requests[0]["id"],
        "requested_by_employee_id": str(data["employee_a"].id),
        "request_type": "task_creation",
        "from_stage": "new_requests",
        "requested_stage": "assigned",
        "status": "pending",
        "request_note": None,
        "decision_note": None,
        "return_stage": None,
        "reviewed_by_admin_user_id": None,
    }
    creation_request_id = creation_requests[0]["id"]

    listed_while_pending = client.get("/api/v1/agent/tasks", headers=data["device_headers"])
    pending_selection = client.post(
        f"/api/v1/agent/sessions/{data['session_a'].id}/task",
        headers=data["device_headers"],
        json={"task_id": task["id"]},
    )
    assert task["id"] not in {row["id"] for row in listed_while_pending.json()["data"]}
    assert pending_selection.status_code == 409

    assert {
        row["type"] for row in admin_task_notifications(client, data["general_headers"], task["id"])
    } == {"task_approval_requested"}
    assert {
        row["type"]
        for row in admin_task_notifications(client, data["second_owner_headers"], task["id"])
    } == {"task_approval_requested"}
    assert admin_task_notifications(client, data["owner_headers"], task["id"]) == []
    assert creation_request_id in admin_notification_request_ids(
        data, data["general_admin"].id, task["id"]
    )
    assert creation_request_id in admin_notification_request_ids(
        data, data["second_owner"].id, task["id"]
    )
    assert admin_notification_request_ids(data, data["owner"].id, task["id"]) == set()

    self_approval = client.post(
        f"/api/v1/tasks/{task['id']}/approve-request",
        headers=data["owner_headers"],
        json={"target_stage": "assigned"},
    )
    approved_request = client.post(
        f"/api/v1/tasks/{task['id']}/approve-request",
        headers=data["second_owner_headers"],
        json={"target_stage": "assigned"},
    )
    assert self_approval.status_code == 403
    assert approved_request.status_code == 200
    assert approved_request.json()["data"]["stage"] == "assigned"
    approved_creation_request = task_workflow_requests(data, task["id"])[0]
    assert approved_creation_request["status"] == "approved"
    assert approved_creation_request["reviewed_by_admin_user_id"] == str(data["second_owner"].id)
    listed_after_approval = client.get("/api/v1/agent/tasks", headers=data["device_headers"])
    assert task["id"] in {row["id"] for row in listed_after_approval.json()["data"]}

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
    assert len(workflow_requests) == 2
    completion_request = workflow_requests[1]
    assert completion_request["request_type"] == "completion"
    assert completion_request["from_stage"] == "in_progress"
    assert completion_request["requested_stage"] == "completed"
    assert completion_request["status"] == "pending"
    assert completion_request["request_note"] == "Ready for checking"

    assert {
        row["type"] for row in admin_task_notifications(client, data["general_headers"], task["id"])
    } >= {"task_approval_requested", "task_review_requested"}
    assert {
        row["type"]
        for row in admin_task_notifications(client, data["second_owner_headers"], task["id"])
    } >= {"task_approval_requested", "task_review_requested"}
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
        json={"note": "I should not approve my own task"},
    )
    completed = client.post(
        f"/api/v1/tasks/{task['id']}/approve-review",
        headers=data["second_owner_headers"],
        json={"note": "Reviewed"},
    )
    duplicate_decision = client.post(
        f"/api/v1/tasks/{task['id']}/approve-review",
        headers=data["general_headers"],
        json={"note": "A stale second decision"},
    )
    assert self_review.status_code == 403
    assert completed.status_code == 200
    assert completed.json()["data"]["stage"] == "completed"
    assert completed.json()["data"]["completed_at"] is not None
    assert duplicate_decision.status_code == 409
    decided_completion_request = task_workflow_requests(data, task["id"])[1]
    assert decided_completion_request["status"] == "approved"
    assert decided_completion_request["decision_note"] == "Reviewed"
    assert decided_completion_request["reviewed_by_admin_user_id"] == str(data["second_owner"].id)


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
    assert row["total_tracked_seconds"] == 1330
