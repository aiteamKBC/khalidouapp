from datetime import UTC, datetime, time, timedelta
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ApiError
from app.models import (
    ActivityEvent,
    Device,
    Employee,
    EmployeeWorkProfile,
    OvertimeRecord,
    PauseBalance,
    PauseSession,
    WorkScheduleOverride,
    WorkSession,
)
from app.schemas.session import (
    ActivityEventRequest,
    HeartbeatRequest,
    SessionEndRequest,
    PauseStartRequest,
    SessionTaskUpdateRequest,
    SessionStartRequest,
)
from app.services.activity_timeline import build_workday_timeline
from app.services.projects import get_employee_task_context, list_employee_tasks
from app.services.schedules import effective_schedule, overlap_seconds
from app.services.task_workflow import TRACKABLE_STAGES
from app.services.work_profiles import get_or_create_work_profile

ACTIVE_SESSION_STATUSES = {"active", "idle", "locked", "sleeping"}
UNENDED_SESSION_STATUSES = ACTIVE_SESSION_STATUSES | {"offline"}
DEFAULT_REQUIRED_DAILY_SECONDS = 8 * 60 * 60
DEFAULT_DAILY_PAUSE_SECONDS = 10 * 60


def utc(value: datetime | None = None) -> datetime:
    if value is None:
        return datetime.now(UTC)
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def employee_zone(db: Session, device: Device) -> ZoneInfo:
    timezone_name = (
        db.scalar(select(Employee.timezone).where(Employee.id == device.employee_id)) or "UTC"
    )
    try:
        return ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def same_local_day(started_at: datetime, at: datetime, zone: ZoneInfo) -> bool:
    return utc(started_at).astimezone(zone).date() == utc(at).astimezone(zone).date()


def next_local_midnight(started_at: datetime, zone: ZoneInfo) -> datetime:
    local_started_at = utc(started_at).astimezone(zone)
    local_midnight = datetime.combine(
        local_started_at.date() + timedelta(days=1),
        time.min,
        tzinfo=zone,
    )
    return local_midnight.astimezone(UTC)


def close_open_session(
    db: Session,
    *,
    device: Device,
    session: WorkSession,
    ended_at: datetime,
    reason: str,
) -> None:
    if session.ended_at is not None:
        return
    ended_at = utc(ended_at)
    session.ended_at = ended_at
    session.status = "ended"
    create_activity_event(
        db,
        device=device,
        session=session,
        event_type="session_ended",
        event_timestamp=ended_at,
        idempotency_key=f"session-auto-ended:{session.id}:{reason}",
        payload={"reason": reason},
    )


def serialize_session(session: WorkSession) -> dict[str, Any]:
    return {
        "id": str(session.id),
        "company_id": str(session.company_id),
        "employee_id": str(session.employee_id),
        "device_id": str(session.device_id),
        "team_id": str(session.team_id) if session.team_id else None,
        "project_id": str(session.project_id) if session.project_id else None,
        "task_id": str(session.task_id) if session.task_id else None,
        "started_at": utc(session.started_at).isoformat(),
        "ended_at": utc(session.ended_at).isoformat() if session.ended_at else None,
        "status": session.status,
        "active_seconds": session.active_seconds,
        "idle_seconds": session.idle_seconds,
        "normal_seconds": session.normal_seconds,
        "extra_seconds": session.extra_seconds,
        "paid_pause_seconds": session.paid_pause_seconds,
        "created_at": utc(session.created_at).isoformat(),
        "updated_at": utc(session.updated_at).isoformat(),
    }


def local_work_date(db: Session, employee_id: UUID, at: datetime) -> tuple[Any, ZoneInfo]:
    timezone_name = db.scalar(select(Employee.timezone).where(Employee.id == employee_id)) or "UTC"
    try:
        zone = ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo("UTC")
    return utc(at).astimezone(zone).date(), zone


