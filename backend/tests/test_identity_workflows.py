from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy import create_engine

from app.api.v1 import people as people_api
from app.core.config import settings
from app.core.security import create_jwt_token, hash_password, hash_token, verify_password
from app.database.base import Base
from app.database.session import get_db
from app.main import app
from app.models import (
    AdminPasswordResetToken,
    AdminUser,
    Company,
    EmailDelivery,
    Employee,
    EmployeeInvitation,
    Team,
    TeamMember,
    TeamOwner,
)


def employee_onboarding_payload() -> dict:
    return {
        "start_date": "2026-01-01",
        "annual_leave_days": 21,
        "work_profile": {
            "shift_start": "09:00",
            "shift_end": "17:00",
            "working_days": [0, 1, 2, 3, 4],
            "weekly_off_days": [5, 6],
            "required_daily_minutes": 480,
            "break_rules": [
                {
                    "name": "Lunch",
                    "minutes": 30,
                    "paid": False,
                    "start_time": "12:30",
                    "end_time": "13:00",
                },
                {
                    "name": "Short break",
                    "minutes": 15,
                    "paid": False,
                    "start_time": "15:30",
                    "end_time": "15:45",
                },
            ],
            "late_grace_minutes": 15,
            "deduction_policy": {
                "mode": "review",
                "brackets": [],
                "require_admin_review": True,
            },
            "overtime_enabled": False,
            "salary_amount": 0,
            "salary_currency": "EGP",
            "salary_type": "monthly",
        },
    }


@pytest.fixture()
def identity_client():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(
        bind=engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )

    def override_get_db():
        db = testing_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    db: Session = testing_session()
    company = Company(name="Kent Test", status="active")
    db.add(company)
    db.flush()
    general_admin = AdminUser(
        company_id=company.id,
        name="General Admin",
        email="general@kentconsultancy.co",
        password_hash=hash_password("OldPassword123!"),
        role="general_admin",
        status="active",
    )
    team_a = Team(company_id=company.id, name="Team A", status="active")
    team_b = Team(company_id=company.id, name="Team B", status="active")
    db.add_all([general_admin, team_a, team_b])
    db.commit()

    token = create_jwt_token(
        subject=general_admin.id,
        company_id=company.id,
        token_type="access",
        expires_delta=timedelta(minutes=30),
        extra_claims={"role": general_admin.role},
    )
    data = {
        "session_factory": testing_session,
        "general_admin": general_admin,
        "general_headers": {"Authorization": f"Bearer {token}"},
        "team_a": team_a,
        "team_b": team_b,
    }
    db.close()
    try:
        yield TestClient(app), data
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(engine)


def test_password_reset_uses_one_time_link_and_revokes_old_sessions(
    identity_client, monkeypatch
):
    client, data = identity_client
    raw_reset_token = "fixed-password-reset-token-with-enough-length-123456"
    monkeypatch.setattr(
        "app.api.v1.auth.secrets.token_urlsafe",
        lambda _length: raw_reset_token,
    )

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "general@kentconsultancy.co", "password": "OldPassword123!"},
    )
    old_refresh_token = login.json()["data"]["refresh_token"]
    forgot = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "general@kentconsultancy.co"},
    )
    old_password_still_works = client.post(
        "/api/v1/auth/login",
        json={"email": "general@kentconsultancy.co", "password": "OldPassword123!"},
    )

    db: Session = data["session_factory"]()
    try:
        reset_rows = db.scalars(select(AdminPasswordResetToken)).all()
        deliveries = db.scalars(
            select(EmailDelivery).where(EmailDelivery.category == "admin_password_reset")
        ).all()
    finally:
        db.close()

    assert forgot.status_code == 200
    assert old_password_still_works.status_code == 200
    assert len(reset_rows) == 1
    assert len(deliveries) == 1
    assert deliveries[0].recipient == "general@kentconsultancy.co"
    assert deliveries[0].status == "suppressed"

    reset = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw_reset_token, "new_password": "NewPassword456!"},
    )
    old_login = client.post(
        "/api/v1/auth/login",
        json={"email": "general@kentconsultancy.co", "password": "OldPassword123!"},
    )
    new_login = client.post(
        "/api/v1/auth/login",
        json={"email": "general@kentconsultancy.co", "password": "NewPassword456!"},
    )
    old_refresh = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": old_refresh_token},
    )
    reused = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw_reset_token, "new_password": "AnotherPassword789!"},
    )

    assert reset.status_code == 200
    assert old_login.status_code == 401
    assert new_login.status_code == 200
    assert old_refresh.status_code == 401
    assert reused.status_code == 400


