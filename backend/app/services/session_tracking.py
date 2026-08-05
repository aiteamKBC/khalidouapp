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
from app.services.activity_timeline import (
    build_workday_timeline,
)
from app.services.projects import get_employee_task_context, list_employee_tasks
from app.services.schedules import effective_schedule, overlap_seconds
from app.services.task_workflow import TRACKABLE_STAGES
from app.services.work_profiles import get_or_create_work_profile

ACTIVE_SESSION_STATUSES = {"active", "idle", "locked", "sleeping"}
UNENDED_SESSION_STATUSES = ACTIVE_SESSION_STATUSES | {"offline"}
DEFAULT_REQUIRED_DAILY_SECONDS = 8 * 60 * 60
DEFAULT_DAILY_PAUSE_SECONDS = 10 * 60
LONG_IDLE_SESSION_SPLIT_SECONDS = 4 * 60 * 60
MAX_FUTURE_CLOCK_SKEW = timedelta(seconds=30)


def utc(value: datetime | None = None) -> datetime:
    if value is None:
        return datetime.now(UTC)
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def bounded_client_timestamp(value: datetime | None = None) -> datetime:
    reported_at = utc(value)
    server_now = datetime.now(UTC)
    if reported_at > server_now + MAX_FUTURE_CLOCK_SKEW:
        return server_now
    return reported_at


