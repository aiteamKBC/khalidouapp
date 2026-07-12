from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import ApiError
from app.core.security import create_jwt_token, decode_jwt_token, hash_token, verify_password
from app.models import AdminRefreshToken, AdminUser


def authenticate_admin(db: Session, email: str, password: str) -> AdminUser:
    admin = db.scalar(select(AdminUser).where(AdminUser.email == email.lower()))
    if admin is None or admin.status != "active" or not verify_password(password, admin.password_hash):
        raise ApiError("INVALID_CREDENTIALS", "Invalid email or password.", 401)
    return admin


def create_admin_token_pair(db: Session, admin: AdminUser) -> dict[str, object]:
    access_delta = timedelta(minutes=settings.jwt_access_token_expire_minutes)
    refresh_delta = timedelta(days=settings.jwt_refresh_token_expire_days)

    access_token = create_jwt_token(
        subject=admin.id,
        company_id=admin.company_id,
        token_type="access",
        expires_delta=access_delta,
        extra_claims={"role": admin.role},
    )
    refresh_token = create_jwt_token(
        subject=admin.id,
        company_id=admin.company_id,
        token_type="refresh",
        expires_delta=refresh_delta,
    )

    db.add(
        AdminRefreshToken(
            company_id=admin.company_id,
            admin_user_id=admin.id,
            token_hash=hash_token(refresh_token),
            expires_at=datetime.now(UTC) + refresh_delta,
        )
    )
    db.commit()

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": int(access_delta.total_seconds()),
    }


def refresh_admin_tokens(db: Session, refresh_token: str) -> dict[str, object]:
    try:
        payload = decode_jwt_token(refresh_token)
    except jwt.PyJWTError:
        raise ApiError("UNAUTHORIZED", "Invalid or expired refresh token.", 401) from None

    if payload.get("type") != "refresh":
        raise ApiError("UNAUTHORIZED", "Invalid token type.", 401)

    token_record = db.scalar(
        select(AdminRefreshToken).where(AdminRefreshToken.token_hash == hash_token(refresh_token))
    )
    if token_record is None or token_record.revoked_at is not None:
        raise ApiError("UNAUTHORIZED", "Refresh token has been revoked.", 401)
    if token_record.expires_at <= datetime.now(UTC):
        raise ApiError("UNAUTHORIZED", "Refresh token has expired.", 401)

    admin = db.scalar(
        select(AdminUser).where(
            AdminUser.id == UUID(str(payload["sub"])),
            AdminUser.company_id == UUID(str(payload["company_id"])),
            AdminUser.status == "active",
        )
    )
    if admin is None:
        raise ApiError("UNAUTHORIZED", "Admin user is not active.", 401)

    token_record.revoked_at = datetime.now(UTC)
    db.add(token_record)
    db.commit()
    return create_admin_token_pair(db, admin)


def logout_admin(db: Session, refresh_token: str) -> None:
    token_record = db.scalar(
        select(AdminRefreshToken).where(AdminRefreshToken.token_hash == hash_token(refresh_token))
    )
    if token_record and token_record.revoked_at is None:
        token_record.revoked_at = datetime.now(UTC)
        db.add(token_record)
        db.commit()