def test_unknown_password_reset_is_non_enumerating(identity_client):
    client, data = identity_client
    response = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "missing@kentconsultancy.co"},
    )
    db: Session = data["session_factory"]()
    try:
        assert db.scalar(select(AdminPasswordResetToken.id)) is None
        assert db.scalar(select(EmailDelivery.id)) is None
    finally:
        db.close()
    assert response.status_code == 200
    assert "If the account exists" in response.json()["data"]["message"]


def test_invited_user_can_change_temporary_password_and_sessions_are_revoked(
    identity_client, monkeypatch
):
    client, data = identity_client
    monkeypatch.setattr(
        "app.api.v1.people.generate_temporary_password",
        lambda: "TemporaryInvitePassword123!",
    )
    client.post(
        "/api/v1/people/invitations",
        headers=data["general_headers"],
        json={
            "name": "Password Change Manager",
            "email": "change.password@kentconsultancy.co",
            "kind": "team_manager",
            "team_ids": [str(data["team_a"].id)],
        },
    )
    login = client.post(
        "/api/v1/auth/login",
        json={
            "email": "change.password@kentconsultancy.co",
            "password": "TemporaryInvitePassword123!",
        },
    )
    tokens = login.json()["data"]
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    wrong_current = client.post(
        "/api/v1/auth/change-password",
        headers=headers,
        json={"current_password": "WrongPassword", "new_password": "NewPassword456!"},
    )
    changed = client.post(
        "/api/v1/auth/change-password",
        headers=headers,
        json={
            "current_password": "TemporaryInvitePassword123!",
            "new_password": "NewPassword456!",
        },
    )
    old_refresh = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )
    old_login = client.post(
        "/api/v1/auth/login",
        json={
            "email": "change.password@kentconsultancy.co",
            "password": "TemporaryInvitePassword123!",
        },
    )
    new_login = client.post(
        "/api/v1/auth/login",
        json={
            "email": "change.password@kentconsultancy.co",
            "password": "NewPassword456!",
        },
    )

    assert login.status_code == 200
    assert wrong_current.status_code == 400
    assert changed.status_code == 200
    assert old_refresh.status_code == 401
    assert old_login.status_code == 401
    assert new_login.status_code == 200


def test_inviting_team_manager_is_atomic_and_permissions_are_scoped(
    identity_client, monkeypatch
):
    client, data = identity_client
    monkeypatch.setattr(
        "app.api.v1.people.generate_temporary_password",
        lambda: "InvitePassword123!",
    )
    invited = client.post(
        "/api/v1/people/invitations",
        headers=data["general_headers"],
        json={
            "name": "Team Manager",
            "email": "manager@kentconsultancy.co",
            "kind": "team_manager",
            "team_ids": [str(data["team_a"].id)],
            "timezone": "Africa/Cairo",
        },
    )
    assert invited.status_code == 200
    invitation = invited.json()["data"]
    assert invitation["email_queued"] is True

    db: Session = data["session_factory"]()
    try:
        manager = db.scalar(
            select(AdminUser).where(AdminUser.email == "manager@kentconsultancy.co")
        )
        employee = db.scalar(
            select(Employee).where(Employee.email == "manager@kentconsultancy.co")
        )
        membership = db.scalar(
            select(TeamMember).where(
                TeamMember.team_id == data["team_a"].id,
                TeamMember.employee_id == employee.id,
            )
        )
        ownership = db.scalar(
            select(TeamOwner).where(
                TeamOwner.team_id == data["team_a"].id,
                TeamOwner.admin_user_id == manager.id,
            )
        )
        delivery = db.scalar(
            select(EmailDelivery).where(EmailDelivery.recipient == "manager@kentconsultancy.co")
        )
        assert manager.employee_id == employee.id
        assert manager.role == "team_owner"
        assert employee.timezone == "Africa/Cairo"
        assert membership is not None and membership.status == "active"
        assert ownership is not None
        assert delivery.category == "admin_welcome"
        assert delivery.status == "suppressed"
    finally:
        db.close()

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "manager@kentconsultancy.co", "password": "InvitePassword123!"},
    )
    manager_headers = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}
    me = client.get("/api/v1/auth/me", headers=manager_headers)
    own_team = client.get(f"/api/v1/teams/{data['team_a'].id}", headers=manager_headers)
    other_team = client.get(f"/api/v1/teams/{data['team_b'].id}", headers=manager_headers)
    users = client.get("/api/v1/users", headers=manager_headers)
    invite_attempt = client.post(
        "/api/v1/people/invitations",
        headers=manager_headers,
        json={
            "name": "Unauthorized User",
            "email": "unauthorized@kentconsultancy.co",
            "kind": "employee",
            "team_ids": [str(data["team_a"].id)],
        },
    )

    assert login.status_code == 200
    assert me.status_code == 200
    assert "tasks.manage_team" in me.json()["data"]["permissions"]
    assert "company.manage" not in me.json()["data"]["permissions"]
    assert own_team.status_code == 200
    assert other_team.status_code == 403
    assert users.status_code == 403
    assert invite_attempt.status_code == 403


