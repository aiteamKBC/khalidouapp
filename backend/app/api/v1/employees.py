from datetime import UTC, date, datetime, timedelta
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, load_only

from app.api.deps import get_current_admin
from app.api.v1.admin_utils import (
    apply_pagination,
    count_for,
    day_bounds,
    get_company_settings,
    pagination_meta,
    serialize_device,
    serialize_employee,
    serialize_activity_event,
    serialize_work_session,
)
from app.api.v1.team_auth import apply_employee_scope, ensure_employee_access, ensure_team_access
from app.core.config import settings
from app.core.exceptions import ApiError
from app.core.responses import success_response
from app.core.security import hash_password
from app.database.session import get_db
from app.models import (
    ActivityEvent,
    AdminUser,
    AuditLog,
    DailyAttendance,
    Device,
    Employee,
    EmployeeInvitation,
    EmployeeWorkProfile,
    LeaveRequest,
    PayrollAdjustment,
    PayrollEntry,
    Screenshot,
    TeamMember,
    TimeAdjustmentRequest,
    WorkScheduleOverride,
    WorkSession,
)
from app.schemas.admin import (
    EmployeeCreate,
    EmployeePasswordUpdate,
    EmployeeUpdate,
)
from app.services.audit import record_audit_log
from app.services.activity_timeline import local_today
from app.services.attendance import (
    accountable_idle_seconds,
    current_idle_contexts,
    refresh_daily_attendance_range,
)
from app.services.email import (
    enqueue_employee_invitation_email,
)
from app.services.employee_invitations import (
    employee_onboarding_status,
    issue_employee_invitation,
    latest_employee_invitations,
)
from app.schemas.admin import EmployeeWorkProfileUpdate
from app.services.permissions import has_capability, require_capability
from app.services.person_access import disable_employee_tracking
from app.services.request_notifications import employee_manager_summaries
from app.services.input_integrity import summarize_input_integrity
from app.services.work_profiles import (
    DEFAULT_BREAK_RULES,
    DEFAULT_WEEKLY_OFF_DAYS,
    DEFAULT_WORKING_DAYS,
    get_or_create_work_profile,
    payroll_preview,
    profile_completeness,
    refresh_profile_completed_at,
    serialize_work_profile,
)

router = APIRouter(tags=["employees"])


FINANCIAL_WORK_PROFILE_FIELDS = {
    "deduction_policy",
    "overtime_rate_multiplier",
    "salary_amount",
    "salary_currency",
    "salary_type",
    "bank_account_number",
    "bank_employee_id",
}
FINANCIAL_WORK_PROFILE_UPDATE_FIELDS = FINANCIAL_WORK_PROFILE_FIELDS | {
    "overtime_enabled",
    "overtime_basis",
}


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def serialize_work_profile_for_admin(profile: EmployeeWorkProfile, admin: AdminUser) -> dict:
    data = serialize_work_profile(profile)
    if not has_capability(admin, "payroll.view"):
        for field in FINANCIAL_WORK_PROFILE_FIELDS:
            data.pop(field, None)
    return data


@router.get("/employees")
def list_employees(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    search: str | None = None,
    status: str | None = None,
    job_title: str | None = None,
    team_id: UUID | None = None,
    sort: str = "name",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
):
    statement = select(Employee).where(
        Employee.company_id == current_admin.company_id,
        Employee.status != "deleted",
    )
    statement = apply_employee_scope(statement, db, current_admin, Employee.id, team_id)
    if search:
        pattern = f"%{search}%"
        statement = statement.where(
            or_(
                Employee.name.ilike(pattern),
                Employee.email.ilike(pattern),
                Employee.employee_code.ilike(pattern),
            )
        )
    if status:
        statement = statement.where(Employee.status == status)
    if job_title:
        statement = statement.where(Employee.job_title == job_title)

    sort_column = {
        "name": Employee.name,
        "email": Employee.email,
        "created_at": Employee.created_at,
        "-created_at": Employee.created_at.desc(),
    }.get(sort, Employee.name)
    statement = statement.order_by(sort_column)
    total = count_for(db, statement)
    employees = db.scalars(apply_pagination(statement, page, page_size)).all()
    invitations = latest_employee_invitations(db, [employee.id for employee in employees])
    return success_response(
        data=[serialize_employee(employee, invitations.get(employee.id)) for employee in employees],
        meta=pagination_meta(total, page, page_size),
    )


