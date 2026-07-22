from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import ActivityEvent, Project, Task, TrackingSettings, WorkSession


EVENT_STATES = {
    "session_started": "worked",
    "idle_started": "idle",
    "idle_ended": "worked",
    "screen_locked": "locked",
    "screen_unlocked": "worked",
    "system_suspended": "sleeping",
    "system_resumed": "worked",
}
TERMINAL_EVENTS = {"agent_stopped", "session_ended"}
TIMELINE_EVENTS = set(EVENT_STATES) | TERMINAL_EVENTS
SIGNAL_EVENTS = TIMELINE_EVENTS | {"heartbeat"}


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _timezone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def local_today(timezone_name: str | None, now: datetime | None = None) -> date:
    """Return today's calendar date in the employee's configured timezone."""
    current = now or datetime.now(UTC)
    return current.astimezone(_timezone(timezone_name or "UTC")).date()


def _day_bounds(value: date, timezone_name: str) -> tuple[datetime, datetime, ZoneInfo]:
    zone = _timezone(timezone_name)
    local_start = datetime.combine(value, time.min, tzinfo=zone)
    return local_start.astimezone(UTC), (local_start + timedelta(days=1)).astimezone(UTC), zone


def build_workday_timeline(
    db: Session,
    *,
    company_id: UUID,
    employee_id: UUID,
    timezone_name: str,
    target_date: date | None = None,
    now: datetime | None = None,
) -> dict:
    now_utc = _utc(now or datetime.now(UTC))
    zone = _timezone(timezone_name)
    selected_date = target_date or now_utc.astimezone(zone).date()
    day_start, day_end, zone = _day_bounds(selected_date, timezone_name)

    rows = db.execute(
        select(WorkSession, Project.name, Task.name)
        .outerjoin(Project, Project.id == WorkSession.project_id)
        .outerjoin(Task, Task.id == WorkSession.task_id)
        .where(
            WorkSession.company_id == company_id,
            WorkSession.employee_id == employee_id,
            WorkSession.started_at < day_end,
            or_(WorkSession.ended_at.is_(None), WorkSession.ended_at > day_start),
        )
        .order_by(WorkSession.started_at)
    ).all()
    sessions = [row[0] for row in rows]
    session_context = {
        session.id: {"project_name": project_name, "task_name": task_name}
        for session, project_name, task_name in rows
    }

    events_by_session: dict[UUID, list[ActivityEvent]] = defaultdict(list)
    if sessions:
        events = db.scalars(
            select(ActivityEvent)
            .where(
                ActivityEvent.company_id == company_id,
                ActivityEvent.employee_id == employee_id,
                ActivityEvent.session_id.in_([session.id for session in sessions]),
                ActivityEvent.event_type.in_(SIGNAL_EVENTS),
                ActivityEvent.event_timestamp < day_end,
            )
            .order_by(ActivityEvent.event_timestamp, ActivityEvent.created_at)
        ).all()
        for event in events:
            events_by_session[event.session_id].append(event)

    offline_threshold_minutes = (
        db.scalar(
            select(TrackingSettings.offline_threshold_minutes).where(
                TrackingSettings.company_id == company_id
            )
        )
        or 3
    )
    freshness_limit = timedelta(minutes=max(1, int(offline_threshold_minutes)))

    intervals: list[dict] = []
    has_open_session = False
    for session in sessions:
        session_start = _utc(session.started_at)
        session_events = events_by_session[session.id]
        last_signal_at = max(
            [_utc(session.started_at), _utc(session.updated_at)]
            + [_utc(event.event_timestamp) for event in session_events],
        )
        is_fresh = session.ended_at is None and now_utc - last_signal_at <= freshness_limit
        open_session_end = now_utc if is_fresh else min(last_signal_at, now_utc)
        session_end = _utc(session.ended_at) if session.ended_at else min(open_session_end, day_end)
        visible_start = max(session_start, day_start)
        visible_end = min(session_end, day_end)
        if visible_end <= visible_start:
            continue

        state = "worked"
        cursor = visible_start
        terminated = False
        context = session_context[session.id]

        for event in session_events:
            if event.event_type == "heartbeat":
                continue
            event_at = _utc(event.event_timestamp)
            if event_at <= visible_start:
                if event.event_type in TERMINAL_EVENTS:
                    terminated = True
                    break
                state = EVENT_STATES.get(event.event_type, state)
                continue
            if event_at >= visible_end:
                break

            intervals.append(
                {
                    "type": state,
                    "started_at": cursor,
                    "ended_at": event_at,
                    "session_id": session.id,
                    **context,
                }
            )
            cursor = event_at
            if event.event_type in TERMINAL_EVENTS:
                terminated = True
                break
            state = EVENT_STATES.get(event.event_type, state)

        if not terminated and cursor < visible_end:
            intervals.append(
                {
                    "type": state,
                    "started_at": cursor,
                    "ended_at": visible_end,
                    "session_id": session.id,
                    **context,
                }
            )

        if (
            session.ended_at is None
            and not terminated
            and is_fresh
            and visible_end == now_utc
            and day_start <= now_utc < day_end
        ):
            has_open_session = True

    # A restart or delayed offline sync can briefly leave overlapping sessions.
    # Turn them into one disjoint timeline so the same wall-clock second can
    # never be counted twice. Any active input wins over idle/locked signals
    # from an older session or another enrolled device.
    valid_intervals = [item for item in intervals if item["ended_at"] > item["started_at"]]
    boundaries = sorted(
        {point for item in valid_intervals for point in (item["started_at"], item["ended_at"])}
    )
    state_priority = {"worked": 4, "idle": 3, "locked": 2, "sleeping": 1}
    disjoint: list[dict] = []
    for start_at, end_at in zip(boundaries, boundaries[1:], strict=False):
        covering = [
            item
            for item in valid_intervals
            if item["started_at"] < end_at and item["ended_at"] > start_at
        ]
        if not covering:
            continue
        selected = max(
            covering,
            key=lambda item: (state_priority.get(item["type"], 0), item["started_at"]),
        ).copy()
        selected["started_at"] = start_at
        selected["ended_at"] = end_at
        disjoint.append(selected)

    merged: list[dict] = []
    for interval in disjoint:
        previous = merged[-1] if merged else None
        if (
            previous
            and previous["type"] == interval["type"]
            and previous["ended_at"] == interval["started_at"]
            and previous["task_name"] == interval["task_name"]
            and previous["project_name"] == interval["project_name"]
        ):
            previous["ended_at"] = interval["ended_at"]
        else:
            merged.append(interval)

    totals = {"worked": 0, "idle": 0, "locked": 0, "sleeping": 0}
    serialized_intervals = []
    for index, interval in enumerate(merged):
        duration_seconds = max(
            0,
            int((interval["ended_at"] - interval["started_at"]).total_seconds()),
        )
        totals[interval["type"]] += duration_seconds
        is_current = (
            has_open_session and index == len(merged) - 1 and interval["ended_at"] == now_utc
        )
        serialized_intervals.append(
            {
                "type": interval["type"],
                "started_at": interval["started_at"].isoformat(),
                "ended_at": None if is_current else interval["ended_at"].isoformat(),
                "duration_seconds": duration_seconds,
                "session_id": str(interval["session_id"]),
                "project_name": interval["project_name"],
                "task_name": interval["task_name"],
                "is_current": is_current,
            }
        )

    first_started_at = min((_utc(session.started_at) for session in sessions), default=None)
    last_visible_end = max((interval["ended_at"] for interval in merged), default=None)
    return {
        "date": selected_date.isoformat(),
        "timezone": zone.key,
        "first_started_at": max(first_started_at, day_start).isoformat()
        if first_started_at
        else None,
        "last_ended_at": None
        if has_open_session
        else last_visible_end.isoformat()
        if last_visible_end
        else None,
        "last_activity_at": last_visible_end.isoformat() if last_visible_end else None,
        "is_running": has_open_session,
        "worked_seconds": totals["worked"],
        "idle_seconds": totals["idle"],
        "locked_seconds": totals["locked"],
        "sleeping_seconds": totals["sleeping"],
        "intervals": serialized_intervals,
    }
