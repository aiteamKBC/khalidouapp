from calendar import monthrange
from datetime import date, timedelta
from typing import Annotated
from uuid import UUID
from datetime import UTC, datetime

from fastapi import APIRouter, Body, Depends, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import DeviceAuthContext, get_current_device
from app.api.v1.employee_portal import manual_request_status_seconds, period_summary
from app.api.v1.timesheets import timesheet_rows
from app.core.responses import success_response
from app.core.security import create_employee_handoff_token
from app.database.session import get_db
from app.models import Employee, Project, Task, Team, TeamMember, TimeAdjustmentRequest
from app.schemas.agent import AgentTaskCreate, AgentTaskUpdate, AgentTimeAdjustmentRequestCreate, EnrollmentRequest, RefreshDeviceTokenRequest
from app.schemas.session import (
    ActivityEventRequest,
    HeartbeatRequest,
    SessionEndRequest,
    SessionTaskUpdateRequest,
    SessionStartRequest,
)
from app.schemas.screenshot import ScreenshotCompleteRequest, ScreenshotInitiateRequest
from app.services.device_enrollment import (
    enroll_device,
    get_or_create_tracking_settings,
    refresh_device_token,
    serialize_tracking_settings,
)
from app.services.session_tracking import (
    current_session_response,
    end_session,
    record_agent_event,
    record_heartbeat,
    start_or_get_session,
    update_session_task,
)
from app.services.screenshots import complete_screenshot, initiate_screenshot, upload_screenshot_content
from app.services.projects import (
    ensure_general_work_project,
    list_employee_tasks,
    serialize_task,
    validate_task_dates,
)
from app.services.task_workflow import (
    create_workflow_request,
    mark_task_blocked,
    notify_project_admins,
    record_task_activity,
    resolve_task_block,
    validate_employee_stage_change,
    stop_task_tracking,
)
from app.services.time_adjustments import (
    create_employee_time_adjustment_request,
    serialize_time_adjustment_request,
)

router = APIRouter(prefix="/agent", tags=["desktop-agent"])


@router.post("/enroll")
def enroll(payload: EnrollmentRequest, request: Request, db: Annotated[Session, Depends(get_db)]):
    ip_address = request.client.host if request.client else None
    return success_response(data=enroll_device(db, payload.enrollment_code, payload.device, ip_address))


