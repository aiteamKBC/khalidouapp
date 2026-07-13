from calendar import monthrange
from datetime import UTC, date, datetime, timedelta
from typing import Annotated
from uuid import UUID, uuid4
from pathlib import Path

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_employee
from app.api.v1.timesheets import timesheet_rows
from app.core.config import settings
from app.core.exceptions import ApiError
from app.core.responses import success_response
from app.database.session import get_db
from app.models import (
    Device,
    AdminUser,
    Employee,
    Project,
    Screenshot,
    Task,
    TaskCollaborator,
    TaskChecklistItem,
    TaskAttachment,
    TaskComment,
    TaskNotification,
    Team,
    TeamMember,
    TimeAdjustmentRequest,
)
from app.schemas.employee_portal import EmployeePortalTaskCreate, EmployeePortalTaskUpdate, EmployeePortalTimeRequestCreate
from app.schemas.admin import ChecklistItemCreate, ChecklistItemUpdate, TaskCommentCreate
from app.services.projects import (
    employee_task_time_totals,
    serialize_project,
    serialize_task,
    validate_task_dates,
)
from app.services.task_workflow import (
    create_workflow_request,
    mark_task_blocked,
    notify_project_admins,
    notify_task_participants,
    record_task_activity,
    resolve_task_block,
    serialize_notification,
    sync_due_notifications_for_employee,
    validate_employee_stage_change,
    stop_task_tracking,
)
from app.services.screenshots import serialize_screenshot
from app.services.time_adjustments import serialize_time_adjustment_request

router = APIRouter(prefix="/employee-portal", tags=["employee-portal"])


def participant_task(db: Session, employee: Employee, task_id: UUID) -> tuple[Task, Project, Team]:
    row = db.execute(
        select(Task, Project, Team)
        .join(Project, Project.id == Task.project_id)
        .join(Team, Team.id == Project.team_id)
        .outerjoin(TaskCollaborator, TaskCollaborator.task_id == Task.id)
        .where(
            Task.id == task_id,
            Task.company_id == employee.company_id,
            Task.stage.not_in(["rejected", "cancelled"]),
            ((Task.assignee_employee_id == employee.id) | (TaskCollaborator.employee_id == employee.id)),
        )
        .distinct()
    ).one_or_none()
    if row is None:
        raise ApiError("TASK_NOT_FOUND", "Your assigned task was not found.", 404)
    return row


def period_summary(rows: list[dict], manual_status_seconds: dict[str, int] | None = None) -> dict:
    active_seconds = sum(int(row["active_seconds"]) for row in rows)
    idle_seconds = sum(int(row["idle_seconds"]) for row in rows)
    approved_manual_seconds = sum(int(row["adjustment_seconds"]) for row in rows)
    manual_status_seconds = manual_status_seconds or {}
    return {
        "active_seconds": active_seconds,
        "tracked_active_seconds": max(0, active_seconds - approved_manual_seconds),
        "idle_seconds": idle_seconds,
        "tracked_seconds": active_seconds + idle_seconds,
        "adjustment_seconds": approved_manual_seconds,
        "manual_approved_seconds": approved_manual_seconds,
        "manual_pending_seconds": int(manual_status_seconds.get("pending", 0)),
        "manual_rejected_seconds": int(manual_status_seconds.get("rejected", 0)),
        "deducted_seconds": sum(int(row.get("deducted_seconds", 0)) for row in rows),
        "screenshot_count": sum(int(row["screenshot_count"]) for row in rows),
        "points": round(active_seconds / 3600, 2),
    }


def manual_request_status_seconds(
    db: Session,
    employee: Employee,
    start_date: date,
    end_date: date,
) -> dict[str, int]:
    rows = db.scalars(
        select(TimeAdjustmentRequest).where(
            TimeAdjustmentRequest.company_id == employee.company_id,
            TimeAdjustmentRequest.employee_id == employee.id,
            TimeAdjustmentRequest.requested_date >= start_date,
            TimeAdjustmentRequest.requested_date <= end_date,
        )
    ).all()
    result = {"pending": 0, "rejected": 0}
    for row in rows:
        if row.status in result:
            result[row.status] += int(row.requested_seconds)
    return result


