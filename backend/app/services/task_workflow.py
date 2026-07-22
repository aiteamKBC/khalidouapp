from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import ApiError
from app.models import (
    AdminUser,
    Employee,
    Project,
    Task,
    TaskActivity,
    TaskNotification,
    TaskWorkflowRequest,
    TeamOwner,
    WorkSession,
)
from app.services.permissions import has_capability

MAIN_STAGES = {
    "new_requests",
    "backlog",
    "assigned",
    "in_progress",
    "ready_for_review",
    "completed",
    "blocked",
    "rejected",
    "cancelled",
}
TERMINAL_STAGES = {"completed", "rejected", "cancelled"}
TRACKABLE_STAGES = {"backlog", "assigned", "in_progress"}
WORKFLOW_REQUEST_TYPES = {"task_creation", "completion"}
WORKFLOW_REQUEST_STATUSES = {"pending", "approved", "rejected"}


def record_task_activity(
    db: Session,
    task: Task,
    action: str,
    *,
    admin: AdminUser | None = None,
    employee: Employee | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    db.add(
        TaskActivity(
            company_id=task.company_id,
            task_id=task.id,
            admin_user_id=admin.id if admin else None,
            employee_id=employee.id if employee else None,
            action=action,
            details=details or {},
        )
    )


def create_notification(
    db: Session,
    *,
    company_id: UUID,
    notification_type: str,
    title: str,
    message: str,
    dedupe_key: str,
    task_id: UUID | None = None,
    employee_id: UUID | None = None,
    admin_user_id: UUID | None = None,
    workflow_request_id: UUID | None = None,
) -> None:
    if db.scalar(select(TaskNotification.id).where(TaskNotification.dedupe_key == dedupe_key)):
        return
    db.add(
        TaskNotification(
            company_id=company_id,
            employee_id=employee_id,
            admin_user_id=admin_user_id,
            task_id=task_id,
            workflow_request_id=workflow_request_id,
            notification_type=notification_type,
            title=title,
            message=message,
            dedupe_key=dedupe_key,
        )
    )


def notify_employee(
    db: Session,
    task: Task,
    employee_id: UUID | None,
    notification_type: str,
    title: str,
    message: str,
    event_key: str,
    *,
    workflow_request_id: UUID | None = None,
) -> None:
    if employee_id is None:
        return
    create_notification(
        db,
        company_id=task.company_id,
        employee_id=employee_id,
        task_id=task.id,
        workflow_request_id=workflow_request_id,
        notification_type=notification_type,
        title=title,
        message=message,
        dedupe_key=f"employee:{employee_id}:{task.id}:{event_key}",
    )


def notify_task_participants(
    db: Session,
    task: Task,
    notification_type: str,
    title: str,
    message: str,
    event_key: str,
    *,
    exclude_employee_id: UUID | None = None,
    workflow_request_id: UUID | None = None,
) -> None:
    employee_ids = {task.assignee_employee_id, *(employee.id for employee in task.collaborators)}
    for employee_id in employee_ids:
        if employee_id and employee_id != exclude_employee_id:
            notify_employee(
                db,
                task,
                employee_id,
                notification_type,
                title,
                message,
                event_key,
                workflow_request_id=workflow_request_id,
            )


def notify_project_admins(
    db: Session,
    task: Task,
    project: Project,
    notification_type: str,
    title: str,
    message: str,
    event_key: str,
    *,
    workflow_request_id: UUID | None = None,
) -> None:
    company_admin_ids = set(
        db.scalars(
            select(AdminUser.id).where(
                AdminUser.company_id == task.company_id,
                AdminUser.status == "active",
                AdminUser.role.in_(("general_admin", "hr")),
            )
        ).all()
    )
    owner_rows = db.execute(
        select(AdminUser.id, AdminUser.employee_id, AdminUser.role)
        .join(TeamOwner, TeamOwner.admin_user_id == AdminUser.id)
        .where(
            TeamOwner.team_id == project.team_id,
            AdminUser.company_id == task.company_id,
            AdminUser.status == "active",
        )
    ).all()
    owner_ids = {
        admin_id
        for admin_id, employee_id, role in owner_rows
        if role in {"general_admin", "hr"}
        or employee_id is None
        or employee_id != task.assignee_employee_id
    }
    for admin_id in company_admin_ids | owner_ids:
        create_notification(
            db,
            company_id=task.company_id,
            admin_user_id=admin_id,
            task_id=task.id,
            workflow_request_id=workflow_request_id,
            notification_type=notification_type,
            title=title,
            message=message,
            dedupe_key=f"admin:{admin_id}:{task.id}:{event_key}",
        )


def create_workflow_request(
    db: Session,
    task: Task,
    *,
    requested_by_employee_id: UUID,
    request_type: str,
    from_stage: str,
    requested_stage: str,
    request_note: str | None = None,
) -> TaskWorkflowRequest:
    if request_type not in WORKFLOW_REQUEST_TYPES:
        raise ApiError("INVALID_WORKFLOW_REQUEST", "Workflow request type is not supported.", 400)
    pending = db.scalar(
        select(TaskWorkflowRequest.id).where(
            TaskWorkflowRequest.task_id == task.id,
            TaskWorkflowRequest.status == "pending",
        )
    )
    if pending is not None:
        raise ApiError(
            "WORKFLOW_REQUEST_PENDING",
            "This task already has a pending workflow request.",
            409,
        )
    row = TaskWorkflowRequest(
        company_id=task.company_id,
        task_id=task.id,
        requested_by_employee_id=requested_by_employee_id,
        request_type=request_type,
        from_stage=from_stage,
        requested_stage=requested_stage,
        status="pending",
        request_note=(request_note or "").strip() or None,
    )
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
    except IntegrityError as exc:
        raise ApiError(
            "WORKFLOW_REQUEST_PENDING",
            "This task already has a pending workflow request.",
            409,
        ) from exc
    return row


def mark_task_blocked(
    task: Task,
    reason: str,
    *,
    employee: Employee | None = None,
    admin: AdminUser | None = None,
) -> None:
    clean_reason = reason.strip()
    if not clean_reason:
        raise ApiError("BLOCK_REASON_REQUIRED", "Explain why the task is blocked.", 400)
    task.blocked_reason = clean_reason
    task.blocked_at = datetime.now(UTC)
    task.blocked_by_employee_id = employee.id if employee else None
    task.blocked_by_admin_user_id = admin.id if admin else None
    task.block_resolution_note = None


def resolve_task_block(task: Task, note: str) -> None:
    clean_note = note.strip()
    if not clean_note:
        raise ApiError(
            "BLOCK_RESOLUTION_REQUIRED",
            "Explain how the blocker was resolved.",
            400,
        )
    task.block_resolution_note = clean_note
    task.blocked_reason = None


def workflow_request_for_decision(
    db: Session,
    task: Task,
    request_type: str,
) -> TaskWorkflowRequest:
    row = db.scalar(
        select(TaskWorkflowRequest)
        .where(
            TaskWorkflowRequest.task_id == task.id,
            TaskWorkflowRequest.request_type == request_type,
        )
        .order_by(TaskWorkflowRequest.created_at.desc())
        .limit(1)
    )
    if row is None:
        raise ApiError(
            "WORKFLOW_REQUEST_NOT_FOUND",
            "No workflow request exists for this task.",
            409,
        )
    if row.status != "pending":
        raise ApiError(
            "WORKFLOW_REQUEST_ALREADY_DECIDED",
            "This workflow request has already been decided.",
            409,
        )
    return row


def pending_workflow_request(db: Session, task_id: UUID) -> TaskWorkflowRequest | None:
    return db.scalar(
        select(TaskWorkflowRequest)
        .where(
            TaskWorkflowRequest.task_id == task_id,
            TaskWorkflowRequest.status == "pending",
        )
        .order_by(TaskWorkflowRequest.created_at.desc())
        .limit(1)
    )


def resolve_workflow_request(
    db: Session,
    row: TaskWorkflowRequest,
    *,
    status: str,
    reviewed_by_admin: AdminUser,
    decision_note: str | None = None,
    return_stage: str | None = None,
) -> TaskWorkflowRequest:
    if status not in {"approved", "rejected"}:
        raise ApiError("INVALID_WORKFLOW_DECISION", "Workflow decision is not supported.", 400)
    reviewed_at = datetime.now(UTC)
    result = db.execute(
        update(TaskWorkflowRequest)
        .where(
            TaskWorkflowRequest.id == row.id,
            TaskWorkflowRequest.status == "pending",
        )
        .values(
            status=status,
            decision_note=(decision_note or "").strip() or None,
            return_stage=return_stage,
            reviewed_by_admin_user_id=reviewed_by_admin.id,
            reviewed_at=reviewed_at,
            updated_at=reviewed_at,
        )
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        raise ApiError(
            "WORKFLOW_REQUEST_ALREADY_DECIDED",
            "This workflow request has already been decided.",
            409,
        )
    db.flush()
    db.refresh(row)
    return row


def ensure_workflow_decision_allowed(
    db: Session,
    admin: AdminUser,
    task: Task,
    project: Project,
) -> None:
    if has_capability(admin, "tasks.review_all"):
        return
    owns_team = db.scalar(
        select(TeamOwner.id).where(
            TeamOwner.team_id == project.team_id,
            TeamOwner.admin_user_id == admin.id,
        )
    )
    if owns_team is None:
        raise ApiError("FORBIDDEN_TEAM", "You do not have access to this team.", 403)
    if admin.employee_id is not None and task.assignee_employee_id == admin.employee_id:
        raise ApiError(
            "SELF_REVIEW_FORBIDDEN",
            "Team owners cannot decide workflow requests for their own tasks.",
            403,
        )


def ensure_admin_task_stage_change_allowed(
    db: Session,
    admin: AdminUser,
    task: Task,
    next_stage: str,
) -> None:
    pending = pending_workflow_request(db, task.id)
    if task.stage == "ready_for_review" and pending is not None:
        raise ApiError(
            "WORKFLOW_REQUEST_PENDING",
            "Use a workflow decision endpoint to resolve this review request.",
            409,
        )
    is_team_owner_self = (
        admin.role == "team_owner"
        and admin.employee_id is not None
        and task.assignee_employee_id == admin.employee_id
    )
    if is_team_owner_self and next_stage in TERMINAL_STAGES | {"ready_for_review"}:
        raise ApiError(
            "SELF_REVIEW_FORBIDDEN",
            "Team owners cannot bypass workflow review for their own tasks.",
            403,
        )


def serialize_workflow_request(row: TaskWorkflowRequest) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "task_id": str(row.task_id),
        "requested_by_employee_id": str(row.requested_by_employee_id),
        "request_type": row.request_type,
        "from_stage": row.from_stage,
        "requested_stage": row.requested_stage,
        "status": row.status,
        "request_note": row.request_note,
        "decision_note": row.decision_note,
        "return_stage": row.return_stage,
        "reviewed_by_admin_user_id": (
            str(row.reviewed_by_admin_user_id) if row.reviewed_by_admin_user_id else None
        ),
        "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
        "created_at": row.created_at.isoformat(),
    }


def ensure_completion_allowed(task: Task, note: str | None) -> None:
    incomplete = [item for item in task.checklist_items if not item.completed]
    if incomplete and not (note or "").strip():
        raise ApiError(
            "CHECKLIST_INCOMPLETE",
            "Complete the checklist or provide a completion reason.",
            400,
            details={"incomplete_items": len(incomplete)},
        )


def validate_employee_stage_change(task: Task, next_stage: str, note: str | None = None) -> None:
    if next_stage not in MAIN_STAGES:
        raise ApiError("INVALID_TASK_STAGE", "Task stage is not supported.", 400)
    if task.stage == "new_requests" and task.created_by_employee_id is not None:
        raise ApiError("TASK_AWAITING_APPROVAL", "An admin must approve this task first.", 409)
    if task.stage in TERMINAL_STAGES:
        raise ApiError("TASK_STAGE_LOCKED", "This task is already closed.", 409)
    allowed: dict[str, set[str]] = {
        "new_requests": {"assigned", "in_progress", "blocked"},
        "backlog": {"assigned", "in_progress", "blocked"},
        "assigned": {"in_progress", "ready_for_review", "blocked", "completed"},
        "in_progress": {"assigned", "ready_for_review", "blocked", "completed"},
        "blocked": {"in_progress"},
        "ready_for_review": set(),
    }
    if next_stage not in allowed.get(task.stage, set()):
        raise ApiError(
            "INVALID_STAGE_TRANSITION",
            f"Cannot move a task from {task.stage} to {next_stage}.",
            409,
        )
    if next_stage == "blocked" and not (note or "").strip():
        raise ApiError("BLOCK_REASON_REQUIRED", "Explain why the task is blocked.", 400)
    if task.stage == "blocked" and next_stage == "in_progress" and not (note or "").strip():
        raise ApiError(
            "BLOCK_RESOLUTION_REQUIRED",
            "Explain how the blocker was resolved.",
            400,
        )
    if next_stage == "completed":
        raise ApiError(
            "TASK_REVIEW_REQUIRED",
            "Submit this task for review instead of completing it directly.",
            409,
        )


def sync_due_notifications_for_employee(db: Session, employee: Employee) -> None:
    today = date.today()
    rows = db.scalars(
        select(Task).where(
            Task.company_id == employee.company_id,
            Task.status == "active",
            Task.assignee_employee_id == employee.id,
            Task.deadline.is_not(None),
            Task.stage.in_(list(TRACKABLE_STAGES)),
            Task.deadline <= today + timedelta(days=3),
        )
    ).all()
    for task in rows:
        overdue = bool(task.deadline and task.deadline < today)
        notify_employee(
            db,
            task,
            employee.id,
            "task_overdue" if overdue else "deadline_soon",
            "Task overdue" if overdue else "Deadline approaching",
            f"{task.name} was due {task.deadline}"
            if overdue
            else f"{task.name} is due {task.deadline}",
            f"deadline:{task.deadline}:{'overdue' if overdue else 'soon'}",
        )
    db.commit()


def serialize_notification(row: TaskNotification) -> dict[str, Any]:
    workflow_request = row.workflow_request
    return {
        "id": str(row.id),
        "task_id": str(row.task_id) if row.task_id else None,
        "type": row.notification_type,
        "workflow_request_id": str(row.workflow_request_id) if row.workflow_request_id else None,
        "workflow_request": (
            serialize_workflow_request(workflow_request) if workflow_request else None
        ),
        "title": row.title,
        "message": row.message,
        "read_at": row.read_at.isoformat() if row.read_at else None,
        "created_at": row.created_at.isoformat(),
    }


def stop_task_tracking(db: Session, task: Task, *, reason: str) -> int:
    now = datetime.now(UTC)
    sessions = db.scalars(
        select(WorkSession).where(
            WorkSession.task_id == task.id,
            WorkSession.ended_at.is_(None),
        )
    ).all()
    for session in sessions:
        session.ended_at = now
        session.status = "ended"
    if sessions:
        record_task_activity(
            db, task, "tracking_stopped", details={"reason": reason, "sessions": len(sessions)}
        )
    return len(sessions)
