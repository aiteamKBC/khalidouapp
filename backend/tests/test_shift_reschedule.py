"""Shift reschedule requests: validation, review gating, and schedule effect."""

from datetime import UTC, date, datetime, time, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.exceptions import ApiError
from app.core.security import create_device_token, create_jwt_token, hash_token
from app.database.base import Base
from app.database.session import get_db
from app.main import app
from app.models import (
    ActivityEvent,
    AdminUser,
    AuditLog,
    Company,
    DailyAttendance,
    Device,
    DeviceToken,
    Employee,
    EmployeeWorkProfile,
    LeaveRequest,
    WorkScheduleOverride,
    WorkSession,
)
from app.services.attendance import calculate_daily_attendance
from app.services.schedules import (
    effective_schedule,
    effective_schedules_for_employees,
    effective_schedules_for_range,
)
from app.services.session_tracking import (
    employee_required_daily_seconds,
    sync_session_time_buckets,
)
from app.services.shift_reschedules import (
    create_emergency_reschedule,
    create_employee_request,
    expire_stale_requests,
    review_request,
)
from app.services.work_profiles import resolve_day_policy

BREAKS = [
    {"name": "Lunch", "minutes": 30, "paid": True, "start_time": "13:00", "end_time": "13:30"},
    {"name": "Short", "minutes": 15, "paid": True, "start_time": "16:30", "end_time": "16:45"},
]
TODAY = datetime.now(UTC).date()
OFF_DAY = TODAY + timedelta(days=4)
# A fixed past working day for deterministic classification tests.
FIXED_DAY = next(
    day for day in (date(2026, 9, 10), date(2026, 9, 11)) if day.weekday() != OFF_DAY.weekday()
)