def test_general_admin_can_invite_employee_and_other_general_admin(
    identity_client, monkeypatch
):
    client, data = identity_client
    monkeypatch.setattr(
        "app.api.v1.people.generate_temporary_password",
        lambda: "AdminInvitePassword123!",
    )
    employee_response = client.post(
        "/api/v1/people/invitations",
        headers=data["general_headers"],
        json={
            "name": "New Employee",
            "email": "employee@kentconsultancy.co",
            "kind": "employee",
            "team_ids": [str(data["team_b"].id)],
            **employee_onboarding_payload(),
        },
    )
    admin_response = client.post(
        "/api/v1/people/invitations",
        headers=data["general_headers"],
        json={
            "name": "Another General Admin",
            "email": "admin2@kentconsultancy.co",
            "kind": "general_admin",
            "job_title": "Operations Manager",
            "team_ids": [],
        },
    )
    me = client.get("/api/v1/auth/me", headers=data["general_headers"])

    db: Session = data["session_factory"]()
    try:
        deliveries = db.scalars(select(EmailDelivery).order_by(EmailDelivery.recipient)).all()
        invited_employee = db.scalar(
            select(Employee).where(Employee.email == "employee@kentconsultancy.co")
        )
        invited_admin = db.scalar(
            select(AdminUser).where(AdminUser.email == "admin2@kentconsultancy.co")
        )
        assert {row.category for row in deliveries} == {"employee_invitation", "admin_welcome"}
        assert invited_employee is not None
        assert invited_admin is not None and invited_admin.role == "general_admin"
        assert invited_admin.employee is not None
        assert invited_admin.employee.job_title == "Operations Manager"
    finally:
        db.close()

    assert employee_response.status_code == 200
    assert admin_response.status_code == 200
    assert me.status_code == 200
    assert "company.manage" in me.json()["data"]["permissions"]
    assert "admins.manage" in me.json()["data"]["permissions"]


def test_general_admin_can_sign_in_to_employee_portal(identity_client):
    client, data = identity_client

    login = client.post(
        "/api/v1/employee-auth/login",
        json={
            "email": "general@kentconsultancy.co",
            "password": "OldPassword123!",
        },
    )

    assert login.status_code == 200
    response_data = login.json()["data"]
    assert response_data["employee"]["email"] == "general@kentconsultancy.co"
    assert response_data["employee"]["status"] == "active"
    assert response_data["access_token"]

    db: Session = data["session_factory"]()
    try:
        admin = db.get(AdminUser, data["general_admin"].id)
        employee = db.get(Employee, UUID(response_data["employee"]["id"]))
        assert employee is not None
        assert admin.employee_id == employee.id
        assert employee.portal_password_hash == admin.password_hash
    finally:
        db.close()


