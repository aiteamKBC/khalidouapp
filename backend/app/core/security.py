from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Any
from uuid import UUID, uuid4

import jwt
from passlib.context import CryptContext

from app.core.config import settings

password_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return password_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return password_context.verify(password, password_hash)


def hash_token(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def create_jwt_token(
    *,
    subject: UUID | str,
    company_id: UUID | str,
    token_type: str,
    expires_delta: timedelta,
    extra_claims: dict[str, Any] | None = None,
) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": str(subject),
        "company_id": str(company_id),
        "type": token_type,
        "jti": uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + expires_delta).timestamp()),
    }
    if extra_claims:
        payload.update(extra_claims)

    return jwt.encode(payload, settings.jwt_secret_key, algorithm="HS256")


def decode_jwt_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.jwt_secret_key, algorithms=["HS256"])


def create_device_token(
    *,
    device_id: UUID | str,
    company_id: UUID | str,
    employee_id: UUID | str,
    expires_delta: timedelta | None = None,
) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": str(device_id),
        "company_id": str(company_id),
        "employee_id": str(employee_id),
        "type": "device",
        "iat": int(now.timestamp()),
    }
    if expires_delta is not None:
        payload["exp"] = int((now + expires_delta).timestamp())

    return jwt.encode(payload, settings.device_token_secret, algorithm="HS256")


def decode_device_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.device_token_secret, algorithms=["HS256"])


def create_employee_access_token(*, employee_id: UUID | str, company_id: UUID | str) -> str:
    return create_jwt_token(
        subject=employee_id,
        company_id=company_id,
        token_type="employee_access",
        expires_delta=timedelta(hours=12),
    )


def create_employee_handoff_token(*, employee_id: UUID | str, company_id: UUID | str) -> str:
    return create_jwt_token(
        subject=employee_id,
        company_id=company_id,
        token_type="employee_handoff",
        expires_delta=timedelta(minutes=2),
    )
