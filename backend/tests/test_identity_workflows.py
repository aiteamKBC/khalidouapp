from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy import create_engine

from app.core.security import create_jwt_token, hash_password
from app.database.base import Base
from app.database.session import get_db
from app.main import app
from app.models import (
    AdminPasswordResetToken,
    AdminUser,
    Company,
    EmailDelivery,
    Employee,
    Team,
    TeamMember,
    TeamOwner,
)


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
        },
    )
    admin_response = client.post(
        "/api/v1/people/invitations",
        headers=data["general_headers"],
        json={
            "name": "Another General Admin",
            "email": "admin2@kentconsultancy.co",
            "kind": "general_admin",
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
    finally:
        db.close()

    assert employee_response.status_code == 200
    assert admin_response.status_code == 200
    assert me.status_code == 200
    assert "company.manage" in me.json()["data"]["permissions"]
    assert "admins.manage" in me.json()["data"]["permissions"]


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