def test_general_admin_can_reset_manager_password_and_queue_reset_email(
    identity_client, monkeypatch
):
    client, data = identity_client
    monkeypatch.setattr(
        "app.api.v1.people.generate_temporary_password",
        lambda: "OriginalInvitePassword123!",
    )
    invited = client.post(
        "/api/v1/people/invitations",
        headers=data["general_headers"],
        json={
            "name": "Password Reset Manager",
            "email": "reset.manager@kentconsultancy.co",
            "kind": "team_manager",
            "team_ids": [str(data["team_a"].id)],
        },
    )
    admin_id = invited.json()["data"]["admin_user_id"]
    changed = client.patch(
        f"/api/v1/users/{admin_id}",
        headers=data["general_headers"],
        json={"password": "AdminChangedPassword456!"},
    )
    old_login = client.post(
        "/api/v1/auth/login",
        json={
            "email": "reset.manager@kentconsultancy.co",
            "password": "OriginalInvitePassword123!",
        },
    )
    new_login = client.post(
        "/api/v1/auth/login",
        json={
            "email": "reset.manager@kentconsultancy.co",
            "password": "AdminChangedPassword456!",
        },
    )
    db: Session = data["session_factory"]()
    try:
        deliveries = db.scalars(
            select(EmailDelivery)
            .where(EmailDelivery.recipient == "reset.manager@kentconsultancy.co")
            .order_by(EmailDelivery.created_at)
        ).all()
    finally:
        db.close()

    assert changed.status_code == 200
    assert old_login.status_code == 401
    assert new_login.status_code == 200
    assert [row.category for row in deliveries] == ["admin_welcome", "admin_password_reset"]
    assert all(row.status == "suppressed" for row in deliveries)


def test_invalid_team_invitation_creates_nothing(identity_client):
    client, data = identity_client
    response = client.post(
        "/api/v1/people/invitations",
        headers=data["general_headers"],
        json={
            "name": "Should Not Exist",
            "email": "nothing@kentconsultancy.co",
            "kind": "team_manager",
            "team_ids": [str(uuid4())],
        },
    )
    db: Session = data["session_factory"]()
    try:
        assert db.scalar(
            select(AdminUser.id).where(AdminUser.email == "nothing@kentconsultancy.co")
        ) is None
        assert db.scalar(
            select(Employee.id).where(Employee.email == "nothing@kentconsultancy.co")
        ) is None
        assert db.scalar(
            select(EmailDelivery.id).where(
                EmailDelivery.recipient == "nothing@kentconsultancy.co"
            )
        ) is None
    finally:
        db.close()
    assert response.status_code == 400


def test_employee_invitation_is_hashed_one_time_and_accepts_password(
    identity_client, monkeypatch
):
    client, data = identity_client
    raw_token = "employee-invitation-token-with-enough-random-looking-bytes-123"
    monkeypatch.setattr(
        "app.services.employee_invitations.secrets.token_urlsafe",
        lambda _length: raw_token,
    )

    created = client.post(
        "/api/v1/people/invitations",
        headers=data["general_headers"],
        json={
            "name": "Invited Employee",
            "email": "invited.employee@kentconsultancy.co",
            "kind": "employee",
            "team_ids": [str(data["team_a"].id)],
            **employee_onboarding_payload(),
        },
    )
    created_data = created.json()["data"]
    assert created.status_code == 200
    assert created_data["invitation"]["status"] == "pending"
    assert created_data["email_queued"] is True

    db: Session = data["session_factory"]()
    try:
        employee = db.scalar(
            select(Employee).where(
                Employee.email == "invited.employee@kentconsultancy.co"
            )
        )
        invitation = db.scalar(
            select(EmployeeInvitation).where(
                EmployeeInvitation.employee_id == employee.id
            )
        )
        assert employee.status == "invited"
        assert employee.portal_password_hash is None
        assert invitation.token_hash == hash_token(raw_token)
        assert invitation.token_hash != raw_token
        validity = invitation.expires_at - invitation.created_at
        assert timedelta(hours=23, minutes=59) < validity < timedelta(hours=24, minutes=1)
    finally:
        db.close()

    verified = client.get(f"/api/v1/people/invitations/{raw_token}")
    before_accept_login = client.post(
        "/api/v1/employee-auth/login",
        json={
            "email": "invited.employee@kentconsultancy.co",
            "password": "ChosenPassword123!",
        },
    )
    accepted = client.post(
        f"/api/v1/people/invitations/{raw_token}",
        json={"password": "ChosenPassword123!"},
    )
    reused = client.post(
        f"/api/v1/people/invitations/{raw_token}",
        json={"password": "DifferentPassword456!"},
    )
    login = client.post(
        "/api/v1/employee-auth/login",
        json={
            "email": "invited.employee@kentconsultancy.co",
            "password": "ChosenPassword123!",
        },
    )

    assert verified.status_code == 200
    assert verified.json()["data"]["valid"] is True
    assert before_accept_login.status_code == 401
    assert accepted.status_code == 200
    assert accepted.json()["data"]["status"] == "accepted"
    assert reused.status_code == 400
    assert login.status_code == 200

    db = data["session_factory"]()
    try:
        employee = db.scalar(
            select(Employee).where(
                Employee.email == "invited.employee@kentconsultancy.co"
            )
        )
        invitation = db.scalar(
            select(EmployeeInvitation).where(
                EmployeeInvitation.employee_id == employee.id
            )
        )
        assert employee.status == "active"
        assert employee.portal_password_hash != "ChosenPassword123!"
        assert verify_password("ChosenPassword123!", employee.portal_password_hash)
        assert invitation.accepted_at is not None
    finally:
        db.close()