@router.get("/employees/break-rules")
def list_employee_break_rules(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    team_id: UUID | None = None,
):
    """Work schedule and break rules for every employee in scope in one query.

    Avoids one /employees/{id}/work-profile round trip per employee, which is
    slow when the database has significant network latency.
    """

    require_capability(current_admin, "breaks.view")
    can_view_payroll = has_capability(current_admin, "payroll.view")
    statement = (
        select(
            Employee.id,
            Employee.name,
            Employee.email,
            Employee.job_title,
            Employee.timezone,
            EmployeeWorkProfile.shift_start,
            EmployeeWorkProfile.shift_end,
            EmployeeWorkProfile.required_daily_minutes,
            EmployeeWorkProfile.break_rules,
            EmployeeWorkProfile.working_days,
            EmployeeWorkProfile.weekly_off_days,
            EmployeeWorkProfile.late_grace_minutes,
            EmployeeWorkProfile.overtime_enabled,
            EmployeeWorkProfile.overtime_rate_multiplier,
            EmployeeWorkProfile.salary_amount,
            EmployeeWorkProfile.salary_currency,
            EmployeeWorkProfile.salary_type,
        )
        .select_from(Employee)
        .outerjoin(EmployeeWorkProfile, EmployeeWorkProfile.employee_id == Employee.id)
        .where(
            Employee.company_id == current_admin.company_id,
            Employee.status != "deleted",
        )
    )
    statement = apply_employee_scope(statement, db, current_admin, Employee.id, team_id)
    statement = statement.order_by(Employee.name)
    rows = db.execute(statement).all()
    data = []
    for (
        employee_id,
        name,
        email,
        job_title,
        timezone,
        shift_start,
        shift_end,
        required_daily_minutes,
        break_rules,
        working_days,
        weekly_off_days,
        late_grace_minutes,
        overtime_enabled,
        overtime_rate_multiplier,
        salary_amount,
        salary_currency,
        salary_type,
    ) in rows:
        item = {
                "employee_id": str(employee_id),
                "name": name,
                "email": email,
                "job_title": job_title,
                "timezone": timezone,
                "break_rules": break_rules if break_rules is not None else DEFAULT_BREAK_RULES,
                "shift_start": shift_start.isoformat(timespec="minutes")
                if shift_start
                else "10:00",
                "shift_end": shift_end.isoformat(timespec="minutes") if shift_end else "18:00",
                "required_daily_minutes": required_daily_minutes or 480,
                "working_days": working_days or DEFAULT_WORKING_DAYS,
                "weekly_off_days": weekly_off_days or DEFAULT_WEEKLY_OFF_DAYS,
                "late_grace_minutes": late_grace_minutes or 15,
                "overtime_enabled": bool(overtime_enabled),
        }
        if can_view_payroll:
            item.update(
                {
                    "overtime_rate_multiplier": float(overtime_rate_multiplier or 1.5),
                    "salary_amount": float(salary_amount or 0),
                    "salary_currency": salary_currency or "EGP",
                    "salary_type": salary_type or "monthly",
                }
            )
        data.append(item)
    return success_response(data=data)


