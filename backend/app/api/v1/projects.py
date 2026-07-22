from typing import Annotated
from uuid import UUID, uuid4
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.api.v1.admin_utils import apply_pagination, count_for, pagination_meta
from app.api.v1.team_auth import accessible_team_ids_statement, ensure_team_access
from app.core.config import settings
from app.core.exceptions import ApiError
from app.core.responses import success_response
from app.database.session import get_db
from app.models import (
    AdminUser,
    Employee,
    Project,
    Task,
    TaskAttachment,
    TaskActivity,
    TaskChecklistItem,
    TaskComment,
    TaskDependency,
    TaskNotification,
    Team,
    TeamMember,
    WorkSession,
)
from app.schemas.admin import (
    ChecklistItemCreate,
    ChecklistItemUpdate,
    ProjectCreate,
    ProjectUpdate,
    TaskCreate,
    TaskApprovalRequest,
    TaskCommentCreate,
    TaskDependencyCreate,
    TaskDecisionRequest,
    TaskReviewReturnRequest,
    TaskUpdate,
)
from app.services.audit import record_audit_log
from app.services.projects import (
    get_project_or_404,
    get_task_or_404,
    serialize_project,
    serialize_task,
    create_next_recurring_task,
    validate_task_dates,
)
from app.services.task_workflow import (
    MAIN_STAGES,
    create_notification,
    ensure_admin_task_stage_change_allowed,
    ensure_completion_allowed,
    ensure_workflow_decision_allowed,
    mark_task_blocked,
    notify_employee,
    notify_task_participants,
    record_task_activity,
    resolve_task_block,
    resolve_workflow_request,
    serialize_notification,
    stop_task_tracking,
    workflow_request_for_decision,
)

router = APIRouter(tags=["projects"])


def validate_assignee(db: Session, project: Project, employee_id: UUID | None) -> None:
    if employee_id is None:
        return
    membership = db.scalar(
        select(TeamMember).where(
            TeamMember.team_id == project.team_id,
            TeamMember.employee_id == employee_id,
            TeamMember.status == "active",
        )
    )
    employee = db.scalar(
        select(Employee).where(
            Employee.id == employee_id,
            Employee.company_id == project.company_id,
            Employee.status == "active",
        )
    )
    if membership is None or employee is None:
        from app.core.exceptions import ApiError

        raise ApiError(
            "INVALID_TASK_ASSIGNEE", "Employee must be an active member of the project's team.", 400
        )


def task_team_employees(db: Session, project: Project, employee_ids: list[UUID]) -> list[Employee]:
    for employee_id in employee_ids:
        validate_assignee(db, project, employee_id)
    if not employee_ids:
        return []
    return list(db.scalars(select(Employee).where(Employee.id.in_(employee_ids))).all())


@router.get("/projects")
def list_projects(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    team_id: UUID | None = None,
    status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=200),
):
    statement = select(Project).where(Project.company_id == current_admin.company_id)
    if team_id:
        ensure_team_access(db, current_admin, team_id)
        statement = statement.where(Project.team_id == team_id)
    else:
        statement = statement.where(
            Project.team_id.in_(accessible_team_ids_statement(current_admin))
        )
    if status:
        statement = statement.where(Project.status == status)
    else:
        statement = statement.where(Project.status != "deleted")
    statement = statement.order_by(Project.name)
    total = count_for(db, statement)
    projects = db.scalars(apply_pagination(statement, page, page_size)).all()
    return success_response(
        data=[serialize_project(project) for project in projects],
        meta=pagination_meta(total, page, page_size),
    )


