from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

import secrets

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session
import jwt

from app.api.deps import get_current_employee
from app.api.v1.admin_utils import serialize_employee
from app.core.exceptions import ApiError
from app.core.responses import success_response
from app.core.security import create_employee_access_token, decode_jwt_token, hash_password, verify_password
from app.database.session import get_db
from app.models import Employee
from app.schemas.employee_portal import (
    EmployeeForgotAccessRequest,
    EmployeePortalHandoff,
    EmployeePortalLogin,
    EmployeeProfileUpdate,
)
from app.services.email import enqueue_portal_key_email, ensure_email_allowed

router = APIRouter(prefix="/employee-auth", tags=["employee-auth"])


def generate_portal_key() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "KHW-" + "".join(secrets.choice(alphabet) for _ in range(16))


def validate_avatar(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    if not value.startswith(("data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,")):
        raise ApiError("INVALID_AVATAR", "Profile photo must be a JPEG, PNG, or WebP image.", 400)
    return value


def employee_login_response(employee: Employee) -> dict:
    return {
        "access_token": create_employee_access_token(
            employee_id=employee.id,
            company_id=employee.company_id,
        ),
        "token_type": "bearer",
        "expires_in_seconds": 12 * 60 * 60,
        "employee": serialize_employee(employee),
    }


def record_employee_portal_login(employee: Employee, request: Request, db: Session) -> None:
    employee.portal_last_login_at = datetime.now(UTC)
    employee.portal_last_login_ip = request.client.host if request.client else None
    employee.portal_last_user_agent = request.headers.get("user-agent", "")[:512] or None
    db.add(employee)
    db.commit()


def normalize_portal_access_key(value: str) -> str:
    return "".join(value.split()).upper()


@router.post("/login")
def login(payload: EmployeePortalLogin, request: Request, db: Annotated[Session, Depends(get_db)]):
    normalized_access_key = normalize_portal_access_key(payload.access_key)
    candidates = db.scalars(
        select(Employee).where(
            func.lower(Employee.email) == payload.email.lower(),
            Employee.status == "active",
            Employee.portal_access_key_hash.is_not(None),
        )
    ).all()
    employee = next(
        (
            candidate
            for candidate in candidates
            if candidate.portal_access_key_hash
            and verify_password(normalized_access_key, candidate.portal_access_key_hash)
        ),
        None,
    )
    if employee is None:
        raise ApiError("INVALID_EMPLOYEE_LOGIN", "Email or employee access key is incorrect.", 401)

    record_employee_portal_login(employee, request, db)
    return success_response(data=employee_login_response(employee))


@router.post("/device-handoff")
def device_handoff(
    payload: EmployeePortalHandoff,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
):
    try:
        token_payload = decode_jwt_token(payload.handoff_token)
    except jwt.PyJWTError:
        raise ApiError("INVALID_EMPLOYEE_HANDOFF", "The dashboard link is invalid or expired.", 401) from None

    if token_payload.get("type") != "employee_handoff":
        raise ApiError("INVALID_EMPLOYEE_HANDOFF", "The dashboard link is invalid or expired.", 401)

    try:
        employee_id = UUID(str(token_payload.get("sub")))
        company_id = UUID(str(token_payload.get("company_id")))
    except ValueError:
        raise ApiError("INVALID_EMPLOYEE_HANDOFF", "The dashboard link is invalid or expired.", 401) from None

    employee = db.scalar(
        select(Employee).where(
            Employee.id == employee_id,
            Employee.company_id == company_id,
            Employee.status == "active",
        )
    )
    if employee is None:
        raise ApiError("INVALID_EMPLOYEE_HANDOFF", "The employee account is not active.", 401)

    record_employee_portal_login(employee, request, db)
    return success_response(data=employee_login_response(employee))


@router.get("/me")
def me(current_employee: Annotated[Employee, Depends(get_current_employee)]):
    return success_response(data=serialize_employee(current_employee))


@router.patch("/me")
def update_me(
    payload: EmployeeProfileUpdate,
    current_employee: Annotated[Employee, Depends(get_current_employee)],
    db: Annotated[Session, Depends(get_db)],
):
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes:
        current_employee.name = changes["name"].strip()
    if "avatar_url" in changes:
        current_employee.avatar_url = validate_avatar(changes["avatar_url"])
    db.add(current_employee)
    db.commit()
    db.refresh(current_employee)
    return success_response(data=serialize_employee(current_employee))


@router.post("/forgot-access-key")
def forgot_access_key(
    payload: EmployeeForgotAccessRequest,
    background_tasks: BackgroundTasks,
    db: Annotated[Session, Depends(get_db)],
):
    employee = db.scalar(
        select(Employee).where(
            func.lower(Employee.email) == payload.email.lower(),
            Employee.status == "active",
        )
    )
    if employee is not None:
        ensure_email_allowed(db, to=employee.email, category="employee_portal_key")
        key = generate_portal_key()
        employee.portal_access_key_hash = hash_password(key)
        employee.portal_access_key_hint = f"{key[:8]}..."
        db.add(employee)
        db.commit()
        enqueue_portal_key_email(
            db,
            background_tasks,
            company_id=employee.company_id,
            to=employee.email,
            name=employee.name,
            access_key=key,
        )
    return success_response(data={"message": "If the account exists, a new access key was sent."})
