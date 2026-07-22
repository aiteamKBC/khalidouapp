from datetime import UTC, date, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.api.v1.admin_utils import (
    apply_pagination,
    count_for,
    day_bounds,
    get_company_settings,
    pagination_meta,
    serialize_employee,
    serialize_work_session,
    temporary_screenshot_url,
)
from app.api.v1.team_auth import (
    apply_employee_scope,
    ensure_employee_access,
    ensure_team_access,
    ensure_team_owner_employee_membership,
    require_general_admin,
    serialize_team,
)
from app.core.exceptions import ApiError
from app.core.responses import success_response
from app.database.session import get_db
from app.models import (
    AdminUser,
    Device,
    Employee,
    Screenshot,
    Team,
    TeamMember,
    TeamOwner,
    TimeAdjustmentRequest,
    WorkSession,
)
from app.schemas.admin import (
    TeamCreate,
    TeamMemberCreate,
    TeamMemberUpdate,
    TeamOwnerCreate,
    TeamUpdate,
)
from app.services.audit import record_audit_log
from app.services.projects import ensure_general_work_project
from app.services.screenshots import serialize_screenshot

router = APIRouter(prefix="/teams", tags=["teams"])


@router.get("")
def list_teams(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    status: str | None = None,
    search: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    include_relations: bool = False,
):
    from app.api.v1.team_auth import accessible_team_ids_statement

    statement = select(Team).where(Team.id.in_(accessible_team_ids_statement(current_admin)))
    if status:
        statement = statement.where(Team.status == status)
    if search:
        statement = statement.where(Team.name.ilike(f"%{search}%"))
    statement = statement.order_by(Team.name)
    total = count_for(db, statement) if not include_relations else None
    teams = db.scalars(apply_pagination(statement, page, page_size)).all()
    if not include_relations:
        return success_response(
            data=[serialize_team(team) for team in teams],
            meta=pagination_meta(total or 0, page, page_size),
        )

    team_ids = [team.id for team in teams]
    members_by_team: dict[UUID, list[str]] = {team_id: [] for team_id in team_ids}
    owners_by_team: dict[UUID, list[str]] = {team_id: [] for team_id in team_ids}
    if team_ids:
        for relation_team_id, employee_id in db.execute(
            select(TeamMember.team_id, TeamMember.employee_id).where(
                TeamMember.team_id.in_(team_ids),
                TeamMember.status == "active",
            )
        ).all():
            members_by_team[relation_team_id].append(str(employee_id))
        for relation_team_id, admin_user_id in db.execute(
            select(TeamOwner.team_id, TeamOwner.admin_user_id).where(
                TeamOwner.team_id.in_(team_ids)
            )
        ).all():
            owners_by_team[relation_team_id].append(str(admin_user_id))

    data = []
    for team in teams:
        item = serialize_team(team)
        item["employee_ids"] = members_by_team[team.id]
        item["owner_ids"] = owners_by_team[team.id]
        data.append(item)
    return success_response(
        data=data,
        meta=pagination_meta(len(teams), page, page_size),
    )