def test_direct_employee_creation_is_invited_and_overview_exposes_invitation(
    identity_client, monkeypatch
):
    client, data = identity_client
    monkeypatch.setattr(
        "app.services.employee_invitations.secrets.token_urlsafe",
        lambda _length: "direct-employee-invitation-token-with-enough-length-123",
    )
    created = client.post(
        "/api/v1/employees",
        headers=data["general_headers"],
        json={
            "name": "Direct Employee",
            "email": "direct.employee@kentconsultancy.co",
            "timezone": "Africa/Cairo",
            "status": "active",
        },
    )
    employee_id = created.json()["data"]["id"]
    overview = client.get(
        f"/api/v1/employees-overview?employee_id={employee_id}",
        headers=data["general_headers"],
    )
    premature_activation = client.patch(
        f"/api/v1/employees/{employee_id}",
        headers=data["general_headers"],
        json={"status": "active"},
    )

    assert created.status_code == 200
    assert created.json()["data"]["status"] == "invited"
    assert created.json()["data"]["invitation"]["status"] == "pending"
    assert overview.status_code == 200
    assert premature_activation.status_code == 409
    assert overview.json()["data"][0]["employee"]["status"] == "invited"
    assert overview.json()["data"][0]["employee"]["invitation"]["id"] == (
        created.json()["data"]["invitation"]["id"]
    )