@router.get("/summary")
def summary(
    current_employee: Annotated[Employee, Depends(get_current_employee)],
    db: Annotated[Session, Depends(get_db)],
):
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    month_end = today.replace(day=monthrange(today.year, today.month)[1])
    daily_rows = timesheet_rows(db, current_employee.company_id, today, today, current_employee.id)
    weekly_rows = timesheet_rows(
        db,
        current_employee.company_id,
        week_start,
        week_start + timedelta(days=6),
        current_employee.id,
    )
    monthly_rows = timesheet_rows(
        db,
        current_employee.company_id,
        month_start,
        month_end,
        current_employee.id,
    )
    return success_response(
        data={
            "today": period_summary(
                daily_rows,
                manual_request_status_seconds(db, current_employee, today, today),
            ),
            "week": period_summary(
                weekly_rows,
                manual_request_status_seconds(
                    db,
                    current_employee,
                    week_start,
                    week_start + timedelta(days=6),
                ),
            ),
            "month": period_summary(
                monthly_rows,
                manual_request_status_seconds(db, current_employee, month_start, month_end),
            ),
            "days": monthly_rows,
            "points_rule": "1 hour of approved active work = 1 point",
        }
    )


@router.get("/tasks")
def tasks(
    current_employee: Annotated[Employee, Depends(get_current_employee)],
    db: Annotated[Session, Depends(get_db)],
):
    rows = db.execute(
        select(Task, Project, Team)
        .join(Project, Project.id == Task.project_id)
        .join(Team, Team.id == Project.team_id)
        .join(TeamMember, TeamMember.team_id == Team.id)
        .outerjoin(TaskCollaborator, TaskCollaborator.task_id == Task.id)
        .where(
            Task.company_id == current_employee.company_id,
            Task.status == "active",
            Project.status == "active",
            Team.status == "active",
            TeamMember.employee_id == current_employee.id,
            TeamMember.status == "active",
            Task.stage.not_in(["rejected", "cancelled"]),
            (
                (Task.assignee_employee_id == current_employee.id)
                | (TaskCollaborator.employee_id == current_employee.id)
            ),
        )
        .distinct()
        .order_by(Team.name, Project.name, Task.name)
    ).all()
    time_totals = employee_task_time_totals(
        db,
        company_id=current_employee.company_id,
        employee_id=current_employee.id,
        task_ids=[task.id for task, _project, _team in rows],
    )
    data = []
    for task, project, team in rows:
        item = serialize_task(task, project, team)
        item["can_update_stage"] = task.assignee_employee_id == current_employee.id
        item.update(
            time_totals.get(
                task.id,
                {"active_seconds": 0, "idle_seconds": 0, "tracked_seconds": 0},
            )
        )
        data.append(item)
    return success_response(data=data)


@router.get("/projects")
def projects(current_employee: Annotated[Employee, Depends(get_current_employee)], db: Annotated[Session, Depends(get_db)]):
    rows = db.scalars(
        select(Project).join(TeamMember, TeamMember.team_id == Project.team_id).where(
            Project.company_id == current_employee.company_id,
            Project.status == "active",
            TeamMember.employee_id == current_employee.id,
            TeamMember.status == "active",
        ).order_by(Project.name)
    ).all()
    return success_response(data=[serialize_project(project) for project in rows])


@router.post("/tasks")
def create_own_task(payload: EmployeePortalTaskCreate, current_employee: Annotated[Employee, Depends(get_current_employee)], db: Annotated[Session, Depends(get_db)]):
    project = db.scalar(select(Project).join(TeamMember, TeamMember.team_id == Project.team_id).where(
        Project.id == payload.project_id,
        Project.company_id == current_employee.company_id,
        Project.status == "active",
        TeamMember.employee_id == current_employee.id,
        TeamMember.status == "active",
    ))
    if project is None:
        raise ApiError("INVALID_PROJECT", "Project is not available to your teams.", 400)
    clean_name = " ".join(payload.name.split())
    validate_task_dates(payload.start_date, payload.deadline)
    if db.scalar(select(Task.id).where(Task.project_id == project.id, Task.name == clean_name)):
        raise ApiError("TASK_NAME_IN_USE", "A task with this name already exists in the project.", 409)
    task = Task(
        company_id=current_employee.company_id,
        project_id=project.id,
        assignee_employee_id=current_employee.id,
        created_by_employee_id=current_employee.id,
        name=clean_name,
        description=payload.description,
        stage="new_requests",
        status="active",
        start_date=payload.start_date,
        deadline=payload.deadline,
        estimated_minutes=payload.estimated_minutes,
        priority=payload.priority,
        completed_at=None,
    )
    db.add(task)
    db.flush()
    workflow_request = create_workflow_request(
        db,
        task,
        requested_by_employee_id=current_employee.id,
        request_type="task_creation",
        from_stage="new_requests",
        requested_stage="assigned",
    )
    record_task_activity(
        db,
        task,
        "employee_task_requested",
        employee=current_employee,
        details={"workflow_request_id": str(workflow_request.id)},
    )
    notify_project_admins(
        db,
        task,
        project,
        "task_approval_requested",
        "New task needs approval",
        f"{current_employee.name} requested: {task.name}",
        "employee-task-requested",
        workflow_request_id=workflow_request.id,
    )
    db.commit()
    db.refresh(task)
    team = db.scalar(select(Team).where(Team.id == project.team_id))
    return success_response(data=serialize_task(task, project, team))


