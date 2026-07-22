from calendar import monthrange
from datetime import date, timedelta
import logging
from typing import Annotated
from uuid import UUID
from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Body, Depends, Query, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import DeviceAuthContext, get_current_device, get_current_employee
from app.api.v1.employee_portal import (
    manual_request_status_seconds,
    period_summary,
    reconcile_today_summary_with_timeline,
)
from app.api.v1.timesheets import timesheet_rows
from app.core.responses import success_response
from app.core.config import settings
from app.core.exceptions import ApiError
from app.core.security import create_employee_handoff_token
from app.database.session import get_db
from app.models import (
    Employee,
    LeaveRequest,
    PauseSession,
    Project,
    Screenshot,
    Task,
    TaskChecklistItem,
    Team,
    TeamMember,
    TimeAdjustmentRequest,
    WorkScheduleOverride,
)
from app.schemas.agent import (
    AgentChecklistItemCreate,
    AgentChecklistItemUpdate,
    AgentLeaveRequestCreate,
    AgentTaskCreate,
    AgentTaskUpdate,
    AgentTimeAdjustmentRequestCreate,
    AuthenticatedEnrollmentRequest,
    RefreshDeviceTokenRequest,
)
from app.schemas.session import (
    ActivityEventRequest,
    HeartbeatRequest,
    PauseStartRequest,
    SessionEndRequest,
    SessionTaskUpdateRequest,
    SessionStartRequest,
)
from app.schemas.screenshot import (
    ScreenshotCompleteRequest,
    ScreenshotInitiateRequest,
    ScreenshotSkipRequest,
)
from app.services.device_enrollment import (
    enroll_employee_device,
    get_or_create_tracking_settings,
    refresh_device_token,
    serialize_tracking_settings,
)
from app.services.session_tracking import (
    current_session_response,
    end_session,
    record_agent_event,
    record_heartbeat,
    start_paid_pause,
    start_or_get_session,
    update_session_task,
)
from app.services.screenshots import (
    complete_screenshot,
    initiate_screenshot,
    record_screenshot_skip,
    upload_screenshot_content,
)
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
from app.services.activity_timeline import build_workday_timeline, local_today
from app.services.leave_management import (
    requested_workdays,
    serialize_balance,
    serialize_leave_request,
)
from app.services.time_adjustments import (
    create_employee_time_adjustment_request,
    serialize_time_adjustment_request,
)
from app.services.work_profiles import get_or_create_work_profile
from app.services.rate_limit import enforce_rate_limit
from app.services.attendance import cached_daily_attendance

router = APIRouter(prefix="/agent", tags=["desktop-agent"])
logger = logging.getLogger(__name__)

DEFAULT_DAILY_TARGET_SECONDS = 8 * 60 * 60


def _employee_zone(employee: Employee) -> ZoneInfo:
    try:
        return ZoneInfo(employee.timezone or "UTC")
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _latest_day_override(
    db: Session,
    employee: Employee,
    work_date: date,
    override_types: list[str],
) -> WorkScheduleOverride | None:
    common = (
        WorkScheduleOverride.company_id == employee.company_id,
        WorkScheduleOverride.permanent.is_(False),
        WorkScheduleOverride.effective_date == work_date,
        WorkScheduleOverride.override_type.in_(override_types),
    )
    employee_override = db.scalar(
        select(WorkScheduleOverride)
        .where(*common, WorkScheduleOverride.employee_id == employee.id)
        .order_by(WorkScheduleOverride.created_at.desc())
    )
    if employee_override:
        return employee_override
    return db.scalar(
        select(WorkScheduleOverride)
        .where(*common, WorkScheduleOverride.employee_id.is_(None))
        .order_by(WorkScheduleOverride.created_at.desc())
    )


