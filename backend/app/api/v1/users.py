from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.core.exceptions import ApiError
from app.core.responses import success_response
from app.core.security import hash_password
from app.database.session import get_db
from app.models import AdminUser, Employee, Team, TeamOwner
from app.schemas.admin import AdminAccessUpdate, AdminUserCreate, AdminUserUpdate
from app.services.audit import record_audit_log
from app.services.email import enqueue_admin_credentials_email, ensure_email_allowed
from app.services.permissions import (
    MANAGED_PERMISSION_KEYS,
    capabilities_for_admin,
    capabilities_for_role,
    is_full_admin,
    permission_catalog_payload,
    permission_overrides_for_admin,
    replace_permission_overrides,
    require_capability,
)
from app.services.person_access import (
    default_admin_job_title,
    disable_employee_tracking,
    ensure_employee_team_memberships,
    ensure_tracked_employee,
    sync_linked_employee_password,
)

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
        "job_title": admin.employee.job_title if admin.employee else None,
        "role": admin.role,
        "status": admin.status,
        "permission_mode": admin.permission_mode,
        "data_scope": admin.data_scope,
        "track_as_employee": bool(admin.employee_id and admin.employee and admin.employee.status == "active"),
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
    job_title: str | None = None,
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
            job_title=job_title or "Team leader",
            timezone="UTC",
            status="active",
        )
        db.add(employee)
        db.flush()
    elif job_title:
        employee.job_title = job_title
    return employee


def serialize_admin_access(db: Session, admin: AdminUser) -> dict:
    overrides = permission_overrides_for_admin(admin)
    return {
        "admin_user_id": str(admin.id),
        "role": admin.role,
        "permission_mode": admin.permission_mode,
        "data_scope": admin.data_scope,
        "base_permissions": sorted(capabilities_for_role(admin.role) & MANAGED_PERMISSION_KEYS),
        "permission_overrides": overrides,
        "effective_permissions": capabilities_for_admin(admin),
        "team_lead_team_ids": assigned_team_ids(db, admin.id),
        "track_as_employee": bool(
            admin.employee_id and admin.employee and admin.employee.status == "active"
        ),
        "tracked_employee_id": str(admin.employee_id) if admin.employee_id else None,
    }


def active_full_admins(db: Session, company_id: UUID, exclude_id: UUID | None = None) -> list[AdminUser]:
    statement = select(AdminUser).where(
        AdminUser.company_id == company_id,
        AdminUser.status == "active",
    )
    if exclude_id is not None:
        statement = statement.where(AdminUser.id != exclude_id)
    return [admin for admin in db.scalars(statement).all() if is_full_admin(admin)]


@router.get("/permissions/catalog")
def permission_catalog(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
):
    require_capability(current_admin, "access.manage")
    return success_response(data=permission_catalog_payload())


@router.get("/{admin_user_id}/access")
def get_user_access(
    admin_user_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_capability(current_admin, "access.manage")
    admin = get_general_admin_or_404(db, current_admin, admin_user_id)
    return success_response(data=serialize_admin_access(db, admin))


@router.patch("/{admin_user_id}/access")
def update_user_access(
    admin_user_id: UUID,
    payload: AdminAccessUpdate,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_capability(current_admin, "access.manage")
    admin = get_general_admin_or_404(db, current_admin, admin_user_id)
    was_full_admin = admin.status == "active" and is_full_admin(admin)
    changes = payload.model_dump(exclude_unset=True)

    if payload.role is not None:
        admin.role = payload.role
    if payload.permission_mode is not None:
        admin.permission_mode = payload.permission_mode
    if payload.data_scope is not None:
        admin.data_scope = payload.data_scope
    if payload.permission_overrides is not None:
        replace_permission_overrides(db, admin, payload.permission_overrides)

    requested_team_ids = payload.team_lead_team_ids
    if requested_team_ids is not None:
        unique_team_ids = list(dict.fromkeys(requested_team_ids))
        teams = list(
            db.scalars(
                select(Team).where(
                    Team.id.in_(unique_team_ids),
                    Team.company_id == current_admin.company_id,
                    Team.status == "active",
                )
            ).all()
        )
        if len(teams) != len(unique_team_ids):
            raise ApiError("INVALID_TEAM", "One or more selected teams are not available.", 400)
        db.execute(delete(TeamOwner).where(TeamOwner.admin_user_id == admin.id))
        for team_id in unique_team_ids:
            db.add(TeamOwner(team_id=team_id, admin_user_id=admin.id))
    else:
        unique_team_ids = [UUID(item) for item in assigned_team_ids(db, admin.id)]

    if admin.role == "team_owner" and not unique_team_ids:
        raise ApiError("TEAM_REQUIRED", "A Team Manager needs at least one team.", 400)
    if admin.role == "team_owner" and payload.track_as_employee is False:
        raise ApiError(
            "TEAM_MANAGER_TRACKING_REQUIRED",
            "A Team Manager must remain enabled for employee tracking.",
            400,
        )

    should_track = payload.track_as_employee
    if admin.role == "team_owner":
        should_track = True
    if should_track is True:
        employee = ensure_tracked_employee(db, admin)
        ensure_employee_team_memberships(db, employee, unique_team_ids)
    elif should_track is False and admin.employee_id:
        employee = db.get(Employee, admin.employee_id)
        if employee is not None:
            disable_employee_tracking(db, employee)

    db.add(admin)
    db.flush()
    if was_full_admin and not is_full_admin(admin) and not active_full_admins(
        db, admin.company_id, exclude_id=admin.id
    ):
        raise ApiError(
            "LAST_FULL_ADMIN_REQUIRED",
            "The company must keep at least one active admin with full access.",
            409,
        )

    record_audit_log(
        db,
        current_admin,
        "access_updated",
        "admin_user",
        entity_id=admin.id,
        entity_name=admin.email,
        details={
            key: ([str(item) for item in value] if key == "team_lead_team_ids" and value is not None else value)
            for key, value in changes.items()
        },
        request=request,
    )
    db.commit()
    db.refresh(admin)
    return success_response(data=serialize_admin_access(db, admin))


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
    require_capability(current_admin, "access.manage")
    admins = db.scalars(
        select(AdminUser)
        .where(
            AdminUser.company_id == current_admin.company_id,
            AdminUser.status != "deleted",
        )
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
    require_capability(current_admin, "access.manage")
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
        permission_mode="role",
        data_scope="company" if payload.role in {"general_admin", "hr"} else "assigned_teams",
    )
    employee = team_owner_employee_identity(
        db,
        company_id=current_admin.company_id,
        name=payload.name,
        email=email,
        job_title=payload.job_title or default_admin_job_title(admin),
    )
    admin.employee_id = employee.id
    employee.portal_password_hash = admin.password_hash
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
    require_capability(current_admin, "access.manage")
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
    job_title_update = updates.pop("job_title", None)
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
            job_title=job_title_update,
        )
        admin.employee_id = employee.id
    if admin.role == "team_owner":
        admin.data_scope = "assigned_teams"
        employee = ensure_tracked_employee(db, admin)
        employee.portal_password_hash = admin.password_hash
    elif admin.role == "hr":
        admin.data_scope = "company"
        employee = ensure_tracked_employee(db, admin)
    else:
        employee = ensure_tracked_employee(db, admin)
    if job_title_update is not None:
        employee.job_title = job_title_update or default_admin_job_title(admin)
        db.add(employee)
    elif new_password and admin.employee_id:
        sync_linked_employee_password(admin)
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
    require_capability(current_admin, "people.archive")
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