@router.patch("/tasks/{task_id}")
def update_own_task(task_id: UUID, payload: EmployeePortalTaskUpdate, current_employee: Annotated[Employee, Depends(get_current_employee)], db: Annotated[Session, Depends(get_db)]):
    task, project, team = participant_task(db, current_employee, task_id)
    is_assignee = task.assignee_employee_id == current_employee.id
    is_collaborator = any(employee.id == current_employee.id for employee in task.collaborators)
    if not (is_assignee or is_collaborator):
        raise ApiError("TASK_FORBIDDEN", "You are not a participant on this task.", 403)
    changes = payload.model_dump(exclude_unset=True)
    note = changes.pop("note", None)
    if task.created_by_employee_id == current_employee.id and task.stage == "new_requests":
        forbidden = set(changes) - {"name", "description", "start_date", "deadline", "estimated_minutes"}
        if forbidden:
            raise ApiError("TASK_AWAITING_APPROVAL", "An admin must approve this task first.", 409)
    else:
        forbidden = set(changes) - {"stage"}
        if forbidden:
            raise ApiError("TASK_FIELDS_FORBIDDEN", "Only managers can change task details.", 403)
    if "stage" in changes:
        if not is_assignee:
            raise ApiError("TASK_STAGE_FORBIDDEN", "Only the primary assignee can change stage.", 403)
        validate_employee_stage_change(task, changes["stage"], note)
        if changes["stage"] == "ready_for_review":
            workflow_request = create_workflow_request(
                db,
                task,
                requested_by_employee_id=current_employee.id,
                request_type="completion",
                from_stage=task.stage,
                requested_stage="completed",
                request_note=note,
            )
            task.review_note = note
            notify_project_admins(
                db, task, project, "task_review_requested", "Task ready for review",
                f"{current_employee.name} submitted {task.name} for review.",
                f"review-requested:{datetime.now(UTC).isoformat()}",
                workflow_request_id=workflow_request.id,
            )
            stop_task_tracking(db, task, reason="submitted_for_review")
        elif changes["stage"] == "blocked":
            mark_task_blocked(task, note or "", employee=current_employee)
            stop_task_tracking(db, task, reason="task_blocked")
            notify_project_admins(
                db,
                task,
                project,
                "task_blocked",
                "Task blocked",
                f"{current_employee.name} blocked {task.name}: {note}",
                f"blocked:{datetime.now(UTC).isoformat()}",
            )
        elif changes["stage"] == "in_progress":
            if task.stage == "blocked":
                resolve_task_block(task, note or "")
        activity_details = {"from": task.stage, "to": changes["stage"], "note": note}
        if changes["stage"] == "ready_for_review":
            activity_details["workflow_request_id"] = str(workflow_request.id)
        record_task_activity(
            db,
            task,
            "stage_changed",
            employee=current_employee,
            details=activity_details,
        )
    for key, value in changes.items():
        setattr(task, key, value)
    validate_task_dates(task.start_date, task.deadline)
    db.add(task)
    db.commit()
    db.refresh(task)
    return success_response(data=serialize_task(task, project, team))


