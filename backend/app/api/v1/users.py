from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.api.v1.team_auth import require_general_admin
from app.core.exceptions import ApiError
from app.core.responses import success_response
from app.core.security import hash_password
from app.database.session import get_db
from app.models import AdminUser, Employee, TeamOwner
from app.schemas.admin import AdminUserCreate, AdminUserUpdate
from app.services.audit import record_audit_log
from app.services.email import enqueue_admin_credentials_email, ensure_email_allowed

router = APIRouter(prefix="/users", tags=["admin-users"])


def assigned_team_ids(db: Session, admin_user_id: UUID) -> list[str]:
    rows = db.scalars(select(TeamOwner.team_id).where(TeamOwner.admin_user_id == admin_user_id)).all()
    return [str(team_id) for team_id in rows]


def serialize_admin_user(db: Session, admin: AdminUser) -> dict:
    return {
        "id": str(admin.id),
        "company_id": str(admin.company_id),
        "employee_id": str(admin.employee_id) if admin.employee_id else None,
        "name": admin.name,
        "email": admin.email,
        "role": admin.role,
        "status": admin.status,
        "assigned_team_ids": assigned_team_ids(db, admin.id),
        "created_at": admin.created_at.isoformat(),
        "updated_at": admin.updated_at.isoformat(),
    }


def team_owner_employee_identity(
    db: Session,
    *,
    company_id: UUID,
    name: str,
    email: str,
) -> Employee:
    employee = db.scalar(
        select(Employee).where(
            Employee.company_id == company_id,
            func.lower(Employee.email) == email.lower(),
        )
    )
    if employee is None:
        employee = Employee(
            company_id=company_id,
            name=name,
            email=email.lower(),
            employee_code=f"EMP-{uuid4().hex[:8].upper()}",
            department="Management",
            timezone="UTC",
            status="active",
        )
        db.add(employee)
        db.flush()
    return employee


def get_general_admin_or_404(db: Session, current_admin: AdminUser, admin_user_id: UUID) -> AdminUser:
    admin = db.scalar(
        select(AdminUser).where(
            AdminUser.id == admin_user_id,
            AdminUser.company_id == current_admin.company_id,
        )
    )
    if admin is None:
        raise ApiError("ADMIN_NOT_FOUND", "Admin user was not found.", 404)
    return admin


@router.get("")
def list_users(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_general_admin(current_admin)
    admins = db.scalars(
        select(AdminUser)
        .where(AdminUser.company_id == current_admin.company_id)
        .order_by(AdminUser.name)
    ).all()
    return success_response(data=[serialize_admin_user(db, admin) for admin in admins])


@router.post("")
def create_user(
    payload: AdminUserCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_general_admin(current_admin)
    email = payload.email.lower()
    if db.scalar(select(AdminUser.id).where(AdminUser.company_id == current_admin.company_id, AdminUser.email == email)):
        raise ApiError("ADMIN_EMAIL_EXISTS", "An admin user with this email already exists.", 409)

    admin = AdminUser(
        company_id=current_admin.company_id,
        name=payload.name,
        email=email,
        password_hash=hash_password(payload.password),
        role=payload.role,
        status=payload.status,
    )
    if payload.role == "team_owner":
        employee = team_owner_employee_identity(
            db,
            company_id=current_admin.company_id,
            name=payload.name,
            email=email,
        )
        admin.employee_id = employee.id
    db.add(admin)
    db.commit()
    db.refresh(admin)
    record_audit_log(
        db,
        current_admin,
        "created",
        "admin_user",
        entity_id=admin.id,
        entity_name=admin.email,
        details={"role": payload.role, "status": payload.status},
        request=request,
    )
    db.commit()
    # Email the new admin their sign-in details (best-effort; see services/email).
    enqueue_admin_credentials_email(
        db,
        background_tasks,
        company_id=current_admin.company_id,
        to=admin.email,
        name=admin.name,
        password=payload.password,
        is_reset=False,
    )
    return success_response(data=serialize_admin_user(db, admin))


@router.patch("/{admin_user_id}")
def update_user(
    admin_user_id: UUID,
    payload: AdminUserUpdate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_general_admin(current_admin)
    admin = get_general_admin_or_404(db, current_admin, admin_user_id)
    updates = payload.model_dump(exclude_unset=True)
    if "email" in updates and updates["email"] is not None:
        updates["email"] = updates["email"].lower()
        existing = db.scalar(
            select(AdminUser.id).where(
                AdminUser.company_id == current_admin.company_id,
                AdminUser.email == updates["email"],
                AdminUser.id != admin.id,
            )
        )
        if existing:
            raise ApiError("ADMIN_EMAIL_EXISTS", "An admin user with this email already exists.", 409)
    audit_updates = {key: value for key, value in updates.items() if key != "password" and value is not None}
    new_password = None
    if "password" in updates and updates["password"] is not None:
        ensure_email_allowed(db, to=admin.email, category="admin_password_reset")
        new_password = updates.pop("password")
        admin.password_hash = hash_password(new_password)
        audit_updates["password"] = "changed"
    for key, value in updates.items():
        if value is not None:
            setattr(admin, key, value)
    if admin.role == "team_owner" and admin.employee_id is None:
        employee = team_owner_employee_identity(
            db,
            company_id=admin.company_id,
            name=admin.name,
            email=admin.email,
        )
        admin.employee_id = employee.id
    db.add(admin)
    db.commit()
    db.refresh(admin)
    record_audit_log(
        db,
        current_admin,
        "updated",
        "admin_user",
        entity_id=admin.id,
        entity_name=admin.email,
        details=audit_updates,
        request=request,
    )
    db.commit()
    # If the password was changed, email the new one to the admin (best-effort).
    if new_password:
        enqueue_admin_credentials_email(
            db,
            background_tasks,
            company_id=current_admin.company_id,
            to=admin.email,
            name=admin.name,
            password=new_password,
            is_reset=True,
        )
    return success_response(data=serialize_admin_user(db, admin))


@router.delete("/{admin_user_id}")
def deactivate_user(
    admin_user_id: UUID,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_general_admin(current_admin)
    admin = get_general_admin_or_404(db, current_admin, admin_user_id)
    admin.status = "inactive"
    db.add(admin)
    db.commit()
    record_audit_log(
        db,
        current_admin,
        "deactivated",
        "admin_user",
        entity_id=admin.id,
        entity_name=admin.email,
        request=request,
    )
    db.commit()
    return success_response(data={"deactivated": True})
