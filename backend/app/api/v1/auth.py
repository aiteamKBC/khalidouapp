import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.core.config import settings
from app.core.responses import success_response
from app.database.session import get_db
from app.models import AdminPasswordResetToken, AdminRefreshToken, AdminUser, TeamOwner
from app.schemas.auth import (
    ForgotPasswordRequest,
    LoginRequest,
    LogoutRequest,
    PasswordChange,
    PasswordResetConfirm,
    ProfileUpdate,
    RefreshRequest,
)
from app.core.exceptions import ApiError
from app.core.security import hash_password, hash_token, verify_password
from app.services.email import enqueue_admin_password_reset_link_email, ensure_email_allowed
from app.services.admin_auth import (
    authenticate_admin,
    create_admin_token_pair,
    logout_admin,
    refresh_admin_tokens,
)
from app.services.audit import record_audit_log
from app.services.permissions import capabilities_for_admin

router = APIRouter(prefix="/auth", tags=["admin-auth"])


def validate_avatar(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    if not value.startswith(("data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,")):
        raise ApiError("INVALID_AVATAR", "Profile photo must be a JPEG, PNG, or WebP image.", 400)
    return value


@router.post("/login")
def login(payload: LoginRequest, request: Request, db: Annotated[Session, Depends(get_db)]):
    admin = authenticate_admin(db, payload.email, payload.password)
    tokens = create_admin_token_pair(db, admin)
    record_audit_log(
        db,
        admin,
        "logged_in",
        "admin_user",
        entity_id=admin.id,
        entity_name=admin.email,
        request=request,
    )
    db.commit()
    return success_response(data=tokens)


@router.post("/refresh")
def refresh(payload: RefreshRequest, db: Annotated[Session, Depends(get_db)]):
    return success_response(data=refresh_admin_tokens(db, payload.refresh_token))


@router.post("/logout")
def logout(payload: LogoutRequest, db: Annotated[Session, Depends(get_db)]):
    logout_admin(db, payload.refresh_token)
    return success_response(data={"logged_out": True})


@router.get("/me")
def me(current_admin: Annotated[AdminUser, Depends(get_current_admin)], db: Annotated[Session, Depends(get_db)]):
    assigned_team_ids = db.scalars(
        select(TeamOwner.team_id).where(TeamOwner.admin_user_id == current_admin.id)
    ).all()
    return success_response(
        data={
            "id": str(current_admin.id),
            "company_id": str(current_admin.company_id),
            "employee_id": str(current_admin.employee_id) if current_admin.employee_id else None,
            "name": current_admin.name,
            "email": current_admin.email,
            "role": current_admin.role,
            "permissions": capabilities_for_admin(current_admin),
            "status": current_admin.status,
            "avatar_url": current_admin.avatar_url,
            "assigned_team_ids": [str(team_id) for team_id in assigned_team_ids],
        }
    )


@router.patch("/me")
def update_me(
    payload: ProfileUpdate,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes:
        current_admin.name = changes["name"].strip()
    if "avatar_url" in changes:
        current_admin.avatar_url = validate_avatar(changes["avatar_url"])
    db.add(current_admin)
    db.commit()
    return me(current_admin, db)


@router.post("/change-password")
def change_password(
    payload: PasswordChange,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    if not verify_password(payload.current_password, current_admin.password_hash):
        raise ApiError("CURRENT_PASSWORD_INVALID", "The current password is incorrect.", 400)
    if verify_password(payload.new_password, current_admin.password_hash):
        raise ApiError("PASSWORD_UNCHANGED", "Choose a different password.", 400)

    now = datetime.now(UTC)
    current_admin.password_hash = hash_password(payload.new_password)
    db.execute(
        update(AdminRefreshToken)
        .where(
            AdminRefreshToken.admin_user_id == current_admin.id,
            AdminRefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    db.add(current_admin)
    db.commit()
    return success_response(data={"password_changed": True})


@router.post("/forgot-password")
def forgot_password(
    payload: ForgotPasswordRequest,
    background_tasks: BackgroundTasks,
    db: Annotated[Session, Depends(get_db)],
):
    admin = db.scalar(
        select(AdminUser).where(func.lower(AdminUser.email) == payload.email.lower(), AdminUser.status == "active")
    )
    if admin is not None:
        ensure_email_allowed(db, to=admin.email, category="admin_password_reset")
        raw_token = secrets.token_urlsafe(48)
        now = datetime.now(UTC)
        db.execute(
            update(AdminPasswordResetToken)
            .where(
                AdminPasswordResetToken.admin_user_id == admin.id,
                AdminPasswordResetToken.used_at.is_(None),
            )
            .values(used_at=now)
        )
        db.add(
            AdminPasswordResetToken(
                company_id=admin.company_id,
                admin_user_id=admin.id,
                token_hash=hash_token(raw_token),
                expires_at=now + timedelta(minutes=settings.password_reset_expire_minutes),
            )
        )
        db.commit()
        enqueue_admin_password_reset_link_email(
            db,
            background_tasks,
            company_id=admin.company_id,
            to=admin.email,
            name=admin.name,
            token=raw_token,
            expires_in_minutes=settings.password_reset_expire_minutes,
        )
    return success_response(data={"message": "If the account exists, reset instructions were sent."})


@router.post("/reset-password")
def reset_password(payload: PasswordResetConfirm, db: Annotated[Session, Depends(get_db)]):
    now = datetime.now(UTC)
    token = db.scalar(
        select(AdminPasswordResetToken).where(
            AdminPasswordResetToken.token_hash == hash_token(payload.token),
            AdminPasswordResetToken.used_at.is_(None),
        )
    )
    expires_at = token.expires_at if token else None
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if token is None or expires_at is None or expires_at <= now:
        raise ApiError(
            "PASSWORD_RESET_TOKEN_INVALID",
            "This password reset link is invalid or expired.",
            400,
        )
    admin = db.get(AdminUser, token.admin_user_id)
    if admin is None or admin.status != "active":
        raise ApiError("PASSWORD_RESET_TOKEN_INVALID", "This account is not available.", 400)
    admin.password_hash = hash_password(payload.new_password)
    token.used_at = now
    db.execute(
        update(AdminRefreshToken)
        .where(
            AdminRefreshToken.admin_user_id == admin.id,
            AdminRefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    db.add_all([admin, token])
    db.commit()
    return success_response(data={"password_reset": True})
