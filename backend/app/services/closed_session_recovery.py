"""Import bounded offline work atomically without taking over a live session."""

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ApiError
from app.models import ActivityEvent, Device, Employee, WorkSession
from app.schemas.session import ClosedSessionRecoveryRequest
from app.services.activity_timeline import EVENT_STATES
from app.services.session_tracking import (
    create_activity_event,
    employee_zone,
    sync_session_time_buckets,
    utc,
)


def recover_closed_session(
    db: Session, device: Device, payload: ClosedSessionRecoveryRequest,
) -> dict:
    start, end = utc(payload.started_at), utc(payload.ended_at)
    zone = employee_zone(db, device)
    # Midnight may be the inclusive end of yesterday's final segment.
    if (
        end < start or end > utc() + timedelta(seconds=30)
        or start.astimezone(zone).date() != (
            (end - timedelta(microseconds=1)) if end > start else end
        ).astimezone(zone).date()
    ):
        raise ApiError("INVALID_RECOVERY_BOUNDS", "Recover one bounded local day at a time.", 422)
    event_ids = set()
    for event in payload.events:
        if event.event_type not in EVENT_STATES or not start <= utc(event.event_timestamp) <= end:
            raise ApiError("INVALID_RECOVERY_EVENT", "Recovery events must fit their session.", 422)
        if event.event_id in event_ids:
            raise ApiError("INVALID_RECOVERY_EVENT", "Recovery event IDs must be unique.", 422)
        event_ids.add(event.event_id)

    # Share the start lock and idempotency namespace with the legacy recovery
    # channel, so a retry or desktop upgrade cannot credit the same work twice.
    db.execute(select(Device.id).where(Device.id == device.id).with_for_update())
    key = f"offline-session-recovery:{payload.offline_recovery_id}"
    existing = db.scalar(select(ActivityEvent).where(
        ActivityEvent.company_id == device.company_id,
        ActivityEvent.idempotency_key == key,
    ))
    session = db.get(WorkSession, existing.session_id) if existing else None
    if session is not None:
        if session.device_id != device.id or session.employee_id != device.employee_id:
            raise ApiError("RECOVERY_ID_CONFLICT", "Recovery belongs to another device.", 409)
        if session.ended_at is not None:
            return {"session_id": str(session.id), "duplicate": True}
        # A partial legacy import may have merged with other online work. Its
        # counters/bounds belong to the live channel; never overwrite them here.
        raise ApiError("RECOVERY_STILL_OPEN", "Legacy recovery is still open.", 409)

    duration = max(0, int((end - start).total_seconds()))
    active = min(duration, payload.active_seconds)
    idle = min(duration - active, payload.idle_seconds)
    # State boundaries must corroborate paid time. Counters alone cannot say
    # where missing work occurred, so retain incomplete evidence on the desktop
    # instead of turning an unobserved gap (or idle-only counters) into work.
    cursor, state, worked = start, "worked", timedelta()
    for event in sorted(payload.events, key=lambda item: utc(item.event_timestamp)):
        at = utc(event.event_timestamp)
        if state == "worked":
            worked += at - cursor
        cursor, state = at, EVENT_STATES[event.event_type]
    if state == "worked":
        worked += end - cursor
    if int(worked.total_seconds()) > active:
        raise ApiError("INCOMPLETE_RECOVERY_EVIDENCE", "Work exceeds the recorded active counter.", 422)
    received_at = utc()
    # Insert closed from the outset. The unique-open-session guard remains
    # enabled, and today's live session is never read, closed, or replaced.
    session = WorkSession(
        company_id=device.company_id, employee_id=device.employee_id,
        device_id=device.id, timezone=zone.key, started_at=start, ended_at=end,
        status="ended", active_seconds=active, idle_seconds=idle,
    )
    db.add(session)
    db.flush()
    started_event, _ = create_activity_event(
        db, device=device, session=session, event_type="session_started",
        event_timestamp=start, idempotency_key=key,
        payload={"source": "offline_recovery", "closed_recovery": True},
    )
    started_event.created_at = received_at
    # These are the initial contents of one atomic import, not subsequent writes
    # to a closed ledger. Every event is checked against the final bounds first.
    for index, event in enumerate(payload.events):
        previous = db.scalar(select(ActivityEvent).where(
            ActivityEvent.company_id == device.company_id,
            ActivityEvent.idempotency_key == str(event.event_id),
        ))
        if previous is not None and previous.session_id != session.id:
            raise ApiError("RECOVERY_ID_CONFLICT", "An event belongs to another session.", 409)
        accepted, duplicate = create_activity_event(
            db, device=device, session=session, event_type=event.event_type,
            event_timestamp=event.event_timestamp, idempotency_key=str(event.event_id),
            # State boundaries suffice; do not import client-provided chain origins.
            payload={"source": "offline_recovery"},
        )
        if not duplicate:
            # Preserve ordering for simultaneous changes, after the start event.
            # Defaults evaluated at flush time would reorder an idle-at-start.
            accepted.created_at = received_at + timedelta(microseconds=index + 1)
    for suffix, at, counters in (
        ("start", start, {"active_seconds": 0, "idle_seconds": 0}),
        ("end", end, {"active_seconds": active, "idle_seconds": idle}),
    ):
        create_activity_event(
            db, device=device, session=session, event_type="heartbeat",
            event_timestamp=at, idempotency_key=f"{key}:{suffix}",
            payload={**counters, "agent_version": payload.agent_version},
        )
    create_activity_event(
        db, device=device, session=session, event_type="session_ended",
        event_timestamp=end, idempotency_key=f"{key}:closed",
        payload={"reason": "Recovered closed offline session"},
    )
    db.flush()
    # The projection must include later sessions on the same historical day.
    # Using the imported end as "now" would zero out their classifications.
    sync_session_time_buckets(db, session, at=utc())
    # Refresh the projection once per imported day, never in the live startup.
    from app.services.attendance import calculate_daily_attendance

    employee = db.get(Employee, device.employee_id)
    calculate_daily_attendance(
        db, employee=employee, work_date=start.astimezone(zone).date(),
        timezone_name=zone.key,
    )
    db.commit()
    return {"session_id": str(session.id), "duplicate": False}