def _admin_token(admin: AdminUser) -> dict:
    token = create_jwt_token(
        subject=admin.id,
        company_id=admin.company_id,
        token_type="access",
        expires_delta=timedelta(minutes=30),
        extra_claims={"role": admin.role},
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def env():
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
    company = Company(name="Reschedule Co", status="active")
    db.add(company)
    db.flush()
    employee = Employee(
        company_id=company.id, name="Shift Employee", email="shift@example.com",
        employee_code="SH-1", timezone="UTC", status="active",
    )
    db.add(employee)
    db.flush()
    working_days = [day for day in range(7) if day != OFF_DAY.weekday()]
    db.add(EmployeeWorkProfile(
        company_id=company.id, employee_id=employee.id,
        shift_start=time(9, 0), shift_end=time(17, 0),
        working_days=working_days, weekly_off_days=[OFF_DAY.weekday()],
        required_daily_minutes=480, break_rules=BREAKS, late_grace_minutes=15,
        overtime_enabled=True,
    ))
    device = Device(
        company_id=company.id, employee_id=employee.id, device_name="Shift Device",
        installation_id="shift-device", operating_system="Windows 11",
        agent_version="1.1.96", status="active",
    )
    admins = {
        "hr": AdminUser(
            company_id=company.id, name="HR", email="hr@example.com", password_hash="x",
            role="hr", status="active", data_scope="company",
        ),
        "super": AdminUser(
            company_id=company.id, name="Super", email="super@example.com", password_hash="x",
            role="general_admin", status="active", data_scope="company", is_super_admin=True,
        ),
        "general": AdminUser(
            company_id=company.id, name="General", email="general@example.com",
            password_hash="x", role="general_admin", status="active", data_scope="company",
        ),
        "leader": AdminUser(
            company_id=company.id, name="Leader", email="leader@example.com",
            password_hash="x", role="team_owner", status="active", data_scope="company",
        ),
        "self_hr": AdminUser(
            company_id=company.id, name="Self HR", email="selfhr@example.com",
            password_hash="x", role="hr", status="active", data_scope="company",
            employee_id=employee.id,
        ),
    }
    db.add(device)
    db.add_all(admins.values())
    db.flush()
    device_token = create_device_token(
        device_id=device.id, company_id=company.id, employee_id=employee.id,
    )
    db.add(DeviceToken(company_id=company.id, device_id=device.id, token_hash=hash_token(device_token)))
    db.commit()
    data = {
        "db": db,
        "company": company,
        "employee": employee,
        "device": device,
        "admins": admins,
        "device_headers": {"Authorization": f"Bearer {device_token}"},
        "headers": {key: _admin_token(admin) for key, admin in admins.items()},
    }
    try:
        yield TestClient(app), data
    finally:
        db.close()
        app.dependency_overrides.clear()
        Base.metadata.drop_all(engine)
        engine.dispose()


def _request(client, data, work_date, start, end, reason="Doctor appointment"):
    return client.post(
        "/api/v1/agent/shift-reschedules",
        headers=data["device_headers"],
        json={
            "work_date": work_date.isoformat(),
            "requested_start": start,
            "requested_end": end,
            "reason": reason,
        },
    )


def _code(response):
    return response.json()["error"]["code"]


# ---- validation ---------------------------------------------------------------


def test_employee_request_validation_rules(env):
    client, data = env
    target = TODAY + timedelta(days=3)

    notice = _request(client, data, TODAY + timedelta(days=1), "10:00", "18:00")
    assert notice.status_code == 422 and _code(notice) == "SHIFT_RESCHEDULE_NOTICE_PERIOD"

    length = _request(client, data, target, "10:00", "17:00")
    assert length.status_code == 422 and _code(length) == "SHIFT_RESCHEDULE_LENGTH_MISMATCH"

    midnight = _request(client, data, target, "20:00", "04:00")
    assert midnight.status_code == 422 and _code(midnight) == "SHIFT_RESCHEDULE_CROSSES_MIDNIGHT"

    off_day = _request(client, data, OFF_DAY, "10:00", "18:00")
    assert off_day.status_code == 422 and _code(off_day) == "SHIFT_RESCHEDULE_NOT_WORKING_DAY"

    unchanged = _request(client, data, target, "09:00", "17:00")
    assert unchanged.status_code == 422 and _code(unchanged) == "SHIFT_RESCHEDULE_UNCHANGED"

    earliest = _request(client, data, TODAY + timedelta(days=2), "10:00", "18:00")
    assert earliest.status_code == 200, earliest.text
    assert earliest.json()["data"]["status"] == "pending"
    assert earliest.json()["data"]["original_start"] == "09:00"

    ok = _request(client, data, target, "10:00", "18:00")
    assert ok.status_code == 200, ok.text
    duplicate = _request(client, data, target, "11:00", "19:00")
    assert duplicate.status_code == 409 and _code(duplicate) == "SHIFT_RESCHEDULE_DUPLICATE"

    # Cancelling a pending request frees the day again.
    cancel = client.post(
        f"/api/v1/agent/shift-reschedules/{ok.json()['data']['id']}/cancel",
        headers=data["device_headers"],
    )
    assert cancel.status_code == 200 and cancel.json()["data"]["status"] == "cancelled"
    again = _request(client, data, target, "11:00", "19:00")
    assert again.status_code == 200, again.text

    listing = client.get("/api/v1/agent/shift-reschedules", headers=data["device_headers"])
    assert listing.status_code == 200
    body = listing.json()["data"]
    assert body["policy"]["earliest_date"] == (TODAY + timedelta(days=2)).isoformat()
    assert {row["status"] for row in body["requests"]} == {"pending", "cancelled"}

    day = client.get(
        f"/api/v1/agent/shift-reschedules/day?date={target.isoformat()}",
        headers=data["device_headers"],
    )
    assert day.json()["data"]["shift_minutes"] == 480
    assert day.json()["data"]["scheduled_day"] is True


def test_request_not_allowed_on_approved_leave_day(env):
    client, data = env
    db = data["db"]
    target = TODAY + timedelta(days=3)
    db.add(LeaveRequest(
        company_id=data["company"].id, employee_id=data["employee"].id,
        start_date=target, end_date=target, requested_days=1, leave_type="annual",
        status="approved",
    ))
    db.commit()
    response = _request(client, data, target, "10:00", "18:00")
    assert response.status_code == 422 and _code(response) == "SHIFT_RESCHEDULE_ON_LEAVE"


# ---- review gating ------------------------------------------------------------


def test_only_super_admin_and_hr_can_review(env):
    client, data = env
    created = _request(client, data, TODAY + timedelta(days=3), "10:00", "18:00")
    request_id = created.json()["data"]["id"]
    for key in ("general", "leader"):
        listing = client.get("/api/v1/shift-reschedules", headers=data["headers"][key])
        assert listing.status_code == 403, key
        review = client.patch(
            f"/api/v1/shift-reschedules/{request_id}",
            headers=data["headers"][key],
            json={"status": "approved"},
        )
        assert review.status_code == 403, key

    self_review = client.patch(
        f"/api/v1/shift-reschedules/{request_id}",
        headers=data["headers"]["self_hr"],
        json={"status": "approved"},
    )
    assert self_review.status_code == 403 and _code(self_review) == "SELF_REVIEW_FORBIDDEN"

    no_reason = client.patch(
        f"/api/v1/shift-reschedules/{request_id}",
        headers=data["headers"]["hr"],
        json={"status": "rejected"},
    )
    assert no_reason.status_code == 422
    assert _code(no_reason) == "SHIFT_RESCHEDULE_REJECT_REASON_REQUIRED"

    for key in ("hr", "super"):
        listing = client.get(
            "/api/v1/shift-reschedules?status=pending", headers=data["headers"][key]
        )
        assert listing.status_code == 200, key
        assert [row["id"] for row in listing.json()["data"]] == [request_id]

    rejected = client.patch(
        f"/api/v1/shift-reschedules/{request_id}",
        headers=data["headers"]["super"],
        json={"status": "rejected", "review_reason": "Team is short that day"},
    )
    assert rejected.status_code == 200, rejected.text
    # The employee sees the reviewer's reason on the desktop.
    mine = client.get("/api/v1/agent/shift-reschedules", headers=data["device_headers"])
    row = mine.json()["data"]["requests"][0]
    assert row["status"] == "rejected"
    assert row["review_reason"] == "Team is short that day"
    # A rejected request leaves the normal shift in place.
    db = data["db"]
    db.expire_all()
    employee = db.get(Employee, data["employee"].id)
    schedule = effective_schedule(
        db, employee, employee.work_profile, TODAY + timedelta(days=3)
    )
    assert schedule["start_at"].time() == time(9, 0)
    assert db.scalar(select(WorkScheduleOverride.id)) is None


def test_approval_materializes_employee_override_seen_by_every_resolver(env):
    client, data = env
    db = data["db"]
    target = TODAY + timedelta(days=3)
    # A company-wide exception on that day must not beat the employee's
    # approved reschedule.
    db.add(WorkScheduleOverride(
        company_id=data["company"].id, scope="company", override_type="both",
        effective_date=target, permanent=False, shift_start=time(8, 0),
        shift_end=time(16, 0), break_rules=[], reason="Company early day",
        created_by_admin_user_id=data["admins"]["super"].id,
    ))
    db.commit()
    created = _request(client, data, target, "07:00", "15:00")
    assert created.status_code == 200, created.text
    assert created.json()["data"]["original_start"] == "08:00"

    approved = client.patch(
        f"/api/v1/shift-reschedules/{created.json()['data']['id']}",
        headers=data["headers"]["hr"],
        json={"status": "approved"},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["data"]["status"] == "approved"
    assert approved.json()["data"]["reviewed_by_name"] == "HR"

    db.expire_all()
    employee = db.get(Employee, data["employee"].id)
    profile = employee.work_profile
    single = effective_schedule(db, employee, profile, target)
    batch = effective_schedules_for_employees(db, [employee], target)[employee.id]
    ranged = effective_schedules_for_range(db, employee, profile, target, target)[target]
    for schedule in (single, batch, ranged):
        assert schedule["start_at"] == datetime.combine(target, time(7, 0), tzinfo=UTC)
        assert schedule["end_at"] == datetime.combine(target, time(15, 0), tzinfo=UTC)
        assert schedule["effective_source"] == "employee_exception"
    policy = resolve_day_policy(db, employee, profile, target)
    assert policy["shift_start"] == time(7, 0)
    assert policy["shift_end"] == time(15, 0)
    assert employee_required_daily_seconds(
        db, employee.id, datetime.combine(target, time(12, 0), tzinfo=UTC)
    ) == 8 * 3600

    audit_actions = [
        row.action for row in db.scalars(select(AuditLog)).all()
    ]
    assert "approved" in audit_actions

    # Pending cannot be re-reviewed; approved cannot be cancelled by the employee.
    cancel = client.post(
        f"/api/v1/agent/shift-reschedules/{created.json()['data']['id']}/cancel",
        headers=data["device_headers"],
    )
    assert cancel.status_code == 409


def test_break_kept_only_when_fully_inside_new_range(env):
    client, data = env
    db = data["db"]
    target = TODAY + timedelta(days=3)
    created = _request(client, data, target, "07:00", "15:00")
    client.patch(
        f"/api/v1/shift-reschedules/{created.json()['data']['id']}",
        headers=data["headers"]["hr"],
        json={"status": "approved"},
    )
    db.expire_all()
    override = db.scalar(select(WorkScheduleOverride))
    assert override.employee_id == data["employee"].id
    assert override.override_type == "both" and override.permanent is False
    # Lunch 13:00-13:30 is inside 07:00-15:00; the 16:30 break is dropped.
    assert [rule["name"] for rule in override.break_rules] == ["Lunch"]
    assert override.break_rules[0]["start_time"] == "13:00"


# ---- expiry -------------------------------------------------------------------


def test_pending_request_expires_when_its_day_starts(env):
    _client, data = env
    db = data["db"]
    employee = db.get(Employee, data["employee"].id)
    day = FIXED_DAY
    row = create_employee_request(
        db, employee=employee, work_date=day, requested_start=time(10, 0),
        requested_end=time(18, 0), reason="Travel",
        now=datetime.combine(day - timedelta(days=9), time(12), tzinfo=UTC),
    )
    db.commit()
    with pytest.raises(ApiError) as error:
        review_request(
            db, admin=data["admins"]["hr"], row=row, status="approved", review_reason=None,
            now=datetime.combine(day, time(0, 0, 1), tzinfo=UTC),
        )
    assert error.value.code == "SHIFT_RESCHEDULE_EXPIRED"
    assert expire_stale_requests(db, [row]) is True
    assert row.status == "expired"
    schedule = effective_schedule(db, employee, employee.work_profile, day)
    assert schedule["start_at"] == datetime.combine(day, time(9, 0), tzinfo=UTC)


# ---- classification -----------------------------------------------------------


def _worked_session(db, employee, device, start: datetime, end: datetime) -> WorkSession:
    session = WorkSession(
        company_id=employee.company_id, employee_id=employee.id, device_id=device.id,
        timezone="UTC", started_at=start, ended_at=end, status="ended",
        active_seconds=0, idle_seconds=0,
    )
    db.add(session)
    db.flush()
    db.add(ActivityEvent(
        company_id=employee.company_id, employee_id=employee.id, device_id=device.id,
        session_id=session.id, event_type="session_started", event_timestamp=start,
        idempotency_key=f"start-{uuid4().hex[:8]}",
    ))
    cursor = start
    while cursor < end:
        cursor = min(end, cursor + timedelta(minutes=5))
        db.add(ActivityEvent(
            company_id=employee.company_id, employee_id=employee.id, device_id=device.id,
            session_id=session.id, event_type="heartbeat", event_timestamp=cursor,
            payload={
                "status": "active",
                "active_seconds": int((cursor - start).total_seconds()),
                "idle_seconds": 0,
                "agent_version": "1.1.96",
            },
            idempotency_key=f"hb-{uuid4().hex[:8]}",
        ))
    db.flush()
    return session


def _approve_for(db, data, day, start, end):
    employee = db.get(Employee, data["employee"].id)
    row = create_employee_request(
        db, employee=employee, work_date=day, requested_start=start, requested_end=end,
        reason="Evening class", now=datetime.combine(day - timedelta(days=5), time(9), tzinfo=UTC),
    )
    review_request(
        db, admin=data["admins"]["hr"], row=row, status="approved", review_reason=None,
        now=datetime.combine(day - timedelta(days=4), time(9), tzinfo=UTC),
    )
    db.commit()
    return employee, row


def test_work_inside_new_range_is_normal_not_extra(env):
    _client, data = env
    db = data["db"]
    day = FIXED_DAY
    employee, _ = _approve_for(db, data, day, time(11, 0), time(19, 0))
    session = _worked_session(
        db, employee, data["device"],
        datetime.combine(day, time(11, 0), tzinfo=UTC),
        datetime.combine(day, time(19, 0), tzinfo=UTC),
    )
    sync_session_time_buckets(db, session, at=datetime.combine(day, time(19, 5), tzinfo=UTC))
    assert session.normal_seconds == 8 * 3600
    assert session.extra_seconds == 0
    row, _ = calculate_daily_attendance(
        db, employee=employee, work_date=day,
        now=datetime.combine(day, time(20), tzinfo=UTC),
    )
    assert row.scheduled_start_at.replace(tzinfo=UTC) == datetime.combine(day, time(11), tzinfo=UTC)
    assert row.recorded_overtime_seconds == 0
    assert row.raw_late_seconds == 0
    assert row.early_leave_seconds == 0


def test_working_old_hours_outside_new_range_is_extra(env):
    _client, data = env
    db = data["db"]
    day = FIXED_DAY
    employee, _ = _approve_for(db, data, day, time(11, 0), time(19, 0))
    session = _worked_session(
        db, employee, data["device"],
        datetime.combine(day, time(9, 0), tzinfo=UTC),
        datetime.combine(day, time(17, 0), tzinfo=UTC),
    )
    sync_session_time_buckets(db, session, at=datetime.combine(day, time(17, 5), tzinfo=UTC))
    assert session.normal_seconds == 6 * 3600
    assert session.extra_seconds == 2 * 3600


def test_rejected_request_keeps_normal_shift_classification(env):
    _client, data = env
    db = data["db"]
    day = FIXED_DAY
    employee = db.get(Employee, data["employee"].id)
    row = create_employee_request(
        db, employee=employee, work_date=day, requested_start=time(11, 0),
        requested_end=time(19, 0), reason="Evening class",
        now=datetime.combine(day - timedelta(days=9), time(9), tzinfo=UTC),
    )
    review_request(
        db, admin=data["admins"]["hr"], row=row, status="rejected",
        review_reason="Not this week", now=datetime.combine(day - timedelta(days=8), time(9), tzinfo=UTC),
    )
    db.commit()
    session = _worked_session(
        db, employee, data["device"],
        datetime.combine(day, time(9, 0), tzinfo=UTC),
        datetime.combine(day, time(17, 0), tzinfo=UTC),
    )
    sync_session_time_buckets(db, session, at=datetime.combine(day, time(17, 5), tzinfo=UTC))
    assert session.normal_seconds == 8 * 3600
    assert session.extra_seconds == 0


def test_emergency_today_reclassifies_already_recorded_work(env):
    _client, data = env
    db = data["db"]
    day = FIXED_DAY
    employee = db.get(Employee, data["employee"].id)
    session = _worked_session(
        db, employee, data["device"],
        datetime.combine(day, time(9, 0), tzinfo=UTC),
        datetime.combine(day, time(12, 0), tzinfo=UTC),
    )
    now = datetime.combine(day, time(12, 5), tzinfo=UTC)
    sync_session_time_buckets(db, session, at=now)
    calculate_daily_attendance(db, employee=employee, work_date=day, now=now)
    db.commit()
    assert session.normal_seconds == 3 * 3600

    row = create_emergency_reschedule(
        db, admin=data["admins"]["hr"], employee=employee, work_date=day,
        requested_start=time(11, 0), requested_end=time(19, 0),
        reason="Emergency cover", now=now,
    )
    db.commit()
    assert row.status == "approved" and row.source == "admin"
    assert row.created_by_admin_user_id == data["admins"]["hr"].id
    db.refresh(session)
    # 09:00-11:00 is now outside the shift; 11:00-12:00 is normal.
    assert session.normal_seconds == 1 * 3600
    assert session.extra_seconds == 2 * 3600
    attendance = db.scalar(
        select(DailyAttendance).where(
            DailyAttendance.employee_id == employee.id, DailyAttendance.work_date == day
        )
    )
    assert attendance.scheduled_start_at.replace(tzinfo=UTC) == datetime.combine(
        day, time(11), tzinfo=UTC
    )


def test_emergency_rejects_past_date(env):
    _client, data = env
    db = data["db"]
    employee = db.get(Employee, data["employee"].id)
    with pytest.raises(ApiError) as error:
        create_emergency_reschedule(
            db, admin=data["admins"]["hr"], employee=employee,
            work_date=FIXED_DAY - timedelta(days=1), requested_start=time(11),
            requested_end=time(19), reason="Too late",
            now=datetime.combine(FIXED_DAY, time(8), tzinfo=UTC),
        )
    assert error.value.code == "SHIFT_RESCHEDULE_PAST_DATE"


# ---- emergency over HTTP + desktop config -------------------------------------


def test_emergency_today_over_http_updates_attendance_and_desktop_config(env):
    client, data = env
    today = TODAY
    for key in ("general", "leader"):
        forbidden = client.post(
            "/api/v1/shift-reschedules/emergency",
            headers=data["headers"][key],
            json={
                "employee_id": str(data["employee"].id), "work_date": today.isoformat(),
                "requested_start": "10:00", "requested_end": "18:00", "reason": "Cover",
            },
        )
        assert forbidden.status_code == 403, key

    created = client.post(
        "/api/v1/shift-reschedules/emergency",
        headers=data["headers"]["super"],
        json={
            "employee_id": str(data["employee"].id), "work_date": today.isoformat(),
            "requested_start": "10:00", "requested_end": "18:00", "reason": "Urgent cover",
        },
    )
    assert created.status_code == 200, created.text
    body = created.json()["data"]
    assert body["status"] == "approved" and body["source"] == "admin"

    db = data["db"]
    db.expire_all()
    attendance = db.scalar(
        select(DailyAttendance).where(
            DailyAttendance.employee_id == data["employee"].id,
            DailyAttendance.work_date == today,
        )
    )
    assert attendance is not None
    assert attendance.scheduled_start_at.replace(tzinfo=UTC) == datetime.combine(
        today, time(10), tzinfo=UTC
    )

    config = client.get("/api/v1/agent/config", headers=data["device_headers"])
    assert config.status_code == 200, config.text
    policy = config.json()["data"]["request_policy"]
    assert policy["shift_start"] == "10:00"
    assert policy["shift_end"] == "18:00"
    # Both original breaks (13:00, 16:30) stay inside 10:00-18:00.
    assert [rule["start_time"] for rule in policy["break_rules"]] == ["13:00", "16:30"]

    duplicate = client.post(
        "/api/v1/shift-reschedules/emergency",
        headers=data["headers"]["hr"],
        json={
            "employee_id": str(data["employee"].id), "work_date": today.isoformat(),
            "requested_start": "11:00", "requested_end": "19:00", "reason": "Again",
        },
    )
    assert duplicate.status_code == 409
