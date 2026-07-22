from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

from starlette.requests import Request

from app.core.security import (
    create_employee_access_token,
    create_employee_handoff_token,
    create_jwt_token,
    decode_jwt_token,
    hash_password,
    verify_password,
)
from app.services.activity_timeline import local_today
from app.services.rate_limit import request_client_ip


def test_tokens_created_in_the_same_second_are_unique() -> None:
    subject = uuid4()
    company_id = uuid4()
    first = create_jwt_token(
        subject=subject,
        company_id=company_id,
        token_type="refresh",
        expires_delta=timedelta(days=1),
    )
    second = create_jwt_token(
        subject=subject,
        company_id=company_id,
        token_type="refresh",
        expires_delta=timedelta(days=1),
    )
    assert first != second


def test_password_hash_round_trip() -> None:
    password_hash = hash_password("ExamplePassword123!")

    assert password_hash != "ExamplePassword123!"
    assert verify_password("ExamplePassword123!", password_hash)
    assert not verify_password("wrong", password_hash)


def test_jwt_round_trip() -> None:
    admin_id = uuid4()
    company_id = uuid4()

    token = create_jwt_token(
        subject=admin_id,
        company_id=company_id,
        token_type="access",
        expires_delta=timedelta(minutes=5),
        extra_claims={"role": "general_admin"},
    )

    payload = decode_jwt_token(token)

    assert payload["sub"] == str(admin_id)
    assert payload["company_id"] == str(company_id)
    assert payload["type"] == "access"
    assert payload["role"] == "general_admin"


def test_employee_access_token_round_trip() -> None:
    employee_id = uuid4()
    company_id = uuid4()

    payload = decode_jwt_token(
        create_employee_access_token(employee_id=employee_id, company_id=company_id)
    )

    assert payload["sub"] == str(employee_id)
    assert payload["company_id"] == str(company_id)
    assert payload["type"] == "employee_access"


def test_employee_handoff_token_round_trip() -> None:
    employee_id = uuid4()
    company_id = uuid4()

    payload = decode_jwt_token(
        create_employee_handoff_token(employee_id=employee_id, company_id=company_id)
    )

    assert payload["sub"] == str(employee_id)
    assert payload["company_id"] == str(company_id)
    assert payload["type"] == "employee_handoff"
    assert payload["exp"] - payload["iat"] == 120


def test_local_today_uses_employee_timezone() -> None:
    now = datetime(2026, 7, 21, 22, 30, tzinfo=UTC)

    assert local_today("Africa/Cairo", now) == date(2026, 7, 22)
    assert local_today("invalid/timezone", now) == date(2026, 7, 21)


def test_rate_limit_ip_trusts_forwarded_header_only_from_known_proxy() -> None:
    proxied = Request(
        {
            "type": "http",
            "client": ("127.0.0.1", 1234),
            "headers": [(b"x-forwarded-for", b"203.0.113.10, 127.0.0.1")],
        }
    )
    direct = Request(
        {
            "type": "http",
            "client": ("203.0.113.20", 1234),
            "headers": [(b"x-forwarded-for", b"198.51.100.5")],
        }
    )

    assert request_client_ip(proxied) == "203.0.113.10"
    assert request_client_ip(direct) == "203.0.113.20"