def employee_required_daily_seconds(
    db: Session, employee_id: UUID, at: datetime | None = None
) -> int:
    required_minutes = db.scalar(
        select(EmployeeWorkProfile.required_daily_minutes).where(
            EmployeeWorkProfile.employee_id == employee_id
        )
    )
    if at is not None:
        work_date, _ = local_work_date(db, employee_id, at)
        company_id = db.scalar(select(Employee.company_id).where(Employee.id == employee_id))
        common = (
            WorkScheduleOverride.company_id == company_id,
            WorkScheduleOverride.permanent.is_(False),
            WorkScheduleOverride.effective_date == work_date,
            WorkScheduleOverride.override_type.in_(["shift", "both"]),
        )
        override = db.scalar(
            select(WorkScheduleOverride)
            .where(*common, WorkScheduleOverride.employee_id == employee_id)
            .order_by(WorkScheduleOverride.created_at.desc())
        ) or db.scalar(
            select(WorkScheduleOverride)
            .where(*common, WorkScheduleOverride.employee_id.is_(None))
            .order_by(WorkScheduleOverride.created_at.desc())
        )
        if (
            override
            and override.shift_start
            and override.shift_end
            and override.shift_end > override.shift_start
        ):
            return (
                override.shift_end.hour * 3600
                + override.shift_end.minute * 60
                - override.shift_start.hour * 3600
                - override.shift_start.minute * 60
            )
    return max(60, int(required_minutes or 480)) * 60


def employee_overtime_enabled(db: Session, employee_id: UUID) -> bool:
    return bool(
        db.scalar(
            select(EmployeeWorkProfile.overtime_enabled).where(
                EmployeeWorkProfile.employee_id == employee_id
            )
        )
    )


def _sessions_for_workday(db: Session, session: WorkSession) -> list[WorkSession]:
    work_date, zone = local_work_date(db, session.employee_id, session.started_at)
    start = datetime.combine(work_date, time.min, tzinfo=zone).astimezone(UTC)
    end = datetime.combine(work_date + timedelta(days=1), time.min, tzinfo=zone).astimezone(UTC)
    return list(
        db.scalars(
            select(WorkSession)
            .where(
                WorkSession.company_id == session.company_id,
                WorkSession.employee_id == session.employee_id,
                WorkSession.started_at >= start,
                WorkSession.started_at < end,
            )
            .order_by(WorkSession.started_at, WorkSession.created_at)
        ).all()
    )


def sync_session_time_buckets(
    db: Session,
    session: WorkSession,
    *,
    at: datetime | None = None,
) -> None:
    """Split active time using schedule boundaries, never an hours-completed threshold."""
    employee = db.get(Employee, session.employee_id)
    if employee is None:
        return
    calculated_at = utc(at)
    work_date, _ = local_work_date(db, session.employee_id, session.started_at)
    profile = get_or_create_work_profile(db, employee)
    schedule = effective_schedule(db, employee, profile, work_date)
    shift_start = schedule["start_at"]
    shift_end = schedule["end_at"]
    timeline = build_workday_timeline(
        db,
        company_id=session.company_id,
        employee_id=session.employee_id,
        timezone_name=schedule["timezone"],
        target_date=work_date,
        now=calculated_at,
    )
    buckets: dict[UUID, dict[str, int]] = {}
    for interval in timeline["intervals"]:
        if interval["type"] != "worked":
            continue
        interval_start = utc(datetime.fromisoformat(interval["started_at"]))
        interval_end = (
            utc(datetime.fromisoformat(interval["ended_at"]))
            if interval["ended_at"]
            else calculated_at
        )
        if interval_end <= interval_start:
            continue
        interval_seconds = int((interval_end - interval_start).total_seconds())
        normal_seconds = (
            overlap_seconds(interval_start, interval_end, shift_start, shift_end)
            if shift_start and shift_end
            else 0
        )
        row = buckets.setdefault(UUID(interval["session_id"]), {"normal": 0, "extra": 0})
        row["normal"] += normal_seconds
        row["extra"] += max(0, interval_seconds - normal_seconds)

    for day_session in _sessions_for_workday(db, session):
        worked_seconds = max(0, day_session.active_seconds - day_session.deducted_seconds)
        classified = buckets.get(day_session.id, {"normal": 0, "extra": 0})
        classified_total = classified["normal"] + classified["extra"]
        if classified_total > worked_seconds and classified_total > 0:
            day_session.normal_seconds = round(
                worked_seconds * classified["normal"] / classified_total
            )
            day_session.extra_seconds = max(0, worked_seconds - day_session.normal_seconds)
        else:
            day_session.normal_seconds = classified["normal"]
            day_session.extra_seconds = classified["extra"]
            unclassified = max(0, worked_seconds - classified_total)
            session_end = utc(day_session.ended_at) if day_session.ended_at else calculated_at
            if shift_end and session_end > shift_end:
                day_session.extra_seconds += unclassified
            else:
                day_session.normal_seconds += unclassified
        db.add(day_session)
        record = db.scalar(
            select(OvertimeRecord).where(OvertimeRecord.work_session_id == day_session.id)
        )
        if day_session.extra_seconds <= 0:
            if record is not None:
                record.recorded_extra_seconds = 0
                record.approved_seconds = 0
                record.status = "recorded_not_counted"
                db.add(record)
            continue
        enabled = employee_overtime_enabled(db, day_session.employee_id)
        status = "pending" if enabled else "recorded_not_counted"
        if record is None:
            record = OvertimeRecord(
                company_id=day_session.company_id,
                employee_id=day_session.employee_id,
                work_session_id=day_session.id,
                work_date=work_date,
                overtime_enabled_snapshot=enabled,
                recorded_extra_seconds=day_session.extra_seconds,
                status=status,
            )
        else:
            record.recorded_extra_seconds = day_session.extra_seconds
            record.approved_seconds = min(record.approved_seconds, day_session.extra_seconds)
            if record.approved_seconds <= 0:
                record.status = status
        db.add(record)


