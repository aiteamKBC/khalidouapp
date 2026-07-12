from datetime import timedelta
from uuid import uuid4

from app.core.security import (
    create_employee_access_token,
    create_employee_handoff_token,
    create_jwt_token,
    decode_jwt_token,
    hash_password,
    verify_password,
)


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
