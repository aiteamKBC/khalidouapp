from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session
import jwt

from app.api.deps import get_current_employee
from app.api.v1.admin_utils import serialize_employee
from app.core.exceptions import ApiError
from app.core.responses import success_response
from app.core.security import create_employee_access_token, decode_jwt_token, verify_password
from app.database.session import get_db
from app.models import AdminUser, Employee
from app.schemas.employee_portal import (
    EmployeePortalHandoff,
    EmployeePortalLogin,
    EmployeeProfileUpdate,
)
from app.services.person_access import ensure_tracked_employee
from app.services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/employee-auth", tags=["employee-auth"])


def validate_avatar(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    if not value.startswith(
        ("data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,")
    ):
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


@router.post("/login")
def login(payload: EmployeePortalLogin, request: Request, db: Annotated[Session, Depends(get_db)]):
    enforce_rate_limit(request, action="employee-login", limit=10, window_seconds=60)
    candidates = db.scalars(
        select(Employee).where(
            func.lower(Employee.email) == payload.email.lower(),
            Employee.status == "active",
            Employee.portal_password_hash.is_not(None),
        )
    ).all()
    employee = next(
        (
            candidate
            for candidate in candidates
            if (
                candidate.portal_password_hash
                and verify_password(payload.password, candidate.portal_password_hash)
            )
        ),
        None,
    )
    if employee is None:
        admin = db.scalar(
            select(AdminUser).where(
                func.lower(AdminUser.email) == payload.email.lower(),
                AdminUser.status == "active",
            )
        )
        if admin is not None and verify_password(payload.password, admin.password_hash):
            employee = ensure_tracked_employee(db, admin)

    if employee is None:
        raise ApiError(
            "INVALID_EMPLOYEE_LOGIN",
            "Email or employee password is incorrect.",
            401,
        )

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
        raise ApiError(
            "INVALID_EMPLOYEE_HANDOFF", "The dashboard link is invalid or expired.", 401
        ) from None

    if token_payload.get("type") != "employee_handoff":
        raise ApiError("INVALID_EMPLOYEE_HANDOFF", "The dashboard link is invalid or expired.", 401)

    try:
        employee_id = UUID(str(token_payload.get("sub")))
        company_id = UUID(str(token_payload.get("company_id")))
    except (TypeError, ValueError):
        raise ApiError(
            "INVALID_EMPLOYEE_HANDOFF", "The dashboard link is invalid or expired.", 401
        ) from None

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
