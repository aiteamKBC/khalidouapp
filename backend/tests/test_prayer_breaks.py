"""Breaks anchored to the daily Dhuhr and Asr adhan."""

import importlib.util
from datetime import UTC, date, datetime, time
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.exceptions import ApiError
from app.database.base import Base
from app.models import Company, Employee, EmployeeWorkProfile
from app.schemas.admin import BreakRule
from app.services.prayer_times import prayer_times, resolve_break_rules
from app.services.schedules import effective_schedule
from app.services.work_profiles import (
    DEFAULT_BREAK_RULES,
    resolve_day_policy,
    validate_break_rules,
)

CAIRO = "Africa/Cairo"
PRAYER_BREAKS = [
    {"name": "Lunch", "minutes": 30, "paid": True, "anchor": "dhuhr"},
    {"name": "Short break", "minutes": 15, "paid": True, "anchor": "asr"},
]


@pytest.mark.parametrize(
    ("day", "dhuhr", "asr"),
    [
        # Egyptian General Authority of Survey timetable for Tanta, +-1 minute.
        (date(2026, 1, 1), time(12, 0), time(14, 47)),
        (date(2026, 6, 21), time(12, 58), time(16, 35)),
        (date(2026, 12, 21), time(11, 55), time(14, 41)),
    ],
)
def test_tanta_prayer_times_match_the_published_timetable(day, dhuhr, asr):
    times = prayer_times(day, CAIRO)

    def minutes(value: time) -> int:
        return value.hour * 60 + value.minute

    assert abs(minutes(times["dhuhr"]) - minutes(dhuhr)) <= 1
    assert abs(minutes(times["asr"]) - minutes(asr)) <= 1


def test_anchored_breaks_move_with_the_prayer_through_the_year():
    winter = resolve_break_rules(PRAYER_BREAKS, date(2026, 1, 1), CAIRO)
    summer = resolve_break_rules(PRAYER_BREAKS, date(2026, 6, 21), CAIRO)
    assert winter[0]["start_time"] == prayer_times(date(2026, 1, 1), CAIRO)["dhuhr"].strftime("%H:%M")
    assert winter[0]["start_time"] != summer[0]["start_time"]
    for rules in (winter, summer):
        lunch, short = rules
        assert _length(lunch) == 30
        assert _length(short) == 15
        assert lunch["anchor"] == "dhuhr" and short["anchor"] == "asr"


def test_fixed_breaks_are_unchanged():
    fixed = [{"name": "Lunch", "minutes": 30, "paid": True, "start_time": "13:00", "end_time": "13:30"}]
    assert resolve_break_rules(fixed, date(2026, 6, 21), CAIRO) == fixed


def test_anchored_breaks_validate_without_clock_times():
    validate_break_rules(PRAYER_BREAKS, shift_start=time(10), shift_end=time(18))
    with pytest.raises(ApiError):
        validate_break_rules([{"name": "Bad", "minutes": 0, "anchor": "asr"}])


def test_schema_drops_clock_times_from_anchored_breaks():
    rule = BreakRule(name="Lunch", minutes=30, paid=True, anchor="dhuhr", start_time=time(13))
    assert rule.start_time is None and rule.end_time is None
    assert BreakRule(name="Fixed", minutes=15, start_time=time(16), end_time=time(16, 15)).anchor == "fixed"


def test_new_profiles_default_to_prayer_breaks():
    assert [rule["anchor"] for rule in DEFAULT_BREAK_RULES] == ["dhuhr", "asr"]


def test_schedule_and_day_policy_use_that_days_prayer_times():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    company = Company(name="Prayer Co", status="active")
    db.add(company)
    db.flush()
    employee = Employee(
        company_id=company.id, name="Prayer Employee", email="prayer@example.com",
        employee_code="PR-1", timezone=CAIRO, status="active",
    )
    db.add(employee)
    db.flush()
    profile = EmployeeWorkProfile(
        company_id=company.id, employee_id=employee.id,
        shift_start=time(10), shift_end=time(18), working_days=list(range(7)),
        weekly_off_days=[], required_daily_minutes=480, break_rules=PRAYER_BREAKS,
        late_grace_minutes=15,
    )
    db.add(profile)
    db.commit()

    day = date(2026, 6, 21)
    times = prayer_times(day, CAIRO)
    schedule = effective_schedule(db, employee, profile, day)
    lunch, short = schedule["breaks"]
    assert lunch["seconds"] == 30 * 60 and short["seconds"] == 15 * 60
    assert lunch["start_at"] == _local(day, times["dhuhr"])
    assert short["start_at"] == _local(day, times["asr"])

    policy = resolve_day_policy(db, employee, profile, day)
    assert [rule["start_time"] for rule in policy["break_rules"]] == [
        times["dhuhr"].strftime("%H:%M"),
        times["asr"].strftime("%H:%M"),
    ]


def test_migration_converts_only_the_standard_breaks():
    path = Path(__file__).resolve().parents[1] / "alembic/versions/20260923_000060_prayer_anchored_breaks.py"
    spec = importlib.util.spec_from_file_location("prayer_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    converted = module._anchor_rules(
        [
            {"name": "Lunch", "minutes": 30, "paid": True, "start_time": "13:00:00", "end_time": "13:30:00"},
            {"name": "Short break", "minutes": 15, "paid": True, "start_time": "16:45:00", "end_time": "17:00:00"},
            {"name": "Tea", "minutes": 10, "paid": False, "start_time": "11:00", "end_time": "11:10"},
        ]
    )
    assert [rule.get("anchor") for rule in converted] == ["dhuhr", "asr", None]
    assert "start_time" not in converted[0]
    assert module._anchor_rules([{"name": "Night", "minutes": 30, "start_time": "02:00"}]) is None
    restored = module._fix_rules(converted)
    assert restored[0]["start_time"] == "13:00" and "anchor" not in restored[0]


def _length(rule: dict) -> int:
    start = datetime.strptime(rule["start_time"], "%H:%M")
    end = datetime.strptime(rule["end_time"], "%H:%M")
    return int((end - start).total_seconds() // 60)


def _local(day: date, clock: time) -> datetime:
    from zoneinfo import ZoneInfo

    return datetime.combine(day, clock, tzinfo=ZoneInfo(CAIRO)).astimezone(UTC)


def test_prayer_times_endpoint_lists_each_day():
    from datetime import timedelta

    from fastapi.testclient import TestClient

    from app.core.security import create_jwt_token
    from app.database.session import get_db
    from app.main import app
    from app.models import AdminUser

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    db = factory()
    company = Company(name="Prayer API Co", status="active")
    db.add(company)
    db.flush()
    admin = AdminUser(
        company_id=company.id, name="HR", email="hr-prayer@example.com", password_hash="x",
        role="hr", status="active", data_scope="company",
    )
    db.add(admin)
    db.commit()

    def override_get_db():
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        token = create_jwt_token(
            subject=admin.id, company_id=admin.company_id, token_type="access",
            expires_delta=timedelta(minutes=30), extra_claims={"role": admin.role},
        )
        response = TestClient(app).get(
            "/api/v1/employees/prayer-times",
            params={"start_date": "2026-06-21", "days": 2},
            headers={"Authorization": f"Bearer {token}"},
        )
    finally:
        app.dependency_overrides.pop(get_db, None)
    assert response.status_code == 200, response.text
    rows = response.json()["data"]
    assert [row["date"] for row in rows] == ["2026-06-21", "2026-06-22"]
    assert rows[0]["dhuhr"] == prayer_times(date(2026, 6, 21), CAIRO)["dhuhr"].strftime("%H:%M")