def _resolved_day_policy(db: Session, employee: Employee, profile, work_date: date) -> dict:
    shift_override = _latest_day_override(db, employee, work_date, ["shift", "both"])
    break_override = _latest_day_override(db, employee, work_date, ["breaks", "both"])
    approved_leave = db.scalar(
        select(LeaveRequest.id).where(
            LeaveRequest.company_id == employee.company_id,
            LeaveRequest.employee_id == employee.id,
            LeaveRequest.status == "approved",
            LeaveRequest.start_date <= work_date,
            LeaveRequest.end_date >= work_date,
        )
    )
    approved_early_leave = db.scalar(
        select(TimeAdjustmentRequest)
        .where(
            TimeAdjustmentRequest.company_id == employee.company_id,
            TimeAdjustmentRequest.employee_id == employee.id,
            TimeAdjustmentRequest.request_type == "early_leave",
            TimeAdjustmentRequest.requested_date == work_date,
            TimeAdjustmentRequest.status == "approved",
        )
        .order_by(TimeAdjustmentRequest.created_at.desc())
    )
    return {
        "shift_start": (
            shift_override.shift_start
            if shift_override and shift_override.shift_start
            else profile.shift_start
        ),
        "shift_end": (
            shift_override.shift_end
            if shift_override and shift_override.shift_end
            else profile.shift_end
        ),
        "break_rules": (
            break_override.break_rules
            if break_override and break_override.break_rules is not None
            else profile.break_rules or []
        ),
        "approved_leave": bool(approved_leave),
        "approved_early_leave_from": (
            approved_early_leave.source_start_at if approved_early_leave else None
        ),
    }


def _seconds_after_exclusions(
    start: datetime,
    end: datetime,
    exclusions: list[tuple[datetime, datetime]],
) -> int:
    clipped = sorted(
        (max(start, excluded_start), min(end, excluded_end))
        for excluded_start, excluded_end in exclusions
        if excluded_end > start and excluded_start < end
    )
    cursor = start
    included_seconds = 0
    for excluded_start, excluded_end in clipped:
        if excluded_start > cursor:
            included_seconds += int((excluded_start - cursor).total_seconds())
        cursor = max(cursor, excluded_end)
    if cursor < end:
        included_seconds += int((end - cursor).total_seconds())
    return max(0, included_seconds)


def _eligible_idle_seconds(
    db: Session,
    employee: Employee,
    profile,
    work_date: date,
    timeline: dict,
) -> int:
    policy = _resolved_day_policy(db, employee, profile, work_date)
    working_days = profile.working_days or [0, 1, 2, 3, 4]
    weekly_off_days = profile.weekly_off_days or []
    if (
        work_date.weekday() not in working_days
        or work_date.weekday() in weekly_off_days
        or policy["approved_leave"]
        or not policy["shift_start"]
        or not policy["shift_end"]
    ):
        return 0

    zone = _employee_zone(employee)
    shift_start = datetime.combine(work_date, policy["shift_start"], tzinfo=zone).astimezone(UTC)
    shift_end = datetime.combine(work_date, policy["shift_end"], tzinfo=zone).astimezone(UTC)
    if shift_end <= shift_start:
        return 0

    exclusions: list[tuple[datetime, datetime]] = []
    for rule in policy["break_rules"]:
        if not rule.get("paid") or not rule.get("start_time") or not rule.get("end_time"):
            continue
        try:
            break_start_time = datetime.strptime(str(rule["start_time"])[:5], "%H:%M").time()
            break_end_time = datetime.strptime(str(rule["end_time"])[:5], "%H:%M").time()
        except ValueError:
            continue
        exclusions.append(
            (
                datetime.combine(work_date, break_start_time, tzinfo=zone).astimezone(UTC),
                datetime.combine(work_date, break_end_time, tzinfo=zone).astimezone(UTC),
            )
        )
    if policy["approved_early_leave_from"]:
        exclusions.append((_as_utc(policy["approved_early_leave_from"]), shift_end))
    pauses = db.scalars(
        select(PauseSession).where(
            PauseSession.company_id == employee.company_id,
            PauseSession.employee_id == employee.id,
            PauseSession.started_at < shift_end,
            PauseSession.scheduled_end_at > shift_start,
        )
    ).all()
    exclusions.extend(
        (_as_utc(pause.started_at), _as_utc(pause.scheduled_end_at)) for pause in pauses
    )

    total = 0
    now = datetime.now(UTC)
    for interval in timeline.get("intervals", []):
        if interval.get("type") not in {"idle", "locked", "sleeping"}:
            continue
        interval_start = datetime.fromisoformat(interval["started_at"]).astimezone(UTC)
        interval_end = (
            datetime.fromisoformat(interval["ended_at"]).astimezone(UTC)
            if interval.get("ended_at")
            else now
        )
        eligible_start = max(interval_start, shift_start)
        eligible_end = min(interval_end, shift_end)
        if eligible_end > eligible_start:
            total += _seconds_after_exclusions(eligible_start, eligible_end, exclusions)
    return total