@router.get("/employees-overview")
def list_employee_overviews(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    team_id: UUID | None = None,
    employee_id: UUID | None = None,
):
    """Return the employee list and live status without per-employee API calls.

    Windowed and grouped subqueries load the latest device/session plus today's
    totals in one database round trip instead of querying once per employee.
    """

    today_start, today_end = day_bounds(date.today())
    settings = get_company_settings(db, current_admin.company_id)
    now = datetime.now(UTC)
    cutoff = now - timedelta(minutes=settings.offline_threshold_minutes)

    device_ranked = (
        select(
            Device.employee_id.label("employee_id"),
            Device.id.label("device_id"),
            Device.device_name.label("device_name"),
            Device.status.label("device_status"),
            Device.last_seen_at.label("device_last_seen"),
            func.row_number()
            .over(
                partition_by=Device.employee_id,
                order_by=(
                    Device.last_seen_at.desc().nullslast(),
                    Device.registered_at.desc(),
                ),
            )
            .label("rank"),
        )
        .where(Device.company_id == current_admin.company_id)
        .subquery()
    )
    latest_device = (
        select(device_ranked)
        .where(device_ranked.c.rank == 1)
        .subquery()
    )
    session_ranked = (
        select(
            WorkSession.employee_id.label("employee_id"),
            WorkSession.id.label("session_id"),
            WorkSession.team_id.label("session_team_id"),
            WorkSession.project_id.label("session_project_id"),
            WorkSession.task_id.label("session_task_id"),
            WorkSession.status.label("session_status"),
            WorkSession.started_at.label("session_started_at"),
            func.row_number()
            .over(
                partition_by=WorkSession.employee_id,
                order_by=WorkSession.started_at.desc(),
            )
            .label("rank"),
        )
        .where(
            WorkSession.company_id == current_admin.company_id,
            WorkSession.ended_at.is_(None),
        )
        .subquery()
    )
    latest_session = (
        select(session_ranked)
        .where(session_ranked.c.rank == 1)
        .subquery()
    )
    today_totals = (
        select(
            WorkSession.employee_id.label("employee_id"),
            func.coalesce(func.sum(WorkSession.active_seconds), 0).label(
                "active_seconds"
            ),
            func.coalesce(func.sum(WorkSession.idle_seconds), 0).label(
                "idle_seconds"
            ),
            func.coalesce(func.sum(WorkSession.deducted_seconds), 0).label(
                "deducted_seconds"
            ),
        )
        .where(
            WorkSession.company_id == current_admin.company_id,
            WorkSession.started_at.between(today_start, today_end),
        )
        .group_by(WorkSession.employee_id)
        .subquery()
    )
    latest_screenshot = (
        select(
            Screenshot.employee_id.label("employee_id"),
            func.max(Screenshot.captured_at).label("captured_at"),
        )
        .where(
            Screenshot.company_id == current_admin.company_id,
            Screenshot.deleted_at.is_(None),
        )
        .group_by(Screenshot.employee_id)
        .subquery()
    )
    statement = select(
        Employee,
        latest_device.c.device_id,
        latest_device.c.device_name,
        latest_device.c.device_status,
        latest_device.c.device_last_seen,
        latest_session.c.session_id,
        latest_session.c.session_team_id,
        latest_session.c.session_project_id,
        latest_session.c.session_task_id,
        latest_session.c.session_status,
        latest_session.c.session_started_at,
        today_totals.c.active_seconds,
        today_totals.c.idle_seconds,
        today_totals.c.deducted_seconds,
        latest_screenshot.c.captured_at,
    ).outerjoin(
        latest_device,
        latest_device.c.employee_id == Employee.id,
    ).outerjoin(
        latest_session,
        latest_session.c.employee_id == Employee.id,
    ).outerjoin(
        today_totals,
        today_totals.c.employee_id == Employee.id,
    ).outerjoin(
        latest_screenshot,
        latest_screenshot.c.employee_id == Employee.id,
    ).where(
        Employee.company_id == current_admin.company_id,
        Employee.status != "deleted",
    )
    statement = apply_employee_scope(statement, db, current_admin, Employee.id, team_id)
    if employee_id is not None:
        statement = statement.where(Employee.id == employee_id)
    statement = statement.order_by(Employee.name)
    rows = db.execute(statement).all()
    schedule_context_candidates = []
    for row in rows:
        employee = row[0]
        device_id = row[1]
        device_status = row[3]
        normalized_last_seen = _as_utc(row[4])
        session_id = row[5]
        session_status = row[9]
        if (
            session_status in {"active", "idle", "locked", "sleeping"}
            and session_id
            and device_id
            and device_status != "revoked"
            and normalized_last_seen
            and normalized_last_seen >= cutoff
        ):
            schedule_context_candidates.append(employee)
    schedule_context_by_employee = current_idle_contexts(
        db,
        employees=schedule_context_candidates,
        now=now,
    )

    employee_ids = [row[0].id for row in rows]
    attendance_today_by_employee: dict[UUID, DailyAttendance] = {}
    if employee_ids:
        # Heartbeats refresh DailyAttendance at most once per minute. Reading
        # those materialized rows in one query keeps employee/team polling fast
        # and avoids rebuilding every employee timeline on each page load.
        expected_day_by_employee = {
            employee.id: local_today(employee.timezone) for employee, *_rest in rows
        }
        local_days = set(expected_day_by_employee.values())
        attendance_rows = db.scalars(
            select(DailyAttendance).where(
                DailyAttendance.company_id == current_admin.company_id,
                DailyAttendance.employee_id.in_(employee_ids),
                DailyAttendance.work_date >= min(local_days),
                DailyAttendance.work_date <= max(local_days),
            )
        ).all()
        attendance_today_by_employee = {
            attendance.employee_id: attendance
            for attendance in attendance_rows
            if attendance.work_date == expected_day_by_employee.get(attendance.employee_id)
        }
    invitations_by_employee = latest_employee_invitations(db, employee_ids)
    managers_by_employee = employee_manager_summaries(db, employee_ids)
    teams_by_employee: dict[UUID, list[str]] = {item: [] for item in employee_ids}
    team_role_by_employee: dict[UUID, str] = {}
    if employee_ids:
        memberships = db.execute(
            select(TeamMember.employee_id, TeamMember.team_id, TeamMember.role).where(
                TeamMember.employee_id.in_(employee_ids),
                TeamMember.status == "active",
            )
        ).all()
        for membership_employee_id, membership_team_id, membership_role in memberships:
            teams_by_employee.setdefault(membership_employee_id, []).append(str(membership_team_id))
            if team_id is not None and membership_team_id == team_id:
                team_role_by_employee[membership_employee_id] = membership_role or "member"

    data = []
    for row in rows:
        (
            employee,
            device_id,
            device_name,
            device_status,
            device_last_seen,
            session_id,
            session_team_id,
            session_project_id,
            session_task_id,
            session_status,
            session_started_at,
            raw_active_seconds,
            idle_seconds,
            deducted_seconds,
            screenshot_at,
        ) = row
        invitation = invitations_by_employee.get(employee.id)
        employee_data = serialize_employee(employee, invitation)
        employee_data["onboarding_status"] = employee_onboarding_status(
            employee,
            invitation,
            desktop_app_linked=device_id is not None,
        )
        normalized_last_seen = _as_utc(device_last_seen)
        online = bool(
            device_id
            and device_status != "revoked"
            and normalized_last_seen
            and normalized_last_seen >= cutoff
        )
        raw_worked_seconds = max(
            0,
            int(raw_active_seconds or 0) - int(deducted_seconds or 0),
        )
        attendance_today = attendance_today_by_employee.get(employee.id)
        materialized_worked_seconds = (
            int(attendance_today.normal_worked_seconds or 0)
            + int(attendance_today.pre_shift_extra_seconds or 0)
            + int(attendance_today.post_shift_extra_seconds or 0)
            + int(attendance_today.approved_manual_seconds or 0)
            if attendance_today
            else 0
        )
        active_seconds = max(raw_worked_seconds, materialized_worked_seconds)
        idle_seconds = (
            accountable_idle_seconds(attendance_today) if attendance_today is not None else 0
        )
        activity_status = session_status if session_id and online else "offline"
        schedule_context = schedule_context_by_employee.get(employee.id)
        if schedule_context == "on_break":
            if activity_status == "active":
                activity_status = "break_work"
            elif activity_status in {"idle", "locked", "sleeping"}:
                activity_status = "on_break"
        elif (
            schedule_context == "off_shift"
            and activity_status in {"idle", "locked", "sleeping"}
        ):
            activity_status = "off_shift"
        data.append(
            {
                "employee": employee_data,
                "online_status": "online" if online else "offline",
                "activity_status": activity_status,
                "current_session": (
                    {
                        "id": str(session_id),
                        "team_id": str(session_team_id) if session_team_id else None,
                        "project_id": str(session_project_id) if session_project_id else None,
                        "task_id": str(session_task_id) if session_task_id else None,
                    }
                    if session_id
                    else None
                ),
                "session_start_time": session_started_at.isoformat()
                if session_started_at
                else None,
                "worked_today_seconds": active_seconds,
                "active_seconds": active_seconds,
                "idle_seconds": idle_seconds,
                "last_heartbeat": device_last_seen.isoformat() if device_last_seen else None,
                "last_screenshot": screenshot_at.isoformat() if screenshot_at else None,
                "device": (
                    {"id": str(device_id), "device_name": device_name} if device_id else None
                ),
                "team_ids": teams_by_employee.get(employee.id, []),
                "team_role": team_role_by_employee.get(employee.id),
                "managers": managers_by_employee.get(employee.id, []),
            }
        )
    return success_response(data=data)


