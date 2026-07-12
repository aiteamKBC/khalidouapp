import secrets
import string
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.api.v1.team_auth import require_general_admin
from app.core.exceptions import ApiError
from app.core.responses import success_response
from app.core.security import hash_password
from app.database.session import get_db
from app.models import AdminUser, Employee, Team, TeamMember, TeamOwner
from app.schemas.admin import PersonInvitationCreate
from app.services.audit import record_audit_log
from app.services.email import (
    enqueue_admin_credentials_email,
    enqueue_employee_invitation_email,
)


router = APIRouter(prefix="/people", tags=["people"])


def generate_temporary_password() -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%"
    return "".join(secrets.choice(alphabet) for _ in range(18))


@router.post("/invitations")
def invite_person(
    payload: PersonInvitationCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_general_admin(current_admin)
    email = payload.email.lower()
    if payload.kind in {"employee", "team_manager"} and not payload.team_ids:
        raise ApiError("TEAM_REQUIRED", "Employees and team managers need at least one team.", 400)

    teams = list(
        db.scalars(
            select(Team).where(
                Team.id.in_(payload.team_ids),
                Team.company_id == current_admin.company_id,
                Team.status == "active",
            )
        ).all()
    )
    if len(teams) != len(set(payload.team_ids)):
        raise ApiError("INVALID_TEAM", "One or more selected teams are not available.", 400)

    employee = db.scalar(
        select(Employee).where(
            Employee.company_id == current_admin.company_id,
            Employee.email == email,
        )
    )
    admin = db.scalar(
        select(AdminUser).where(
            AdminUser.company_id == current_admin.company_id,
            AdminUser.email == email,
        )
    )
    if payload.kind == "employee" and employee is not None:
        raise ApiError("EMPLOYEE_EMAIL_EXISTS", "An employee with this email already exists.", 409)
    if payload.kind in {"team_manager", "general_admin"} and admin is not None:
        raise ApiError("ADMIN_EMAIL_EXISTS", "An admin user with this email already exists.", 409)

    temporary_password: str | None = None
    if payload.kind in {"employee", "team_manager"} and employee is None:
        employee = Employee(
            company_id=current_admin.company_id,
            name=payload.name.strip(),
            email=email,
            employee_code=f"EMP-{uuid4().hex[:8].upper()}",
            department=payload.department or ("Management" if payload.kind == "team_manager" else None),
            timezone=payload.timezone,
            status="active",
        )
        db.add(employee)
        db.flush()

    if payload.kind in {"team_manager", "general_admin"}:
        temporary_password = generate_temporary_password()
        admin = AdminUser(
            company_id=current_admin.company_id,
            employee_id=employee.id if payload.kind == "team_manager" and employee else None,
            name=payload.name.strip(),
            email=email,
            password_hash=hash_password(temporary_password),
            role="team_owner" if payload.kind == "team_manager" else "general_admin",
            status="active",
        )
        db.add(admin)
        db.flush()

    for team in teams:
        if employee is not None:
            membership = db.scalar(
                select(TeamMember).where(
                    TeamMember.team_id == team.id,
                    TeamMember.employee_id == employee.id,
                )
            )
            if membership is None:
                db.add(TeamMember(team_id=team.id, employee_id=employee.id, status="active"))
            else:
                membership.status = "active"
                db.add(membership)
        if payload.kind == "team_manager" and admin is not None:
            db.add(TeamOwner(team_id=team.id, admin_user_id=admin.id))

    record_audit_log(
        db,
        current_admin,
        "invited",
        "person",
        entity_id=admin.id if admin else employee.id,
        entity_name=email,
        details={"kind": payload.kind, "team_ids": [str(team.id) for team in teams]},
        request=request,
    )
    db.commit()

    if admin is not None and temporary_password is not None:
        email_queued = enqueue_admin_credentials_email(
            db,
            background_tasks,
            company_id=current_admin.company_id,
            to=email,
            name=payload.name,
            password=temporary_password,
            is_reset=False,
        )
    else:
        email_queued = enqueue_employee_invitation_email(
            db,
            background_tasks,
            company_id=current_admin.company_id,
            to=email,
            name=payload.name,
        )

    return success_response(
        data={
            "kind": payload.kind,
            "employee_id": str(employee.id) if employee else None,
            "admin_user_id": str(admin.id) if admin else None,
            "team_ids": [str(team.id) for team in teams],
            "email_queued": email_queued,
        }
    )