@router.post("/enroll-authenticated")
def enroll_authenticated(
    payload: AuthenticatedEnrollmentRequest,
    request: Request,
    current_employee: Annotated[Employee, Depends(get_current_employee)],
    db: Annotated[Session, Depends(get_db)],
):
    """Link the desktop after employee email/password authentication."""
    enforce_rate_limit(request, action="device-enroll-authenticated", limit=15, window_seconds=300)
    ip_address = request.client.host if request.client else None
    return success_response(
        data=enroll_employee_device(db, current_employee, payload.device, ip_address)
    )


@router.get("/config")
def config(
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    settings_row = get_or_create_tracking_settings(db, context.device.company_id)
    employee = db.get(Employee, context.device.employee_id)
    if employee is None:
        raise ApiError("EMPLOYEE_NOT_FOUND", "Employee profile was not found.", 404)
    profile = get_or_create_work_profile(db, employee)
    today = local_today(employee.timezone)
    day_policy = _resolved_day_policy(db, employee, profile, today)
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=6)
    early_leave_seconds = (
        db.scalar(
            select(func.coalesce(func.sum(TimeAdjustmentRequest.requested_seconds), 0)).where(
                TimeAdjustmentRequest.company_id == context.device.company_id,
                TimeAdjustmentRequest.employee_id == context.device.employee_id,
                TimeAdjustmentRequest.request_type == "early_leave",
                TimeAdjustmentRequest.requested_date >= week_start,
                TimeAdjustmentRequest.requested_date <= week_end,
                TimeAdjustmentRequest.status.in_(["pending", "approved"]),
            )
        )
        or 0
    )
    weekly_allowance = max(0, int(profile.weekly_early_leave_minutes or 0))
    db.commit()
    return success_response(
        data={
            **serialize_tracking_settings(settings_row),
            "request_policy": {
                "timezone": employee.timezone,
                "shift_start": day_policy["shift_start"].isoformat(timespec="minutes")
                if day_policy["shift_start"]
                else None,
                "shift_end": day_policy["shift_end"].isoformat(timespec="minutes")
                if day_policy["shift_end"]
                else None,
                "working_days": profile.working_days or [0, 1, 2, 3, 4],
                "break_rules": day_policy["break_rules"],
                "approved_leave_today": day_policy["approved_leave"],
                "approved_early_leave_from": (
                    _as_utc(day_policy["approved_early_leave_from"])
                    .astimezone(_employee_zone(employee))
                    .strftime("%H:%M")
                    if day_policy["approved_early_leave_from"]
                    else None
                ),
                "weekly_early_leave_minutes": weekly_allowance,
                "weekly_early_leave_used_minutes": round(early_leave_seconds / 60),
                "weekly_early_leave_remaining_minutes": max(
                    0, weekly_allowance - round(early_leave_seconds / 60)
                ),
            },
        }
    )


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
    today = local_today(employee.timezone if employee else None)
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    month_end = today.replace(day=monthrange(today.year, today.month)[1])

    profile = get_or_create_work_profile(db, employee)

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

    timeline = build_workday_timeline(
        db,
        company_id=context.device.company_id,
        employee_id=context.device.employee_id,
        timezone_name=employee.timezone,
    )
    today_summary = reconcile_today_summary_with_timeline(summarize(today, today), timeline)
    today_summary["idle_seconds"] = _eligible_idle_seconds(db, employee, profile, today, timeline)
    today_summary["tracked_seconds"] = (
        today_summary["active_seconds"] + today_summary["idle_seconds"]
    )
    today_policy = _resolved_day_policy(db, employee, profile, today)
    shift_start = today_policy["shift_start"]
    shift_end = today_policy["shift_end"]
    target_seconds = int(profile.required_daily_minutes or 480) * 60
    if shift_start and shift_end and shift_end > shift_start:
        target_seconds = (
            shift_end.hour * 3600
            + shift_end.minute * 60
            - shift_start.hour * 3600
            - shift_start.minute * 60
        )
    tracked_seconds = today_summary["tracked_active_seconds"]
    activity_base_seconds = tracked_seconds + today_summary["idle_seconds"]
    return {
        "employee": {
            "id": str(employee.id),
            "name": employee.name,
            "avatar_url": employee.avatar_url,
        },
        "daily_target_seconds": target_seconds,
        "daily_target_progress_percent": min(
            100,
            round((tracked_seconds / target_seconds) * 100),
        )
        if target_seconds
        else 0,
        "activity_percent": round((tracked_seconds / activity_base_seconds) * 100)
        if activity_base_seconds
        else 0,
        "today": today_summary,
        "today_timeline": timeline,
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


@router.get("/tasks/recent")
def recent_tasks(
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
    limit: int = Query(default=3, ge=1, le=8),
):
    tasks = list_employee_tasks(db, context.device)
    ordered = sorted(
        tasks,
        key=lambda task: (
            task.get("tracked_seconds", 0),
            task.get("active_seconds", 0),
            task.get("name", ""),
        ),
        reverse=True,
    )
    return success_response(data=ordered[:limit])


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
            db,
            existing,
            project,
            "task_approval_requested",
            "New task needs approval",
            f"{employee.name if employee else 'An employee'} requested: {existing.name}",
            "employee-task-requested",
            workflow_request_id=workflow_request.id,
        )
    elif existing.assignee_employee_id != context.device.employee_id:
        from app.core.exceptions import ApiError

        raise ApiError(
            "TASK_NAME_IN_USE", "A task with this name already exists in the project.", 409
        )
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
        forbidden = set(changes) - {
            "name",
            "description",
            "start_date",
            "deadline",
            "estimated_minutes",
        }
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
                db,
                task,
                project,
                "task_review_requested",
                "Task ready for review",
                f"{employee.name if employee else 'An employee'} submitted {task.name} for review.",
                f"review-requested:{datetime.now(UTC).isoformat()}",
                workflow_request_id=workflow_request.id,
            )
    db.commit()
    db.refresh(task)
    return success_response(data=serialize_task(task, project, team))