def get_or_create_pause_balance(
    db: Session,
    *,
    company_id: UUID,
    employee_id: UUID,
    at: datetime,
) -> PauseBalance:
    work_date, _ = local_work_date(db, employee_id, at)
    balance = db.scalar(
        select(PauseBalance).where(
            PauseBalance.employee_id == employee_id,
            PauseBalance.work_date == work_date,
        )
    )
    if balance is None:
        balance = PauseBalance(
            company_id=company_id,
            employee_id=employee_id,
            work_date=work_date,
            base_seconds=DEFAULT_DAILY_PAUSE_SECONDS,
            extra_approved_seconds=0,
            used_seconds=0,
        )
        db.add(balance)
        db.flush()
    return balance


def active_pause_for_session(db: Session, session: WorkSession) -> PauseSession | None:
    return db.scalar(
        select(PauseSession)
        .where(
            PauseSession.work_session_id == session.id,
            PauseSession.status == "active",
            PauseSession.ended_at.is_(None),
        )
        .order_by(PauseSession.started_at.desc())
    )


def finalize_due_pause(db: Session, session: WorkSession, *, at: datetime | None = None) -> None:
    now = utc(at)
    pause = active_pause_for_session(db, session)
    if pause is None or utc(pause.scheduled_end_at) > now:
        return
    pause.ended_at = pause.scheduled_end_at
    pause.status = "completed"
    pause.used_seconds = pause.requested_seconds
    balance = db.get(PauseBalance, pause.pause_balance_id)
    if balance is not None:
        balance.used_seconds = max(balance.used_seconds, 0) + pause.used_seconds
        session.paid_pause_seconds = max(session.paid_pause_seconds, balance.used_seconds)
        db.add(balance)
    create_activity_event(
        db,
        device=db.get(Device, session.device_id),
        session=session,
        event_type="paid_pause_auto_resumed",
        event_timestamp=pause.ended_at,
        idempotency_key=f"paid-pause-auto-resumed:{pause.id}",
        payload={"pause_session_id": str(pause.id), "used_seconds": pause.used_seconds},
    )
    db.add_all([pause, session])