def test_employee_invitation_resend_revokes_old_token(identity_client, monkeypatch):
    client, data = identity_client
    tokens = iter(
        [
            "first-employee-invitation-token-with-enough-length-123456",
            "failed-employee-invitation-token-with-enough-length-000000",
            "final-employee-invitation-token-with-enough-length-654321",
        ]
    )
    monkeypatch.setattr(
        "app.services.employee_invitations.secrets.token_urlsafe",
        lambda _length: next(tokens),
    )
    created = client.post(
        "/api/v1/people/invitations",
        headers=data["general_headers"],
        json={
            "name": "Resent Employee",
            "email": "resent.employee@kentconsultancy.co",
            "kind": "employee",
            "team_ids": [str(data["team_a"].id)],
            **employee_onboarding_payload(),
        },
    )
    invitation_id = created.json()["data"]["invitation"]["id"]

    cooldown_blocked = client.post(
        f"/api/v1/people/invitations/{invitation_id}/resend",
        headers=data["general_headers"],
    )
    original_still_valid = client.get(
        "/api/v1/people/invitations/first-employee-invitation-token-with-enough-length-123456"
    )
    assert cooldown_blocked.status_code == 429
    assert original_still_valid.json()["data"]["valid"] is True

    db: Session = data["session_factory"]()
    try:
        delivery = db.scalar(
            select(EmailDelivery).where(
                EmailDelivery.recipient == "resent.employee@kentconsultancy.co",
                EmailDelivery.category == "employee_invitation",
            )
        )
        delivery.created_at = datetime.now(UTC) - timedelta(
            minutes=settings.email_cooldown_minutes + 1
        )
        db.add(delivery)
        db.commit()
    finally:
        db.close()

    real_enqueue = people_api.enqueue_employee_invitation_email
    monkeypatch.setattr(
        people_api,
        "enqueue_employee_invitation_email",
        lambda *args, **kwargs: False,
    )
    queue_failed = client.post(
        f"/api/v1/people/invitations/{invitation_id}/resend",
        headers=data["general_headers"],
    )
    old_after_queue_failure = client.get(
        "/api/v1/people/invitations/first-employee-invitation-token-with-enough-length-123456"
    )
    assert queue_failed.status_code == 200
    assert queue_failed.json()["data"]["email_queued"] is False
    assert queue_failed.json()["data"]["invitation"]["id"] == invitation_id
    assert old_after_queue_failure.json()["data"]["valid"] is True

    monkeypatch.setattr(people_api, "enqueue_employee_invitation_email", real_enqueue)
    resent = client.post(
        f"/api/v1/people/invitations/{invitation_id}/resend",
        headers=data["general_headers"],
    )
    old_verification = client.get(
        "/api/v1/people/invitations/first-employee-invitation-token-with-enough-length-123456"
    )
    new_verification = client.get(
        "/api/v1/people/invitations/final-employee-invitation-token-with-enough-length-654321"
    )

    assert resent.status_code == 200
    assert resent.json()["data"]["invitation"]["status"] == "pending"
    assert resent.json()["data"]["invitation"]["id"] != invitation_id
    assert old_verification.json()["data"] == {"valid": False, "status": "revoked"}
    assert new_verification.json()["data"]["valid"] is True

    db: Session = data["session_factory"]()
    try:
        invitations = db.scalars(
            select(EmployeeInvitation).order_by(EmployeeInvitation.created_at)
        ).all()
        assert len(invitations) == 3
        assert invitations[0].revoked_at is not None
        assert invitations[1].revoked_at is not None
        assert invitations[2].revoked_at is None
    finally:
        db.close()


def test_accepted_employee_can_enroll_desktop_with_employee_token(
    identity_client, monkeypatch
):
    client, data = identity_client
    raw_token = "desktop-invitation-token-with-enough-length-123456789"
    monkeypatch.setattr(
        "app.services.employee_invitations.secrets.token_urlsafe",
        lambda _length: raw_token,
    )
    client.post(
        "/api/v1/people/invitations",
        headers=data["general_headers"],
        json={
            "name": "Desktop Employee",
            "email": "desktop.employee@kentconsultancy.co",
            "kind": "employee",
            "team_ids": [str(data["team_a"].id)],
            **employee_onboarding_payload(),
        },
    )
    client.post(
        f"/api/v1/people/invitations/{raw_token}",
        json={"password": "DesktopPassword123!"},
    )
    portal_login = client.post(
        "/api/v1/employee-auth/login",
        json={
            "email": "desktop.employee@kentconsultancy.co",
            "password": "DesktopPassword123!",
        },
    )
    employee_token = portal_login.json()["data"]["access_token"]
    enrolled = client.post(
        "/api/v1/agent/enroll-authenticated",
        headers={"Authorization": f"Bearer {employee_token}"},
        json={
            "device": {
                "installation_id": "desktop-installation-12345",
                "device_name": "KBC Laptop",
                "operating_system": "Windows 11",
                "agent_version": "1.2.0",
                "windows_username": "kbc-user",
            }
        },
    )

    assert portal_login.status_code == 200
    assert enrolled.status_code == 200
    assert enrolled.json()["data"]["device"]["installation_id"] == "desktop-installation-12345"
    assert enrolled.json()["data"]["device_token"]
    assert enrolled.json()["data"]["token_type"] == "bearer"