@router.post("/projects")
def create_project(
    payload: ProjectCreate,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    ensure_team_access(db, current_admin, payload.team_id)
    project = Project(
        company_id=current_admin.company_id,
        team_id=payload.team_id,
        name=payload.name,
        description=payload.description,
        status=payload.status,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    record_audit_log(
        db,
        current_admin,
        "created",
        "project",
        entity_id=project.id,
        entity_name=project.name,
        details={"team_id": str(project.team_id), "status": project.status},
        request=request,
    )
    db.commit()
    return success_response(data=serialize_project(project))


@router.get("/projects/{project_id}")
def get_project(
    project_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    return success_response(
        data=serialize_project(get_project_or_404(db, current_admin, project_id))
    )


@router.post("/projects/{project_id}/duplicate")
def duplicate_project(
    project_id: UUID,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    source = get_project_or_404(db, current_admin, project_id)
    base_name = f"{source.name} copy"
    name = base_name
    suffix = 2
    while db.scalar(
        select(Project.id).where(
            Project.company_id == source.company_id,
            Project.team_id == source.team_id,
            Project.name == name,
        )
    ):
        name = f"{base_name} {suffix}"
        suffix += 1
    duplicate = Project(
        company_id=source.company_id,
        team_id=source.team_id,
        name=name,
        description=source.description,
        status="active",
    )
    db.add(duplicate)
    db.flush()
    source_tasks = db.scalars(
        select(Task).where(Task.project_id == source.id, Task.status != "deleted")
    ).all()
    for source_task in source_tasks:
        copied_task = Task(
            company_id=source_task.company_id,
            project_id=duplicate.id,
            assignee_employee_id=source_task.assignee_employee_id,
            name=source_task.name,
            description=source_task.description,
            status="active",
            stage=(
                "backlog"
                if source_task.stage in {"completed", "new_requests", "ready_for_review"}
                else source_task.stage
            ),
            position=source_task.position,
            start_date=source_task.start_date,
            deadline=source_task.deadline,
            estimated_minutes=source_task.estimated_minutes,
            labels=list(source_task.labels or []),
            recurrence_rule=source_task.recurrence_rule,
        )
        copied_task.collaborators = list(source_task.collaborators)
        db.add(copied_task)
        db.flush()
        for item in source_task.checklist_items:
            db.add(
                TaskChecklistItem(
                    task_id=copied_task.id,
                    title=item.title,
                    completed=False,
                    position=item.position,
                    assignee_employee_id=item.assignee_employee_id,
                )
            )
    record_audit_log(
        db,
        current_admin,
        "duplicated",
        "project",
        entity_id=duplicate.id,
        entity_name=duplicate.name,
        details={"source_project_id": str(source.id)},
        request=request,
    )
    db.commit()
    db.refresh(duplicate)
    return success_response(data=serialize_project(duplicate), status_code=201)


@router.patch("/projects/{project_id}")
def update_project(
    project_id: UUID,
    payload: ProjectUpdate,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    project = get_project_or_404(db, current_admin, project_id)
    changes = payload.model_dump(exclude_unset=True)
    audit_details = payload.model_dump(mode="json", exclude_unset=True)
    if payload.team_id is not None:
        ensure_team_access(db, current_admin, payload.team_id)
    for key, value in changes.items():
        setattr(project, key, value)
    db.add(project)
    db.commit()
    db.refresh(project)
    record_audit_log(
        db,
        current_admin,
        "updated",
        "project",
        entity_id=project.id,
        entity_name=project.name,
        details=audit_details,
        request=request,
    )
    db.commit()
    return success_response(data=serialize_project(project))


@router.delete("/projects/{project_id}")
def archive_project(
    project_id: UUID,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    project = get_project_or_404(db, current_admin, project_id)
    project.status = "archived"
    db.add(project)
    db.commit()
    record_audit_log(
        db,
        current_admin,
        "archived",
        "project",
        entity_id=project.id,
        entity_name=project.name,
        details={"team_id": str(project.team_id)},
        request=request,
    )
    db.commit()
    return success_response(data={"deleted": True})


@router.get("/tasks")
def list_tasks(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    project_id: UUID | None = None,
    team_id: UUID | None = None,
    stage: str | None = None,
    status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=200),
):
    statement = (
        select(Task, Project, Team)
        .join(Project, Project.id == Task.project_id)
        .join(Team, Team.id == Project.team_id)
    )
    statement = statement.where(Task.company_id == current_admin.company_id)
    if project_id:
        project = get_project_or_404(db, current_admin, project_id)
        statement = statement.where(Task.project_id == project.id)
    elif team_id:
        ensure_team_access(db, current_admin, team_id)
        statement = statement.where(Project.team_id == team_id)
    else:
        statement = statement.where(
            Project.team_id.in_(accessible_team_ids_statement(current_admin))
        )
    if status:
        statement = statement.where(Task.status == status)
    else:
        statement = statement.where(Task.status != "deleted")
    if stage:
        statement = statement.where(Task.stage == stage)
    statement = statement.order_by(Team.name, Project.name, Task.stage, Task.position, Task.name)
    total = count_for(db, statement)
    rows = db.execute(apply_pagination(statement, page, page_size)).all()
    return success_response(
        data=[serialize_task(task, project, team) for task, project, team in rows],
        meta=pagination_meta(total, page, page_size),
    )


@router.get("/task-metrics")
def task_metrics(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    team_id: UUID | None = None,
):
    statement = (
        select(
            WorkSession.task_id,
            func.coalesce(func.sum(WorkSession.active_seconds), 0),
            func.coalesce(func.sum(WorkSession.idle_seconds), 0),
        )
        .join(Task, Task.id == WorkSession.task_id)
        .join(Project, Project.id == Task.project_id)
        .where(WorkSession.company_id == current_admin.company_id, WorkSession.task_id.is_not(None))
    )
    if team_id:
        ensure_team_access(db, current_admin, team_id)
        statement = statement.where(Project.team_id == team_id)
    else:
        statement = statement.where(
            Project.team_id.in_(accessible_team_ids_statement(current_admin))
        )
    rows = db.execute(statement.group_by(WorkSession.task_id)).all()
    return success_response(
        data=[
            {"task_id": str(task_id), "active_seconds": active, "idle_seconds": idle}
            for task_id, active, idle in rows
        ]
    )


@router.get("/projects/{project_id}/tasks")
def list_project_tasks(
    project_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    project = get_project_or_404(db, current_admin, project_id)
    tasks = db.scalars(
        select(Task)
        .where(
            Task.company_id == current_admin.company_id,
            Task.project_id == project.id,
            Task.status != "deleted",
        )
        .order_by(Task.name)
    ).all()
    team = db.scalar(select(Team).where(Team.id == project.team_id))
    return success_response(data=[serialize_task(task, project, team) for task in tasks])


@router.post("/tasks")
def create_task(
    payload: TaskCreate,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    project = get_project_or_404(db, current_admin, payload.project_id)
    if payload.stage not in MAIN_STAGES or payload.stage == "new_requests":
        raise ApiError(
            "INVALID_TASK_STAGE",
            "new_requests is reserved for employee-created tasks.",
            400,
        )
    validate_task_dates(payload.start_date, payload.deadline)
    validate_assignee(db, project, payload.assignee_employee_id)
    task = Task(
        company_id=current_admin.company_id,
        project_id=project.id,
        assignee_employee_id=payload.assignee_employee_id,
        name=payload.name,
        description=payload.description,
        status=payload.status,
        stage=payload.stage,
        completed_at=datetime.now(UTC) if payload.stage == "completed" else None,
        start_date=payload.start_date,
        deadline=payload.deadline,
        estimated_minutes=payload.estimated_minutes,
        labels=[label.strip() for label in payload.labels if label.strip()],
        recurrence_rule=payload.recurrence_rule,
        priority=payload.priority,
    )
    task.collaborators = task_team_employees(db, project, payload.collaborator_employee_ids)
    db.add(task)
    db.flush()
    record_task_activity(
        db,
        task,
        "task_created",
        admin=current_admin,
        details={"stage": task.stage, "priority": task.priority},
    )
    if task.stage not in {"blocked", "rejected", "cancelled"}:
        notify_employee(
            db,
            task,
            task.assignee_employee_id,
            "task_assigned",
            "New task assigned",
            f"You were assigned: {task.name}",
            f"assigned:{task.assignee_employee_id}:{task.updated_at.isoformat() if task.updated_at else task.id}",
        )
    db.commit()
    db.refresh(task)
    record_audit_log(
        db,
        current_admin,
        "created",
        "task",
        entity_id=task.id,
        entity_name=task.name,
        details={
            "project_id": str(task.project_id),
            "team_id": str(project.team_id),
            "status": task.status,
            "stage": task.stage,
        },
        request=request,
    )
    db.commit()
    team = db.scalar(select(Team).where(Team.id == project.team_id))
    return success_response(data=serialize_task(task, project, team))


@router.post("/tasks/{task_id}/approve-request")
def approve_employee_task_request(
    task_id: UUID,
    payload: TaskApprovalRequest,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    task, project = get_task_or_404(db, current_admin, task_id)
    workflow_request = workflow_request_for_decision(db, task, "task_creation")
    ensure_workflow_decision_allowed(db, current_admin, task, project)
    if task.stage != "new_requests":
        raise ApiError("TASK_NOT_PENDING", "Only new task requests can be approved.", 409)
    if payload.target_stage == "assigned" and task.assignee_employee_id is None:
        raise ApiError("TASK_ASSIGNEE_REQUIRED", "Assign an employee before approval.", 400)
    resolve_workflow_request(
        db,
        workflow_request,
        status="approved",
        reviewed_by_admin=current_admin,
    )
    task.stage = payload.target_stage
    task.reviewed_by_admin_user_id = current_admin.id
    task.reviewed_at = workflow_request.reviewed_at
    record_task_activity(
        db,
        task,
        "request_approved",
        admin=current_admin,
        details={
            "to_stage": payload.target_stage,
            "workflow_request_id": str(workflow_request.id),
        },
    )
    notify_employee(
        db,
        task,
        task.created_by_employee_id or task.assignee_employee_id,
        "request_approved",
        "Task request approved",
        f"{task.name} was approved and moved to {payload.target_stage}.",
        f"request-approved:{workflow_request.id}",
        workflow_request_id=workflow_request.id,
    )
    db.commit()
    db.refresh(task)
    team = db.scalar(select(Team).where(Team.id == project.team_id))
    return success_response(data=serialize_task(task, project, team))


@router.post("/tasks/{task_id}/reject-request")
def reject_employee_task_request(
    task_id: UUID,
    payload: TaskDecisionRequest,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    task, project = get_task_or_404(db, current_admin, task_id)
    workflow_request = workflow_request_for_decision(db, task, "task_creation")
    ensure_workflow_decision_allowed(db, current_admin, task, project)
    if task.stage != "new_requests":
        raise ApiError("TASK_NOT_PENDING", "Only new task requests can be rejected.", 409)
    if not (payload.note or "").strip():
        raise ApiError("REJECTION_REASON_REQUIRED", "Add a rejection reason.", 400)
    resolve_workflow_request(
        db,
        workflow_request,
        status="rejected",
        reviewed_by_admin=current_admin,
        decision_note=payload.note,
    )
    task.stage = "rejected"
    task.review_note = payload.note.strip()
    task.reviewed_by_admin_user_id = current_admin.id
    task.reviewed_at = workflow_request.reviewed_at
    stop_task_tracking(db, task, reason="request_rejected")
    record_task_activity(
        db,
        task,
        "request_rejected",
        admin=current_admin,
        details={
            "note": task.review_note,
            "workflow_request_id": str(workflow_request.id),
        },
    )
    notify_employee(
        db,
        task,
        task.created_by_employee_id or task.assignee_employee_id,
        "request_rejected",
        "Task request rejected",
        task.review_note,
        f"request-rejected:{workflow_request.id}",
        workflow_request_id=workflow_request.id,
    )
    db.commit()
    db.refresh(task)
    team = db.scalar(select(Team).where(Team.id == project.team_id))
    return success_response(data=serialize_task(task, project, team))


@router.post("/tasks/{task_id}/approve-review")
def approve_task_review(
    task_id: UUID,
    payload: TaskDecisionRequest,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    task, project = get_task_or_404(db, current_admin, task_id)
    workflow_request = workflow_request_for_decision(db, task, "completion")
    ensure_workflow_decision_allowed(db, current_admin, task, project)
    if task.stage != "ready_for_review":
        raise ApiError("TASK_NOT_IN_REVIEW", "Task is not ready for review.", 409)
    ensure_completion_allowed(task, payload.note)
    resolve_workflow_request(
        db,
        workflow_request,
        status="approved",
        reviewed_by_admin=current_admin,
        decision_note=payload.note,
    )
    task.stage = "completed"
    task.completion_note = payload.note
    task.completed_at = datetime.now(UTC)
    task.reviewed_at = workflow_request.reviewed_at
    task.reviewed_by_admin_user_id = current_admin.id
    stop_task_tracking(db, task, reason="review_approved")
    record_task_activity(
        db,
        task,
        "review_approved",
        admin=current_admin,
        details={
            "note": payload.note,
            "workflow_request_id": str(workflow_request.id),
        },
    )
    notify_task_participants(
        db,
        task,
        "review_approved",
        "Task approved",
        f"{task.name} was approved and completed.",
        f"review-approved:{workflow_request.id}",
        workflow_request_id=workflow_request.id,
    )
    create_next_recurring_task(db, task)
    db.commit()
    db.refresh(task)
    team = db.scalar(select(Team).where(Team.id == project.team_id))
    return success_response(data=serialize_task(task, project, team))


@router.post("/tasks/{task_id}/return-review")
def return_task_review(
    task_id: UUID,
    payload: TaskReviewReturnRequest,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    task, project = get_task_or_404(db, current_admin, task_id)
    workflow_request = workflow_request_for_decision(db, task, "completion")
    ensure_workflow_decision_allowed(db, current_admin, task, project)
    if task.stage != "ready_for_review":
        raise ApiError("TASK_NOT_IN_REVIEW", "Task is not ready for review.", 409)
    if not (payload.note or "").strip():
        raise ApiError("REVIEW_NOTE_REQUIRED", "Explain what needs to change.", 400)
    resolve_workflow_request(
        db,
        workflow_request,
        status="rejected",
        reviewed_by_admin=current_admin,
        decision_note=payload.note,
        return_stage=payload.target_stage,
    )
    task.stage = payload.target_stage
    task.review_note = payload.note.strip()
    task.reviewed_at = workflow_request.reviewed_at
    task.reviewed_by_admin_user_id = current_admin.id
    task.completed_at = None
    if payload.target_stage == "blocked":
        mark_task_blocked(task, task.review_note, admin=current_admin)
    record_task_activity(
        db,
        task,
        "review_returned",
        admin=current_admin,
        details={
            "note": task.review_note,
            "to_stage": payload.target_stage,
            "workflow_request_id": str(workflow_request.id),
        },
    )
    notify_task_participants(
        db,
        task,
        "review_returned",
        "Task returned for changes",
        task.review_note,
        f"review-returned:{workflow_request.id}",
        workflow_request_id=workflow_request.id,
    )
    db.commit()
    db.refresh(task)
    team = db.scalar(select(Team).where(Team.id == project.team_id))
    return success_response(data=serialize_task(task, project, team))


@router.patch("/tasks/{task_id}")
def update_task(
    task_id: UUID,
    payload: TaskUpdate,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    task, project = get_task_or_404(db, current_admin, task_id)
    previous_stage = task.stage
    previous_assignee_id = task.assignee_employee_id
    previous_deadline = task.deadline
    changes = payload.model_dump(exclude_unset=True)
    collaborator_ids = changes.pop("collaborator_employee_ids", None)
    audit_details = payload.model_dump(mode="json", exclude_unset=True)
    if payload.project_id is not None:
        project = get_project_or_404(db, current_admin, payload.project_id)
    if "assignee_employee_id" in changes or payload.project_id is not None:
        validate_assignee(
            db,
            project,
            payload.assignee_employee_id
            if "assignee_employee_id" in changes
            else task.assignee_employee_id,
        )
    if collaborator_ids is not None:
        task.collaborators = task_team_employees(db, project, collaborator_ids)
    elif payload.project_id is not None:
        task.collaborators = task_team_employees(
            db, project, [employee.id for employee in task.collaborators]
        )
    entering_completed = changes.get("stage") == "completed" and task.stage != "completed"
    if "stage" in changes:
        next_stage = changes["stage"]
        if next_stage not in MAIN_STAGES or next_stage == "new_requests":
            raise ApiError("INVALID_TASK_STAGE", "Task stage is not supported.", 400)
        ensure_admin_task_stage_change_allowed(db, current_admin, task, next_stage)
        if next_stage == "blocked" and not (changes.get("blocked_reason") or task.blocked_reason):
            raise ApiError("BLOCK_REASON_REQUIRED", "Explain why the task is blocked.", 400)
        if next_stage == "completed" and task.stage != "completed":
            ensure_completion_allowed(task, changes.get("completion_note") or task.completion_note)
            task.completed_at = datetime.now(UTC)
            task.reviewed_by_admin_user_id = current_admin.id
            task.reviewed_at = datetime.now(UTC)
        elif next_stage != "completed":
            task.completed_at = None
        if previous_stage == "blocked" and next_stage != "blocked":
            resolve_task_block(task, changes.get("block_resolution_note") or "")
    for key, value in changes.items():
        setattr(task, key, value)
    if previous_stage != task.stage and task.stage == "blocked":
        mark_task_blocked(task, task.blocked_reason or "", admin=current_admin)
    validate_task_dates(task.start_date, task.deadline)
    if entering_completed:
        stop_task_tracking(db, task, reason="task_completed")
        create_next_recurring_task(db, task)
    elif previous_stage != task.stage and task.stage in {
        "ready_for_review",
        "blocked",
        "rejected",
        "cancelled",
    }:
        stop_task_tracking(db, task, reason=f"task_{task.stage}")
    db.add(task)
    db.flush()
    activity_details = {
        key: value.isoformat() if hasattr(value, "isoformat") else value
        for key, value in audit_details.items()
    }
    if previous_stage != task.stage:
        activity_details.update({"from_stage": previous_stage, "to_stage": task.stage})
    record_task_activity(
        db,
        task,
        "stage_changed" if previous_stage != task.stage else "task_updated",
        admin=current_admin,
        details=activity_details,
    )
    if task.stage not in {"blocked", "rejected", "cancelled"} and (
        task.assignee_employee_id != previous_assignee_id
        or previous_stage in {"blocked", "rejected", "cancelled"}
    ):
        notify_employee(
            db,
            task,
            task.assignee_employee_id,
            "task_assigned",
            "Task assigned",
            f"You were assigned: {task.name}",
            f"assigned:{task.assignee_employee_id}:{task.updated_at.isoformat()}",
        )
    if task.deadline != previous_deadline:
        notify_task_participants(
            db,
            task,
            "deadline_changed",
            "Task deadline changed",
            f"{task.name} is now due {task.deadline or 'without a deadline'}",
            f"deadline-changed:{task.updated_at.isoformat()}",
        )
    if previous_stage == "ready_for_review" and task.stage == "in_progress":
        notify_employee(
            db,
            task,
            task.assignee_employee_id,
            "review_returned",
            "Task returned for changes",
            task.review_note or f"{task.name} needs more work.",
            f"review-returned:{task.updated_at.isoformat()}",
        )
    db.commit()
    db.refresh(task)
    record_audit_log(
        db,
        current_admin,
        "updated",
        "task",
        entity_id=task.id,
        entity_name=task.name,
        details=audit_details,
        request=request,
    )
    db.commit()
    team = db.scalar(select(Team).where(Team.id == project.team_id))
    return success_response(data=serialize_task(task, project, team))


@router.get("/tasks/{task_id}/workspace")
def task_workspace(
    task_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    task, project = get_task_or_404(db, current_admin, task_id)
    comments = db.scalars(
        select(TaskComment)
        .where(TaskComment.task_id == task.id)
        .order_by(TaskComment.created_at.desc())
    ).all()
    attachments = db.scalars(
        select(TaskAttachment)
        .where(TaskAttachment.task_id == task.id)
        .order_by(TaskAttachment.created_at.desc())
    ).all()
    dependencies = db.execute(
        select(TaskDependency, Task)
        .join(Task, Task.id == TaskDependency.depends_on_task_id)
        .where(TaskDependency.task_id == task.id)
        .order_by(Task.name)
    ).all()
    work_rows = db.execute(
        select(
            WorkSession.employee_id,
            func.coalesce(func.sum(WorkSession.active_seconds), 0),
            func.coalesce(func.sum(WorkSession.idle_seconds), 0),
            func.min(WorkSession.started_at),
            func.max(WorkSession.ended_at),
        )
        .where(WorkSession.task_id == task.id)
        .group_by(WorkSession.employee_id)
    ).all()
    history = db.scalars(
        select(TaskActivity)
        .where(TaskActivity.company_id == current_admin.company_id, TaskActivity.task_id == task.id)
        .order_by(TaskActivity.created_at.desc())
        .limit(100)
    ).all()

    def comment_author(comment: TaskComment) -> str:
        if comment.admin_user_id:
            admin = db.get(AdminUser, comment.admin_user_id)
            return admin.name if admin else "Admin"
        if comment.employee_id:
            employee = db.get(Employee, comment.employee_id)
            return employee.name if employee else "Employee"
        return "System"

    return success_response(
        data={
            "comments": [
                {
                    "id": str(comment.id),
                    "body": comment.body,
                    "author_name": comment_author(comment),
                    "created_at": comment.created_at.isoformat(),
                }
                for comment in comments
            ],
            "attachments": [
                {
                    "id": str(attachment.id),
                    "file_name": attachment.file_name,
                    "content_type": attachment.content_type,
                    "size_bytes": attachment.size_bytes,
                    "created_at": attachment.created_at.isoformat(),
                }
                for attachment in attachments
            ],
            "dependencies": [
                {
                    "id": str(dependency.id),
                    "task_id": str(dependency_task.id),
                    "name": dependency_task.name,
                    "stage": dependency_task.stage,
                }
                for dependency, dependency_task in dependencies
            ],
            "work_logs": [
                {
                    "employee_id": str(employee_id),
                    "employee_name": (
                        db.get(Employee, employee_id).name
                        if db.get(Employee, employee_id)
                        else "Employee"
                    ),
                    "active_seconds": active_seconds,
                    "idle_seconds": idle_seconds,
                    "started_at": started_at.isoformat() if started_at else None,
                    "ended_at": ended_at.isoformat() if ended_at else None,
                }
                for employee_id, active_seconds, idle_seconds, started_at, ended_at in work_rows
            ],
            "history": [
                {
                    "id": str(row.id),
                    "action": row.action,
                    "actor_name": (
                        db.get(AdminUser, row.admin_user_id).name
                        if row.admin_user_id and db.get(AdminUser, row.admin_user_id)
                        else db.get(Employee, row.employee_id).name
                        if row.employee_id and db.get(Employee, row.employee_id)
                        else "System"
                    ),
                    "details": row.details or {},
                    "created_at": row.created_at.isoformat(),
                }
                for row in history
            ],
        }
    )


@router.post("/tasks/{task_id}/comments")
def create_task_comment(
    task_id: UUID,
    payload: TaskCommentCreate,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    task, _project = get_task_or_404(db, current_admin, task_id)
    comment = TaskComment(
        task_id=task.id,
        admin_user_id=current_admin.id,
        body=payload.body.strip(),
    )
    db.add(comment)
    db.flush()
    record_task_activity(
        db,
        task,
        "comment_added",
        admin=current_admin,
        details={"comment_id": str(comment.id)},
    )
    notify_task_participants(
        db,
        task,
        "task_comment",
        "New task comment",
        f"{current_admin.name} commented on {task.name}.",
        f"comment:{comment.id}",
    )
    record_audit_log(
        db,
        current_admin,
        "commented",
        "task",
        entity_id=task.id,
        entity_name=task.name,
        request=request,
    )
    db.commit()
    return success_response(data={"id": str(comment.id)}, status_code=201)


@router.post("/tasks/{task_id}/dependencies")
def create_task_dependency(
    task_id: UUID,
    payload: TaskDependencyCreate,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    task, _project = get_task_or_404(db, current_admin, task_id)
    dependency_task, _ = get_task_or_404(db, current_admin, payload.depends_on_task_id)
    if dependency_task.id == task.id:
        raise ApiError("INVALID_DEPENDENCY", "A task cannot depend on itself.", 400)
    existing = db.scalar(
        select(TaskDependency).where(
            TaskDependency.task_id == task.id,
            TaskDependency.depends_on_task_id == dependency_task.id,
        )
    )
    if existing:
        return success_response(data={"id": str(existing.id)})
    reverse = db.scalar(
        select(TaskDependency).where(
            TaskDependency.task_id == dependency_task.id,
            TaskDependency.depends_on_task_id == task.id,
        )
    )
    if reverse:
        raise ApiError("DEPENDENCY_CYCLE", "This dependency would create a cycle.", 409)
    dependency = TaskDependency(task_id=task.id, depends_on_task_id=dependency_task.id)
    db.add(dependency)
    db.commit()
    return success_response(data={"id": str(dependency.id)}, status_code=201)


@router.delete("/tasks/{task_id}/dependencies/{dependency_id}")
def delete_task_dependency(
    task_id: UUID,
    dependency_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    task, _project = get_task_or_404(db, current_admin, task_id)
    dependency = db.scalar(
        select(TaskDependency).where(
            TaskDependency.id == dependency_id, TaskDependency.task_id == task.id
        )
    )
    if dependency is None:
        raise ApiError("DEPENDENCY_NOT_FOUND", "Dependency was not found.", 404)
    db.delete(dependency)
    db.commit()
    return success_response(data={"deleted": True})


@router.post("/tasks/{task_id}/attachments")
async def upload_task_attachment(
    task_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
):
    task, _project = get_task_or_404(db, current_admin, task_id)
    content = await file.read(20 * 1024 * 1024 + 1)
    if not content:
        raise ApiError("EMPTY_ATTACHMENT", "The selected file is empty.", 400)
    if len(content) > 20 * 1024 * 1024:
        raise ApiError("ATTACHMENT_TOO_LARGE", "Attachments must be 20 MB or smaller.", 413)
    safe_name = Path(file.filename or "attachment").name[:255]
    relative_path = Path(str(current_admin.company_id)) / str(task.id) / f"{uuid4()}-{safe_name}"
    root = settings.screenshot_storage_path.parent / "task-attachments"
    target = root / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    attachment = TaskAttachment(
        company_id=current_admin.company_id,
        task_id=task.id,
        uploader_admin_user_id=current_admin.id,
        file_name=safe_name,
        content_type=file.content_type,
        size_bytes=len(content),
        storage_path=str(relative_path),
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return success_response(data={"id": str(attachment.id)}, status_code=201)


@router.get("/tasks/{task_id}/attachments/{attachment_id}/file")
def download_task_attachment(
    task_id: UUID,
    attachment_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    task, _project = get_task_or_404(db, current_admin, task_id)
    attachment = db.scalar(
        select(TaskAttachment).where(
            TaskAttachment.id == attachment_id,
            TaskAttachment.task_id == task.id,
            TaskAttachment.company_id == current_admin.company_id,
        )
    )
    if attachment is None:
        raise ApiError("ATTACHMENT_NOT_FOUND", "Attachment was not found.", 404)
    root = (settings.screenshot_storage_path.parent / "task-attachments").resolve()
    target = (root / attachment.storage_path).resolve()
    if root not in target.parents or not target.exists():
        raise ApiError("ATTACHMENT_FILE_NOT_FOUND", "Attachment file is unavailable.", 404)
    return FileResponse(target, filename=attachment.file_name, media_type=attachment.content_type)


@router.post("/tasks/{task_id}/checklist")
def create_checklist_item(
    task_id: UUID,
    payload: ChecklistItemCreate,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    task, project = get_task_or_404(db, current_admin, task_id)
    validate_assignee(db, project, payload.assignee_employee_id)
    position = max((item.position for item in task.checklist_items), default=-1) + 1
    item = TaskChecklistItem(
        task_id=task.id,
        title=payload.title.strip(),
        assignee_employee_id=payload.assignee_employee_id,
        position=position,
    )
    db.add(item)
    db.flush()
    record_task_activity(
        db,
        task,
        "checklist_item_added",
        admin=current_admin,
        details={"item": item.title},
    )
    db.commit()
    db.refresh(task)
    team = db.scalar(select(Team).where(Team.id == project.team_id))
    return success_response(data=serialize_task(task, project, team))


@router.patch("/tasks/{task_id}/checklist/{item_id}")
def update_checklist_item(
    task_id: UUID,
    item_id: UUID,
    payload: ChecklistItemUpdate,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    task, project = get_task_or_404(db, current_admin, task_id)
    item = db.scalar(
        select(TaskChecklistItem).where(
            TaskChecklistItem.id == item_id, TaskChecklistItem.task_id == task.id
        )
    )
    if item is None:
        from app.core.exceptions import ApiError

        raise ApiError("CHECKLIST_ITEM_NOT_FOUND", "Checklist item was not found.", 404)
    changes = payload.model_dump(exclude_unset=True)
    if "assignee_employee_id" in changes:
        validate_assignee(db, project, payload.assignee_employee_id)
    for key, value in changes.items():
        setattr(item, key, value.strip() if key == "title" else value)
    db.add(item)
    record_task_activity(
        db,
        task,
        "checklist_item_completed"
        if changes.get("completed") is True
        else "checklist_item_updated",
        admin=current_admin,
        details={"item": item.title, **changes},
    )
    db.commit()
    db.refresh(task)
    team = db.scalar(select(Team).where(Team.id == project.team_id))
    return success_response(data=serialize_task(task, project, team))


@router.delete("/tasks/{task_id}/checklist/{item_id}")
def delete_checklist_item(
    task_id: UUID,
    item_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    task, _ = get_task_or_404(db, current_admin, task_id)
    item = db.scalar(
        select(TaskChecklistItem).where(
            TaskChecklistItem.id == item_id, TaskChecklistItem.task_id == task.id
        )
    )
    if item is not None:
        item_title = item.title
        db.delete(item)
        record_task_activity(
            db,
            task,
            "checklist_item_deleted",
            admin=current_admin,
            details={"item": item_title},
        )
        db.commit()
    return success_response(data={"deleted": item is not None})


@router.get("/notifications")
def list_admin_notifications(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    today = date.today()
    due_tasks = db.execute(
        select(Task, Project)
        .join(Project, Project.id == Task.project_id)
        .where(
            Task.company_id == current_admin.company_id,
            Task.status == "active",
            Project.team_id.in_(accessible_team_ids_statement(current_admin)),
            Task.deadline.is_not(None),
            Task.deadline <= today + timedelta(days=3),
            Task.stage.not_in(["completed", "rejected", "cancelled"]),
        )
    ).all()
    for task, _project in due_tasks:
        overdue = bool(task.deadline and task.deadline < today)
        create_notification(
            db,
            company_id=task.company_id,
            admin_user_id=current_admin.id,
            task_id=task.id,
            notification_type="task_overdue" if overdue else "deadline_soon",
            title="Task overdue" if overdue else "Deadline approaching",
            message=f"{task.name} {'was due' if overdue else 'is due'} {task.deadline}",
            dedupe_key=f"admin:{current_admin.id}:{task.id}:deadline:{task.deadline}:{'overdue' if overdue else 'soon'}",
        )
    db.commit()
    rows = db.scalars(
        select(TaskNotification)
        .where(TaskNotification.admin_user_id == current_admin.id)
        .order_by(TaskNotification.created_at.desc())
        .limit(100)
    ).all()
    return success_response(data=[serialize_notification(row) for row in rows])


@router.patch("/notifications/{notification_id}/read")
def read_admin_notification(
    notification_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    row = db.scalar(
        select(TaskNotification).where(
            TaskNotification.id == notification_id,
            TaskNotification.admin_user_id == current_admin.id,
        )
    )
    if row is None:
        raise ApiError("NOTIFICATION_NOT_FOUND", "Notification was not found.", 404)
    row.read_at = datetime.now(UTC)
    db.commit()
    return success_response(data=serialize_notification(row))


@router.post("/notifications/read-all")
def read_all_admin_notifications(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    rows = db.scalars(
        select(TaskNotification).where(
            TaskNotification.admin_user_id == current_admin.id,
            TaskNotification.read_at.is_(None),
        )
    ).all()
    now = datetime.now(UTC)
    for row in rows:
        row.read_at = now
    db.commit()
    return success_response(data={"updated": len(rows)})


@router.delete("/tasks/{task_id}")
def archive_task(
    task_id: UUID,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    task, project = get_task_or_404(db, current_admin, task_id)
    task.status = "archived"
    db.add(task)
    db.commit()
    record_audit_log(
        db,
        current_admin,
        "archived",
        "task",
        entity_id=task.id,
        entity_name=task.name,
        details={"project_id": str(task.project_id), "team_id": str(project.team_id)},
        request=request,
    )
    db.commit()
    return success_response(data={"deleted": True})
