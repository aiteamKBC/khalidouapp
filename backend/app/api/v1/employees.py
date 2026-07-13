from datetime import UTC, date, datetime, timedelta
import secrets
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
from app.api.v1.team_auth import apply_employee_scope, ensure_employee_access, ensure_team_access, require_general_admin
from app.core.config import settings
from app.core.exceptions import ApiError
from app.core.responses import success_response
from app.core.security import hash_password
from app.database.session import get_db
from app.models import (
    ActivityEvent,
    AdminUser,
    Device,
    Employee,
    EnrollmentCode,
    Screenshot,
    TeamMember,
    WorkSession,
)
from app.schemas.admin import EmployeeCreate, EmployeeUpdate, EnrollmentCodeCreate
from app.services.audit import record_audit_log
from app.services.email import (
    enqueue_employee_invitation_email,
)
from app.services.employee_invitations import (
    issue_employee_invitation,
    latest_employee_invitations,
)

router = APIRouter(tags=["employees"])


@router.get("/employees")
def list_employees(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    search: str | None = None,
    status: str | None = None,
    department: str | None = None,
    team_id: UUID | None = None,
    sort: str = "name",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
):
    statement = select(Employee).where(Employee.company_id == current_admin.company_id)
    statement = apply_employee_scope(statement, db, current_admin, Employee.id, team_id)
    if search:
        pattern = f"%{search}%"
        statement = statement.where(or_(Employee.name.ilike(pattern), Employee.email.ilike(pattern), Employee.employee_code.ilike(pattern)))
    if status:
        statement = statement.where(Employee.status == status)
    if department:
        statement = statement.where(Employee.department == department)

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
        data=[
            serialize_employee(employee, invitations.get(employee.id))
            for employee in employees
        ],
        meta=pagination_meta(total, page, page_size),
    )


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
    ).where(Employee.company_id == current_admin.company_id)
    statement = apply_employee_scope(statement, db, current_admin, Employee.id, team_id)
    if employee_id is not None:
        statement = statement.where(Employee.id == employee_id)
    statement = statement.order_by(Employee.name)
    rows = db.execute(statement).all()

    employee_ids = [row[0].id for row in rows]
    invitations_by_employee = latest_employee_invitations(db, employee_ids)
    teams_by_employee: dict[UUID, list[str]] = {item: [] for item in employee_ids}
    if employee_ids:
        memberships = db.execute(
            select(TeamMember.employee_id, TeamMember.team_id).where(
                TeamMember.employee_id.in_(employee_ids),
                TeamMember.status == "active",
            )
        ).all()
        for membership_employee_id, membership_team_id in memberships:
            teams_by_employee.setdefault(membership_employee_id, []).append(str(membership_team_id))

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
                "employee": serialize_employee(
                    employee, invitations_by_employee.get(employee.id)
                ),
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
                "session_start_time": session_started_at.isoformat() if session_started_at else None,
                "worked_today_seconds": active_seconds + idle_seconds,
                "active_seconds": active_seconds,
                "idle_seconds": idle_seconds,
                "last_heartbeat": device_last_seen.isoformat() if device_last_seen else None,
                "last_screenshot": screenshot_at.isoformat() if screenshot_at else None,
                "device": (
                    {"id": str(device_id), "device_name": device_name}
                    if device_id
                    else None
                ),
                "team_ids": teams_by_employee.get(employee.id, []),
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
    require_general_admin(current_admin)
    employee = Employee(
        company_id=current_admin.company_id,
        name=payload.name,
        email=payload.email.lower(),
        employee_code=payload.employee_code or f"EMP-{uuid4().hex[:8].upper()}",
        department=payload.department,
        timezone=payload.timezone,
        status="invited",
        weekly_capacity_minutes=payload.weekly_capacity_minutes,
    )
    db.add(employee)
    db.flush()
    invitation, raw_invitation_token = issue_employee_invitation(db, employee)
    record_audit_log(
        db,
        current_admin,
        "created",
        "employee",
        entity_id=employee.id,
        entity_name=employee.email,
        details={"status": employee.status, "department": employee.department},
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
    data["email_queued"] = email_queued
    return success_response(data=data)


def get_employee_or_404(
    db: Session,
    current_admin: AdminUser,
    employee_id: UUID,
    team_id: UUID | None = None,
) -> Employee:
    return ensure_employee_access(db, current_admin, employee_id, team_id)


def generate_enrollment_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "KH-" + "".join(secrets.choice(alphabet) for _ in range(12))


def generate_portal_access_key() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "KHW-" + "".join(secrets.choice(alphabet) for _ in range(16))


def serialize_enrollment_code(code: EnrollmentCode, include_plain_code: str | None = None) -> dict:
    expires_at = code.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    status = "expired" if code.status == "active" and expires_at <= datetime.now(UTC) else code.status
    data = {
        "id": str(code.id),
        "employee_id": str(code.employee_id),
        "code_hint": code.code_hint,
        "status": status,
        "expires_at": code.expires_at.isoformat(),
        "used_at": code.used_at.isoformat() if code.used_at else None,
        "created_at": code.created_at.isoformat(),
    }
    if include_plain_code is not None:
        data["code"] = include_plain_code
    return data


@router.get("/employees/{employee_id}")
def get_employee(employee_id: UUID, current_admin: Annotated[AdminUser, Depends(get_current_admin)], db: Annotated[Session, Depends(get_db)]):
    employee = get_employee_or_404(db, current_admin, employee_id)
    invitation = latest_employee_invitations(db, [employee.id]).get(employee.id)
    return success_response(data=serialize_employee(employee, invitation))


@router.post("/employees/{employee_id}/portal-access-key")
def create_employee_portal_access_key(
    employee_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_general_admin(current_admin)
    employee = get_employee_or_404(db, current_admin, employee_id)
    plain_key = generate_portal_access_key()
    employee.portal_access_key_hash = hash_password(plain_key)
    employee.portal_access_key_hint = f"{plain_key[:8]}..."
    db.add(employee)
    record_audit_log(
        db,
        current_admin,
        "created",
        "employee_portal_access_key",
        entity_id=employee.id,
        entity_name=employee.email,
        request=request,
    )
    db.commit()
    return success_response(
        data={
            "employee_id": str(employee.id),
            "email": employee.email,
            "access_key": plain_key,
            "access_key_hint": employee.portal_access_key_hint,
            "email_queued": False,
        }
    )


@router.delete("/employees/{employee_id}/portal-access-key")
def revoke_employee_portal_access_key(
    employee_id: UUID,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_general_admin(current_admin)
    employee = get_employee_or_404(db, current_admin, employee_id)
    employee.portal_access_key_hash = None
    employee.portal_access_key_hint = None
    db.add(employee)
    record_audit_log(
        db,
        current_admin,
        "revoked",
        "employee_portal_access_key",
        entity_id=employee.id,
        entity_name=employee.email,
        request=request,
    )
    db.commit()
    return success_response(data={"revoked": True})


@router.get("/employees/{employee_id}/enrollment-codes")
def list_employee_enrollment_codes(
    employee_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_general_admin(current_admin)
    employee = get_employee_or_404(db, current_admin, employee_id)
    codes = db.scalars(
        select(EnrollmentCode)
        .where(
            EnrollmentCode.company_id == current_admin.company_id,
            EnrollmentCode.employee_id == employee.id,
        )
        .order_by(EnrollmentCode.created_at.desc())
    ).all()
    return success_response(data=[serialize_enrollment_code(code) for code in codes])


@router.post("/employees/{employee_id}/enrollment-codes")
def create_employee_enrollment_code(
    employee_id: UUID,
    payload: EnrollmentCodeCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_general_admin(current_admin)
    employee = get_employee_or_404(db, current_admin, employee_id)
    plain_code = generate_enrollment_code()
    expires_at = datetime.now(UTC) + timedelta(days=payload.expires_in_days)
    enrollment_code = EnrollmentCode(
        company_id=current_admin.company_id,
        employee_id=employee.id,
        code_hash=hash_password(plain_code),
        code_hint=f"{plain_code[:6]}...",
        status="active",
        expires_at=expires_at,
    )
    db.add(enrollment_code)
    db.commit()
    db.refresh(enrollment_code)
    record_audit_log(
        db,
        current_admin,
        "created",
        "enrollment_code",
        entity_id=enrollment_code.id,
        entity_name=employee.email,
        details={
            "employee_id": str(employee.id),
            "expires_at": enrollment_code.expires_at.isoformat(),
        },
        request=request,
    )
    db.commit()
    data = serialize_enrollment_code(enrollment_code, plain_code)
    data["email_queued"] = False
    return success_response(data=data)


@router.delete("/employees/{employee_id}/enrollment-codes/{code_id}")
def revoke_employee_enrollment_code(
    employee_id: UUID,
    code_id: UUID,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_general_admin(current_admin)
    employee = get_employee_or_404(db, current_admin, employee_id)
    enrollment_code = db.scalar(
        select(EnrollmentCode).where(
            EnrollmentCode.id == code_id,
            EnrollmentCode.company_id == current_admin.company_id,
            EnrollmentCode.employee_id == employee.id,
        )
    )
    if enrollment_code is None:
        raise ApiError("ENROLLMENT_CODE_NOT_FOUND", "Enrollment code was not found.", 404)
    if enrollment_code.status == "active":
        enrollment_code.status = "revoked"
        db.add(enrollment_code)
        db.commit()
        db.refresh(enrollment_code)
        record_audit_log(
            db,
            current_admin,
            "revoked",
            "enrollment_code",
            entity_id=enrollment_code.id,
            entity_name=employee.email,
            details={"employee_id": str(employee.id)},
            request=request,
        )
        db.commit()
    return success_response(data=serialize_enrollment_code(enrollment_code))


@router.patch("/employees/{employee_id}")
def update_employee(
    employee_id: UUID,
    payload: EmployeeUpdate,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_general_admin(current_admin)
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
    for key, value in changes.items():
        setattr(employee, key, value.lower() if key == "email" and isinstance(value, str) else value)
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


@router.delete("/employees/{employee_id}")
def delete_employee(employee_id: UUID, request: Request, current_admin: Annotated[AdminUser, Depends(get_current_admin)], db: Annotated[Session, Depends(get_db)]):
    require_general_admin(current_admin)
    employee = get_employee_or_404(db, current_admin, employee_id)
    employee.status = "inactive"
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
def employee_status(employee_id: UUID, current_admin: Annotated[AdminUser, Depends(get_current_admin)], db: Annotated[Session, Depends(get_db)]):
    employee = get_employee_or_404(db, current_admin, employee_id)
    device = db.scalar(
        select(Device)
        .where(Device.company_id == current_admin.company_id, Device.employee_id == employee.id)
        .order_by(Device.last_seen_at.desc().nullslast())
    )
    current = db.scalar(
        select(WorkSession)
        .where(WorkSession.company_id == current_admin.company_id, WorkSession.employee_id == employee.id, WorkSession.ended_at.is_(None))
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
        .where(Screenshot.company_id == current_admin.company_id, Screenshot.employee_id == employee.id, Screenshot.deleted_at.is_(None))
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
            "last_heartbeat": device.last_seen_at.isoformat() if device and device.last_seen_at else None,
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
    statement = select(WorkSession).where(WorkSession.company_id == current_admin.company_id, WorkSession.employee_id == employee_id)
    if start_date:
        statement = statement.where(WorkSession.started_at >= day_bounds(start_date)[0])
    if end_date:
        statement = statement.where(WorkSession.started_at <= day_bounds(end_date)[1])
    statement = statement.order_by(WorkSession.started_at.desc())
    total = count_for(db, statement)
    sessions = db.scalars(apply_pagination(statement, page, page_size)).all()
    return success_response(data=[serialize_work_session(session) for session in sessions], meta=pagination_meta(total, page, page_size))


@router.get("/sessions/{session_id}")
def session_detail(session_id: UUID, current_admin: Annotated[AdminUser, Depends(get_current_admin)], db: Annotated[Session, Depends(get_db)]):
    session = db.scalar(select(WorkSession).where(WorkSession.id == session_id, WorkSession.company_id == current_admin.company_id))
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
    session = db.scalar(select(WorkSession).where(WorkSession.id == session_id, WorkSession.company_id == current_admin.company_id))
    if session is None:
        from app.core.exceptions import ApiError

        raise ApiError("SESSION_NOT_FOUND", "Session was not found.", 404)
    ensure_employee_access(db, current_admin, session.employee_id)
    if session.team_id is not None:
        ensure_team_access(db, current_admin, session.team_id)
    events = db.scalars(
        select(ActivityEvent)
        .where(ActivityEvent.company_id == current_admin.company_id, ActivityEvent.session_id == session_id)
        .order_by(ActivityEvent.event_timestamp)
    ).all()
    return success_response(data=[serialize_activity_event(event) for event in events])