def employee_zone(db: Session, device: Device) -> ZoneInfo:
    timezone_name = (
        device.timezone
        or db.scalar(select(Employee.timezone).where(Employee.id == device.employee_id))
        or "UTC"
    )
    try:
        return ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def session_zone(db: Session, session: WorkSession) -> ZoneInfo:
    timezone_name = session.timezone
    if not timezone_name:
        device = db.get(Device, session.device_id)
        if device is not None:
            return employee_zone(db, device)
        timezone_name = (
            db.scalar(select(Employee.timezone).where(Employee.id == session.employee_id)) or "UTC"
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


def session_chain_started_at(db: Session, session: WorkSession) -> datetime:
    started_event = db.scalar(
        select(ActivityEvent)
        .where(
            ActivityEvent.session_id == session.id,
            ActivityEvent.event_type == "session_started",
        )
        .order_by(ActivityEvent.event_timestamp, ActivityEvent.created_at)
    )
    source = started_event.payload if started_event and isinstance(started_event.payload, dict) else {}
    continued_at = source.get("continued_session_started_at")
    if isinstance(continued_at, str):
        try:
            return utc(datetime.fromisoformat(continued_at))
        except ValueError:
            pass
    return utc(session.started_at)


WORKED_EVENT_TYPES = {
    "session_started",
    # The agent emits this boundary when it detects that the employee has
    # stopped interacting.  It is therefore the last proven worked instant,
    # even though everything after it is non-working.
    "idle_started",
    "idle_ended",
    "manual_pause_ended",
    "screen_unlocked",
    "system_resumed",
}
NON_WORKING_SESSION_STATUSES = {"idle", "locked", "sleeping", "offline"}


def mark_device_seen(device: Device, *, received_at: datetime | None = None) -> None:
    """Record transport liveness using server time, never the device clock.

    Client timestamps describe when work happened. They can be delayed, replayed,
    or have a bad clock, so using them for device liveness allowed an old queued
    event to move ``last_seen_at`` backwards.
    """
    seen_at = utc(received_at)
    if device.last_seen_at is None or utc(device.last_seen_at) < seen_at:
        device.last_seen_at = seen_at


def last_worked_activity_at(
    db: Session,
    session: WorkSession,
    *,
    not_after: datetime | None = None,
) -> datetime:
    """When the employee was last demonstrably at the keyboard in this session.

    A machine left switched on keeps sending heartbeats, so the session's own
    end time says nothing about when the employee stopped working. Closing a
    session at this timestamp keeps unattended hours out of the workday instead
    of counting them up to midnight.
    """
    started_at = utc(session.started_at)
    statement = select(
        ActivityEvent.event_type,
        ActivityEvent.event_timestamp,
        ActivityEvent.payload,
    ).where(
        ActivityEvent.session_id == session.id,
        ActivityEvent.event_timestamp >= started_at,
    )
    upper_bound = not_after or session.ended_at
    if upper_bound is not None:
        statement = statement.where(ActivityEvent.event_timestamp <= utc(upper_bound))
    events = db.execute(statement.order_by(ActivityEvent.event_timestamp.desc())).all()
    for event_type, event_timestamp, payload in events:
        if event_type in WORKED_EVENT_TYPES:
            return max(started_at, utc(event_timestamp))
        if event_type == "heartbeat" and (payload or {}).get("status") == "active":
            return max(started_at, utc(event_timestamp))
    return started_at


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
    # The database must never contain an impossible interval. Delayed or
    # mis-clocked clients used to create rows whose end preceded their start.
    ended_at = max(utc(session.started_at), utc(ended_at))
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
        "timezone": session.timezone,
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


def local_work_date(
    db: Session,
    employee_id: UUID,
    at: datetime,
    timezone_name: str | None = None,
) -> tuple[Any, ZoneInfo]:
    timezone_name = (
        timezone_name
        or db.scalar(select(Employee.timezone).where(Employee.id == employee_id))
        or "UTC"
    )
    try:
        zone = ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo("UTC")
    return utc(at).astimezone(zone).date(), zone


def employee_required_daily_seconds(
    db: Session,
    employee_id: UUID,
    at: datetime | None = None,
    timezone_name: str | None = None,
) -> int:
    required_minutes = db.scalar(
        select(EmployeeWorkProfile.required_daily_minutes).where(
            EmployeeWorkProfile.employee_id == employee_id
        )
    )
    if at is not None:
        work_date, _ = local_work_date(db, employee_id, at, timezone_name)
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
    zone = session_zone(db, session)
    work_date, zone = local_work_date(
        db,
        session.employee_id,
        session.started_at,
        zone.key,
    )
    start = datetime.combine(work_date, time.min, tzinfo=zone).astimezone(UTC)
    end = datetime.combine(work_date + timedelta(days=1), time.min, tzinfo=zone).astimezone(UTC)
    return list(
        db.scalars(
            select(WorkSession)
            .where(
                WorkSession.company_id == session.company_id,
                WorkSession.employee_id == session.employee_id,
                WorkSession.device_id == session.device_id,
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
    zone = session_zone(db, session)
    work_date, _ = local_work_date(
        db,
        session.employee_id,
        session.started_at,
        zone.key,
    )
    profile = get_or_create_work_profile(db, employee)
    schedule = effective_schedule(
        db,
        employee,
        profile,
        work_date,
        timezone_name=zone.key,
    )
    shift_start = schedule["start_at"]
    shift_end = schedule["end_at"]
    timeline = build_workday_timeline(
        db,
        company_id=session.company_id,
        employee_id=session.employee_id,
        timezone_name=schedule["timezone"],
        target_date=work_date,
        now=calculated_at,
        device_id=session.device_id,
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
            0
            if interval.get("work_category") == "extra"
            else (
                overlap_seconds(interval_start, interval_end, shift_start, shift_end)
                if shift_start and shift_end
                else 0
            )
        )
        row = buckets.setdefault(UUID(interval["session_id"]), {"normal": 0, "extra": 0})
        row["normal"] += normal_seconds
        row["extra"] += max(0, interval_seconds - normal_seconds)

    for day_session in _sessions_for_workday(db, session):
        classified = buckets.get(day_session.id, {"normal": 0, "extra": 0})

        # The disjoint activity timeline is the authoritative classification.
        # A legacy/recovered client counter can be larger than the work that is
        # actually visible today (for example, after carrying a previous-day
        # counter through a restart). Treating that difference as unclassified
        # work made the entire stale amount become overtime as soon as the shift
        # ended. Timeline construction already preserves locally observed work
        # across API outages while removing genuine offline gaps, so never turn
        # an unmatched counter remainder into normal time or overtime.
        day_session.normal_seconds = classified["normal"]
        day_session.extra_seconds = classified["extra"]
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
    timezone_name: str | None = None,
) -> PauseBalance:
    work_date, _ = local_work_date(db, employee_id, at, timezone_name)
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
    if session.ended_at is not None:
        # Reading a closed historical session must not advance its pause state
        # with today's clock or create an event after the immutable end.
        now = min(now, utc(session.ended_at))
    finalize_due_pause(db, session, at=now)
    balance = get_or_create_pause_balance(
        db,
        company_id=session.company_id,
        employee_id=session.employee_id,
        at=now,
        timezone_name=session_zone(db, session).key,
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
    work_date, zone = local_work_date(
        db,
        session.employee_id,
        session.started_at,
        session_zone(db, session).key,
    )
    required_seconds = employee_required_daily_seconds(
        db,
        session.employee_id,
        session.started_at,
        zone.key,
    )
    overtime_enabled = employee_overtime_enabled(db, session.employee_id)
    day_sessions = _sessions_for_workday(db, session)
    normal_seconds = sum(item.normal_seconds for item in day_sessions)
    extra_seconds = sum(item.extra_seconds for item in day_sessions)
    return {
        "work_date": work_date.isoformat(),
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


def get_current_session(
    db: Session,
    device: Device,
    *,
    include_offline: bool = False,
) -> WorkSession | None:
    statuses = UNENDED_SESSION_STATUSES if include_offline else ACTIVE_SESSION_STATUSES
    return db.scalar(
        select(WorkSession)
        .where(
            WorkSession.company_id == device.company_id,
            WorkSession.employee_id == device.employee_id,
            WorkSession.device_id == device.id,
            WorkSession.ended_at.is_(None),
            WorkSession.status.in_(statuses),
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

    event_at = utc(event_timestamp)
    session_start = utc(session.started_at)
    session_end = utc(session.ended_at) if session.ended_at is not None else None
    if event_at < session_start or (session_end is not None and event_at > session_end):
        raise ApiError(
            "EVENT_OUTSIDE_SESSION_BOUNDS",
            "Activity events must be inside their work session.",
            409,
            details={
                "session_id": str(session.id),
                "session_started_at": session_start.isoformat(),
                "session_ended_at": session_end.isoformat() if session_end else None,
                "event_timestamp": event_at.isoformat(),
            },
        )

    event = ActivityEvent(
        id=uuid4(),
        company_id=device.company_id,
        employee_id=device.employee_id,
        device_id=device.id,
        session_id=session.id,
        event_type=event_type,
        event_timestamp=event_at,
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
    db: Session,
    device: Device,
    payload: SessionStartRequest,
    *,
    start_source: str = "automatic_start",
) -> dict[str, Any]:
    now = bounded_client_timestamp(payload.started_at)
    # Serialize starts for the same installation. Together with the partial
    # unique index this prevents two concurrent requests from creating two
    # open sessions for one device.
    db.execute(select(Device.id).where(Device.id == device.id).with_for_update())
    recovery_key = (
        f"offline-session-recovery:{payload.offline_recovery_id}"
        if payload.offline_recovery and payload.offline_recovery_id is not None
        else None
    )
    if recovery_key is not None:
        recovered_event = db.scalar(
            select(ActivityEvent).where(
                ActivityEvent.company_id == device.company_id,
                ActivityEvent.device_id == device.id,
                ActivityEvent.idempotency_key == recovery_key,
            )
        )
        if recovered_event is not None:
            recovered_session = get_owned_session(
                db,
                device,
                recovered_event.session_id,
            )
            return session_response(db, recovered_session, created=False)
    mark_device_seen(device)
    zone = employee_zone(db, device)
    current = get_current_session(
        db,
        device,
        include_offline=payload.offline_recovery,
    )
    continued_session_started_at: datetime | None = None
    if current is not None:
        if now < utc(current.started_at):
            current_zone = session_zone(db, current)
            if payload.offline_recovery and same_local_day(
                current.started_at,
                now,
                current_zone,
            ):
                # The explicit, idempotent recovery channel may extend the
                # same local workday backwards. It cannot cross a day boundary
                # or close/replace a newer session.
                current.started_at = now
                current.status = "active"
                create_activity_event(
                    db,
                    device=device,
                    session=current,
                    event_type="session_started",
                    event_timestamp=now,
                    idempotency_key=(
                        recovery_key
                        or f"offline-session-start:{device.id}:{now.isoformat()}"
                    ),
                    payload={"source": "offline_recovery"},
                )
                db.commit()
                return session_response(db, current, created=False)
            # A delayed offline queue must never rewrite or close a newer live
            # session. Keep the accepted ledger monotonic and let the caller
            # continue with the authoritative current session.
            response = session_response(db, current, created=False)
            response.update(
                {
                    "ignored": True,
                    "ignore_reason": "event_precedes_session",
                }
            )
            db.commit()
            return response
        current_zone = session_zone(db, current)
        if current_zone.key != zone.key:
            close_open_session(
                db,
                device=device,
                session=current,
                ended_at=now,
                reason="Device timezone changed",
            )
            current = None
        elif not same_local_day(current.started_at, now, current_zone):
            # End yesterday's session where the employee actually stopped, not at
            # midnight. A machine left switched on overnight otherwise banked
            # every unattended hour as work.
            last_worked_at = max(
                last_worked_activity_at(db, current),
                utc(current.started_at),
            )
            if last_worked_at > utc(current.started_at):
                continued_session_started_at = session_chain_started_at(db, current)
            close_open_session(
                db,
                device=device,
                session=current,
                ended_at=min(
                    now,
                    next_local_midnight(current.started_at, current_zone),
                    last_worked_at,
                ),
                reason="New local workday started",
            )
            current = None
        elif current.status == "offline":
            if payload.offline_recovery:
                # A signed-in employee may restart Khaliduo while an update or
                # API outage has temporarily marked the still-open session
                # offline. Recovery carries an idempotent local-session ID, so
                # reconnect to that same server session instead of resetting
                # the employee's current-session counter.
                current.status = "active"
            else:
                close_open_session(
                    db,
                    device=device,
                    session=current,
                    ended_at=now,
                    reason="Previous agent run was offline",
                )
                current = None

    if current is not None:
        if payload.offline_recovery:
            create_activity_event(
                db,
                device=device,
                session=current,
                event_type="offline_session_recovered",
                event_timestamp=now,
                idempotency_key=(
                    recovery_key
                    or f"offline-session-start:{device.id}:{now.isoformat()}"
                ),
                payload={"source": "offline_recovery"},
            )
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
        timezone=zone.key,
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
        idempotency_key=recovery_key or f"session-started:{session.id}",
        payload={
            "source": (
                "daily_rollover"
                if continued_session_started_at is not None
                else "offline_recovery"
                if payload.offline_recovery
                else start_source
            ),
            "task": task_context,
            **(
                {
                    "continued_from_previous_day": True,
                    "continued_session_started_at": continued_session_started_at.isoformat(),
                }
                if continued_session_started_at is not None
                else {}
            ),
        },
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
        timezone_name=session_zone(db, session).key,
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


def resume_paid_pause(
    db: Session,
    *,
    device: Device,
    session_id: UUID,
) -> dict[str, Any]:
    session = get_owned_session(db, device, session_id)
    if session.ended_at is not None:
        raise ApiError("SESSION_ENDED", "This work session has already ended.", 409)

    now = utc()
    finalize_due_pause(db, session, at=now)
    pause = active_pause_for_session(db, session)
    if pause is not None:
        ended_at = min(now, utc(pause.scheduled_end_at))
        used_seconds = min(
            pause.requested_seconds,
            max(0, int((ended_at - utc(pause.started_at)).total_seconds())),
        )
        pause.ended_at = ended_at
        pause.status = "completed"
        pause.used_seconds = used_seconds

        balance = db.get(PauseBalance, pause.pause_balance_id)
        if balance is not None:
            balance.used_seconds = max(balance.used_seconds, 0) + used_seconds
            session.paid_pause_seconds = max(session.paid_pause_seconds, balance.used_seconds)
            db.add(balance)

        create_activity_event(
            db,
            device=device,
            session=session,
            event_type="paid_pause_resumed",
            event_timestamp=ended_at,
            idempotency_key=f"paid-pause-resumed:{pause.id}",
            payload={
                "pause_session_id": str(pause.id),
                "used_seconds": used_seconds,
            },
        )
        db.add_all([pause, session])

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
    heartbeat_at = bounded_client_timestamp(payload.timestamp)
    received_at = utc()
    mark_device_seen(device, received_at=received_at)
    device.agent_version = payload.agent_version

    def ignored(reason: str) -> dict[str, Any]:
        db.commit()
        return {
            "event_id": None,
            "duplicate": False,
            **session_response(db, session),
            "restarted": False,
            "ignored": True,
            "ignore_reason": reason,
        }

    if session.ended_at is not None:
        # Only real work reopens a workday. An unattended machine keeps sending
        # idle heartbeats, and restarting on those spawned a fresh session the
        # moment the previous one closed - which is how workdays ended up
        # beginning at midnight.
        if payload.status in NON_WORKING_SESSION_STATUSES:
            return ignored("closed_session_non_working_signal")
        if heartbeat_at < utc(session.started_at):
            return ignored("event_precedes_session")
        if heartbeat_at <= utc(session.ended_at):
            return ignored("closed_session_is_immutable")
        restarted = start_or_get_session(
            db,
            device,
            SessionStartRequest(started_at=heartbeat_at, task_id=session.task_id),
        )
        db.commit()
        return {
            "event_id": None,
            "duplicate": False,
            **restarted,
            "restarted": True,
        }

    if heartbeat_at < utc(session.started_at):
        return ignored("event_precedes_session")

    zone = session_zone(db, session)
    current_device_zone = employee_zone(db, device)
    timezone_changed = zone.key != current_device_zone.key
    local_day_changed = not same_local_day(session.started_at, heartbeat_at, zone)
    if local_day_changed or session.status == "offline" or timezone_changed:
        if timezone_changed:
            trusted_end = heartbeat_at
            reason = "Device timezone changed"
        else:
            cutoff = (
                next_local_midnight(session.started_at, zone)
                if local_day_changed
                else heartbeat_at
            )
            trusted_end = min(
                heartbeat_at,
                cutoff,
                last_worked_activity_at(db, session, not_after=cutoff),
            )
            reason = (
                "New local workday started"
                if local_day_changed
                else "Previous agent run was offline"
            )
        close_open_session(
            db,
            device=device,
            session=session,
            ended_at=trusted_end,
            reason=reason,
        )
        # autoflush is disabled; make the close visible before looking for or
        # creating the authoritative current session.
        db.flush()
        db.commit()
        if payload.status in NON_WORKING_SESSION_STATUSES:
            return ignored(
                "new_workday_requires_active_input"
                if local_day_changed
                else "closed_session_non_working_signal"
            )
        restarted = start_or_get_session(
            db,
            device,
            SessionStartRequest(started_at=heartbeat_at, task_id=session.task_id),
        )
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
        session.status = payload.status
        next_active_seconds = (
            payload.active_seconds
            if payload.active_seconds is not None
            else max(0, elapsed_seconds - session.idle_seconds)
        )
        # A device counter can never represent more active work than the
        # wall-clock lifetime of its session. This server-side cap prevents a
        # modified client from crediting arbitrary future hours.
        bounded_active_seconds = min(elapsed_seconds, next_active_seconds)
        session.active_seconds = max(session.active_seconds, bounded_active_seconds)
        # Idle is whatever the session has lasted minus the work in it. The agent
        # counter this used to take a max() of does not accumulate across idle
        # episodes, so a session with two hours away reported only its longest
        # single episode - roughly 18 minutes instead of 123.
        session.idle_seconds = max(
            session.idle_seconds,
            max(0, elapsed_seconds - session.active_seconds),
        )
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


def latest_automatic_idle_start(
    db: Session,
    session: WorkSession,
    *,
    ended_at: datetime,
) -> ActivityEvent | None:
    return db.scalar(
        select(ActivityEvent)
        .where(
            ActivityEvent.session_id == session.id,
            ActivityEvent.event_type == "idle_started",
            ActivityEvent.event_timestamp <= utc(ended_at),
        )
        .order_by(ActivityEvent.event_timestamp.desc(), ActivityEvent.created_at.desc())
    )


def restart_session_after_long_idle(
    db: Session,
    *,
    device: Device,
    session: WorkSession,
    idle_started_at: datetime,
    idle_baseline: int | None,
    payload: ActivityEventRequest,
) -> dict[str, Any]:
    idle_started_at = utc(idle_started_at)
    returned_at = bounded_client_timestamp(payload.event_timestamp)
    gap_seconds = max(0, int((returned_at - idle_started_at).total_seconds()))
    previous_task_id = session.task_id
    previous_session_ended_at = max(utc(session.started_at), returned_at)
    previous_idle_seconds = (
        idle_baseline if isinstance(idle_baseline, int) and idle_baseline >= 0 else 0
    )
    elapsed_seconds = max(
        0,
        int((previous_session_ended_at - utc(session.started_at)).total_seconds()),
    )
    max_recordable_idle = max(0, elapsed_seconds - int(session.active_seconds))
    session.idle_seconds = min(
        max_recordable_idle,
        max(int(session.idle_seconds), previous_idle_seconds + gap_seconds),
    )
    close_open_session(
        db,
        device=device,
        session=session,
        ended_at=previous_session_ended_at,
        reason="Employee returned after more than four hours idle",
    )
    # Sessions use autoflush=False. Persist the close before looking up the
    # current session or start_or_get_session can return this ended row again.
    db.flush()
    sync_session_time_buckets(db, session, at=previous_session_ended_at)
    restarted = start_or_get_session(
        db,
        device,
        SessionStartRequest(started_at=returned_at, task_id=previous_task_id),
        start_source="long_idle_return",
    )
    next_session = get_owned_session(db, device, UUID(restarted["session"]["id"]))
    event, duplicate = create_activity_event(
        db,
        device=device,
        session=next_session,
        event_type="idle_ended",
        event_timestamp=returned_at,
        idempotency_key=str(payload.event_id),
        payload={
            **(payload.payload or {}),
            "started_new_session": True,
            "idle_gap_seconds": gap_seconds,
            "previous_session_id": str(session.id),
        },
    )
    next_session.status = "active"
    db.commit()
    db.refresh(next_session)
    response = {
        "event_id": str(event.id),
        "duplicate": duplicate,
        **session_response(db, next_session),
        "restarted": True,
        "restart_reason": "long_idle",
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
    existing_event = db.scalar(
        select(ActivityEvent).where(
            ActivityEvent.company_id == device.company_id,
            ActivityEvent.idempotency_key == str(payload.event_id),
        )
    )
    if existing_event is not None:
        existing_session = get_owned_session(db, device, existing_event.session_id)
        response = {
            "event_id": str(existing_event.id),
            "duplicate": True,
            **session_response(db, existing_session),
        }
        db.commit()
        return response

    session = get_owned_session(db, device, session_id)
    event_at = bounded_client_timestamp(payload.event_timestamp)
    mark_device_seen(device)

    def ignored(reason: str) -> dict[str, Any]:
        db.commit()
        return {
            "event_id": None,
            "duplicate": False,
            **session_response(db, session),
            "ignored": True,
            "ignore_reason": reason,
        }

    if event_at < utc(session.started_at):
        return ignored("event_precedes_session")

    if session.ended_at is not None:
        # Closed sessions are immutable. A client can still have queued events
        # that reference the old id after an active heartbeat has created a new
        # session, so redirect only live non-terminal evidence to that already
        # open session. Never reopen or mutate the closed row itself.
        current = get_current_session(db, device)
        redirectable = payload.event_type not in {"agent_stopped", "session_ended"}
        if (
            redirectable
            and current is not None
            and current.id != session.id
            and event_at >= utc(current.started_at)
        ):
            session = current
        else:
            return ignored("closed_session_is_immutable")

    zone = session_zone(db, session)
    if not same_local_day(session.started_at, event_at, zone):
        cutoff = next_local_midnight(session.started_at, zone)
        close_open_session(
            db,
            device=device,
            session=session,
            ended_at=min(
                event_at,
                cutoff,
                last_worked_activity_at(db, session, not_after=cutoff),
            ),
            reason="New local workday started",
        )
        db.flush()
        return ignored("new_workday_requires_current_session")

    event_payload = payload.payload
    if payload.event_type == "foreground_activity":
        source = payload.payload or {}

        def safe_text(key: str, maximum: int) -> str | None:
            value = source.get(key)
            if not isinstance(value, str):
                return None
            return " ".join(value.strip().split())[:maximum] or None

        site_domain = safe_text("site_domain", 253)
        if site_domain:
            site_domain = site_domain.lower().removeprefix("www.")
            if any(character.isspace() or character in "/?#@" for character in site_domain):
                site_domain = None

        # Foreground tracking is intentionally data-minimal: application
        # identity, website domain, and duration only. Never persist a full URL,
        # browser query, page title, or arbitrary extra agent fields.
        event_payload = {
            "application_name": safe_text("application_name", 160),
            "process_name": safe_text("process_name", 120),
            "site_domain": site_domain,
            "ended_at": safe_text("ended_at", 40),
            "duration_seconds": max(
                1,
                min(
                    300,
                    int(source.get("duration_seconds", 1))
                    if str(source.get("duration_seconds", 1)).isdigit()
                    else 1,
                ),
            ),
        }
    if payload.event_type == "idle_ended":
        idle_started = latest_automatic_idle_start(
            db,
            session,
            ended_at=event_at,
        )
        idle_started_at = (
            utc(idle_started.event_timestamp) if idle_started is not None else None
        )
        idle_baseline = (
            idle_started.payload.get("idle_seconds")
            if idle_started is not None and isinstance(idle_started.payload, dict)
            else None
        )
        if idle_started_at is None and isinstance(payload.payload, dict):
            reported_idle_started_at = payload.payload.get("idle_started_at")
            if isinstance(reported_idle_started_at, str):
                try:
                    idle_started_at = utc(datetime.fromisoformat(reported_idle_started_at))
                except ValueError:
                    idle_started_at = None
            reported_idle_baseline = payload.payload.get("idle_seconds_before_gap")
            if isinstance(reported_idle_baseline, int):
                idle_baseline = reported_idle_baseline
        reported_gap_seconds = (
            payload.payload.get("idle_gap_seconds")
            if isinstance(payload.payload, dict)
            else None
        )
        gap_seconds = (
            reported_gap_seconds
            if isinstance(reported_gap_seconds, int) and reported_gap_seconds >= 0
            else (
                max(
                    0,
                    int(
                        (
                            event_at - idle_started_at
                        ).total_seconds()
                    ),
                )
                if idle_started_at is not None
                else 0
            )
        )
        if (
            idle_started_at is not None
            and gap_seconds > LONG_IDLE_SESSION_SPLIT_SECONDS
        ):
            return restart_session_after_long_idle(
                db,
                device=device,
                session=session,
                idle_started_at=idle_started_at,
                idle_baseline=idle_baseline,
                payload=payload,
            )
    event, duplicate = create_activity_event(
        db,
        device=device,
        session=session,
        event_type=payload.event_type,
        event_timestamp=event_at,
        idempotency_key=str(payload.event_id),
        payload=event_payload,
    )

    if payload.event_type in {"screen_locked", "system_suspended"}:
        session.status = "locked" if payload.event_type == "screen_locked" else "sleeping"
    elif payload.event_type in {
        "screen_unlocked",
        "system_resumed",
        "idle_ended",
        "manual_pause_ended",
    }:
        session.status = "active"
    elif payload.event_type in {"idle_started", "manual_pause_started"}:
        session.status = "idle"
    elif payload.event_type == "agent_stopped":
        close_open_session(
            db,
            device=device,
            session=session,
            ended_at=event_at,
            reason="Agent stopped",
        )
    if payload.payload and isinstance(payload.payload.get("idle_seconds"), int):
        elapsed_seconds = max(
            0,
            int((event_at - utc(session.started_at)).total_seconds()),
        )
        max_idle_seconds = max(0, elapsed_seconds - int(session.active_seconds))
        session.idle_seconds = min(
            max_idle_seconds,
            max(session.idle_seconds, payload.payload["idle_seconds"]),
        )

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

    ended_at = max(
        utc(session.started_at),
        bounded_client_timestamp(payload.ended_at),
    )
    elapsed_seconds = max(
        0, int((ended_at - utc(session.started_at)).total_seconds())
    )
    if (payload.reason or "").strip().casefold() == "khaliduo update installation":
        # Desktop releases before 1.1.64 attempted to end the active session
        # before installing an update. Treat that legacy request as a final
        # checkpoint so those clients can upgrade without creating an
        # attendance sign-out/sign-in break.
        if payload.active_seconds is not None:
            session.active_seconds = max(
                session.active_seconds,
                min(elapsed_seconds, payload.active_seconds),
            )
        if payload.idle_seconds is not None:
            session.idle_seconds = min(
                max(0, elapsed_seconds - int(session.active_seconds)),
                max(session.idle_seconds, payload.idle_seconds),
            )
        mark_device_seen(device)
        sync_session_time_buckets(db, session, at=ended_at)
        db.commit()
        db.refresh(session)
        return session_response(db, session)

    session.ended_at = ended_at
    session.status = "ended"
    if payload.active_seconds is not None:
        session.active_seconds = max(
            session.active_seconds,
            min(elapsed_seconds, payload.active_seconds),
        )
    if payload.idle_seconds is not None:
        session.idle_seconds = min(
            max(0, elapsed_seconds - int(session.active_seconds)),
            max(session.idle_seconds, payload.idle_seconds),
        )
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