@router.get("/config")
def config(
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    settings_row = get_or_create_tracking_settings(db, context.device.company_id)
    db.commit()
    return success_response(data=serialize_tracking_settings(settings_row))


@router.get("/tasks")
def tasks(
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    return success_response(data=list_employee_tasks(db, context.device))


@router.get("/projects")
def projects(
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    rows = db.execute(
        select(Project, Team)
        .join(Team, Team.id == Project.team_id)
        .join(TeamMember, TeamMember.team_id == Team.id)
        .where(
            Project.company_id == context.device.company_id,
            Project.status == "active",
            Team.status == "active",
            TeamMember.employee_id == context.device.employee_id,
            TeamMember.status == "active",
        )
        .order_by(Team.name, Project.name)
    ).all()
    return success_response(
        data=[
            {
                "id": str(project.id),
                "name": project.name,
                "team_id": str(team.id),
                "team_name": team.name,
            }
            for project, team in rows
        ]
    )


def agent_period_summary(context: DeviceAuthContext, db: Session) -> dict:
    employee = db.get(Employee, context.device.employee_id)
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    month_end = today.replace(day=monthrange(today.year, today.month)[1])

    def summarize(start: date, end: date) -> dict:
        rows = timesheet_rows(
            db,
            context.device.company_id,
            start,
            end,
            context.device.employee_id,
        )
        return period_summary(
            rows,
            manual_request_status_seconds(db, employee, start, end),
        )

    return {
        "employee": {
            "id": str(employee.id),
            "name": employee.name,
            "avatar_url": employee.avatar_url,
        },
        "today": summarize(today, today),
        "week": summarize(week_start, week_start + timedelta(days=6)),
        "month": summarize(month_start, month_end),
    }


@router.get("/summary")
def agent_summary(
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    return success_response(data=agent_period_summary(context, db))


@router.get("/time-summary/today")
def today_time_summary(
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    summary = agent_period_summary(context, db)["today"]
    return success_response(data={"active_seconds": summary["tracked_active_seconds"]})


@router.post("/tasks")
def create_own_task(
    payload: AgentTaskCreate,
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    memberships = db.scalars(
        select(TeamMember).where(
            TeamMember.employee_id == context.device.employee_id,
            TeamMember.status == "active",
        )
    ).all()
    if not memberships:
        from app.core.exceptions import ApiError

        raise ApiError("TEAM_REQUIRED", "Ask an administrator to assign you to a team first.", 400)
    team_ids = {membership.team_id for membership in memberships}
    if payload.project_id:
        project = db.scalar(
            select(Project).where(
                Project.id == payload.project_id,
                Project.company_id == context.device.company_id,
                Project.team_id.in_(team_ids),
                Project.status == "active",
            )
        )
        if project is None:
            from app.core.exceptions import ApiError

            raise ApiError("INVALID_PROJECT", "Project is not available to your teams.", 400)
    else:
        team_id = sorted(team_ids, key=str)[0]
        project = ensure_general_work_project(
            db, company_id=context.device.company_id, team_id=team_id
        )
    clean_name = " ".join(payload.name.split())
    validate_task_dates(payload.start_date, payload.deadline)
    existing = db.scalar(
        select(Task).where(
            Task.company_id == context.device.company_id,
            Task.project_id == project.id,
            Task.name == clean_name,
            Task.status == "active",
        )
    )
    if existing is None:
        existing = Task(
            company_id=context.device.company_id,
            project_id=project.id,
            assignee_employee_id=context.device.employee_id,
            name=clean_name,
            description=payload.description or "Created by employee from the desktop app.",
            status="active",
            stage="new_requests",
            created_by_employee_id=context.device.employee_id,
            start_date=payload.start_date,
            deadline=payload.deadline,
            estimated_minutes=payload.estimated_minutes,
            priority=payload.priority,
            completed_at=None,
        )
        db.add(existing)
        db.flush()
        employee = db.get(Employee, context.device.employee_id)
        workflow_request = create_workflow_request(
            db,
            existing,
            requested_by_employee_id=context.device.employee_id,
            request_type="task_creation",
            from_stage="new_requests",
            requested_stage="assigned",
        )
        record_task_activity(
            db,
            existing,
            "employee_task_requested",
            employee=employee,
            details={"workflow_request_id": str(workflow_request.id)},
        )
        notify_project_admins(
            db, existing, project, "task_approval_requested", "New task needs approval",
            f"{employee.name if employee else 'An employee'} requested: {existing.name}",
            "employee-task-requested",
            workflow_request_id=workflow_request.id,
        )
    elif existing.assignee_employee_id != context.device.employee_id:
        from app.core.exceptions import ApiError

        raise ApiError("TASK_NAME_IN_USE", "A task with this name already exists in the project.", 409)
    team = db.scalar(select(Team).where(Team.id == project.team_id))
    db.commit()
    db.refresh(existing)
    return success_response(data=serialize_task(existing, project, team))


@router.patch("/tasks/{task_id}")
def update_own_task(
    task_id: UUID,
    payload: AgentTaskUpdate,
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    from app.core.exceptions import ApiError

    task = db.scalar(
        select(Task).where(
            Task.id == task_id,
            Task.company_id == context.device.company_id,
            Task.assignee_employee_id == context.device.employee_id,
            Task.status == "active",
        )
    )
    if task is None:
        raise ApiError("TASK_NOT_FOUND", "You can only update your own task.", 404)
    changes = payload.model_dump(exclude_unset=True)
    note = changes.pop("note", None)
    if "name" in changes:
        changes["name"] = " ".join(changes["name"].split())
    previous_stage = task.stage
    if task.created_by_employee_id == context.device.employee_id and task.stage == "new_requests":
        forbidden = set(changes) - {"name", "description", "start_date", "deadline", "estimated_minutes"}
        if forbidden:
            raise ApiError("TASK_AWAITING_APPROVAL", "An admin must approve this task first.", 409)
    else:
        forbidden = set(changes) - {"stage"}
        if forbidden:
            raise ApiError("TASK_FIELDS_FORBIDDEN", "Only managers can change task details.", 403)
    if "stage" in changes:
        employee = db.get(Employee, context.device.employee_id)
        project = db.scalar(select(Project).where(Project.id == task.project_id))
        validate_employee_stage_change(task, changes["stage"], note)
        if changes["stage"] == "ready_for_review":
            workflow_request = create_workflow_request(
                db,
                task,
                requested_by_employee_id=context.device.employee_id,
                request_type="completion",
                from_stage=task.stage,
                requested_stage="completed",
                request_note=note,
            )
            task.review_note = note
        elif changes["stage"] == "blocked":
            mark_task_blocked(task, note or "", employee=employee)
            stop_task_tracking(db, task, reason="task_blocked")
            notify_project_admins(
                db,
                task,
                project,
                "task_blocked",
                "Task blocked",
                f"{employee.name if employee else 'An employee'} blocked {task.name}: {note}",
                f"blocked:{datetime.now(UTC).isoformat()}",
            )
        elif changes["stage"] == "in_progress":
            if previous_stage == "blocked":
                resolve_task_block(task, note or "")
    for field, value in changes.items():
        setattr(task, field, value)
    validate_task_dates(task.start_date, task.deadline)
    project = db.scalar(select(Project).where(Project.id == task.project_id))
    team = db.scalar(select(Team).where(Team.id == project.team_id))
    if task.stage != previous_stage:
        employee = db.get(Employee, context.device.employee_id)
        activity_details = {"from": previous_stage, "to": task.stage, "note": note}
        if task.stage == "ready_for_review":
            activity_details["workflow_request_id"] = str(workflow_request.id)
        record_task_activity(
            db,
            task,
            "stage_changed",
            employee=employee,
            details=activity_details,
        )
        if task.stage == "ready_for_review":
            stop_task_tracking(db, task, reason="submitted_for_review")
            notify_project_admins(
                db, task, project, "task_review_requested", "Task ready for review",
                f"{employee.name if employee else 'An employee'} submitted {task.name} for review.",
                f"review-requested:{datetime.now(UTC).isoformat()}",
                workflow_request_id=workflow_request.id,
            )
    db.commit()
    db.refresh(task)
    return success_response(data=serialize_task(task, project, team))


@router.post("/refresh-token")
def refresh_token(
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
    _: RefreshDeviceTokenRequest = Body(default_factory=RefreshDeviceTokenRequest),
):
    return success_response(data=refresh_device_token(db, context.device, context.token_record))


@router.post("/employee-portal-handoff")
def employee_portal_handoff(
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
):
    return success_response(
        data={
            "handoff_token": create_employee_handoff_token(
                employee_id=context.device.employee_id,
                company_id=context.device.company_id,
            ),
            "expires_in_seconds": 120,
        }
    )


@router.post("/sessions/start")
def start_session(
    payload: SessionStartRequest,
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    return success_response(data=start_or_get_session(db, context.device, payload))


@router.get("/sessions/current")
def current_session(
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    return success_response(data=current_session_response(db, context.device))


@router.post("/sessions/{session_id}/heartbeat")
def heartbeat(
    session_id: UUID,
    payload: HeartbeatRequest,
    request: Request,
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    context.device.last_ip_address = request.client.host if request.client else context.device.last_ip_address
    return success_response(data=record_heartbeat(db, device=context.device, session_id=session_id, payload=payload))


@router.post("/sessions/{session_id}/events")
def event(
    session_id: UUID,
    payload: ActivityEventRequest,
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    return success_response(data=record_agent_event(db, device=context.device, session_id=session_id, payload=payload))


@router.post("/sessions/{session_id}/task")
def session_task(
    session_id: UUID,
    payload: SessionTaskUpdateRequest,
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    return success_response(data=update_session_task(db, device=context.device, session_id=session_id, payload=payload))


@router.post("/sessions/{session_id}/end")
def end(
    session_id: UUID,
    payload: SessionEndRequest,
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    return success_response(data=end_session(db, device=context.device, session_id=session_id, payload=payload))


@router.post("/screenshots/initiate")
def screenshot_initiate(
    payload: ScreenshotInitiateRequest,
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    return success_response(data=initiate_screenshot(db, context.device, payload))


@router.post("/screenshots/{screenshot_id}/upload")
async def screenshot_upload(
    screenshot_id: UUID,
    file: UploadFile,
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    content = await file.read()
    return success_response(
        data=upload_screenshot_content(
            db,
            device=context.device,
            screenshot_id=screenshot_id,
            content=content,
            content_type=file.content_type,
        )
    )


@router.post("/screenshots/{screenshot_id}/complete")
def screenshot_complete(
    screenshot_id: UUID,
    payload: ScreenshotCompleteRequest,
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    return success_response(data=complete_screenshot(db, device=context.device, screenshot_id=screenshot_id, payload=payload))


@router.get("/time-adjustment-requests")
def list_time_adjustment_requests(
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    rows = db.scalars(
        select(TimeAdjustmentRequest)
        .where(
            TimeAdjustmentRequest.company_id == context.device.company_id,
            TimeAdjustmentRequest.employee_id == context.device.employee_id,
        )
        .order_by(TimeAdjustmentRequest.created_at.desc())
        .limit(10)
    ).all()
    return success_response(data=[serialize_time_adjustment_request(row) for row in rows])


@router.post("/time-adjustment-requests")
def create_time_adjustment_request(
    payload: AgentTimeAdjustmentRequestCreate,
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    row = create_employee_time_adjustment_request(
        db,
        device=context.device,
        requested_date=payload.requested_date or date.today(),
        requested_minutes=payload.requested_minutes,
        reason=payload.reason,
    )
    return success_response(data=serialize_time_adjustment_request(row))