def pause_state_payload(
    db: Session, session: WorkSession, *, at: datetime | None = None
) -> dict[str, Any]:
    now = utc(at)
    finalize_due_pause(db, session, at=now)
    balance = get_or_create_pause_balance(
        db,
        company_id=session.company_id,
        employee_id=session.employee_id,
        at=now,
    )
    active_pause = active_pause_for_session(db, session)
    total = balance.base_seconds + balance.extra_approved_seconds
    active_reserved = active_pause.requested_seconds if active_pause else 0
    remaining = max(0, total - balance.used_seconds - active_reserved)
    return {
        "work_date": balance.work_date.isoformat(),
        "base_seconds": balance.base_seconds,
        "extra_approved_seconds": balance.extra_approved_seconds,
        "used_seconds": balance.used_seconds,
        "reserved_seconds": active_reserved,
        "remaining_seconds": remaining,
        "active_pause": None
        if active_pause is None
        else {
            "id": str(active_pause.id),
            "started_at": utc(active_pause.started_at).isoformat(),
            "scheduled_end_at": utc(active_pause.scheduled_end_at).isoformat(),
            "requested_seconds": active_pause.requested_seconds,
            "remaining_seconds": max(
                0, int((utc(active_pause.scheduled_end_at) - now).total_seconds())
            ),
            "status": active_pause.status,
        },
    }


def workday_state_payload(db: Session, session: WorkSession) -> dict[str, Any]:
    required_seconds = employee_required_daily_seconds(db, session.employee_id, session.started_at)
    overtime_enabled = employee_overtime_enabled(db, session.employee_id)
    day_sessions = _sessions_for_workday(db, session)
    normal_seconds = sum(item.normal_seconds for item in day_sessions)
    extra_seconds = sum(item.extra_seconds for item in day_sessions)
    return {
        "required_normal_seconds": required_seconds,
        "normal_seconds": normal_seconds,
        "normal_remaining_seconds": max(0, required_seconds - normal_seconds),
        "extra_seconds": extra_seconds,
        "overtime_enabled": overtime_enabled,
        "extra_time_status": (
            "none"
            if extra_seconds <= 0
            else "pending_overtime"
            if overtime_enabled
            else "recorded_not_counted"
        ),
    }


def get_current_session(db: Session, device: Device) -> WorkSession | None:
    return db.scalar(
        select(WorkSession)
        .where(
            WorkSession.company_id == device.company_id,
            WorkSession.employee_id == device.employee_id,
            WorkSession.device_id == device.id,
            WorkSession.ended_at.is_(None),
            WorkSession.status.in_(ACTIVE_SESSION_STATUSES),
        )
        .order_by(WorkSession.started_at.desc())
    )


def get_owned_session(db: Session, device: Device, session_id: UUID) -> WorkSession:
    session = db.scalar(
        select(WorkSession).where(
            WorkSession.id == session_id,
            WorkSession.company_id == device.company_id,
            WorkSession.employee_id == device.employee_id,
            WorkSession.device_id == device.id,
        )
    )
    if session is None:
        raise ApiError("SESSION_NOT_FOUND", "Work session was not found for this device.", 404)
    return session


