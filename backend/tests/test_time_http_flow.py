"""Time release gate through real HTTP routes, optionally on a migrated scratch PG DB."""

import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import create_device_token, create_jwt_token, hash_token
from app.database.base import Base
from app.database.session import get_db
from app.main import app
from app.models import ActivityEvent, AdminUser, Company, Device, DeviceToken, Employee, WorkSession


def _utc(value):
    # SQLite returns naive values; PostgreSQL returns aware values in its own
    # configured zone. Relabelling an aware Cairo value as UTC adds two hours.
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


@pytest.fixture()
def time_http():
    url = os.environ.get("KHALIDUO_TIME_TEST_DATABASE_URL")
    if url:
        # Never point this fixture at the production database. PostgreSQL tests
        # use a separately created/migrated database destroyed by the runner.
        assert make_url(url).database.startswith("khaliduo_time_test_")
        engine = create_engine(url)
    else:
        engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_db():
        with factory() as db:
            yield db

    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = override_db
    with factory() as db:
        company = Company(name=f"Isolated time HTTP test {uuid4().hex}", status="active")
        db.add(company)
        db.flush()
        employee = Employee(
            company_id=company.id, name="Time test", email=f"{uuid4()}@example.com",
            employee_code=uuid4().hex, timezone="Africa/Cairo", status="active",
        )
        db.add(employee)
        db.flush()
        device = Device(
            company_id=company.id, employee_id=employee.id, device_name="Test only",
            installation_id=str(uuid4()), operating_system="Windows 11",
            timezone="Africa/Cairo", country_code="EG", timezone_source="ip_geolocation",
            timezone_checked_at=datetime.now(UTC), agent_version="9.9.9", status="active",
        )
        admin = AdminUser(
            company_id=company.id, name="Test HR", email=f"{uuid4()}@example.com",
            password_hash="unused", role="general_admin", status="active", data_scope="company",
        )
        db.add_all([device, admin])
        db.flush()
        token = create_device_token(device_id=device.id, company_id=company.id, employee_id=employee.id)
        db.add(DeviceToken(company_id=company.id, device_id=device.id, token_hash=hash_token(token)))
        db.commit()
        admin_token = create_jwt_token(
            subject=admin.id, company_id=company.id, token_type="access",
            expires_delta=timedelta(minutes=15), extra_claims={"role": admin.role},
        )
        data = {
            "factory": factory, "device_id": device.id, "employee_id": employee.id,
            "device_headers": {"Authorization": f"Bearer {token}"},
            "admin_headers": {"Authorization": f"Bearer {admin_token}"},
        }
    try:
        # No lifespan worker: all DB operations use the dependency above and no
        # screenshot retention/background processing runs during these tests.
        client = TestClient(app, raise_server_exceptions=True)
        yield client, data
        client.close()
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)
        if not url:
            Base.metadata.drop_all(engine)
        engine.dispose()


def _post(client, path, headers, body):
    response = client.post(f"/api/v1/{path}", headers=headers, json=body)
    assert response.status_code == 200, response.text
    return response.json()["data"]


@pytest.mark.parametrize("status", ["idle", "locked", "sleeping", "offline"])
def test_overnight_idle_and_active_return_over_http(time_http, status):
    client, data = time_http
    headers = data["device_headers"]
    # Cairo's DST begins at this boundary: midnight jumps directly to 01:00.
    start = "2026-04-23T21:00:00+00:00"
    last_work = "2026-04-23T21:30:00+00:00"
    arrival = "2026-04-24T02:00:00+00:00"
    session_id = _post(client, "agent/sessions/start", headers, {"started_at": start})["session"]["id"]
    path = f"agent/sessions/{session_id}/heartbeat"
    _post(client, path, headers, {
        "event_id": str(uuid4()), "timestamp": last_work, "status": "active",
        "active_seconds": 1800, "idle_seconds": 0, "agent_version": "9.9.9",
        "timezone": "Europe/London",  # wrong Windows zone must not displace verified EG
    })
    payload = {
        "event_id": str(uuid4()), "timestamp": arrival, "status": status,
        "active_seconds": 999999, "idle_seconds": 999999, "agent_version": "9.9.9",
    }
    result = _post(client, path, headers, payload)
    assert result["ignored"] is True
    assert result["session"]["ended_at"] == last_work
    assert result.get("restarted") is not True
    _post(client, path, headers, payload)
    resumed = _post(client, path, headers, {**payload, "event_id": str(uuid4()), "status": "active"})
    assert resumed["restarted"] is True
    assert resumed["session"]["id"] != session_id
    assert resumed["session"]["started_at"] == arrival
    assert resumed["session"]["active_seconds"] == 0
    assert resumed["session"]["timezone"] == "Africa/Cairo"
    with data["factory"]() as db:
        assert db.scalar(select(func.count()).select_from(WorkSession).where(
            WorkSession.device_id == data["device_id"], WorkSession.ended_at.is_(None),
        )) == 1


def test_long_admin_reason_closes_and_late_replay_cannot_rewrite_ledger_over_http(time_http):
    client, data = time_http
    headers = data["device_headers"]
    started = _post(client, "agent/sessions/start", headers, {"started_at": "2026-11-26T10:00:00Z"})
    session_id = started["session"]["id"]
    reason = "\u0642" * 2000
    path = f"attendance/employee/{data['employee_id']}/sessions/close"
    closed = _post(client, path, data["admin_headers"], {
        "ended_at": "2026-11-26T10:30:00Z", "reason": reason,
    })
    assert closed["closed"] is True
    assert _post(client, path, data["admin_headers"], {"reason": reason})["closed"] is False
    replay = _post(client, f"agent/sessions/{session_id}/heartbeat", headers, {
        "event_id": str(uuid4()), "timestamp": "2026-11-26T10:20:00Z", "status": "active",
        "active_seconds": 999999, "idle_seconds": 999999, "agent_version": "9.9.9",
    })
    assert replay["ignored"] is True
    assert replay.get("restarted") is not True
    with data["factory"]() as db:
        event = db.scalar(select(ActivityEvent).where(
            ActivityEvent.device_id == data["device_id"], ActivityEvent.event_type == "session_ended",
        ))
        assert event.payload["reason"] == f"Administrative close: {reason}"
        assert len(event.idempotency_key) <= 120


def test_offline_duplicate_and_return_preserve_bounded_non_working_tail_over_http(time_http):
    client, data = time_http
    headers = data["device_headers"]
    session_id = _post(client, "agent/sessions/start", headers, {"started_at": "2026-11-26T10:00:00Z"})["session"]["id"]
    path = f"agent/sessions/{session_id}/heartbeat"
    payload = {"event_id": str(uuid4()), "timestamp": "2026-11-26T10:00:01Z", "status": "offline",
               "active_seconds": 0, "idle_seconds": 1, "agent_version": "9.9.9"}
    _post(client, path, headers, payload)
    duplicate = _post(client, path, headers, payload)
    assert duplicate["duplicate"] is True
    assert duplicate["session"]["ended_at"] is None
    returned = _post(client, path, headers, {**payload, "event_id": str(uuid4()), "status": "active"})
    assert returned["restarted"] is True
    with data["factory"]() as db:
        from uuid import UUID
        old = db.get(WorkSession, UUID(session_id))
        assert old.active_seconds == 0
        assert _utc(old.ended_at) == datetime(2026, 11, 26, 10, 0, 1, tzinfo=UTC)
        for event in db.scalars(select(ActivityEvent).where(ActivityEvent.session_id == old.id)):
            assert _utc(old.started_at) <= _utc(event.event_timestamp) <= _utc(old.ended_at)