@router.get("/employees-monitoring")
def list_monitoring_employees(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    team_id: UUID | None = None,
):
    """Return only the roster fields required by Employee Monitoring.

    Attendance totals, screenshots, managers, payroll, and full employee
    profiles deliberately stay out of this frequently-polled response.
    """

    company_settings = get_company_settings(db, current_admin.company_id)
    now = datetime.now(UTC)
    cutoff = now - timedelta(minutes=company_settings.offline_threshold_minutes)

    device_ranked = (
        select(
            Device.employee_id.label("employee_id"),
            Device.id.label("device_id"),
            Device.device_name.label("device_name"),
            Device.status.label("device_status"),
            Device.last_seen_at.label("device_last_seen"),
            func.row_number()
            .over(
                partition_by=Device.employee_id,
                order_by=(
                    Device.last_seen_at.desc().nullslast(),
                    Device.registered_at.desc(),
                ),
            )
            .label("rank"),
        )
        .where(Device.company_id == current_admin.company_id)
        .subquery()
    )
    latest_device = select(device_ranked).where(device_ranked.c.rank == 1).subquery()
    session_ranked = (
        select(
            WorkSession.employee_id.label("employee_id"),
            WorkSession.id.label("session_id"),
            WorkSession.status.label("session_status"),
            func.row_number()
            .over(
                partition_by=WorkSession.employee_id,
                order_by=WorkSession.started_at.desc(),
            )
            .label("rank"),
        )
        .where(
            WorkSession.company_id == current_admin.company_id,
            WorkSession.ended_at.is_(None),
        )
        .subquery()
    )
    latest_session = select(session_ranked).where(session_ranked.c.rank == 1).subquery()
    invitation_ranked = (
        select(
            EmployeeInvitation.employee_id.label("employee_id"),
            EmployeeInvitation.accepted_at.label("accepted_at"),
            func.row_number()
            .over(
                partition_by=EmployeeInvitation.employee_id,
                order_by=EmployeeInvitation.created_at.desc(),
            )
            .label("rank"),
        )
        .where(EmployeeInvitation.company_id == current_admin.company_id)
        .subquery()
    )
    latest_invitation = (
        select(invitation_ranked).where(invitation_ranked.c.rank == 1).subquery()
    )

    statement = (
        select(
            Employee,
            latest_device.c.device_id,
            latest_device.c.device_name,
            latest_device.c.device_status,
            latest_device.c.device_last_seen,
            latest_session.c.session_id,
            latest_session.c.session_status,
            latest_invitation.c.accepted_at,
        )
        .options(
            load_only(
                Employee.id,
                Employee.company_id,
                Employee.name,
                Employee.email,
                Employee.employee_code,
                Employee.job_title,
                Employee.timezone,
                Employee.status,
            )
        )
        .outerjoin(latest_device, latest_device.c.employee_id == Employee.id)
        .outerjoin(latest_session, latest_session.c.employee_id == Employee.id)
        .outerjoin(latest_invitation, latest_invitation.c.employee_id == Employee.id)
        .where(
            Employee.company_id == current_admin.company_id,
            Employee.status != "deleted",
        )
    )
    statement = apply_employee_scope(statement, db, current_admin, Employee.id, team_id)
    rows = db.execute(statement.order_by(Employee.name)).all()

    employee_ids = [row[0].id for row in rows]
    memberships_by_employee: dict[UUID, list[UUID]] = {
        employee_id: [] for employee_id in employee_ids
    }
    if employee_ids:
        memberships = db.execute(
            select(TeamMember.employee_id, TeamMember.team_id).where(
                TeamMember.employee_id.in_(employee_ids),
                TeamMember.status == "active",
            )
        ).all()
        for membership_employee_id, membership_team_id in memberships:
            memberships_by_employee.setdefault(membership_employee_id, []).append(
                membership_team_id
            )

    integrity_by_employee: dict[UUID, list[tuple[datetime, object]]] = {
        employee_id: [] for employee_id in employee_ids
    }
    if employee_ids:
        integrity_rows = db.execute(
            select(
                ActivityEvent.employee_id,
                ActivityEvent.event_timestamp,
                ActivityEvent.payload,
            ).where(
                ActivityEvent.company_id == current_admin.company_id,
                ActivityEvent.employee_id.in_(employee_ids),
                ActivityEvent.event_type == "heartbeat",
                ActivityEvent.event_timestamp >= now - timedelta(minutes=10),
            )
        ).all()
        for integrity_employee_id, observed_at, event_payload in integrity_rows:
            observation = (
                event_payload.get("input_integrity")
                if isinstance(event_payload, dict)
                else None
            )
            if observation is not None:
                integrity_by_employee.setdefault(integrity_employee_id, []).append(
                    (observed_at, observation)
                )

    schedule_candidates = []
    for (
        employee,
        device_id,
        _device_name,
        device_status,
        last_seen,
        session_id,
        status,
        _invitation_accepted_at,
    ) in rows:
        normalized_last_seen = _as_utc(last_seen)
        if (
            status in {"active", "idle", "locked", "sleeping"}
            and session_id
            and device_id
            and device_status != "revoked"
            and normalized_last_seen
            and normalized_last_seen >= cutoff
        ):
            schedule_candidates.append(employee)
    schedule_context_by_employee = current_idle_contexts(
        db,
        employees=schedule_candidates,
        now=now,
        memberships_by_employee=memberships_by_employee,
    )

    data = []
    for (
        employee,
        device_id,
        device_name,
        device_status,
        last_seen,
        session_id,
        status,
        invitation_accepted_at,
    ) in rows:
        normalized_last_seen = _as_utc(last_seen)
        online = bool(
            device_id
            and device_status != "revoked"
            and normalized_last_seen
            and normalized_last_seen >= cutoff
        )
        activity_status = status if session_id and online else "offline"
        schedule_context = schedule_context_by_employee.get(employee.id)
        if schedule_context == "on_break":
            if activity_status == "active":
                activity_status = "break_work"
            elif activity_status in {"idle", "locked", "sleeping"}:
                activity_status = "on_break"
        elif (
            schedule_context == "off_shift"
            and activity_status in {"idle", "locked", "sleeping"}
        ):
            activity_status = "off_shift"

        onboarding_status = (
            "app_pending"
            if employee.status == "active"
            and invitation_accepted_at is not None
            and device_id is None
            else employee.status
        )
        data.append(
            {
                "employee": {
                    "id": str(employee.id),
                    "name": employee.name,
                    "email": employee.email,
                    "employee_code": employee.employee_code,
                    "job_title": employee.job_title,
                    "timezone": employee.timezone,
                    "status": employee.status,
                    "onboarding_status": onboarding_status,
                },
                "activity_status": activity_status,
                "last_heartbeat": last_seen.isoformat() if last_seen else None,
                "device": (
                    {"id": str(device_id), "device_name": device_name} if device_id else None
                ),
                "team_ids": [
                    str(team_id)
                    for team_id in memberships_by_employee.get(employee.id, [])
                ],
                "input_integrity": summarize_input_integrity(
                    integrity_by_employee.get(employee.id, [])
                ),
            }
        )
    return success_response(data=data)


