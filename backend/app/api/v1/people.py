import secrets
import string
from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.core.config import settings
from app.core.exceptions import ApiError
from app.core.responses import success_response
from app.core.security import hash_password
from app.database.session import get_db
from app.models import AdminUser, Employee, EmployeeInvitation, Team, TeamMember, TeamOwner
from app.schemas.admin import PersonInvitationCreate
from app.schemas.employee_portal import EmployeeInvitationAccept
from app.services.audit import record_audit_log
from app.services.email import (
    enqueue_admin_credentials_email,
    enqueue_employee_invitation_email,
    ensure_email_allowed,
)
from app.services.employee_invitations import (
    find_employee_invitation,
    invitation_status,
    issue_employee_invitation,
    revoke_other_pending_invitations,
    serialize_employee_invitation,
)
from app.services.permissions import is_full_admin, require_capability
from app.services.work_profiles import get_or_create_work_profile, refresh_profile_completed_at
from app.services.person_access import (
    archive_linked_person,
    person_state,
    restore_linked_person,
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
    require_capability(current_admin, "people.manage")
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
    if payload.kind in {"team_manager", "general_admin", "hr"} and admin is not None:
        raise ApiError("ADMIN_EMAIL_EXISTS", "An admin user with this email already exists.", 409)

    temporary_password: str | None = None
    employee_invitation: EmployeeInvitation | None = None
    raw_invitation_token: str | None = None
    track_as_employee = payload.kind in {"employee", "team_manager"} or payload.track_as_employee
    if track_as_employee and employee is None:
        employee = Employee(
            company_id=current_admin.company_id,
            name=payload.name.strip(),
            email=email,
            employee_code=f"EMP-{uuid4().hex[:8].upper()}",
            job_title=payload.job_title or ("Team Leader" if payload.kind == "team_manager" else None),
            timezone=payload.timezone,
            status="invited" if payload.kind == "employee" else "active",
            start_date=payload.start_date,
            annual_leave_days=payload.annual_leave_days,
        )
        db.add(employee)
        db.flush()

    if payload.kind in {"team_manager", "general_admin", "hr"}:
        temporary_password = generate_temporary_password()
        password_hash = hash_password(temporary_password)
        admin_role = "team_owner" if payload.kind == "team_manager" else payload.kind
        admin = AdminUser(
            company_id=current_admin.company_id,
            employee_id=employee.id if payload.kind == "team_manager" and employee else None,
            name=payload.name.strip(),
            email=email,
            password_hash=password_hash,
            role=admin_role,
            status="active",
            permission_mode="role",
            data_scope="assigned_teams" if payload.kind == "team_manager" else "company",
        )
        if employee is not None:
            employee.portal_password_hash = password_hash
            db.add(employee)
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
        if admin is not None:
            db.add(TeamOwner(team_id=team.id, admin_user_id=admin.id))

    if payload.kind == "employee" and employee is not None:
        profile = get_or_create_work_profile(db, employee)
        if payload.start_date is None:
            raise ApiError("START_DATE_REQUIRED", "Employee start date is required.", 400)
        if payload.work_profile is None:
            raise ApiError("WORK_PROFILE_REQUIRED", "Complete the employee schedule and salary before invitation.", 400)
        work_profile_changes = payload.work_profile.model_dump(exclude_unset=True, mode="json")
        for time_field in ("shift_start", "shift_end"):
            if time_field in work_profile_changes:
                work_profile_changes[time_field] = getattr(payload.work_profile, time_field)
        for key, value in work_profile_changes.items():
            setattr(profile, key, value)
        refresh_profile_completed_at(profile)
        employee_invitation, raw_invitation_token = issue_employee_invitation(db, employee)

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
        if employee_invitation is None or raw_invitation_token is None:
            raise RuntimeError("Employee invitation was not created.")
        email_queued = enqueue_employee_invitation_email(
            db,
            background_tasks,
            company_id=current_admin.company_id,
            to=email,
            name=payload.name,
            token=raw_invitation_token,
            expires_in_hours=settings.employee_invitation_expire_hours,
        )

    return success_response(
        data={
            "kind": payload.kind,
            "employee_id": str(employee.id) if employee else None,
            "admin_user_id": str(admin.id) if admin else None,
            "team_ids": [str(team.id) for team in teams],
            "track_as_employee": bool(employee is not None),
            "invitation": (
                serialize_employee_invitation(employee_invitation)
                if employee_invitation
                else None
            ),
            "email_queued": email_queued,
        }
    )


@router.get("/invitations/{token}")
def verify_employee_invitation(token: str, db: Annotated[Session, Depends(get_db)]):
    invitation = find_employee_invitation(db, token)
    if invitation is None:
        return success_response(data={"valid": False, "status": "invalid"})
    status = invitation_status(invitation)
    if status != "pending":
        return success_response(data={"valid": False, "status": status})
    employee = db.get(Employee, invitation.employee_id)
    if employee is None or employee.status != "invited":
        return success_response(data={"valid": False, "status": "invalid"})
    return success_response(
        data={
            "valid": True,
            "status": status,
            "name": employee.name,
            "email": employee.email,
            "kind": "employee",
            "expires_at": invitation.expires_at.isoformat(),
        }
    )


@router.post("/invitations/{token}")
def accept_employee_invitation(
    token: str,
    payload: EmployeeInvitationAccept,
    db: Annotated[Session, Depends(get_db)],
):
    invitation = find_employee_invitation(db, token, for_update=True)
    if invitation is None or invitation_status(invitation) != "pending":
        raise ApiError(
            "EMPLOYEE_INVITATION_INVALID",
            "This invitation link is invalid, expired, or already used.",
            400,
        )
    employee = db.get(Employee, invitation.employee_id)
    if employee is None or employee.status != "invited":
        raise ApiError(
            "EMPLOYEE_INVITATION_INVALID",
            "This invitation is not available.",
            400,
        )
    now = datetime.now(UTC)
    employee.portal_password_hash = hash_password(payload.password)
    employee.status = "active"
    invitation.accepted_at = now
    db.add_all([employee, invitation])
    db.commit()
    return success_response(
        data={
            "status": "accepted",
            "employee_id": str(employee.id),
        }
    )


@router.post("/invitations/{invitation_id}/resend")
def resend_employee_invitation(
    invitation_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_capability(current_admin, "people.manage")
    invitation = db.scalar(
        select(EmployeeInvitation).where(
            EmployeeInvitation.id == invitation_id,
            EmployeeInvitation.company_id == current_admin.company_id,
        )
    )
    employee = db.get(Employee, invitation.employee_id) if invitation else None
    if invitation is None or employee is None or employee.status != "invited":
        raise ApiError("EMPLOYEE_INVITATION_NOT_FOUND", "Invitation was not found.", 404)
    # Check the persistent cooldown before revoking the link the employee still has.
    ensure_email_allowed(db, to=employee.email, category="employee_invitation")
    new_invitation, raw_token = issue_employee_invitation(
        db, employee, revoke_existing=False
    )
    db.commit()
    email_queued = enqueue_employee_invitation_email(
        db,
        background_tasks,
        company_id=employee.company_id,
        to=employee.email,
        name=employee.name,
        token=raw_token,
        expires_in_hours=settings.employee_invitation_expire_hours,
    )
    if email_queued:
        revoke_other_pending_invitations(
            db, employee.id, keep_invitation_id=new_invitation.id
        )
        response_invitation = new_invitation
        action = "resent"
    else:
        # Preserve the link the employee already has when a new email cannot be queued.
        new_invitation.revoked_at = datetime.now(UTC)
        db.add(new_invitation)
        response_invitation = invitation
        action = "resend_failed"
    record_audit_log(
        db,
        current_admin,
        action,
        "employee_invitation",
        entity_id=new_invitation.id,
        entity_name=employee.email,
        details={"replaces_invitation_id": str(invitation.id)},
        request=request,
    )
    db.commit()
    return success_response(
        data={
            "invitation": serialize_employee_invitation(response_invitation),
            "email_queued": email_queued,
        }
    )


@router.post("/invitations/{invitation_id}/revoke")
def revoke_employee_invitation(
    invitation_id: UUID,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_capability(current_admin, "people.manage")
    invitation = db.scalar(
        select(EmployeeInvitation).where(
            EmployeeInvitation.id == invitation_id,
            EmployeeInvitation.company_id == current_admin.company_id,
        )
    )
    if invitation is None:
        raise ApiError("EMPLOYEE_INVITATION_NOT_FOUND", "Invitation was not found.", 404)
    if invitation_status(invitation) == "pending":
        invitation.revoked_at = datetime.now(UTC)
        db.add(invitation)
        record_audit_log(
            db,
            current_admin,
            "revoked",
            "employee_invitation",
            entity_id=invitation.id,
            request=request,
        )
        db.commit()
    return success_response(data=serialize_employee_invitation(invitation))


def resolve_person(
    db: Session,
    current_admin: AdminUser,
    person_type: Literal["admin", "employee"],
    person_id: UUID,
) -> tuple[AdminUser | None, Employee | None]:
    if person_type == "admin":
        admin = db.scalar(
            select(AdminUser).where(
                AdminUser.id == person_id,
                AdminUser.company_id == current_admin.company_id,
            )
        )
        if admin is None:
            raise ApiError("PERSON_NOT_FOUND", "Person was not found.", 404)
        employee = db.get(Employee, admin.employee_id) if admin.employee_id else None
        return admin, employee

    employee = db.scalar(
        select(Employee).where(
            Employee.id == person_id,
            Employee.company_id == current_admin.company_id,
        )
    )
    if employee is None:
        raise ApiError("PERSON_NOT_FOUND", "Person was not found.", 404)
    admin = db.scalar(
        select(AdminUser).where(
            AdminUser.company_id == current_admin.company_id,
            AdminUser.employee_id == employee.id,
        )
    )
    return admin, employee


@router.post("/{person_type}/{person_id}/archive")
def archive_person(
    person_type: Literal["admin", "employee"],
    person_id: UUID,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_capability(current_admin, "people.archive")
    admin, employee = resolve_person(db, current_admin, person_type, person_id)
    if admin is not None and admin.id == current_admin.id:
        raise ApiError("CANNOT_ARCHIVE_SELF", "You cannot archive your own account.", 409)
    if admin is not None and admin.status == "active" and is_full_admin(admin):
        other_full_admin = any(
            is_full_admin(item)
            for item in db.scalars(
                select(AdminUser).where(
                    AdminUser.company_id == current_admin.company_id,
                    AdminUser.status == "active",
                    AdminUser.id != admin.id,
                )
            ).all()
        )
        if not other_full_admin:
            raise ApiError(
                "LAST_FULL_ADMIN_REQUIRED",
                "The company must keep at least one active admin with full access.",
                409,
            )
    archive_linked_person(db, admin, employee)
    record_audit_log(
        db,
        current_admin,
        "archived",
        "person",
        entity_id=admin.id if admin else employee.id,
        entity_name=admin.email if admin else employee.email,
        details={"person_type": person_type},
        request=request,
    )
    db.commit()
    return success_response(data=person_state(admin, employee, person_type))


@router.post("/{person_type}/{person_id}/restore")
def restore_person(
    person_type: Literal["admin", "employee"],
    person_id: UUID,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_capability(current_admin, "people.archive")
    admin, employee = resolve_person(db, current_admin, person_type, person_id)
    restore_linked_person(db, admin, employee)
    record_audit_log(
        db,
        current_admin,
        "restored",
        "person",
        entity_id=admin.id if admin else employee.id,
        entity_name=admin.email if admin else employee.email,
        details={"person_type": person_type},
        request=request,
    )
    db.commit()
    return success_response(data=person_state(admin, employee, person_type))
