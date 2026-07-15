from typing import Any
from uuid import UUID
from calendar import monthrange
from datetime import date, timedelta

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from app.api.v1.team_auth import ensure_team_access
from app.core.exceptions import ApiError
from app.models import AdminUser, Device, Project, Task, TaskChecklistItem, Team, TeamMember, WorkSession
from app.services.task_workflow import TRACKABLE_STAGES


def validate_task_dates(start_date, deadline) -> None:
    if start_date and deadline and deadline < start_date:
        raise ApiError("INVALID_TASK_DATES", "Deadline cannot be before the start date.", 400)


def create_next_recurring_task(db: Session, task: Task) -> Task | None:
    if task.recurrence_rule not in {"daily", "weekly", "monthly"}:
        return None
    anchor = task.start_date or task.deadline or date.today()
    if task.recurrence_rule == "daily":
        next_start = anchor + timedelta(days=1)
    elif task.recurrence_rule == "weekly":
        next_start = anchor + timedelta(days=7)
    else:
        year = anchor.year + (1 if anchor.month == 12 else 0)
        month = 1 if anchor.month == 12 else anchor.month + 1
        next_start = date(year, month, min(anchor.day, monthrange(year, month)[1]))
    duration = (task.deadline - task.start_date).days if task.start_date and task.deadline else 0
    next_deadline = next_start + timedelta(days=max(0, duration)) if task.deadline else None
    base_name = task.name.rsplit(" · ", 1)[0]
    next_name = f"{base_name} · {next_start.isoformat()}"[:255]
    existing = db.scalar(
        select(Task).where(
            Task.company_id == task.company_id,
            Task.project_id == task.project_id,
            Task.name == next_name,
        )
    )
    if existing:
        return existing
    max_position = db.scalar(
        select(func.max(Task.position)).where(
            Task.project_id == task.project_id, Task.stage == "assigned"
        )
    )
    next_task = Task(
        company_id=task.company_id,
        project_id=task.project_id,
        assignee_employee_id=task.assignee_employee_id,
        name=next_name,
        description=task.description,
        status="active",
        stage="assigned",
        position=(max_position or 0) + 1,
        start_date=next_start,
        deadline=next_deadline,
        estimated_minutes=task.estimated_minutes,
        labels=list(task.labels or []),
        recurrence_rule=task.recurrence_rule,
        priority=task.priority,
    )
    next_task.collaborators = list(task.collaborators)
    db.add(next_task)
    db.flush()
    for item in task.checklist_items:
        db.add(
            TaskChecklistItem(
                task_id=next_task.id,
                title=item.title,
                completed=False,
                position=item.position,
                assignee_employee_id=item.assignee_employee_id,
            )
        )
    return next_task


def serialize_project(project: Project) -> dict[str, Any]:
    return {
        "id": str(project.id),
        "company_id": str(project.company_id),
        "team_id": str(project.team_id),
        "name": project.name,
        "description": project.description,
        "status": project.status,
        "created_at": project.created_at.isoformat(),
        "updated_at": project.updated_at.isoformat(),
    }


def ensure_general_work_project(db: Session, *, company_id: UUID, team_id: UUID) -> Project:
    project = db.scalar(
        select(Project).where(
            Project.company_id == company_id,
            Project.team_id == team_id,
            Project.name.startswith("General Work"),
        )
        .order_by(Project.created_at.asc())
    )
    if project is None:
        project = Project(
            company_id=company_id,
            team_id=team_id,
            name="General Work",
            description="Default project for quick tasks created by team members.",
            status="active",
        )
        db.add(project)
        db.flush()
    elif project.status != "active":
        project.status = "active"
        db.add(project)
        db.flush()
    default_task = db.scalar(
        select(Task).where(
            Task.company_id == company_id,
            Task.project_id == project.id,
            Task.name == "General Work",
        )
    )
    if default_task is None:
        db.add(
            Task(
                company_id=company_id,
                project_id=project.id,
                name="General Work",
                description="Fallback task until the employee selects or creates specific work.",
                status="active",
                stage="assigned",
            )
        )
        db.flush()
    elif default_task.status != "active":
        default_task.status = "active"
        default_task.stage = "assigned"
        db.add(default_task)
        db.flush()
    return project


def serialize_task(task: Task, project: Project | None = None, team: Team | None = None) -> dict[str, Any]:
    is_system_default = (
        task.name == "General Work"
        and task.assignee_employee_id is None
        and task.created_by_employee_id is None
        and project is not None
        and project.name.startswith("General Work")
    )
    data = {
        "id": str(task.id),
        "company_id": str(task.company_id),
        "project_id": str(task.project_id),
        "assignee_employee_id": str(task.assignee_employee_id) if task.assignee_employee_id else None,
        "created_by_employee_id": str(task.created_by_employee_id) if task.created_by_employee_id else None,
        "collaborator_employee_ids": [str(employee.id) for employee in task.collaborators],
        "team_id": str(project.team_id) if project else None,
        "name": task.name,
        "description": task.description,
        "status": task.status,
        "stage": task.stage,
        "position": task.position,
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "start_date": task.start_date.isoformat() if task.start_date else None,
        "deadline": task.deadline.isoformat() if task.deadline else None,
        "estimated_minutes": task.estimated_minutes,
        "labels": task.labels or [],
        "recurrence_rule": task.recurrence_rule,
        "priority": task.priority,
        "blocked_reason": task.blocked_reason,
        "blocked_at": task.blocked_at.isoformat() if task.blocked_at else None,
        "blocked_by_employee_id": str(task.blocked_by_employee_id) if task.blocked_by_employee_id else None,
        "blocked_by_admin_user_id": str(task.blocked_by_admin_user_id) if task.blocked_by_admin_user_id else None,
        "block_resolution_note": task.block_resolution_note,
        "review_note": task.review_note,
        "completion_note": task.completion_note,
        "is_system_default": is_system_default,
        "reviewed_by_admin_user_id": str(task.reviewed_by_admin_user_id) if task.reviewed_by_admin_user_id else None,
        "reviewed_at": task.reviewed_at.isoformat() if task.reviewed_at else None,
        "checklist": [
            {
                "id": str(item.id),
                "title": item.title,
                "completed": item.completed,
                "position": item.position,
                "assignee_employee_id": str(item.assignee_employee_id) if item.assignee_employee_id else None,
            }
            for item in task.checklist_items
        ],
        "created_at": task.created_at.isoformat(),
        "updated_at": task.updated_at.isoformat(),
    }
    if project is not None:
        data["project_name"] = project.name
    if team is not None:
        data["team_name"] = team.name
    return data