def test_inviting_an_existing_active_employee_is_a_conflict(identity_client):
    client, data = identity_client
    db: Session = data["session_factory"]()
    active_employee = Employee(
        company_id=data["general_admin"].company_id,
        name="Existing Employee",
        email="existing.employee@kentconsultancy.co",
        employee_code="EMP-EXISTING",
        timezone="Africa/Cairo",
        status="active",
    )
    db.add(active_employee)
    db.commit()
    db.close()

    response = client.post(
        "/api/v1/people/invitations",
        headers=data["general_headers"],
        json={
            "name": "Existing Employee",
            "email": "existing.employee@kentconsultancy.co",
            "kind": "employee",
            "team_ids": [str(data["team_a"].id)],
        },
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "EMPLOYEE_EMAIL_EXISTS"
    db = data["session_factory"]()
    try:
        assert db.scalar(
            select(EmployeeInvitation.id).where(
                EmployeeInvitation.employee_id == active_employee.id
            )
        ) is None
        assert db.scalar(
            select(EmailDelivery.id).where(
                EmailDelivery.recipient == "existing.employee@kentconsultancy.co"
            )
        ) is None
    finally:
        db.close()


def test_archived_person_can_be_deleted_and_email_reused(identity_client):
    client, data = identity_client
    email = "delete.me@kentconsultancy.co"
    created = client.post(
        "/api/v1/people/invitations",
        headers=data["general_headers"],
        json={
            "name": "Delete Me",
            "email": email,
            "kind": "employee",
            "team_ids": [str(data["team_a"].id)],
            **employee_onboarding_payload(),
        },
    )
    assert created.status_code == 200
    employee_id = created.json()["data"]["employee_id"]

    delete_before_archive = client.delete(
        f"/api/v1/people/employee/{employee_id}",
        headers=data["general_headers"],
    )
    archived = client.post(
        f"/api/v1/people/employee/{employee_id}/archive",
        headers=data["general_headers"],
    )
    deleted = client.delete(
        f"/api/v1/people/employee/{employee_id}",
        headers=data["general_headers"],
    )
    listed = client.get("/api/v1/employees", headers=data["general_headers"])
    recreated = client.post(
        "/api/v1/people/invitations",
        headers=data["general_headers"],
        json={
            "name": "Delete Me Again",
            "email": email,
            "kind": "employee",
            "team_ids": [str(data["team_a"].id)],
            **employee_onboarding_payload(),
        },
    )

    assert delete_before_archive.status_code == 409
    assert archived.status_code == 200
    assert deleted.status_code == 200
    assert deleted.json()["data"]["deleted"] is True
    assert all(item["email"] != email for item in listed.json()["data"])
    assert recreated.status_code == 200

    db: Session = data["session_factory"]()
    try:
        deleted_employee = db.get(Employee, UUID(employee_id))
        assert deleted_employee is not None
        assert deleted_employee.status == "deleted"
        assert deleted_employee.email != email
        assert deleted_employee.email.startswith("deleted-employee-")
    finally:
        db.close()


def test_failed_invitation_queue_is_reported_and_can_be_resent(
    identity_client, monkeypatch
):
    client, data = identity_client
    tokens = iter(
        [
            "queue-failure-invitation-token-with-enough-length-123456",
            "queue-recovery-invitation-token-with-enough-length-654321",
        ]
    )
    monkeypatch.setattr(
        "app.services.employee_invitations.secrets.token_urlsafe",
        lambda _length: next(tokens),
    )
    real_enqueue = people_api.enqueue_employee_invitation_email
    monkeypatch.setattr(
        people_api,
        "enqueue_employee_invitation_email",
        lambda *args, **kwargs: False,
    )
    created = client.post(
        "/api/v1/people/invitations",
        headers=data["general_headers"],
        json={
            "name": "Queue Recovery Employee",
            "email": "queue.recovery@kentconsultancy.co",
            "kind": "employee",
            "team_ids": [str(data["team_a"].id)],
            **employee_onboarding_payload(),
        },
    )
    assert created.status_code == 200
    assert created.json()["data"]["email_queued"] is False
    assert created.json()["data"]["invitation"]["status"] == "pending"

    monkeypatch.setattr(people_api, "enqueue_employee_invitation_email", real_enqueue)
    resent = client.post(
        f"/api/v1/people/invitations/{created.json()['data']['invitation']['id']}/resend",
        headers=data["general_headers"],
    )
    assert resent.status_code == 200
    assert resent.json()["data"]["email_queued"] is True
    assert resent.json()["data"]["invitation"]["status"] == "pending"