@router.post("/tasks/{task_id}/checklist")
def create_own_checklist_item(
    task_id: UUID,
    payload: ChecklistItemCreate,
    current_employee: Annotated[Employee, Depends(get_current_employee)],
    db: Annotated[Session, Depends(get_db)],
):
    task, project, team = participant_task(db, current_employee, task_id)
    if task.stage in {"completed", "rejected", "cancelled"}:
        raise ApiError("TASK_STAGE_LOCKED", "Closed tasks cannot be changed.", 409)
    if payload.assignee_employee_id:
        valid = db.scalar(select(TeamMember.id).where(
            TeamMember.team_id == project.team_id,
            TeamMember.employee_id == payload.assignee_employee_id,
            TeamMember.status == "active",
        ))
        if not valid:
            raise ApiError("INVALID_ASSIGNEE", "Checklist assignee must belong to the team.", 400)
    item = TaskChecklistItem(
        task_id=task.id,
        title=payload.title.strip(),
        assignee_employee_id=payload.assignee_employee_id,
        position=max((entry.position for entry in task.checklist_items), default=-1) + 1,
    )
    db.add(item)
    db.flush()
    record_task_activity(db, task, "checklist_item_added", employee=current_employee, details={"item": item.title})
    db.commit()
    db.refresh(task)
    return success_response(data=serialize_task(task, project, team))


@router.patch("/tasks/{task_id}/checklist/{item_id}")
def update_own_checklist_item(
    task_id: UUID,
    item_id: UUID,
    payload: ChecklistItemUpdate,
    current_employee: Annotated[Employee, Depends(get_current_employee)],
    db: Annotated[Session, Depends(get_db)],
):
    task, project, team = participant_task(db, current_employee, task_id)
    if task.stage in {"completed", "rejected", "cancelled"}:
        raise ApiError("TASK_STAGE_LOCKED", "Closed tasks cannot be changed.", 409)
    item = db.scalar(select(TaskChecklistItem).where(TaskChecklistItem.id == item_id, TaskChecklistItem.task_id == task.id))
    if item is None:
        raise ApiError("CHECKLIST_ITEM_NOT_FOUND", "Checklist item was not found.", 404)
    changes = payload.model_dump(exclude_unset=True)
    if "assignee_employee_id" in changes and changes["assignee_employee_id"]:
        valid = db.scalar(select(TeamMember.id).where(
            TeamMember.team_id == project.team_id,
            TeamMember.employee_id == changes["assignee_employee_id"],
            TeamMember.status == "active",
        ))
        if not valid:
            raise ApiError("INVALID_ASSIGNEE", "Checklist assignee must belong to the team.", 400)
    for key, value in changes.items():
        setattr(item, key, value.strip() if key == "title" else value)
    record_task_activity(
        db, task,
        "checklist_item_completed" if changes.get("completed") is True else "checklist_item_updated",
        employee=current_employee,
        details={"item": item.title, **changes},
    )
    db.commit()
    db.refresh(task)
    return success_response(data=serialize_task(task, project, team))


@router.delete("/tasks/{task_id}/checklist/{item_id}")
def delete_own_checklist_item(
    task_id: UUID,
    item_id: UUID,
    current_employee: Annotated[Employee, Depends(get_current_employee)],
    db: Annotated[Session, Depends(get_db)],
):
    task, _project, _team = participant_task(db, current_employee, task_id)
    item = db.scalar(select(TaskChecklistItem).where(TaskChecklistItem.id == item_id, TaskChecklistItem.task_id == task.id))
    if item is None:
        raise ApiError("CHECKLIST_ITEM_NOT_FOUND", "Checklist item was not found.", 404)
    title = item.title
    db.delete(item)
    record_task_activity(db, task, "checklist_item_deleted", employee=current_employee, details={"item": title})
    db.commit()
    return success_response(data={"deleted": True})


@router.get("/tasks/{task_id}/workspace")
def own_task_workspace(
    task_id: UUID,
    current_employee: Annotated[Employee, Depends(get_current_employee)],
    db: Annotated[Session, Depends(get_db)],
):
    task, _project, _team = participant_task(db, current_employee, task_id)
    comments = db.scalars(select(TaskComment).where(TaskComment.task_id == task.id).order_by(TaskComment.created_at.desc())).all()
    attachments = db.scalars(select(TaskAttachment).where(TaskAttachment.task_id == task.id).order_by(TaskAttachment.created_at.desc())).all()
    return success_response(data={
        "comments": [
            {
                "id": str(comment.id),
                "body": comment.body,
                "author_name": (
                    db.get(Employee, comment.employee_id).name
                    if comment.employee_id and db.get(Employee, comment.employee_id)
                    else db.get(AdminUser, comment.admin_user_id).name
                    if comment.admin_user_id and db.get(AdminUser, comment.admin_user_id)
                    else "System"
                ),
                "created_at": comment.created_at.isoformat(),
            }
            for comment in comments
        ],
        "attachments": [
            {
                "id": str(attachment.id),
                "file_name": attachment.file_name,
                "size_bytes": attachment.size_bytes,
                "created_at": attachment.created_at.isoformat(),
            }
            for attachment in attachments
        ],
    })