def employee_task_time_totals(
    db: Session,
    *,
    company_id: UUID,
    employee_id: UUID,
    task_ids: list[UUID] | None = None,
) -> dict[UUID, dict[str, int]]:
    statement = (
        select(
            WorkSession.task_id,
            func.coalesce(func.sum(WorkSession.active_seconds), 0),
            func.coalesce(func.sum(WorkSession.idle_seconds), 0),
            func.coalesce(func.sum(WorkSession.deducted_seconds), 0),
        )
        .where(
            WorkSession.company_id == company_id,
            WorkSession.employee_id == employee_id,
            WorkSession.task_id.is_not(None),
        )
        .group_by(WorkSession.task_id)
    )
    if task_ids is not None:
        if not task_ids:
            return {}
        statement = statement.where(WorkSession.task_id.in_(task_ids))

    totals: dict[UUID, dict[str, int]] = {}
    for task_id, raw_active, idle, deducted in db.execute(statement).all():
        active = max(0, int(raw_active or 0) - int(deducted or 0))
        idle_seconds = max(0, int(idle or 0))
        totals[task_id] = {
            "active_seconds": active,
            "idle_seconds": idle_seconds,
            "tracked_seconds": active + idle_seconds,
        }
    return totals


def get_project_or_404(db: Session, admin: AdminUser, project_id: UUID) -> Project:
    project = db.scalar(
        select(Project).where(Project.id == project_id, Project.company_id == admin.company_id)
    )
    if project is None:
        raise ApiError("PROJECT_NOT_FOUND", "Project was not found.", 404)
    ensure_team_access(db, admin, project.team_id)
    return project


def get_task_or_404(db: Session, admin: AdminUser, task_id: UUID) -> tuple[Task, Project]:
    row = db.execute(
        select(Task, Project)
        .join(Project, Project.id == Task.project_id)
        .where(Task.id == task_id, Task.company_id == admin.company_id)
    ).one_or_none()
    if row is None:
        raise ApiError("TASK_NOT_FOUND", "Task was not found.", 404)
    task, project = row
    ensure_team_access(db, admin, project.team_id)
    return task, project


def get_employee_task_context(
    db: Session,
    device: Device,
    task_id: UUID,
) -> tuple[Task, Project, Team]:
    row = db.execute(
        select(Task, Project, Team)
        .join(Project, Project.id == Task.project_id)
        .join(Team, Team.id == Project.team_id)
        .where(
            Task.id == task_id,
            Task.company_id == device.company_id,
            Task.status == "active",
            Project.status == "active",
            Team.status == "active",
        )
    ).one_or_none()
    if row is None:
        raise ApiError("TASK_NOT_FOUND", "Task was not found or is inactive.", 404)

    task, project, team = row
    is_member = db.scalar(
        select(
            exists().where(
                TeamMember.team_id == project.team_id,
                TeamMember.employee_id == device.employee_id,
                TeamMember.status == "active",
            )
        )
    )
    if not is_member:
        raise ApiError("FORBIDDEN_TASK", "This task is not assigned to one of your teams.", 403)
    if task.stage not in TRACKABLE_STAGES:
        raise ApiError(
            "TASK_NOT_TRACKABLE",
            "This task must be approved and assigned before time can be tracked.",
            409,
        )
    return task, project, team


def list_employee_tasks(db: Session, device: Device) -> list[dict[str, Any]]:
    rows = db.execute(
        select(Task, Project, Team)
        .join(Project, Project.id == Task.project_id)
        .join(Team, Team.id == Project.team_id)
        .join(TeamMember, TeamMember.team_id == Team.id)
        .where(
            Task.company_id == device.company_id,
            Task.status == "active",
            Project.status == "active",
            Team.status == "active",
            TeamMember.employee_id == device.employee_id,
            TeamMember.status == "active",
            Task.stage.in_(list(TRACKABLE_STAGES)),
        )
        .order_by(Team.name, Project.name, Task.name)
    ).all()
    time_totals = employee_task_time_totals(
        db,
        company_id=device.company_id,
        employee_id=device.employee_id,
        task_ids=[task.id for task, _project, _team in rows],
    )
    data: list[dict[str, Any]] = []
    for task, project, team in rows:
        item = serialize_task(task, project, team)
        item["can_update_stage"] = task.assignee_employee_id == device.employee_id
        item.update(
            time_totals.get(
                task.id,
                {"active_seconds": 0, "idle_seconds": 0, "tracked_seconds": 0},
            )
        )
        data.append(item)
    return data