@router.post("")
def create_team(
    payload: TeamCreate,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_general_admin(current_admin)
    team = Team(
        company_id=current_admin.company_id,
        name=payload.name,
        description=payload.description,
        status=payload.status,
    )
    db.add(team)
    db.flush()
    ensure_general_work_project(db, company_id=current_admin.company_id, team_id=team.id)
    db.commit()
    db.refresh(team)
    record_audit_log(
        db,
        current_admin,
        "created",
        "team",
        entity_id=team.id,
        entity_name=team.name,
        details={"status": team.status},
        request=request,
    )
    db.commit()
    return success_response(data=serialize_team(team))


@router.get("/{team_id}")
def get_team(
    team_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    return success_response(data=serialize_team(ensure_team_access(db, current_admin, team_id)))


@router.patch("/{team_id}")
def update_team(
    team_id: UUID,
    payload: TeamUpdate,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_general_admin(current_admin)
    team = ensure_team_access(db, current_admin, team_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(team, key, value)
    db.add(team)
    db.commit()
    db.refresh(team)
    record_audit_log(
        db,
        current_admin,
        "updated",
        "team",
        entity_id=team.id,
        entity_name=team.name,
        details=payload.model_dump(exclude_unset=True),
        request=request,
    )
    db.commit()
    return success_response(data=serialize_team(team))


@router.delete("/{team_id}")
def delete_team(
    team_id: UUID,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_general_admin(current_admin)
    team = ensure_team_access(db, current_admin, team_id)
    team.status = "deleted"
    db.add(team)
    db.commit()
    record_audit_log(
        db,
        current_admin,
        "deleted",
        "team",
        entity_id=team.id,
        entity_name=team.name,
        request=request,
    )
    db.commit()
    return success_response(data={"deleted": True})


@router.get("/{team_id}/members")
def list_team_members(
    team_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    ensure_team_access(db, current_admin, team_id)
    rows = db.execute(
        select(Employee, TeamMember.role)
        .join(TeamMember, TeamMember.employee_id == Employee.id)
        .where(TeamMember.team_id == team_id, TeamMember.status == "active")
        .order_by(Employee.name)
    ).all()
    data = []
    for member, role in rows:
        item = serialize_employee(member)
        item["team_role"] = role or "member"
        data.append(item)
    return success_response(data=data)


@router.post("/{team_id}/members")
def add_team_member(
    team_id: UUID,
    payload: TeamMemberCreate,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_general_admin(current_admin)
    team = ensure_team_access(db, current_admin, team_id)
    employee = ensure_employee_access(db, current_admin, payload.employee_id)
    existing = db.scalar(
        select(TeamMember).where(
            TeamMember.team_id == team_id, TeamMember.employee_id == employee.id
        )
    )
    if existing:
        existing.status = payload.status
        existing.role = payload.role
        db.add(existing)
        db.commit()
        record_audit_log(
            db,
            current_admin,
            "member_updated",
            "team",
            entity_id=team.id,
            entity_name=team.name,
            details={"employee": employee.email, "status": payload.status, "role": payload.role},
            request=request,
        )
        db.commit()
        return success_response(data={"added": True, "employee_id": str(employee.id)})
    db.add(
        TeamMember(
            team_id=team_id, employee_id=employee.id, status=payload.status, role=payload.role
        )
    )
    db.commit()
    record_audit_log(
        db,
        current_admin,
        "member_added",
        "team",
        entity_id=team.id,
        entity_name=team.name,
        details={"employee": employee.email, "status": payload.status, "role": payload.role},
        request=request,
    )
    db.commit()
    return success_response(data={"added": True, "employee_id": str(employee.id)})


@router.patch("/{team_id}/members/{employee_id}")
def update_team_member(
    team_id: UUID,
    employee_id: UUID,
    payload: TeamMemberUpdate,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_general_admin(current_admin)
    team = ensure_team_access(db, current_admin, team_id)
    member = db.scalar(
        select(TeamMember).where(
            TeamMember.team_id == team_id,
            TeamMember.employee_id == employee_id,
        )
    )
    if member is None:
        raise ApiError("TEAM_MEMBER_NOT_FOUND", "Team member was not found.", 404)
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(member, key, value)
    db.add(member)
    db.commit()
    record_audit_log(
        db,
        current_admin,
        "member_updated",
        "team",
        entity_id=team.id,
        entity_name=team.name,
        details={"employee_id": str(employee_id), **changes},
        request=request,
    )
    db.commit()
    return success_response(data={"updated": True, "employee_id": str(employee_id)})


@router.delete("/{team_id}/members/{employee_id}")
def remove_team_member(
    team_id: UUID,
    employee_id: UUID,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_general_admin(current_admin)
    team = ensure_team_access(db, current_admin, team_id)
    member = db.scalar(
        select(TeamMember).where(
            TeamMember.team_id == team_id, TeamMember.employee_id == employee_id
        )
    )
    if member:
        member.status = "removed"
        db.add(member)
        db.commit()
    record_audit_log(
        db,
        current_admin,
        "member_removed",
        "team",
        entity_id=team.id,
        entity_name=team.name,
        details={"employee_id": str(employee_id)},
        request=request,
    )
    db.commit()
    return success_response(data={"removed": True})


@router.get("/{team_id}/owners")
def list_team_owners(
    team_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    ensure_team_access(db, current_admin, team_id)
    owners = db.scalars(
        select(AdminUser)
        .join(TeamOwner, TeamOwner.admin_user_id == AdminUser.id)
        .where(TeamOwner.team_id == team_id)
        .order_by(AdminUser.name)
    ).all()
    return success_response(
        data=[
            {
                "id": str(owner.id),
                "company_id": str(owner.company_id),
                "employee_id": str(owner.employee_id) if owner.employee_id else None,
                "name": owner.name,
                "email": owner.email,
                "job_title": owner.employee.job_title if owner.employee else None,
                "role": owner.role,
                "status": owner.status,
            }
            for owner in owners
        ]
    )


@router.post("/{team_id}/owners")
def add_team_owner(
    team_id: UUID,
    payload: TeamOwnerCreate,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_general_admin(current_admin)
    team = ensure_team_access(db, current_admin, team_id)
    owner = db.scalar(
        select(AdminUser).where(
            AdminUser.id == payload.admin_user_id, AdminUser.company_id == current_admin.company_id
        )
    )
    if owner is None:
        raise ApiError("ADMIN_NOT_FOUND", "Admin user was not found.", 404)
    if (
        db.scalar(
            select(TeamOwner).where(
                TeamOwner.team_id == team_id, TeamOwner.admin_user_id == owner.id
            )
        )
        is None
    ):
        db.add(TeamOwner(team_id=team_id, admin_user_id=owner.id))
        ensure_team_owner_employee_membership(db, team_id, owner)
        db.commit()
        record_audit_log(
            db,
            current_admin,
            "owner_added",
            "team",
            entity_id=team.id,
            entity_name=team.name,
            details={"owner": owner.email},
            request=request,
        )
        db.commit()
    else:
        ensure_team_owner_employee_membership(db, team_id, owner)
        db.commit()
    return success_response(data={"added": True, "admin_user_id": str(owner.id)})


@router.delete("/{team_id}/owners/{admin_user_id}")
def remove_team_owner(
    team_id: UUID,
    admin_user_id: UUID,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_general_admin(current_admin)
    team = ensure_team_access(db, current_admin, team_id)
    owner = db.scalar(
        select(TeamOwner).where(
            TeamOwner.team_id == team_id, TeamOwner.admin_user_id == admin_user_id
        )
    )
    if owner:
        db.delete(owner)
        db.commit()
    record_audit_log(
        db,
        current_admin,
        "owner_removed",
        "team",
        entity_id=team.id,
        entity_name=team.name,
        details={"admin_user_id": str(admin_user_id)},
        request=request,
    )
    db.commit()
    return success_response(data={"removed": True})


@router.get("/{team_id}/summary")
def team_summary(
    team_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    ensure_team_access(db, current_admin, team_id)
    employee_ids = select(TeamMember.employee_id).where(
        TeamMember.team_id == team_id, TeamMember.status == "active"
    )
    start, end = day_bounds(date.today())
    settings = get_company_settings(db, current_admin.company_id)
    offline_cutoff = datetime.now(UTC) - timedelta(minutes=settings.offline_threshold_minutes)
    total_employees_query = select(func.count()).where(
        Employee.id.in_(employee_ids),
        Employee.company_id == current_admin.company_id,
    )
    online_employees_query = select(func.count(func.distinct(Device.employee_id))).where(
        Device.company_id == current_admin.company_id,
        Device.employee_id.in_(employee_ids),
        Device.last_seen_at >= offline_cutoff,
        Device.revoked_at.is_(None),
    )
    idle_employees_query = select(func.count(func.distinct(WorkSession.employee_id))).where(
        WorkSession.company_id == current_admin.company_id,
        WorkSession.employee_id.in_(employee_ids),
        WorkSession.status == "idle",
        WorkSession.ended_at.is_(None),
    )
    active_seconds_query = select(
        func.coalesce(func.sum(WorkSession.active_seconds - WorkSession.deducted_seconds), 0)
    ).where(
        WorkSession.company_id == current_admin.company_id,
        WorkSession.employee_id.in_(employee_ids),
        WorkSession.started_at.between(start, end),
    )
    idle_seconds_query = select(func.coalesce(func.sum(WorkSession.idle_seconds), 0)).where(
        WorkSession.company_id == current_admin.company_id,
        WorkSession.employee_id.in_(employee_ids),
        WorkSession.started_at.between(start, end),
    )
    adjustment_seconds_query = select(
        func.coalesce(func.sum(TimeAdjustmentRequest.approved_seconds), 0)
    ).where(
        TimeAdjustmentRequest.company_id == current_admin.company_id,
        TimeAdjustmentRequest.employee_id.in_(employee_ids),
        TimeAdjustmentRequest.status == "approved",
        TimeAdjustmentRequest.requested_date == date.today(),
    )
    screenshots_today_query = select(func.count()).where(
        Screenshot.company_id == current_admin.company_id,
        Screenshot.employee_id.in_(employee_ids),
        Screenshot.captured_at.between(start, end),
        Screenshot.deleted_at.is_(None),
    )
    screenshot_count_query = select(func.count()).where(
        Screenshot.company_id == current_admin.company_id,
        Screenshot.employee_id.in_(employee_ids),
        Screenshot.deleted_at.is_(None),
    )
    (
        total_employees,
        online_employees,
        idle_employees,
        active_seconds,
        idle_seconds,
        adjustment_seconds,
        screenshots_today,
        screenshot_count,
    ) = db.execute(
        select(
            total_employees_query.scalar_subquery(),
            online_employees_query.scalar_subquery(),
            idle_employees_query.scalar_subquery(),
            active_seconds_query.scalar_subquery(),
            idle_seconds_query.scalar_subquery(),
            adjustment_seconds_query.scalar_subquery(),
            screenshots_today_query.scalar_subquery(),
            screenshot_count_query.scalar_subquery(),
        )
    ).one()
    tracked_seconds = int(active_seconds or 0) + int(idle_seconds or 0)
    return success_response(
        data={
            "total_employees": int(total_employees or 0),
            "online_employees": int(online_employees or 0),
            "idle_employees": int(idle_employees or 0),
            "active_seconds": int(active_seconds or 0) + int(adjustment_seconds or 0),
            "idle_seconds": int(idle_seconds or 0),
            "total_hours_today": round((tracked_seconds + int(adjustment_seconds or 0)) / 3600, 2),
            "screenshots_today": int(screenshots_today or 0),
            "screenshot_count": int(screenshot_count or 0),
        }
    )


@router.get("/{team_id}/screenshots")
def team_screenshots(
    team_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    ensure_team_access(db, current_admin, team_id)
    statement = apply_employee_scope(
        select(Screenshot).where(
            Screenshot.company_id == current_admin.company_id, Screenshot.deleted_at.is_(None)
        ),
        db,
        current_admin,
        Screenshot.employee_id,
        team_id,
    ).order_by(Screenshot.captured_at.desc())
    screenshots = db.scalars(statement).all()
    return success_response(
        data=[
            {**serialize_screenshot(item), "temporary_url": temporary_screenshot_url(item)}
            for item in screenshots
        ]
    )


@router.get("/{team_id}/sessions")
def team_sessions(
    team_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    ensure_team_access(db, current_admin, team_id)
    statement = apply_employee_scope(
        select(WorkSession).where(WorkSession.company_id == current_admin.company_id),
        db,
        current_admin,
        WorkSession.employee_id,
        team_id,
    ).order_by(WorkSession.started_at.desc())
    sessions = db.scalars(statement).all()
    return success_response(data=[serialize_work_session(session) for session in sessions])


@router.get("/{team_id}/timesheets")
def team_timesheets(
    team_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    from app.api.v1.timesheets import timesheet_rows

    ensure_team_access(db, current_admin, team_id)
    return success_response(
        data=timesheet_rows(
            db,
            current_admin.company_id,
            date.today(),
            date.today(),
            team_id=team_id,
            current_admin=current_admin,
        )
    )


@router.get("/{team_id}/reports")
def team_reports(
    team_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    ensure_team_access(db, current_admin, team_id)
    employee_ids = select(TeamMember.employee_id).where(
        TeamMember.team_id == team_id, TeamMember.status == "active"
    )
    tracked_seconds = (
        db.scalar(
            select(
                func.coalesce(func.sum(WorkSession.active_seconds + WorkSession.idle_seconds), 0)
            ).where(
                WorkSession.company_id == current_admin.company_id,
                WorkSession.employee_id.in_(employee_ids),
            )
        )
        or 0
    )
    adjustment_seconds = (
        db.scalar(
            select(func.coalesce(func.sum(TimeAdjustmentRequest.approved_seconds), 0)).where(
                TimeAdjustmentRequest.company_id == current_admin.company_id,
                TimeAdjustmentRequest.employee_id.in_(employee_ids),
                TimeAdjustmentRequest.status == "approved",
            )
        )
        or 0
    )
    screenshots = (
        db.scalar(
            select(func.count()).where(
                Screenshot.company_id == current_admin.company_id,
                Screenshot.employee_id.in_(employee_ids),
                Screenshot.deleted_at.is_(None),
            )
        )
        or 0
    )
    return success_response(
        data={
            "total_tracked_seconds": int(tracked_seconds) + int(adjustment_seconds),
            "screenshots": int(screenshots),
        }
    )