@router.post("/tasks/{task_id}/checklist")
def create_own_task_checklist_item(
    task_id: UUID,
    payload: AgentChecklistItemCreate,
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
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
    if task.stage in {"completed", "rejected", "cancelled", "ready_for_review"}:
        raise ApiError("TASK_STAGE_LOCKED", "Closed or submitted tasks cannot be changed.", 409)
    item = TaskChecklistItem(
        task_id=task.id,
        title=payload.title.strip(),
        assignee_employee_id=context.device.employee_id,
        position=max((entry.position for entry in task.checklist_items), default=-1) + 1,
    )
    db.add(item)
    employee = db.get(Employee, context.device.employee_id)
    project = db.scalar(select(Project).where(Project.id == task.project_id))
    team = db.scalar(select(Team).where(Team.id == project.team_id))
    record_task_activity(
        db,
        task,
        "checklist_item_added",
        employee=employee,
        details={"item": item.title},
    )
    db.commit()
    db.refresh(task)
    return success_response(data=serialize_task(task, project, team))


@router.patch("/tasks/{task_id}/checklist/{item_id}")
def update_own_task_checklist_item(
    task_id: UUID,
    item_id: UUID,
    payload: AgentChecklistItemUpdate,
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
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
    if task.stage in {"completed", "rejected", "cancelled", "ready_for_review"}:
        raise ApiError("TASK_STAGE_LOCKED", "Closed or submitted tasks cannot be changed.", 409)
    item = db.scalar(
        select(TaskChecklistItem).where(
            TaskChecklistItem.id == item_id, TaskChecklistItem.task_id == task.id
        )
    )
    if item is None:
        raise ApiError("CHECKLIST_ITEM_NOT_FOUND", "Checklist item was not found.", 404)
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(item, field, value)
    employee = db.get(Employee, context.device.employee_id)
    project = db.scalar(select(Project).where(Project.id == task.project_id))
    team = db.scalar(select(Team).where(Team.id == project.team_id))
    record_task_activity(
        db,
        task,
        "checklist_item_completed"
        if changes.get("completed") is True
        else "checklist_item_updated",
        employee=employee,
        details={"item": item.title, **changes},
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
    context.device.last_ip_address = (
        request.client.host if request.client else context.device.last_ip_address
    )
    response = record_heartbeat(
        db,
        device=context.device,
        session_id=session_id,
        payload=payload,
    )
    # Attendance is a derived read model. Refresh it at most once per minute so
    # live admin screens remain current without making every heartbeat heavy.
    try:
        employee = db.get(Employee, context.device.employee_id)
        if employee is not None:
            cached_daily_attendance(
                db,
                employee=employee,
                work_date=local_today(employee.timezone or "UTC", payload.timestamp),
                now=payload.timestamp,
                max_age_seconds=60,
            )
            db.commit()
    except Exception:
        db.rollback()
        logger.exception("Unable to refresh the daily attendance snapshot")
    return success_response(data=response)


@router.post("/sessions/{session_id}/pause")
def paid_pause(
    session_id: UUID,
    payload: PauseStartRequest,
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    return success_response(
        data=start_paid_pause(db, device=context.device, session_id=session_id, payload=payload)
    )


@router.post("/sessions/{session_id}/events")
def event(
    session_id: UUID,
    payload: ActivityEventRequest,
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    return success_response(
        data=record_agent_event(db, device=context.device, session_id=session_id, payload=payload)
    )


@router.post("/sessions/{session_id}/task")
def session_task(
    session_id: UUID,
    payload: SessionTaskUpdateRequest,
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    return success_response(
        data=update_session_task(db, device=context.device, session_id=session_id, payload=payload)
    )


@router.post("/sessions/{session_id}/end")
def end(
    session_id: UUID,
    payload: SessionEndRequest,
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    return success_response(
        data=end_session(db, device=context.device, session_id=session_id, payload=payload)
    )


@router.post("/screenshots/initiate")
def screenshot_initiate(
    payload: ScreenshotInitiateRequest,
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    return success_response(data=initiate_screenshot(db, context.device, payload))


@router.post("/screenshots/skips")
def screenshot_skip(
    payload: ScreenshotSkipRequest,
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    return success_response(data=record_screenshot_skip(db, context.device, payload))


@router.get("/screenshots/recent")
def recent_screenshots(
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
    limit: int = Query(default=4, ge=1, le=4),
):
    rows = db.scalars(
        select(Screenshot)
        .where(
            Screenshot.company_id == context.device.company_id,
            Screenshot.employee_id == context.device.employee_id,
            Screenshot.deleted_at.is_(None),
            Screenshot.status.in_(("uploaded", "completed")),
        )
        .order_by(Screenshot.captured_at.desc())
        .limit(limit)
    ).all()
    return success_response(
        data=[
            {
                "id": str(screenshot.id),
                "captured_at": screenshot.captured_at.isoformat(),
                "mime_type": screenshot.mime_type,
                "display_name": screenshot.display_name,
            }
            for screenshot in rows
        ]
    )


@router.get("/screenshots/{screenshot_id}/file")
def own_screenshot_file(
    screenshot_id: UUID,
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    screenshot = db.scalar(
        select(Screenshot).where(
            Screenshot.id == screenshot_id,
            Screenshot.company_id == context.device.company_id,
            Screenshot.employee_id == context.device.employee_id,
            Screenshot.deleted_at.is_(None),
            Screenshot.status.in_(("uploaded", "completed")),
        )
    )
    if screenshot is None:
        raise ApiError("SCREENSHOT_NOT_FOUND", "Screenshot was not found.", 404)
    storage_root = settings.screenshot_storage_path.resolve()
    file_path = (storage_root / screenshot.storage_path).resolve()
    if not file_path.is_relative_to(storage_root) or not file_path.exists():
        raise ApiError("SCREENSHOT_FILE_NOT_FOUND", "Screenshot file was not found.", 404)
    return FileResponse(file_path, media_type=screenshot.mime_type)


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
    return success_response(
        data=complete_screenshot(
            db, device=context.device, screenshot_id=screenshot_id, payload=payload
        )
    )


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
    employee = db.get(Employee, context.device.employee_id)
    if employee is None:
        raise ApiError("EMPLOYEE_NOT_FOUND", "Employee profile was not found.", 404)
    row = create_employee_time_adjustment_request(
        db,
        device=context.device,
        requested_date=payload.requested_date or local_today(employee.timezone),
        requested_minutes=payload.requested_minutes,
        reason=payload.reason,
        request_type=payload.request_type,
        work_session_id=payload.work_session_id,
        source_start_at=payload.source_start_at,
        source_end_at=payload.source_end_at,
        requested_leave_time=payload.requested_leave_time,
    )
    return success_response(data=serialize_time_adjustment_request(row))


@router.get("/leave-requests")
def list_leave_requests(
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    employee = db.get(Employee, context.device.employee_id)
    if employee is None:
        raise ApiError("EMPLOYEE_NOT_FOUND", "Employee profile was not found.", 404)
    rows = db.scalars(
        select(LeaveRequest)
        .where(
            LeaveRequest.company_id == context.device.company_id,
            LeaveRequest.employee_id == context.device.employee_id,
        )
        .order_by(LeaveRequest.created_at.desc())
        .limit(10)
    ).all()
    return success_response(
        data={
            "balance": serialize_balance(db, employee, local_today(employee.timezone).year),
            "requests": [serialize_leave_request(row) for row in rows],
        }
    )


@router.post("/leave-requests")
def create_leave_request(
    payload: AgentLeaveRequestCreate,
    context: Annotated[DeviceAuthContext, Depends(get_current_device)],
    db: Annotated[Session, Depends(get_db)],
):
    employee = db.get(Employee, context.device.employee_id)
    if employee is None:
        raise ApiError("EMPLOYEE_NOT_FOUND", "Employee profile was not found.", 404)
    if payload.end_date < payload.start_date:
        raise ApiError("INVALID_LEAVE_DATES", "End date must be on or after start date.", 400)
    if payload.start_date.year != payload.end_date.year:
        raise ApiError(
            "LEAVE_YEAR_BOUNDARY", "A holiday request must stay within one calendar year.", 400
        )
    profile = get_or_create_work_profile(db, employee)
    days = requested_workdays(payload.start_date, payload.end_date, profile.working_days)
    if days < 1:
        raise ApiError("NO_WORKDAYS", "The selected period contains no working days.", 400)
    balance = serialize_balance(db, employee, payload.start_date.year)
    if payload.leave_type == "annual" and days > balance["remaining_days"]:
        raise ApiError("INSUFFICIENT_LEAVE_CREDIT", "You do not have enough holiday credit.", 409)
    overlap = db.scalar(
        select(LeaveRequest.id).where(
            LeaveRequest.employee_id == employee.id,
            LeaveRequest.status.in_(["pending", "approved"]),
            LeaveRequest.start_date <= payload.end_date,
            LeaveRequest.end_date >= payload.start_date,
        )
    )
    if overlap:
        raise ApiError(
            "OVERLAPPING_LEAVE_REQUEST", "You already have a holiday request in this period.", 409
        )
    row = LeaveRequest(
        company_id=employee.company_id,
        employee_id=employee.id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        requested_days=days,
        leave_type=payload.leave_type,
        reason=payload.reason.strip() if payload.reason else None,
        status="pending",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return success_response(data=serialize_leave_request(row))