def create_activity_event(
    db: Session,
    *,
    device: Device,
    session: WorkSession,
    event_type: str,
    event_timestamp: datetime,
    idempotency_key: str,
    payload: dict[str, Any] | None = None,
) -> tuple[ActivityEvent, bool]:
    existing = db.scalar(
        select(ActivityEvent).where(
            ActivityEvent.company_id == device.company_id,
            ActivityEvent.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        return existing, True

    event = ActivityEvent(
        id=uuid4(),
        company_id=device.company_id,
        employee_id=device.employee_id,
        device_id=device.id,
        session_id=session.id,
        event_type=event_type,
        event_timestamp=utc(event_timestamp),
        payload=payload,
        idempotency_key=idempotency_key,
    )
    db.add(event)
    return event, False


def apply_session_task(
    db: Session, device: Device, session: WorkSession, task_id: UUID | None
) -> dict[str, Any] | None:
    if task_id is None:
        session.team_id = None
        session.project_id = None
        session.task_id = None
        return None

    task, project, team = get_employee_task_context(db, device, task_id)
    session.team_id = project.team_id
    session.project_id = project.id
    session.task_id = task.id
    return {
        "task_id": str(task.id),
        "task_name": task.name,
        "project_id": str(project.id),
        "project_name": project.name,
        "team_id": str(team.id),
        "team_name": team.name,
    }


def start_or_get_session(
    db: Session, device: Device, payload: SessionStartRequest
) -> dict[str, Any]:
    now = utc(payload.started_at)
    device.last_seen_at = now
    zone = employee_zone(db, device)
    current = get_current_session(db, device)
    if current is not None:
        if not same_local_day(current.started_at, now, zone):
            close_open_session(
                db,
                device=device,
                session=current,
                ended_at=min(now, next_local_midnight(current.started_at, zone)),
                reason="New local workday started",
            )
            current = None
        elif current.status == "offline":
            close_open_session(
                db,
                device=device,
                session=current,
                ended_at=now,
                reason="Previous agent run was offline",
            )
            current = None

    if current is not None:
        if payload.task_id is not None and current.task_id != payload.task_id:
            result = switch_session_task(
                db, device=device, session=current, task_id=payload.task_id
            )
            current = get_owned_session(db, device, UUID(result["session"]["id"]))
            response = session_response(db, current, created=False)
            db.commit()
            return response
        response = session_response(db, current, created=False)
        db.commit()
        return response

    other_sessions = db.scalars(
        select(WorkSession).where(
            WorkSession.company_id == device.company_id,
            WorkSession.employee_id == device.employee_id,
            WorkSession.ended_at.is_(None),
            WorkSession.status.in_(UNENDED_SESSION_STATUSES),
        )
    ).all()
    for other in other_sessions:
        close_open_session(
            db,
            device=device,
            session=other,
            ended_at=now,
            reason="Superseded by a new work session",
        )

    started_at = now
    session = WorkSession(
        company_id=device.company_id,
        employee_id=device.employee_id,
        device_id=device.id,
        started_at=started_at,
        status="active",
        active_seconds=0,
        idle_seconds=0,
    )
    initial_task_id = payload.task_id
    if initial_task_id is None:
        available_tasks = list_employee_tasks(db, device)
        trackable_tasks = [
            task for task in available_tasks if task.get("stage") in TRACKABLE_STAGES
        ]
        if trackable_tasks:
            initial_task_id = UUID(trackable_tasks[0]["id"])
    task_context = apply_session_task(db, device, session, initial_task_id)
    db.add(session)
    db.flush()
    create_activity_event(
        db,
        device=device,
        session=session,
        event_type="session_started",
        event_timestamp=started_at,
        idempotency_key=f"session-started:{session.id}",
        payload={"source": "automatic_start", "task": task_context},
    )
    db.commit()
    db.refresh(session)
    response = session_response(db, session, created=True)
    db.commit()
    return response


def current_session_response(db: Session, device: Device) -> dict[str, Any]:
    current = get_current_session(db, device)
    if current is None:
        return {"session": None, "workday": None, "pause": None}
    response = session_response(db, current)
    db.commit()
    return response


def session_response(
    db: Session, session: WorkSession, *, created: bool | None = None
) -> dict[str, Any]:
    workday = workday_state_payload(db, session)
    pause = pause_state_payload(db, session)
    payload: dict[str, Any] = {
        "session": serialize_session(session),
        "workday": workday,
        "pause": pause,
    }
    if created is not None:
        payload["created"] = created
    return payload


def start_paid_pause(
    db: Session,
    *,
    device: Device,
    session_id: UUID,
    payload: PauseStartRequest,
) -> dict[str, Any]:
    session = get_owned_session(db, device, session_id)
    if session.ended_at is not None:
        raise ApiError("SESSION_ENDED", "This work session has already ended.", 409)
    now = utc()
    finalize_due_pause(db, session, at=now)
    if active_pause_for_session(db, session) is not None:
        raise ApiError("PAUSE_ALREADY_ACTIVE", "A paid pause is already running.", 409)
    requested_seconds = payload.requested_minutes * 60
    balance = get_or_create_pause_balance(
        db,
        company_id=session.company_id,
        employee_id=session.employee_id,
        at=now,
    )
    remaining = balance.base_seconds + balance.extra_approved_seconds - balance.used_seconds
    if requested_seconds > remaining:
        raise ApiError(
            "PAUSE_BALANCE_EXHAUSTED",
            "You have used your daily paid Pause allowance.",
            409,
            details={"remaining_seconds": max(0, remaining)},
        )
    idempotency_key = payload.idempotency_key or f"paid-pause:{session.id}:{now.isoformat()}"
    existing = db.scalar(
        select(PauseSession).where(
            PauseSession.work_session_id == session.id,
            PauseSession.idempotency_key == idempotency_key,
        )
    )
    if existing is None:
        pause = PauseSession(
            company_id=session.company_id,
            employee_id=session.employee_id,
            work_session_id=session.id,
            pause_balance_id=balance.id,
            started_at=now,
            scheduled_end_at=now + timedelta(seconds=requested_seconds),
            requested_seconds=requested_seconds,
            status="active",
            reason=payload.reason,
            idempotency_key=idempotency_key,
        )
        db.add(pause)
        db.flush()
        create_activity_event(
            db,
            device=device,
            session=session,
            event_type="paid_pause_started",
            event_timestamp=now,
            idempotency_key=f"paid-pause-started:{pause.id}",
            payload={
                "pause_session_id": str(pause.id),
                "requested_seconds": requested_seconds,
                "reason": payload.reason,
            },
        )
    db.commit()
    db.refresh(session)
    response = session_response(db, session)
    db.commit()
    return response


def record_heartbeat(
    db: Session,
    *,
    device: Device,
    session_id: UUID,
    payload: HeartbeatRequest,
) -> dict[str, Any]:
    session = get_owned_session(db, device, session_id)
    if session.ended_at is not None:
        restarted = start_or_get_session(
            db, device, SessionStartRequest(started_at=payload.timestamp)
        )
        device.last_seen_at = utc(payload.timestamp)
        db.commit()
        return {
            "event_id": None,
            "duplicate": False,
            **restarted,
            "restarted": True,
        }
    heartbeat_at = utc(payload.timestamp)
    zone = employee_zone(db, device)
    if session.status == "offline" or not same_local_day(session.started_at, heartbeat_at, zone):
        close_open_session(
            db,
            device=device,
            session=session,
            ended_at=min(heartbeat_at, next_local_midnight(session.started_at, zone)),
            reason="Heartbeat arrived after the local workday changed",
        )
        db.commit()
        restarted = start_or_get_session(
            db,
            device,
            SessionStartRequest(started_at=heartbeat_at, task_id=session.task_id),
        )
        device.last_seen_at = heartbeat_at
        db.commit()
        return {
            "event_id": None,
            "duplicate": False,
            **restarted,
            "restarted": True,
        }
    elapsed_seconds = max(0, int((heartbeat_at - utc(session.started_at)).total_seconds()))

    event, duplicate = create_activity_event(
        db,
        device=device,
        session=session,
        event_type="heartbeat",
        event_timestamp=heartbeat_at,
        idempotency_key=str(payload.event_id),
        payload=payload.model_dump(mode="json"),
    )
    if not duplicate:
        device.last_seen_at = heartbeat_at
        device.agent_version = payload.agent_version
        session.status = payload.status
        session.idle_seconds = max(session.idle_seconds, payload.idle_seconds)
        next_active_seconds = (
            payload.active_seconds
            if payload.active_seconds is not None
            else max(0, elapsed_seconds - session.idle_seconds)
        )
        session.active_seconds = max(session.active_seconds, next_active_seconds)
        finalize_due_pause(db, session, at=heartbeat_at)
        sync_session_time_buckets(db, session, at=heartbeat_at)

    db.commit()
    db.refresh(session)
    response = {
        "event_id": str(event.id),
        "duplicate": duplicate,
        **session_response(db, session),
    }
    db.commit()
    return response


def update_session_task(
    db: Session,
    *,
    device: Device,
    session_id: UUID,
    payload: SessionTaskUpdateRequest,
) -> dict[str, Any]:
    session = get_owned_session(db, device, session_id)
    if session.ended_at is not None:
        current = get_current_session(db, device)
        if current is None:
            raise ApiError("SESSION_ENDED", "This work session has already ended.", 409)
        session = current
    if session.task_id == payload.task_id:
        return {"event_id": None, "duplicate": False, **session_response(db, session)}
    return switch_session_task(db, device=device, session=session, task_id=payload.task_id)


def switch_session_task(
    db: Session,
    *,
    device: Device,
    session: WorkSession,
    task_id: UUID | None,
) -> dict[str, Any]:
    switched_at = datetime.now(UTC)
    previous_task_id = session.task_id
    session.ended_at = switched_at
    session.status = "ended"
    create_activity_event(
        db,
        device=device,
        session=session,
        event_type="task_tracking_stopped",
        event_timestamp=switched_at,
        idempotency_key=f"task-tracking-stopped:{session.id}:{switched_at.isoformat()}",
        payload={"task_id": str(previous_task_id) if previous_task_id else None},
    )

    next_session = WorkSession(
        company_id=device.company_id,
        employee_id=device.employee_id,
        device_id=device.id,
        started_at=switched_at,
        status="active",
        active_seconds=0,
        idle_seconds=0,
    )
    task_context = apply_session_task(db, device, next_session, task_id)
    db.add(next_session)
    db.flush()
    event_id = uuid4()
    event, duplicate = create_activity_event(
        db,
        device=device,
        session=next_session,
        event_type="task_selected" if task_id else "task_cleared",
        event_timestamp=switched_at,
        idempotency_key=str(event_id),
        payload={
            **(task_context or {}),
            "previous_task_id": str(previous_task_id) if previous_task_id else None,
        },
    )
    db.commit()
    db.refresh(next_session)
    response = {
        "event_id": str(event.id),
        "duplicate": duplicate,
        **session_response(db, next_session),
    }
    db.commit()
    return response


def record_agent_event(
    db: Session,
    *,
    device: Device,
    session_id: UUID,
    payload: ActivityEventRequest,
) -> dict[str, Any]:
    session = get_owned_session(db, device, session_id)
    event, duplicate = create_activity_event(
        db,
        device=device,
        session=session,
        event_type=payload.event_type,
        event_timestamp=payload.event_timestamp,
        idempotency_key=str(payload.event_id),
        payload=payload.payload,
    )

    if payload.event_type in {"screen_locked", "system_suspended"}:
        session.status = "locked" if payload.event_type == "screen_locked" else "sleeping"
    elif payload.event_type in {"screen_unlocked", "system_resumed", "idle_ended"}:
        session.status = "active"
    elif payload.event_type == "idle_started":
        session.status = "idle"
    elif payload.event_type == "agent_stopped":
        close_open_session(
            db,
            device=device,
            session=session,
            ended_at=payload.event_timestamp,
            reason="Agent stopped",
        )
    if payload.payload and isinstance(payload.payload.get("idle_seconds"), int):
        session.idle_seconds = max(session.idle_seconds, payload.payload["idle_seconds"])

    db.commit()
    db.refresh(session)
    response = {
        "event_id": str(event.id),
        "duplicate": duplicate,
        **session_response(db, session),
    }
    db.commit()
    return response


def end_session(
    db: Session,
    *,
    device: Device,
    session_id: UUID,
    payload: SessionEndRequest,
) -> dict[str, Any]:
    session = get_owned_session(db, device, session_id)
    if session.ended_at is not None:
        return {"session": serialize_session(session)}

    ended_at = utc(payload.ended_at)
    session.ended_at = ended_at
    session.status = "ended"
    if payload.active_seconds is not None:
        session.active_seconds = max(session.active_seconds, payload.active_seconds)
    if payload.idle_seconds is not None:
        session.idle_seconds = max(session.idle_seconds, payload.idle_seconds)
    sync_session_time_buckets(db, session, at=ended_at)

    create_activity_event(
        db,
        device=device,
        session=session,
        event_type="session_ended",
        event_timestamp=ended_at,
        idempotency_key=str(payload.event_id or uuid4()),
        payload={"reason": payload.reason},
    )
    db.commit()
    db.refresh(session)
    response = session_response(db, session)
    db.commit()
    return response
