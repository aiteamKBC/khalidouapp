"""Recipients and email notifications for employee approval requests."""

from dataclasses import dataclass, field
from uuid import UUID

from fastapi import BackgroundTasks
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import AdminUser, Employee, Team, TeamMember, TeamOwner
from app.services.email import enqueue_email_once
from app.services.email_templates import request_review_email


@dataclass
class RequestRecipient:
    admin_id: UUID
    name: str
    email: str
    role: str
    team_names: set[str] = field(default_factory=set)


def employee_manager_summaries(
    db: Session,
    employee_ids: list[UUID],
) -> dict[UUID, list[dict[str, object]]]:
    """Return deduplicated active team managers for each employee."""
    result: dict[UUID, dict[UUID, dict[str, object]]] = {
        employee_id: {} for employee_id in employee_ids
    }
    if not employee_ids:
        return {}
    rows = db.execute(
        select(
            TeamMember.employee_id,
            Team.id,
            Team.name,
            AdminUser.id,
            AdminUser.name,
            AdminUser.email,
        )
        .join(Team, Team.id == TeamMember.team_id)
        .join(TeamOwner, TeamOwner.team_id == Team.id)
        .join(AdminUser, AdminUser.id == TeamOwner.admin_user_id)
        .where(
            TeamMember.employee_id.in_(employee_ids),
            TeamMember.status == "active",
            Team.status == "active",
            AdminUser.status == "active",
            AdminUser.archived_at.is_(None),
        )
        .order_by(TeamMember.employee_id, AdminUser.name, Team.name)
    ).all()
    for employee_id, team_id, team_name, admin_id, admin_name, admin_email in rows:
        manager = result[employee_id].setdefault(
            admin_id,
            {
                "id": str(admin_id),
                "name": admin_name,
                "email": admin_email,
                "teams": [],
            },
        )
        manager["teams"].append({"id": str(team_id), "name": team_name})
    return {
        employee_id: list(managers.values())
        for employee_id, managers in result.items()
    }


def request_recipients(db: Session, employee: Employee) -> list[RequestRecipient]:
    """Resolve all team managers plus company HR, deduplicated by admin account."""
    recipients: dict[UUID, RequestRecipient] = {}
    manager_rows = db.execute(
        select(AdminUser, Team.name)
        .join(TeamOwner, TeamOwner.admin_user_id == AdminUser.id)
        .join(Team, Team.id == TeamOwner.team_id)
        .join(TeamMember, TeamMember.team_id == Team.id)
        .where(
            TeamMember.employee_id == employee.id,
            TeamMember.status == "active",
            Team.status == "active",
            AdminUser.company_id == employee.company_id,
            AdminUser.status == "active",
            AdminUser.archived_at.is_(None),
            or_(AdminUser.employee_id.is_(None), AdminUser.employee_id != employee.id),
        )
    ).all()
    for admin, team_name in manager_rows:
        recipient = recipients.setdefault(
            admin.id,
            RequestRecipient(admin.id, admin.name, admin.email, admin.role),
        )
        recipient.team_names.add(team_name)

    hr_users = db.scalars(
        select(AdminUser).where(
            AdminUser.company_id == employee.company_id,
            AdminUser.role == "hr",
            AdminUser.status == "active",
            AdminUser.archived_at.is_(None),
            or_(AdminUser.employee_id.is_(None), AdminUser.employee_id != employee.id),
        )
    ).all()
    for admin in hr_users:
        recipients.setdefault(
            admin.id,
            RequestRecipient(admin.id, admin.name, admin.email, admin.role),
        )

    if not recipients:
        fallback = db.scalar(
            select(AdminUser)
            .where(
                AdminUser.company_id == employee.company_id,
                AdminUser.is_super_admin.is_(True),
                AdminUser.status == "active",
                AdminUser.archived_at.is_(None),
                or_(AdminUser.employee_id.is_(None), AdminUser.employee_id != employee.id),
            )
            .order_by(AdminUser.created_at.asc())
        )
        if fallback:
            recipients[fallback.id] = RequestRecipient(
                fallback.id,
                fallback.name,
                fallback.email,
                fallback.role,
            )
    return sorted(recipients.values(), key=lambda item: item.email.lower())


def enqueue_request_review_emails(
    db: Session,
    background_tasks: BackgroundTasks,
    *,
    employee: Employee,
    request_id: UUID,
    request_type: str,
    details: list[tuple[str, object | None]],
) -> int:
    is_early_leave = request_type == "early_leave"
    request_label = "Early leave permission" if is_early_leave else "Annual leave request"
    route = "time-adjustments" if is_early_leave else "holiday-requests"
    review_url = f"{settings.app_public_url.rstrip('/')}/{route}?requestId={request_id}"
    category = "early_leave_submitted" if is_early_leave else "leave_request_submitted"
    queued = 0
    for recipient in request_recipients(db, employee):
        content = request_review_email(
            recipient_name=recipient.name,
            employee_name=employee.name,
            request_label=request_label,
            team_names=sorted(recipient.team_names),
            details=details,
            review_url=review_url,
        )
        if enqueue_email_once(
            db,
            background_tasks,
            company_id=employee.company_id,
            to=recipient.email,
            category=category,
            subject=content.subject,
            body=content.text,
            html=content.html,
        ):
            queued += 1
    return queued
