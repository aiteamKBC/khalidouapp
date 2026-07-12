from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ApiError
from app.models import ActivityEvent, Device, WorkSession
from app.schemas.session import (
    ActivityEventRequest,
    HeartbeatRequest,
    SessionEndRequest,
    SessionTaskUpdateRequest,
    SessionStartRequest,
)
from app.services.projects import get_employee_task_context, list_employee_tasks
from app.services.task_workflow import TRACKABLE_STAGES

ACTIVE_SESSION_STATUSES = {"active", "idle", "locked", "sleeping", "offline"}


def utc(value: datetime | None = None) -> datetime:
    if value is None:
        return datetime.now(UTC)
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


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
        "created_at": utc(session.created_at).isoformat(),
        "updated_at": utc(session.updated_at).isoformat(),
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


def apply_session_task(db: Session, device: Device, session: WorkSession, task_id: UUID | None) -> dict[str, Any] | None:
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


def start_or_get_session(db: Session, device: Device, payload: SessionStartRequest) -> dict[str, Any]:
    current = get_current_session(db, device)
    if current is not None:
        if payload.task_id is not None and current.task_id != payload.task_id:
            result = switch_session_task(db, device=device, session=current, task_id=payload.task_id)
            return {"session": result["session"], "created": False}
        return {"session": serialize_session(current), "created": False}

    now = utc(payload.started_at)
    other_sessions = db.scalars(
        select(WorkSession).where(
            WorkSession.company_id == device.company_id,
            WorkSession.employee_id == device.employee_id,
            WorkSession.ended_at.is_(None),
            WorkSession.status.in_(ACTIVE_SESSION_STATUSES),
        )
    ).all()
    for other in other_sessions:
        other.ended_at = now
        other.status = "ended"

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
        trackable_tasks = [task for task in available_tasks if task.get("stage") in TRACKABLE_STAGES]
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
    return {"session": serialize_session(session), "created": True}


def current_session_response(db: Session, device: Device) -> dict[str, Any]:
    current = get_current_session(db, device)
    return {"session": serialize_session(current) if current else None}


def record_heartbeat(
    db: Session,
    *,
    device: Device,
    session_id: UUID,
    payload: HeartbeatRequest,
) -> dict[str, Any]:
    session = get_owned_session(db, device, session_id)
    if session.ended_at is not None:
        restarted = start_or_get_session(db, device, SessionStartRequest(started_at=payload.timestamp))
        return {
            "event_id": None,
            "duplicate": False,
            "session": restarted["session"],
            "restarted": True,
        }
    heartbeat_at = utc(payload.timestamp)
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
            payload.active_seconds if payload.active_seconds is not None else max(0, elapsed_seconds - session.idle_seconds)
        )
        session.active_seconds = max(session.active_seconds, next_active_seconds)

    db.commit()
    db.refresh(session)
    return {
        "event_id": str(event.id),
        "duplicate": duplicate,
        "session": serialize_session(session),
    }


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
        return {"event_id": None, "duplicate": False, "session": serialize_session(session)}
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
        payload={**(task_context or {}), "previous_task_id": str(previous_task_id) if previous_task_id else None},
    )
    db.commit()
    db.refresh(next_session)
    return {
        "event_id": str(event.id),
        "duplicate": duplicate,
        "session": serialize_session(next_session),
    }


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
        session.status = "offline"
    if payload.payload and isinstance(payload.payload.get("idle_seconds"), int):
        session.idle_seconds = max(session.idle_seconds, payload.payload["idle_seconds"])

    db.commit()
    db.refresh(session)
    return {
        "event_id": str(event.id),
        "duplicate": duplicate,
        "session": serialize_session(session),
    }


def end_session(
    db: Session,
    *,
    device: Device,
    session_id: UUID,
    payload: SessionEndRequest,
) -> dict[str, Any]:
    session = get_owned_session(db, device, session_id)
    ended_at = utc(payload.ended_at)
    session.ended_at = ended_at
    session.status = "ended"
    if payload.active_seconds is not None:
        session.active_seconds = payload.active_seconds
    if payload.idle_seconds is not None:
        session.idle_seconds = payload.idle_seconds

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
    return {"session": serialize_session(session)}