@router.post("/tasks/{task_id}/comments")
def create_own_task_comment(
    task_id: UUID,
    payload: TaskCommentCreate,
    current_employee: Annotated[Employee, Depends(get_current_employee)],
    db: Annotated[Session, Depends(get_db)],
):
    task, project, _team = participant_task(db, current_employee, task_id)
    comment = TaskComment(task_id=task.id, employee_id=current_employee.id, body=payload.body.strip())
    db.add(comment)
    db.flush()
    record_task_activity(db, task, "comment_added", employee=current_employee, details={"comment_id": str(comment.id)})
    notify_task_participants(
        db, task, "task_comment", "New task comment",
        f"{current_employee.name} commented on {task.name}.",
        f"comment:{comment.id}", exclude_employee_id=current_employee.id,
    )
    notify_project_admins(
        db, task, project, "task_comment", "New task comment",
        f"{current_employee.name} commented on {task.name}.", f"comment:{comment.id}",
    )
    db.commit()
    return success_response(data={"id": str(comment.id)}, status_code=201)


@router.post("/tasks/{task_id}/attachments")
async def upload_own_task_attachment(
    task_id: UUID,
    current_employee: Annotated[Employee, Depends(get_current_employee)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
):
    task, project, _team = participant_task(db, current_employee, task_id)
    content = await file.read(20 * 1024 * 1024 + 1)
    if not content:
        raise ApiError("EMPTY_ATTACHMENT", "The selected file is empty.", 400)
    if len(content) > 20 * 1024 * 1024:
        raise ApiError("ATTACHMENT_TOO_LARGE", "Attachments must be 20 MB or smaller.", 413)
    safe_name = Path(file.filename or "attachment").name[:255]
    relative_path = Path(str(current_employee.company_id)) / str(task.id) / f"{uuid4()}-{safe_name}"
    root = settings.screenshot_storage_path.parent / "task-attachments"
    target = root / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    attachment = TaskAttachment(
        company_id=current_employee.company_id,
        task_id=task.id,
        uploader_employee_id=current_employee.id,
        file_name=safe_name,
        content_type=file.content_type,
        size_bytes=len(content),
        storage_path=str(relative_path),
    )
    db.add(attachment)
    db.flush()
    record_task_activity(db, task, "attachment_added", employee=current_employee, details={"file_name": safe_name})
    notify_project_admins(
        db, task, project, "task_attachment", "Task attachment added",
        f"{current_employee.name} attached {safe_name} to {task.name}.", f"attachment:{attachment.id}",
    )
    db.commit()
    return success_response(data={"id": str(attachment.id)}, status_code=201)


@router.get("/tasks/{task_id}/attachments/{attachment_id}/file")
def download_own_task_attachment(
    task_id: UUID,
    attachment_id: UUID,
    current_employee: Annotated[Employee, Depends(get_current_employee)],
    db: Annotated[Session, Depends(get_db)],
):
    task, _project, _team = participant_task(db, current_employee, task_id)
    attachment = db.scalar(select(TaskAttachment).where(TaskAttachment.id == attachment_id, TaskAttachment.task_id == task.id))
    if attachment is None:
        raise ApiError("ATTACHMENT_NOT_FOUND", "Attachment was not found.", 404)
    root = (settings.screenshot_storage_path.parent / "task-attachments").resolve()
    target = (root / attachment.storage_path).resolve()
    if root not in target.parents or not target.exists():
        raise ApiError("ATTACHMENT_FILE_NOT_FOUND", "Attachment file is unavailable.", 404)
    return FileResponse(target, filename=attachment.file_name, media_type=attachment.content_type)


@router.get("/notifications")
def notifications(
    current_employee: Annotated[Employee, Depends(get_current_employee)],
    db: Annotated[Session, Depends(get_db)],
):
    sync_due_notifications_for_employee(db, current_employee)
    rows = db.scalars(
        select(TaskNotification)
        .where(TaskNotification.employee_id == current_employee.id)
        .order_by(TaskNotification.created_at.desc())
        .limit(100)
    ).all()
    return success_response(data=[serialize_notification(row) for row in rows])


@router.patch("/notifications/{notification_id}/read")
def read_notification(
    notification_id: UUID,
    current_employee: Annotated[Employee, Depends(get_current_employee)],
    db: Annotated[Session, Depends(get_db)],
):
    row = db.scalar(
        select(TaskNotification).where(
            TaskNotification.id == notification_id,
            TaskNotification.employee_id == current_employee.id,
        )
    )
    if row is None:
        raise ApiError("NOTIFICATION_NOT_FOUND", "Notification was not found.", 404)
    row.read_at = datetime.now(UTC)
    db.commit()
    return success_response(data=serialize_notification(row))


@router.post("/notifications/read-all")
def read_all_notifications(
    current_employee: Annotated[Employee, Depends(get_current_employee)],
    db: Annotated[Session, Depends(get_db)],
):
    rows = db.scalars(
        select(TaskNotification).where(
            TaskNotification.employee_id == current_employee.id,
            TaskNotification.read_at.is_(None),
        )
    ).all()
    now = datetime.now(UTC)
    for row in rows:
        row.read_at = now
    db.commit()
    return success_response(data={"updated": len(rows)})


@router.get("/screenshots")
def screenshots(
    current_employee: Annotated[Employee, Depends(get_current_employee)],
    db: Annotated[Session, Depends(get_db)],
    page_size: int = Query(default=50, ge=1, le=100),
):
    rows = db.scalars(
        select(Screenshot)
        .where(
            Screenshot.company_id == current_employee.company_id,
            Screenshot.employee_id == current_employee.id,
            Screenshot.deleted_at.is_(None),
        )
        .order_by(Screenshot.captured_at.desc())
        .limit(page_size)
    ).all()
    data = []
    for screenshot in rows:
        item = serialize_screenshot(screenshot)
        item["temporary_url"] = f"/api/v1/employee-portal/screenshots/{screenshot.id}/file"
        data.append(item)
    return success_response(data=data)


@router.get("/screenshots/{screenshot_id}/file")
def screenshot_file(
    screenshot_id: UUID,
    current_employee: Annotated[Employee, Depends(get_current_employee)],
    db: Annotated[Session, Depends(get_db)],
):
    screenshot = db.scalar(
        select(Screenshot).where(
            Screenshot.id == screenshot_id,
            Screenshot.company_id == current_employee.company_id,
            Screenshot.employee_id == current_employee.id,
            Screenshot.deleted_at.is_(None),
        )
    )
    if screenshot is None:
        raise ApiError("SCREENSHOT_NOT_FOUND", "Screenshot was not found.", 404)
    path = (settings.screenshot_storage_path / screenshot.storage_path).resolve()
    if not path.exists():
        raise ApiError("SCREENSHOT_FILE_NOT_FOUND", "Screenshot file was not found.", 404)
    return FileResponse(path, media_type=screenshot.mime_type)


@router.get("/time-adjustment-requests")
def list_time_requests(
    current_employee: Annotated[Employee, Depends(get_current_employee)],
    db: Annotated[Session, Depends(get_db)],
):
    rows = db.scalars(
        select(TimeAdjustmentRequest)
        .where(
            TimeAdjustmentRequest.company_id == current_employee.company_id,
            TimeAdjustmentRequest.employee_id == current_employee.id,
        )
        .order_by(TimeAdjustmentRequest.created_at.desc())
        .limit(50)
    ).all()
    return success_response(data=[serialize_time_adjustment_request(row) for row in rows])


@router.post("/time-adjustment-requests")
def create_time_request(
    payload: EmployeePortalTimeRequestCreate,
    current_employee: Annotated[Employee, Depends(get_current_employee)],
    db: Annotated[Session, Depends(get_db)],
):
    device = db.scalar(
        select(Device)
        .where(
            Device.company_id == current_employee.company_id,
            Device.employee_id == current_employee.id,
        )
        .order_by(Device.last_seen_at.desc().nullslast())
    )
    row = TimeAdjustmentRequest(
        company_id=current_employee.company_id,
        employee_id=current_employee.id,
        device_id=device.id if device else None,
        requested_date=payload.requested_date or date.today(),
        requested_seconds=payload.requested_minutes * 60,
        reason=payload.reason.strip(),
        status="pending",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return success_response(data=serialize_time_adjustment_request(row))
