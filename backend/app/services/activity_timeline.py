from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import ActivityEvent, LeaveRequest, Project, Task, TrackingSettings, WorkSession


EVENT_STATES = {
    "session_started": "worked",
    "idle_started": "idle",
    "idle_ended": "worked",
    "manual_pause_started": "idle",
    "manual_pause_ended": "worked",
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


def _without_excluded_windows(
    start_at: datetime,
    end_at: datetime,
    excluded_windows: list[tuple[datetime, datetime]],
) -> list[tuple[datetime, datetime]]:
    segments = [(start_at, end_at)]
    for excluded_start, excluded_end in excluded_windows:
        next_segments: list[tuple[datetime, datetime]] = []
        for segment_start, segment_end in segments:
            if excluded_end <= segment_start or excluded_start >= segment_end:
                next_segments.append((segment_start, segment_end))
                continue
            if segment_start < excluded_start:
                next_segments.append((segment_start, excluded_start))
            if excluded_end < segment_end:
                next_segments.append((excluded_end, segment_end))
        segments = next_segments
    return segments


def scope_timeline_to_schedule(
    timeline: dict,
    *,
    shift_start: datetime | None,
    shift_end: datetime | None,
    scheduled_breaks: list[dict] | None = None,
    now: datetime | None = None,
) -> dict:
    """Return the attendance view of a raw activity timeline.

    Worked time outside the scheduled shift remains visible and is classified
    as extra work. Non-working states outside the shift, during scheduled
    breaks, on off days, or on approved leave are not attendance idle and must
    not affect activity, lateness, early-leave, or payroll calculations.
    """
    now_utc = _utc(now or datetime.now(UTC))
    normalized_shift_start = _utc(shift_start) if shift_start else None
    normalized_shift_end = _utc(shift_end) if shift_end else None
    has_shift = bool(normalized_shift_start and normalized_shift_end)
    excluded_windows = [
        (_utc(item["start_at"]), _utc(item["end_at"]))
        for item in scheduled_breaks or []
        if item.get("start_at") and item.get("end_at")
    ]
    approved_leave = bool(timeline.get("approved_leave"))
    scoped: list[dict] = []

    for item in timeline.get("intervals", []):
        interval_start = _utc(datetime.fromisoformat(item["started_at"]))
        interval_end = (
            _utc(datetime.fromisoformat(item["ended_at"]))
            if item.get("ended_at")
            else now_utc
        )
        if interval_end <= interval_start:
            continue

        if item["type"] == "worked":
            boundaries = [interval_start, interval_end]
            if has_shift:
                if interval_start < normalized_shift_start < interval_end:
                    boundaries.append(normalized_shift_start)
                if interval_start < normalized_shift_end < interval_end:
                    boundaries.append(normalized_shift_end)
            boundaries.sort()
            segments = list(zip(boundaries, boundaries[1:], strict=False))
        else:
            if not has_shift or approved_leave:
                continue
            visible_start = max(interval_start, normalized_shift_start)
            visible_end = min(interval_end, normalized_shift_end)
            if visible_end <= visible_start:
                continue
            segments = _without_excluded_windows(
                visible_start,
                visible_end,
                excluded_windows,
            )

        for segment_start, segment_end in segments:
            if segment_end <= segment_start:
                continue
            work_category = item.get("work_category")
            if item["type"] == "worked" and (
                approved_leave
                or not has_shift
                or segment_start < normalized_shift_start
                or segment_end > normalized_shift_end
            ):
                work_category = "extra"
            scoped.append(
                {
                    **item,
                    "started_at": segment_start,
                    "ended_at": segment_end,
                    "duration_seconds": int((segment_end - segment_start).total_seconds()),
                    "is_current": bool(
                        item.get("is_current") and segment_end == interval_end
                    ),
                    "work_category": work_category,
                }
            )

    merged: list[dict] = []
    for interval in scoped:
        previous = merged[-1] if merged else None
        if (
            previous
            and previous["type"] == interval["type"]
            and previous.get("source") == interval.get("source")
            and previous["ended_at"] == interval["started_at"]
            and previous["session_id"] == interval["session_id"]
            and previous.get("task_id") == interval.get("task_id")
            and previous.get("project_id") == interval.get("project_id")
            and previous.get("task_name") == interval.get("task_name")
            and previous.get("project_name") == interval.get("project_name")
            and previous.get("work_category") == interval.get("work_category")
        ):
            previous["ended_at"] = interval["ended_at"]
            previous["duration_seconds"] += interval["duration_seconds"]
            previous["is_current"] = interval["is_current"]
        else:
            merged.append(interval)

    totals = {"worked": 0, "idle": 0, "locked": 0, "sleeping": 0}
    for interval in merged:
        totals[interval["type"]] += interval["duration_seconds"]

    is_running = any(item["is_current"] for item in merged)
    first_started_at = min(
        (item["started_at"] for item in merged),
        default=None,
    )
    last_activity_at = max(
        (item["ended_at"] for item in merged),
        default=None,
    )
    serialized = []
    for item in merged:
        serialized.append(
            {
                **item,
                "started_at": item["started_at"].isoformat(),
                "ended_at": None if item["is_current"] else item["ended_at"].isoformat(),
            }
        )

    return {
        **timeline,
        "first_started_at": first_started_at.isoformat() if first_started_at else None,
        "last_ended_at": (
            None
            if is_running
            else last_activity_at.isoformat()
            if last_activity_at
            else None
        ),
        "last_activity_at": last_activity_at.isoformat() if last_activity_at else None,
        "is_running": is_running,
        "worked_seconds": totals["worked"],
        "idle_seconds": 0 if approved_leave else totals["idle"],
        "locked_seconds": totals["locked"],
        "sleeping_seconds": totals["sleeping"],
        "leave_seconds": 0,
        "intervals": serialized,
    }


def build_workday_timeline(
    db: Session,
    *,
    company_id: UUID,
    employee_id: UUID,
    timezone_name: str,
    target_date: date | None = None,
    now: datetime | None = None,
    device_id: UUID | None = None,
    session_timezone_name: str | None = None,
) -> dict:
    now_utc = _utc(now or datetime.now(UTC))
    zone = _timezone(timezone_name)
    selected_date = target_date or now_utc.astimezone(zone).date()
    day_start, day_end, zone = _day_bounds(selected_date, timezone_name)
    approved_leave = db.scalar(
        select(LeaveRequest.id).where(
            LeaveRequest.company_id == company_id,
            LeaveRequest.employee_id == employee_id,
            LeaveRequest.status == "approved",
            LeaveRequest.start_date <= selected_date,
            LeaveRequest.end_date >= selected_date,
        )
    ) is not None

    session_statement = (
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
    )
    if device_id is not None:
        session_statement = session_statement.where(WorkSession.device_id == device_id)
    if session_timezone_name:
        session_statement = session_statement.where(
            or_(
                WorkSession.timezone == session_timezone_name,
                WorkSession.timezone.is_(None),
            )
        )
    rows = db.execute(session_statement).all()
    sessions = [row[0] for row in rows]
    session_context = {
        session.id: {
            "project_id": session.project_id,
            "task_id": session.task_id,
            "project_name": project_name,
            "task_name": task_name,
        }
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
    continued_session_starts: list[datetime] = []
    for session in sessions:
        session_start = _utc(session.started_at)
        session_events = events_by_session[session.id]
        heartbeat_times = [
            _utc(event.event_timestamp)
            for event in session_events
            if event.event_type == "heartbeat"
        ]
        if heartbeat_times:
            # A terminal event can arrive hours or days after the desktop's
            # last heartbeat when a stale session is closed on the next app
            # launch.  It proves when the row was closed, not that the employee
            # worked through the offline gap.
            live_signal_times = [
                _utc(event.event_timestamp)
                for event in session_events
                if event.event_type not in TERMINAL_EVENTS
            ]
            last_signal_at = max([session_start, *live_signal_times])
        else:
            recorded_end = _utc(session.ended_at) if session.ended_at else now_utc
            last_signal_at = (
                recorded_end
                if session.ended_at is not None
                else max(
                    session_start,
                    min(_utc(session.updated_at), recorded_end, now_utc),
                )
            )
        is_fresh = session.ended_at is None and now_utc - last_signal_at <= freshness_limit
        if session.ended_at is not None:
            recorded_end = _utc(session.ended_at)
            session_end = (
                last_signal_at
                if recorded_end - last_signal_at > freshness_limit
                else recorded_end
            )
        else:
            session_end = now_utc if is_fresh else min(last_signal_at, now_utc)
        session_end = min(session_end, day_end)
        visible_start = max(session_start, day_start)
        visible_end = session_end
        if visible_end <= visible_start:
            continue

        state = "worked"
        state_source = "activity"
        cursor = visible_start
        terminated = False
        context = session_context[session.id]
        interval_count_before_session = len(intervals)

        for event in session_events:
            if event.event_type == "heartbeat":
                continue
            event_at = _utc(event.event_timestamp)
            if event_at <= visible_start:
                if event.event_type in TERMINAL_EVENTS:
                    terminated = True
                    break
                state = EVENT_STATES.get(event.event_type, state)
                state_source = (
                    "manual_pause"
                    if event.event_type == "manual_pause_started"
                    else "activity"
                )
                continue
            if event_at >= visible_end:
                break

            intervals.append(
                {
                    "type": state,
                    "source": state_source,
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
            state_source = (
                "manual_pause"
                if event.event_type == "manual_pause_started"
                else "activity"
            )

        if not terminated and cursor < visible_end:
            intervals.append(
                {
                    "type": state,
                    "source": state_source,
                    "started_at": cursor,
                    "ended_at": visible_end,
                    "session_id": session.id,
                    **context,
                }
            )

        if len(intervals) > interval_count_before_session and session_start < day_start:
            continued_session_starts.append(session_start)

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
            and previous["source"] == interval["source"]
            and previous["ended_at"] == interval["started_at"]
            and previous.get("task_id") == interval.get("task_id")
            and previous.get("project_id") == interval.get("project_id")
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
                "source": interval["source"],
                "started_at": interval["started_at"].isoformat(),
                "ended_at": None if is_current else interval["ended_at"].isoformat(),
                "duration_seconds": duration_seconds,
                "session_id": str(interval["session_id"]),
                "project_id": (
                    str(interval["project_id"]) if interval.get("project_id") else None
                ),
                "task_id": str(interval["task_id"]) if interval.get("task_id") else None,
                "project_name": interval["project_name"],
                "task_name": interval["task_name"],
                "is_current": is_current,
                "work_category": (
                    "extra" if approved_leave and interval["type"] == "worked" else None
                ),
            }
        )

    leave_seconds = (
        totals["idle"] + totals["locked"] + totals["sleeping"] if approved_leave else 0
    )
    first_started_at = min(
        (interval["started_at"] for interval in merged),
        default=None,
    )
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
        "continued_from_previous_day": bool(continued_session_starts),
        "continued_session_started_at": (
            min(continued_session_starts).isoformat() if continued_session_starts else None
        ),
        "worked_seconds": totals["worked"],
        "idle_seconds": 0 if approved_leave else totals["idle"],
        "locked_seconds": totals["locked"],
        "sleeping_seconds": totals["sleeping"],
        "approved_leave": approved_leave,
        "leave_seconds": leave_seconds,
        "intervals": serialized_intervals,
    }