@router.post("/employees")
def create_employee(
    payload: EmployeeCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_capability(current_admin, "people.manage")
    employee = Employee(
        company_id=current_admin.company_id,
        name=payload.name,
        email=payload.email.lower(),
        employee_code=payload.employee_code or f"EMP-{uuid4().hex[:8].upper()}",
        job_title=payload.job_title,
        timezone=payload.timezone,
        status="invited",
        weekly_capacity_minutes=payload.weekly_capacity_minutes,
    )
    db.add(employee)
    db.flush()
    profile = get_or_create_work_profile(db, employee)
    refresh_profile_completed_at(profile)
    invitation, raw_invitation_token = issue_employee_invitation(db, employee)
    record_audit_log(
        db,
        current_admin,
        "created",
        "employee",
        entity_id=employee.id,
        entity_name=employee.email,
        details={"status": employee.status, "job_title": employee.job_title},
        request=request,
    )
    db.commit()
    db.refresh(employee)
    email_queued = enqueue_employee_invitation_email(
        db,
        background_tasks,
        company_id=current_admin.company_id,
        to=employee.email,
        name=employee.name,
        token=raw_invitation_token,
        expires_in_hours=settings.employee_invitation_expire_hours,
    )
    data = serialize_employee(employee, invitation)
    data["work_profile"] = serialize_work_profile(profile)
    data["email_queued"] = email_queued
    return success_response(data=data)


def get_employee_or_404(
    db: Session,
    current_admin: AdminUser,
    employee_id: UUID,
    team_id: UUID | None = None,
) -> Employee:
    return ensure_employee_access(db, current_admin, employee_id, team_id)


@router.get("/employees/{employee_id}")
def get_employee(
    employee_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_capability(current_admin, "people.view")
    employee = get_employee_or_404(db, current_admin, employee_id)
    invitation = latest_employee_invitations(db, [employee.id]).get(employee.id)
    profile = get_or_create_work_profile(db, employee)
    data = serialize_employee(employee, invitation)
    data["work_profile"] = serialize_work_profile_for_admin(profile, current_admin)
    return success_response(data=data)


@router.get("/employees/{employee_id}/work-profile")
def get_employee_work_profile(
    employee_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_capability(current_admin, "breaks.view")
    employee = get_employee_or_404(db, current_admin, employee_id)
    profile = get_or_create_work_profile(db, employee)
    return success_response(data=serialize_work_profile_for_admin(profile, current_admin))


@router.get("/employees/{employee_id}/change-history")
def get_employee_change_history(
    employee_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    limit: int = Query(default=100, ge=1, le=200),
):
    """Return auditable employee changes without exposing protected payroll values."""
    require_capability(current_admin, "breaks.view")
    employee = get_employee_or_404(db, current_admin, employee_id)
    entity_ids: set[UUID] = {employee.id}
    entity_ids.update(
        db.scalars(
            select(TimeAdjustmentRequest.id).where(
                TimeAdjustmentRequest.employee_id == employee.id
            )
        ).all()
    )
    entity_ids.update(
        db.scalars(select(LeaveRequest.id).where(LeaveRequest.employee_id == employee.id)).all()
    )
    entity_ids.update(
        db.scalars(
            select(WorkScheduleOverride.id).where(
                WorkScheduleOverride.employee_id == employee.id
            )
        ).all()
    )
    if has_capability(current_admin, "payroll.view"):
        payroll_entry_ids = db.scalars(
            select(PayrollEntry.id).where(PayrollEntry.employee_id == employee.id)
        ).all()
        entity_ids.update(payroll_entry_ids)
        if payroll_entry_ids:
            entity_ids.update(
                db.scalars(
                    select(PayrollAdjustment.id).where(
                        PayrollAdjustment.payroll_entry_id.in_(payroll_entry_ids)
                    )
                ).all()
            )
    rows = db.scalars(
        select(AuditLog)
        .where(
            AuditLog.company_id == current_admin.company_id,
            or_(
                AuditLog.entity_id.in_(entity_ids),
                AuditLog.entity_type == "work_schedule_override",
            ),
        )
        .order_by(AuditLog.created_at.desc())
        .limit(max(limit, 200))
    ).all()
    payroll_entities = {"payroll_entry", "payroll_adjustment", "payroll_run"}

    def relates_to_employee(row: AuditLog) -> bool:
        if row.entity_id in entity_ids:
            return True
        if row.entity_type != "work_schedule_override":
            return False
        details = row.details or {}
        employee_key = str(employee.id)
        return (
            details.get("employee_id") == employee_key
            or employee_key in (details.get("employee_ids") or [])
            or employee_key in (details.get("affected_employee_ids") or [])
        )

    return success_response(
        data=[
            {
                "id": str(row.id),
                "at": row.created_at.isoformat(),
                "action": row.action,
                "entity_type": row.entity_type,
                "entity_name": row.entity_name,
                "actor_name": row.admin_user.name if row.admin_user else "System",
                "details": row.details or {},
            }
            for row in rows
            if relates_to_employee(row)
            and (
                has_capability(current_admin, "payroll.view")
                or row.entity_type not in payroll_entities
            )
        ][:limit]
    )


@router.patch("/employees/{employee_id}/work-profile")
def update_employee_work_profile(
    employee_id: UUID,
    payload: EmployeeWorkProfileUpdate,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    requested_fields = set(payload.model_fields_set)
    if requested_fields & FINANCIAL_WORK_PROFILE_UPDATE_FIELDS:
        require_capability(current_admin, "payroll.manage")
    else:
        require_capability(current_admin, "breaks.manage")
    employee = get_employee_or_404(db, current_admin, employee_id)
    profile = get_or_create_work_profile(db, employee)
    audit_changes = payload.model_dump(exclude_unset=True, mode="json")
    audit_before = {
        key: (
            getattr(profile, key).isoformat()
            if hasattr(getattr(profile, key), "isoformat")
            else float(getattr(profile, key))
            if key in {"salary_amount", "overtime_rate_multiplier"}
            and getattr(profile, key) is not None
            else getattr(profile, key)
        )
        for key in audit_changes
    }
    changes = dict(audit_changes)
    for time_field in ("shift_start", "shift_end"):
        if time_field in changes:
            changes[time_field] = getattr(payload, time_field)
    for key, value in changes.items():
        setattr(profile, key, value)
    refresh_profile_completed_at(profile)
    db.add(profile)
    db.flush()
    employee_today = local_today(employee.timezone or "UTC")
    refresh_daily_attendance_range(
        db,
        employee=employee,
        start_date=employee_today,
        end_date=employee_today,
    )
    record_audit_log(
        db,
        current_admin,
        "updated",
        "employee_work_profile",
        entity_id=employee.id,
        entity_name=employee.email,
        details={"old": audit_before, "new": audit_changes},
        request=request,
    )
    db.commit()
    db.refresh(profile)
    return success_response(data=serialize_work_profile_for_admin(profile, current_admin))


@router.post("/employees/{employee_id}/send-invitation")
def send_employee_invitation(
    employee_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_capability(current_admin, "people.manage")
    employee = get_employee_or_404(db, current_admin, employee_id)
    profile = get_or_create_work_profile(db, employee)
    completeness = profile_completeness(profile)
    if not completeness["complete"]:
        raise ApiError(
            "EMPLOYEE_PROFILE_INCOMPLETE",
            "Complete schedule, breaks, salary, deduction and overtime settings before sending the invitation.",
            409,
            details={"missing_fields": completeness["missing_fields"]},
        )
    invitation, raw_invitation_token = issue_employee_invitation(db, employee)
    if employee.status == "inactive":
        employee.status = "invited"
        db.add(employee)
    record_audit_log(
        db,
        current_admin,
        "sent",
        "employee_invitation",
        entity_id=employee.id,
        entity_name=employee.email,
        request=request,
    )
    db.commit()
    email_queued = enqueue_employee_invitation_email(
        db,
        background_tasks,
        company_id=current_admin.company_id,
        to=employee.email,
        name=employee.name,
        token=raw_invitation_token,
        expires_in_hours=settings.employee_invitation_expire_hours,
    )
    data = serialize_employee(employee, invitation)
    data["email_queued"] = email_queued
    return success_response(data=data)


@router.get("/employees/{employee_id}/payroll-preview")
def get_employee_payroll_preview(
    employee_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    start_date: date | None = None,
    end_date: date | None = None,
):
    require_capability(current_admin, "payroll.view")
    employee = get_employee_or_404(db, current_admin, employee_id)
    today = date.today()
    start_date = start_date or today.replace(day=1)
    end_date = end_date or today
    return success_response(
        data=payroll_preview(
            db,
            company_id=current_admin.company_id,
            employee=employee,
            start_date=start_date,
            end_date=end_date,
        )
    )


@router.patch("/employees/{employee_id}")
def update_employee(
    employee_id: UUID,
    payload: EmployeeUpdate,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_capability(current_admin, "people.manage")
    employee = get_employee_or_404(db, current_admin, employee_id)
    changes = payload.model_dump(exclude_unset=True)
    if (
        changes.get("status") == "active"
        and employee.status == "invited"
        and not employee.portal_password_hash
    ):
        raise ApiError(
            "EMPLOYEE_INVITATION_REQUIRED",
            "The employee must accept the invitation before the account can be activated.",
            409,
        )
    turning_inactive = changes.get("status") == "inactive" and employee.status != "inactive"
    for key, value in changes.items():
        if key == "status":
            continue
        setattr(
            employee, key, value.lower() if key == "email" and isinstance(value, str) else value
        )
    if turning_inactive:
        disable_employee_tracking(db, employee)
    elif "status" in changes:
        employee.status = changes["status"]
    db.add(employee)
    db.commit()
    db.refresh(employee)
    record_audit_log(
        db,
        current_admin,
        "updated",
        "employee",
        entity_id=employee.id,
        entity_name=employee.email,
        details=payload.model_dump(exclude_unset=True, mode="json"),
        request=request,
    )
    db.commit()
    return success_response(data=serialize_employee(employee))


@router.patch("/employees/{employee_id}/password")
def update_employee_password(
    employee_id: UUID,
    payload: EmployeePasswordUpdate,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_capability(current_admin, "people.manage")
    employee = get_employee_or_404(db, current_admin, employee_id)
    employee.portal_password_hash = hash_password(payload.password)
    if employee.status == "invited":
        employee.status = "active"
    db.add(employee)
    db.commit()
    db.refresh(employee)
    record_audit_log(
        db,
        current_admin,
        "password_reset",
        "employee",
        entity_id=employee.id,
        entity_name=employee.email,
        request=request,
    )
    db.commit()
    return success_response(data=serialize_employee(employee))


@router.delete("/employees/{employee_id}")
def delete_employee(
    employee_id: UUID,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_capability(current_admin, "people.archive")
    employee = get_employee_or_404(db, current_admin, employee_id)
    disable_employee_tracking(db, employee)
    db.add(employee)
    db.commit()
    record_audit_log(
        db,
        current_admin,
        "deactivated",
        "employee",
        entity_id=employee.id,
        entity_name=employee.email,
        request=request,
    )
    db.commit()
    return success_response(data={"deleted": True})


@router.get("/employees/{employee_id}/status")
def employee_status(
    employee_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    employee = get_employee_or_404(db, current_admin, employee_id)
    device = db.scalar(
        select(Device)
        .where(Device.company_id == current_admin.company_id, Device.employee_id == employee.id)
        .order_by(Device.last_seen_at.desc().nullslast())
    )
    current = db.scalar(
        select(WorkSession)
        .where(
            WorkSession.company_id == current_admin.company_id,
            WorkSession.employee_id == employee.id,
            WorkSession.ended_at.is_(None),
        )
        .order_by(WorkSession.started_at.desc())
    )
    employee_today = local_today(employee.timezone)
    from app.api.v1.timesheets import timesheet_rows

    canonical_rows = timesheet_rows(
        db,
        current_admin.company_id,
        employee_today,
        employee_today,
        employee_id=employee.id,
        current_admin=current_admin,
    )
    canonical_today = canonical_rows[0] if canonical_rows else None
    last_screenshot = db.scalar(
        select(Screenshot)
        .where(
            Screenshot.company_id == current_admin.company_id,
            Screenshot.employee_id == employee.id,
            Screenshot.deleted_at.is_(None),
        )
        .order_by(Screenshot.captured_at.desc())
    )
    settings = get_company_settings(db, current_admin.company_id)
    now = datetime.now(UTC)
    cutoff = now - timedelta(minutes=settings.offline_threshold_minutes)
    normalized_last_seen = _as_utc(device.last_seen_at if device else None)
    online = bool(
        device
        and device.status != "revoked"
        and normalized_last_seen
        and normalized_last_seen >= cutoff
    )
    active_seconds = (
        max(
            0,
            int(canonical_today["active_seconds"])
            - int(canonical_today["adjustment_seconds"]),
        )
        if canonical_today
        else 0
    )
    idle_seconds = max(0, int(canonical_today["idle_seconds"])) if canonical_today else 0
    activity_status = current.status if current and online else "offline"
    schedule_context = None
    if activity_status in {"active", "idle", "locked", "sleeping"}:
        schedule_context = current_idle_contexts(
            db,
            employees=[employee],
            now=now,
        ).get(employee.id, "off_shift")
    if schedule_context == "on_break":
        if activity_status == "active":
            activity_status = "break_work"
        elif activity_status in {"idle", "locked", "sleeping"}:
            activity_status = "on_break"
    elif (
        schedule_context == "off_shift"
        and activity_status in {"idle", "locked", "sleeping"}
    ):
        activity_status = "off_shift"
    return success_response(
        data={
            "employee": serialize_employee(employee),
            "online_status": "online" if online else "offline",
            "activity_status": activity_status,
            "current_session": serialize_work_session(current) if current else None,
            "session_start_time": current.started_at.isoformat() if current else None,
            "worked_today_seconds": active_seconds,
            "active_seconds": active_seconds,
            "idle_seconds": idle_seconds,
            "points_today": round(active_seconds / 3600, 2),
            "last_heartbeat": device.last_seen_at.isoformat()
            if device and device.last_seen_at
            else None,
            "last_screenshot": last_screenshot.captured_at.isoformat() if last_screenshot else None,
            "device": serialize_device(device) if device else None,
        }
    )


@router.get("/employees/{employee_id}/sessions")
def employee_sessions(
    employee_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    start_date: date | None = None,
    end_date: date | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
):
    get_employee_or_404(db, current_admin, employee_id)
    statement = select(WorkSession).where(
        WorkSession.company_id == current_admin.company_id, WorkSession.employee_id == employee_id
    )
    if start_date:
        statement = statement.where(WorkSession.started_at >= day_bounds(start_date)[0])
    if end_date:
        statement = statement.where(WorkSession.started_at <= day_bounds(end_date)[1])
    statement = statement.order_by(WorkSession.started_at.desc())
    total = count_for(db, statement)
    sessions = db.scalars(apply_pagination(statement, page, page_size)).all()
    return success_response(
        data=[serialize_work_session(session) for session in sessions],
        meta=pagination_meta(total, page, page_size),
    )


@router.get("/sessions/{session_id}")
def session_detail(
    session_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    session = db.scalar(
        select(WorkSession).where(
            WorkSession.id == session_id, WorkSession.company_id == current_admin.company_id
        )
    )
    if session is None:
        from app.core.exceptions import ApiError

        raise ApiError("SESSION_NOT_FOUND", "Session was not found.", 404)
    ensure_employee_access(db, current_admin, session.employee_id)
    if session.team_id is not None:
        ensure_team_access(db, current_admin, session.team_id)
    return success_response(data=serialize_work_session(session))


@router.get("/sessions/{session_id}/events")
def session_events(
    session_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    session = db.scalar(
        select(WorkSession).where(
            WorkSession.id == session_id, WorkSession.company_id == current_admin.company_id
        )
    )
    if session is None:
        from app.core.exceptions import ApiError

        raise ApiError("SESSION_NOT_FOUND", "Session was not found.", 404)
    ensure_employee_access(db, current_admin, session.employee_id)
    if session.team_id is not None:
        ensure_team_access(db, current_admin, session.team_id)
    events = db.scalars(
        select(ActivityEvent)
        .where(
            ActivityEvent.company_id == current_admin.company_id,
            ActivityEvent.session_id == session_id,
        )
        .order_by(ActivityEvent.event_timestamp)
    ).all()
    return success_response(data=[serialize_activity_event(event) for event in events])
