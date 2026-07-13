from uuid import UUID

from sqlalchemy import Select, exists, select
from sqlalchemy.orm import Session

from app.core.exceptions import ApiError
from app.models import AdminUser, Employee, Team, TeamMember, TeamOwner
from app.services.permissions import has_capability, has_company_data_scope, require_capability


def is_general_admin(admin: AdminUser) -> bool:
    """Backward-compatible name for company-wide data scope checks."""
    return has_company_data_scope(admin)


def require_general_admin(admin: AdminUser) -> None:
    require_capability(admin, "company.manage")


def ensure_team_owner_employee_membership(
    db: Session,
    team_id: UUID,
    owner: AdminUser,
) -> TeamMember | None:
    if owner.employee_id is None:
        return None
    membership = db.scalar(
        select(TeamMember).where(
            TeamMember.team_id == team_id,
            TeamMember.employee_id == owner.employee_id,
        )
    )
    if membership is None:
        membership = TeamMember(
            team_id=team_id,
            employee_id=owner.employee_id,
            status="active",
        )
        db.add(membership)
    elif membership.status != "active":
        membership.status = "active"
        db.add(membership)
    return membership


def serialize_team(team: Team) -> dict:
    return {
        "id": str(team.id),
        "company_id": str(team.company_id),
        "name": team.name,
        "description": team.description,
        "status": team.status,
        "created_at": team.created_at.isoformat(),
        "updated_at": team.updated_at.isoformat(),
    }


def get_company_team_or_404(db: Session, admin: AdminUser, team_id: UUID) -> Team:
    team = db.scalar(select(Team).where(Team.id == team_id, Team.company_id == admin.company_id))
    if team is None:
        raise ApiError("TEAM_NOT_FOUND", "Team was not found.", 404)
    return team


def ensure_team_access(db: Session, admin: AdminUser, team_id: UUID) -> Team:
    team = get_company_team_or_404(db, admin, team_id)
    if is_general_admin(admin):
        return team

    owns_team = db.scalar(
        select(
            exists().where(
                TeamOwner.team_id == team_id,
                TeamOwner.admin_user_id == admin.id,
            )
        )
    )
    if not owns_team:
        raise ApiError("FORBIDDEN_TEAM", "You do not have access to this team.", 403)
    return team


def accessible_team_ids_statement(admin: AdminUser) -> Select[tuple[UUID]]:
    statement = select(Team.id).where(Team.company_id == admin.company_id, Team.status != "deleted")
    if not is_general_admin(admin):
        statement = statement.join(TeamOwner, TeamOwner.team_id == Team.id).where(
            TeamOwner.admin_user_id == admin.id
        )
    return statement


def employee_ids_for_team_statement(team_id: UUID) -> Select[tuple[UUID]]:
    return select(TeamMember.employee_id).where(
        TeamMember.team_id == team_id,
        TeamMember.status == "active",
    )


def accessible_employee_ids_statement(
    db: Session,
    admin: AdminUser,
    team_id: UUID | None = None,
) -> Select[tuple[UUID]] | None:
    if team_id is not None:
        ensure_team_access(db, admin, team_id)
        return employee_ids_for_team_statement(team_id)

    if is_general_admin(admin):
        return None

    return (
        select(TeamMember.employee_id)
        .join(Team, Team.id == TeamMember.team_id)
        .join(TeamOwner, TeamOwner.team_id == Team.id)
        .where(
            Team.company_id == admin.company_id,
            Team.status != "deleted",
            TeamMember.status == "active",
            TeamOwner.admin_user_id == admin.id,
        )
    )


def apply_employee_scope(
    statement,
    db: Session,
    admin: AdminUser,
    employee_column,
    team_id: UUID | None = None,
):
    employee_ids = accessible_employee_ids_statement(db, admin, team_id)
    if employee_ids is not None:
        statement = statement.where(employee_column.in_(employee_ids))
    return statement


def ensure_employee_access(
    db: Session,
    admin: AdminUser,
    employee_id: UUID,
    team_id: UUID | None = None,
) -> Employee:
    employee = db.scalar(
        select(Employee).where(Employee.id == employee_id, Employee.company_id == admin.company_id)
    )
    if employee is None:
        raise ApiError("EMPLOYEE_NOT_FOUND", "Employee was not found.", 404)

    scoped = apply_employee_scope(
        select(Employee.id).where(Employee.id == employee_id, Employee.company_id == admin.company_id),
        db,
        admin,
        Employee.id,
        team_id,
    )
    if db.scalar(scoped) is None:
        raise ApiError("FORBIDDEN_EMPLOYEE", "You do not have access to this employee.", 403)
    return employee
