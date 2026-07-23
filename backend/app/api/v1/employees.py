from datetime import UTC, date, datetime, timedelta
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

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
    Device,
    Employee,
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
from app.services.attendance import refresh_daily_attendance_range
from app.services.email import (
    enqueue_employee_invitation_email,
)
from app.services.employee_invitations import (
    issue_employee_invitation,
    latest_employee_invitations,
)
from app.schemas.admin import EmployeeWorkProfileUpdate
from app.services.permissions import has_capability, require_capability
from app.services.person_access import disable_employee_tracking
from app.services.request_notifications import employee_manager_summaries
from app.services.work_profiles import (
    DEFAULT_BREAK_RULES,
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
}
FINANCIAL_WORK_PROFILE_UPDATE_FIELDS = FINANCIAL_WORK_PROFILE_FIELDS | {
    "overtime_enabled",
    "overtime_basis",
}


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
                else "09:00",
                "shift_end": shift_end.isoformat(timespec="minutes") if shift_end else "17:00",
                "required_daily_minutes": required_daily_minutes or 480,
                "working_days": working_days or [0, 1, 2, 3, 4],
                "weekly_off_days": weekly_off_days or [5, 6],
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

    The correlated subqueries run inside PostgreSQL, so the remote database is
    reached once for status data instead of several times for every employee.
    """

    today_start, today_end = day_bounds(date.today())
    settings = get_company_settings(db, current_admin.company_id)
    cutoff = datetime.now(UTC) - timedelta(minutes=settings.offline_threshold_minutes)

    def latest_device(column):
        return (
            select(column)
            .where(
                Device.company_id == current_admin.company_id,
                Device.employee_id == Employee.id,
            )
            .order_by(Device.last_seen_at.desc().nullslast(), Device.registered_at.desc())
            .limit(1)
            .correlate(Employee)
            .scalar_subquery()
        )

    def current_session(column):
        return (
            select(column)
            .where(
                WorkSession.company_id == current_admin.company_id,
                WorkSession.employee_id == Employee.id,
                WorkSession.ended_at.is_(None),
            )
            .order_by(WorkSession.started_at.desc())
            .limit(1)
            .correlate(Employee)
            .scalar_subquery()
        )

    def today_total(column):
        return (
            select(func.coalesce(func.sum(column), 0))
            .where(
                WorkSession.company_id == current_admin.company_id,
                WorkSession.employee_id == Employee.id,
                WorkSession.started_at.between(today_start, today_end),
            )
            .correlate(Employee)
            .scalar_subquery()
        )

    last_screenshot = (
        select(func.max(Screenshot.captured_at))
        .where(
            Screenshot.company_id == current_admin.company_id,
            Screenshot.employee_id == Employee.id,
            Screenshot.deleted_at.is_(None),
        )
        .correlate(Employee)
        .scalar_subquery()
    )
    statement = select(
        Employee,
        latest_device(Device.id),
        latest_device(Device.device_name),
        latest_device(Device.status),
        latest_device(Device.last_seen_at),
        current_session(WorkSession.id),
        current_session(WorkSession.team_id),
        current_session(WorkSession.project_id),
        current_session(WorkSession.task_id),
        current_session(WorkSession.status),
        current_session(WorkSession.started_at),
        today_total(WorkSession.active_seconds),
        today_total(WorkSession.idle_seconds),
        today_total(WorkSession.deducted_seconds),
        last_screenshot,
    ).where(
        Employee.company_id == current_admin.company_id,
        Employee.status != "deleted",
    )
    statement = apply_employee_scope(statement, db, current_admin, Employee.id, team_id)
    if employee_id is not None:
        statement = statement.where(Employee.id == employee_id)
    statement = statement.order_by(Employee.name)
    rows = db.execute(statement).all()

    employee_ids = [row[0].id for row in rows]
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
        online = bool(
            device_id
            and device_status != "revoked"
            and device_last_seen
            and device_last_seen >= cutoff
        )
        active_seconds = max(0, int(raw_active_seconds or 0) - int(deducted_seconds or 0))
        idle_seconds = int(idle_seconds or 0)
        data.append(
            {
                "employee": serialize_employee(employee, invitations_by_employee.get(employee.id)),
                "online_status": "online" if online else "offline",
                "activity_status": session_status if session_id and online else "offline",
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
                "worked_today_seconds": active_seconds + idle_seconds,
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
        details=payload.model_dump(exclude_unset=True),
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
    today_start, today_end = day_bounds(date.today())
    totals = db.execute(
        select(
            func.coalesce(func.sum(WorkSession.active_seconds), 0),
            func.coalesce(func.sum(WorkSession.idle_seconds), 0),
            func.coalesce(func.sum(WorkSession.deducted_seconds), 0),
        ).where(
            WorkSession.company_id == current_admin.company_id,
            WorkSession.employee_id == employee.id,
            WorkSession.started_at.between(today_start, today_end),
        )
    ).one_or_none()
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
    cutoff = datetime.now(UTC) - timedelta(minutes=settings.offline_threshold_minutes)
    online = bool(
        device
        and device.status != "revoked"
        and device.last_seen_at
        and device.last_seen_at >= cutoff
    )
    active_seconds = max(0, int(totals[0] if totals else 0) - int(totals[2] if totals else 0))
    idle_seconds = int(totals[1] if totals else 0)
    activity_status = current.status if current and online else "offline"
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
