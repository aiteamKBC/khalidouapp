from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from typing import TypedDict
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, or_, select
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


class SessionLiveness(TypedDict):
    is_fresh: bool
    last_signal_at: datetime


class SessionObservation(SessionLiveness):
    effective_end_at: datetime


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def session_observation_bounds(
    db: Session,
    *,
    company_id: UUID,
    sessions: list[WorkSession],
    now: datetime | None = None,
) -> dict[UUID, SessionObservation]:
    """Resolve trustworthy session ends in a fixed number of database queries.

    A terminal event can arrive long after the device's last heartbeat when an
    old session is closed on the next launch. The terminal timestamp says when
    the database row was closed, not that the employee worked through the gap.
    Open sessions have the same problem when the desktop disappears without a
    terminal event, so both cases use the last non-terminal signal as evidence.
    """
    sessions_by_id = {session.id: session for session in sessions}
    if not sessions_by_id:
        return {}

    now_utc = _utc(now or datetime.now(UTC))
    signal_by_session: dict[UUID, dict[str, datetime]] = {}
    signal_rows = db.execute(
        select(
            ActivityEvent.session_id,
            ActivityEvent.event_type,
            func.max(ActivityEvent.event_timestamp),
        )
        .join(WorkSession, WorkSession.id == ActivityEvent.session_id)
        .where(
            ActivityEvent.company_id == company_id,
            ActivityEvent.session_id.in_(sessions_by_id),
            ActivityEvent.event_timestamp >= WorkSession.started_at,
            or_(
                WorkSession.ended_at.is_(None),
                ActivityEvent.event_timestamp <= WorkSession.ended_at,
            ),
            or_(
                ActivityEvent.event_type == "heartbeat",
                ActivityEvent.event_type.in_(EVENT_STATES),
            ),
        )
        .group_by(ActivityEvent.session_id, ActivityEvent.event_type)
    ).all()
    for session_id, event_type, event_at in signal_rows:
        if event_at is not None:
            signal_by_session.setdefault(session_id, {})[event_type] = _utc(event_at)

    offline_threshold_minutes = (
        db.scalar(
            select(TrackingSettings.offline_threshold_minutes).where(
                TrackingSettings.company_id == company_id
            )
        )
        or 3
    )
    freshness_limit = timedelta(minutes=max(1, int(offline_threshold_minutes)))
    result: dict[UUID, SessionObservation] = {}
    for session_id, session in sessions_by_id.items():
        session_start = _utc(session.started_at)
        signals = signal_by_session.get(session_id, {})
        heartbeat_at = signals.get("heartbeat")
        if heartbeat_at is not None:
            last_signal_at = max(
                session_start,
                heartbeat_at,
                *(
                    event_at
                    for event_type, event_at in signals.items()
                    if event_type != "heartbeat"
                ),
            )
        elif session.ended_at is None:
            last_signal_at = max(
                session_start,
                min(_utc(session.updated_at), now_utc),
            )
        else:
            last_signal_at = max(session_start, _utc(session.ended_at))
        last_signal_at = min(last_signal_at, now_utc)
        is_fresh = session.ended_at is None and now_utc - last_signal_at <= freshness_limit
        if session.ended_at is not None:
            recorded_end = max(session_start, _utc(session.ended_at))
            effective_end_at = (
                last_signal_at
                if heartbeat_at is not None and recorded_end - last_signal_at > freshness_limit
                else recorded_end
            )
        else:
            effective_end_at = now_utc if is_fresh else last_signal_at
        result[session_id] = {
            "is_fresh": is_fresh,
            "last_signal_at": last_signal_at,
            "effective_end_at": effective_end_at,
        }
    return result


def open_session_liveness(
    db: Session,
    *,
    company_id: UUID,
    sessions: list[WorkSession],
    now: datetime | None = None,
) -> dict[UUID, SessionLiveness]:
    """Resolve open-session freshness without introducing an N+1 query."""
    open_sessions = [session for session in sessions if session.ended_at is None]
    return {
        session_id: {
            "is_fresh": observation["is_fresh"],
            "last_signal_at": observation["last_signal_at"],
        }
        for session_id, observation in session_observation_bounds(
            db,
            company_id=company_id,
            sessions=open_sessions,
            now=now,
        ).items()
    }


def _continued_session_started_at(events: list[ActivityEvent]) -> datetime | None:
    for event in events:
        if event.event_type != "session_started" or not isinstance(event.payload, dict):
            continue
        value = event.payload.get("continued_session_started_at")
        if not isinstance(value, str):
            continue
        try:
            return _utc(datetime.fromisoformat(value))
        except ValueError:
            return None
    return None


def _counter(payload: dict | None, key: str) -> int | None:
    if not isinstance(payload, dict):
        return None
    value = payload.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return max(0, int(value))


def _offline_gaps(
    heartbeats: list[tuple[datetime, dict | None]],
    *,
    freshness_limit: timedelta,
) -> list[tuple[datetime, datetime]]:
    """Find time where the agent itself was not running.

    A session can survive an app update or crash.  When the same session later
    resumes, treating the entire heartbeat gap as worked makes the work total
    disagree with the screenshot count. The active and idle counters tell us
    how much of the gap the agent actually observed: preserve that amount at
    the end of the gap and exclude only the unobserved remainder. Looking at
    active time alone incorrectly deleted long, locally observed idle periods.

    A network-only outage is different: the local counters continue to advance,
    so the gap remains classified even though the heartbeats arrive late.
    """
    result: list[tuple[datetime, datetime]] = []
    for (previous_at, previous_payload), (next_at, next_payload) in zip(
        heartbeats,
        heartbeats[1:],
        strict=False,
    ):
        gap_seconds = max(0, int((next_at - previous_at).total_seconds()))
        if gap_seconds <= int(freshness_limit.total_seconds()):
            continue
        previous_active = _counter(previous_payload, "active_seconds")
        next_active = _counter(next_payload, "active_seconds")
        previous_idle = _counter(previous_payload, "idle_seconds")
        next_idle = _counter(next_payload, "idle_seconds")
        observed_active = (
            max(0, next_active - previous_active)
            if previous_active is not None and next_active is not None
            else 0
        )
        observed_idle = (
            max(0, next_idle - previous_idle)
            if previous_idle is not None and next_idle is not None
            else 0
        )
        observed_seconds = min(gap_seconds, observed_active + observed_idle)
        unobserved_seconds = max(0, gap_seconds - observed_seconds)
        if unobserved_seconds <= int(freshness_limit.total_seconds()):
            continue
        result.append(
            (
                previous_at,
                previous_at + timedelta(seconds=unobserved_seconds),
            )
        )
    return result


def _exclude_gaps(interval: dict, gaps: list[tuple[datetime, datetime]]) -> list[dict]:
    segments = [(interval["started_at"], interval["ended_at"])]
    for gap_start, gap_end in gaps:
        next_segments: list[tuple[datetime, datetime]] = []
        for segment_start, segment_end in segments:
            if gap_end <= segment_start or gap_start >= segment_end:
                next_segments.append((segment_start, segment_end))
                continue
            if segment_start < gap_start:
                next_segments.append((segment_start, min(segment_end, gap_start)))
            if gap_end < segment_end:
                next_segments.append((max(segment_start, gap_end), segment_end))
        segments = next_segments
    return [
        {
            **interval,
            "started_at": segment_start,
            "ended_at": segment_end,
        }
        for segment_start, segment_end in segments
        if segment_end > segment_start
    ]


def company_idle_threshold_seconds(db: Session, company_id: UUID) -> int:
    """The company's idle threshold, the yardstick for 'the employee left'."""
    minutes = db.scalar(
        select(TrackingSettings.idle_threshold_minutes).where(
            TrackingSettings.company_id == company_id
        )
    )
    return max(1, minutes or 10) * 60


def sustained_work_start(
    blocks: list[tuple[str, datetime, datetime]],
    idle_threshold: int,
) -> datetime | None:
    """When the workday really began, given (type, start, end) blocks in order.

    Switching a machine on and touching it for a few minutes before leaving it
    for hours is not the start of a workday. Such a leading block is skipped
    when the non-working stretch after it is longer than both the block itself
    and the idle threshold. A normal lunch break keeps the morning's start
    because the gap is shorter than the work that preceded it.
    """
    worked = [block for block in blocks if block[0] == "worked"]
    if not worked:
        return None
    for index, (_, started_at, ended_at) in enumerate(worked):
        if index + 1 >= len(worked):
            return started_at
        worked_seconds = (ended_at - started_at).total_seconds()
        gap_seconds = (worked[index + 1][1] - ended_at).total_seconds()
        if gap_seconds <= idle_threshold or gap_seconds <= worked_seconds:
            return started_at
    return worked[-1][1]


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


def _approved_idle_allocations(adjustments: list[dict] | None) -> list[dict]:
    allocations: list[dict] = []
    for item in adjustments or []:
        source_start = item.get("start_at")
        source_end = item.get("end_at")
        approved_seconds = max(0, int(item.get("approved_seconds") or 0))
        if not source_start or not source_end or approved_seconds <= 0:
            continue
        start_at = _utc(
            datetime.fromisoformat(source_start) if isinstance(source_start, str) else source_start
        )
        end_at = _utc(
            datetime.fromisoformat(source_end) if isinstance(source_end, str) else source_end
        )
        if end_at <= start_at:
            continue
        allocations.append(
            {
                "session_id": str(item.get("session_id") or ""),
                "start_at": start_at,
                "end_at": end_at,
                "remaining_seconds": min(
                    approved_seconds,
                    int((end_at - start_at).total_seconds()),
                ),
            }
        )
    return allocations


def _apply_approved_idle_allocations(
    intervals: list[dict],
    adjustments: list[dict] | None,
) -> list[dict]:
    allocations = _approved_idle_allocations(adjustments)
    if not allocations:
        return intervals

    result: list[dict] = []
    for interval in intervals:
        segments = [interval]
        for allocation in allocations:
            if (
                allocation["remaining_seconds"] <= 0
                or interval["type"] != "idle"
                or str(interval.get("session_id") or "") != allocation["session_id"]
            ):
                continue
            split_segments: list[dict] = []
            for segment in segments:
                if segment["type"] != "idle" or allocation["remaining_seconds"] <= 0:
                    split_segments.append(segment)
                    continue
                approved_start = max(segment["started_at"], allocation["start_at"])
                approved_limit = min(segment["ended_at"], allocation["end_at"])
                if approved_limit <= approved_start:
                    split_segments.append(segment)
                    continue
                approved_end = min(
                    approved_limit,
                    approved_start + timedelta(seconds=allocation["remaining_seconds"]),
                )
                if segment["started_at"] < approved_start:
                    split_segments.append(
                        {
                            **segment,
                            "ended_at": approved_start,
                            "is_current": False,
                        }
                    )
                split_segments.append(
                    {
                        **segment,
                        "type": "manual",
                        "source": "approved_manual",
                        "started_at": approved_start,
                        "ended_at": approved_end,
                        "is_current": False,
                        "work_category": None,
                    }
                )
                allocation["remaining_seconds"] -= int(
                    (approved_end - approved_start).total_seconds()
                )
                if approved_end < segment["ended_at"]:
                    split_segments.append(
                        {
                            **segment,
                            "started_at": approved_end,
                        }
                    )
            segments = split_segments
        result.extend(segments)
    return result


def _insert_untracked_gaps(intervals: list[dict]) -> list[dict]:
    """Make missing device evidence visible between recorded intervals.

    These gaps are intentionally not treated as worked or idle.  They simply
    explain where time inside the observed workday went when the agent stopped
    sending evidence and later resumed.
    """
    result: list[dict] = []
    previous: dict | None = None
    for interval in intervals:
        if previous is not None:
            gap_start = previous["ended_at"]
            gap_end = interval["started_at"]
            if int((gap_end - gap_start).total_seconds()) > 0:
                result.append(
                    {
                        "type": "untracked",
                        "source": "missing_device_signal",
                        "started_at": gap_start,
                        "ended_at": gap_end,
                        "session_id": None,
                        "project_id": None,
                        "task_id": None,
                        "project_name": None,
                        "task_name": None,
                    }
                )
        result.append(interval)
        previous = interval
    return result


def scope_timeline_to_schedule(
    timeline: dict,
    *,
    shift_start: datetime | None,
    shift_end: datetime | None,
    scheduled_breaks: list[dict] | None = None,
    approved_idle_adjustments: list[dict] | None = None,
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
    normalized_breaks = [
        {
            **item,
            "start_at": _utc(item["start_at"]),
            "end_at": _utc(item["end_at"]),
        }
        for item in scheduled_breaks or []
        if item.get("start_at") and item.get("end_at")
    ]
    approved_leave = bool(timeline.get("approved_leave"))
    scoped: list[dict] = []

    for item in timeline.get("intervals", []):
        interval_start = _utc(datetime.fromisoformat(item["started_at"]))
        interval_end = (
            _utc(datetime.fromisoformat(item["ended_at"])) if item.get("ended_at") else now_utc
        )
        raw_interval_end = interval_end
        if interval_end <= interval_start:
            continue

        if item["type"] not in {"worked", "untracked"}:
            if not has_shift or approved_leave:
                continue
            interval_start = max(interval_start, normalized_shift_start)
            interval_end = min(interval_end, normalized_shift_end)
            if interval_end <= interval_start:
                continue

        boundaries = [interval_start, interval_end]
        if has_shift:
            if interval_start < normalized_shift_start < interval_end:
                boundaries.append(normalized_shift_start)
            if interval_start < normalized_shift_end < interval_end:
                boundaries.append(normalized_shift_end)
        if has_shift and not approved_leave:
            for scheduled_break in normalized_breaks:
                if interval_start < scheduled_break["start_at"] < interval_end:
                    boundaries.append(scheduled_break["start_at"])
                if interval_start < scheduled_break["end_at"] < interval_end:
                    boundaries.append(scheduled_break["end_at"])
        boundaries = sorted(set(boundaries))
        segments = list(zip(boundaries, boundaries[1:], strict=False))

        for segment_start, segment_end in segments:
            if segment_end <= segment_start:
                continue
            scheduled_break = next(
                (
                    entry
                    for entry in normalized_breaks
                    if entry["start_at"] <= segment_start and segment_end <= entry["end_at"]
                ),
                None,
            )
            work_category = item.get("work_category")
            interval_type = item["type"]
            interval_source = item.get("source")
            if (
                scheduled_break is not None
                and has_shift
                and not approved_leave
                and item["type"] == "worked"
            ):
                # Keep real activity visible during a scheduled break.  The
                # employee may return early or work through part of the break;
                # turning that interval into "break" would hide the work.
                work_category = "break_work"
            elif scheduled_break is not None and has_shift and not approved_leave:
                interval_type = "break"
                interval_source = "scheduled_break"
                work_category = None
            elif item["type"] == "worked" and (
                approved_leave
                or not has_shift
                or segment_start < normalized_shift_start
                or segment_end > normalized_shift_end
            ):
                work_category = "extra"
            scoped.append(
                {
                    **item,
                    "type": interval_type,
                    "source": interval_source,
                    "started_at": segment_start,
                    "ended_at": segment_end,
                    "duration_seconds": int((segment_end - segment_start).total_seconds()),
                    "is_current": bool(item.get("is_current") and segment_end == raw_interval_end),
                    "work_category": work_category,
                    "break_name": scheduled_break.get("name") if scheduled_break else None,
                    "break_paid": scheduled_break.get("paid") if scheduled_break else None,
                }
            )

    scoped = _apply_approved_idle_allocations(scoped, approved_idle_adjustments)
    for interval in scoped:
        interval["duration_seconds"] = int(
            (interval["ended_at"] - interval["started_at"]).total_seconds()
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
            and previous.get("break_name") == interval.get("break_name")
            and previous.get("break_paid") == interval.get("break_paid")
        ):
            previous["ended_at"] = interval["ended_at"]
            previous["duration_seconds"] += interval["duration_seconds"]
            previous["is_current"] = interval["is_current"]
        else:
            merged.append(interval)

    totals = {
        "worked": 0,
        "idle": 0,
        "locked": 0,
        "sleeping": 0,
        "untracked": 0,
        "break": 0,
        "manual": 0,
    }
    for interval in merged:
        totals[interval["type"]] += interval["duration_seconds"]

    is_running = any(item["is_current"] for item in merged)
    # build_workday_timeline already removed false starts using the company's
    # idle threshold. Keep that canonical start when the raw timeline is split
    # into shift/break categories; taking min() here used to put the discarded
    # first touch back into attendance responses.
    first_started_at = (
        _utc(datetime.fromisoformat(timeline["first_started_at"]))
        if timeline.get("first_started_at")
        else min((item["started_at"] for item in merged), default=None)
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
            None if is_running else last_activity_at.isoformat() if last_activity_at else None
        ),
        "last_activity_at": last_activity_at.isoformat() if last_activity_at else None,
        "is_running": is_running,
        # Splitting one worked interval at shift or break boundaries can put a
        # fractional second on each side.  Summing the individually truncated
        # pieces loses a second even though no work was removed.  The raw
        # timeline is already disjoint and worked intervals are never filtered
        # here, so preserve its exact whole-second worked total.
        "worked_seconds": int(timeline.get("worked_seconds", totals["worked"])),
        "idle_seconds": 0 if approved_leave else totals["idle"],
        "locked_seconds": totals["locked"],
        "sleeping_seconds": totals["sleeping"],
        "untracked_seconds": totals["untracked"],
        "break_seconds": totals["break"],
        "manual_seconds": totals["manual"],
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
) -> dict:
    now_utc = _utc(now or datetime.now(UTC))
    zone = _timezone(timezone_name)
    selected_date = target_date or now_utc.astimezone(zone).date()
    day_start, day_end, zone = _day_bounds(selected_date, timezone_name)
    approved_leave = (
        db.scalar(
            select(LeaveRequest.id).where(
                LeaveRequest.company_id == company_id,
                LeaveRequest.employee_id == employee_id,
                LeaveRequest.status == "approved",
                LeaveRequest.start_date <= selected_date,
                LeaveRequest.end_date >= selected_date,
            )
        )
        is not None
    )

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
    heartbeats_by_session: dict[UUID, list[tuple[datetime, dict | None]]] = defaultdict(list)
    if sessions:
        session_ids = [session.id for session in sessions]
        events = db.scalars(
            select(ActivityEvent)
            .join(WorkSession, WorkSession.id == ActivityEvent.session_id)
            .where(
                ActivityEvent.company_id == company_id,
                ActivityEvent.employee_id == employee_id,
                ActivityEvent.session_id.in_(session_ids),
                ActivityEvent.event_type.in_(TIMELINE_EVENTS),
                ActivityEvent.event_timestamp >= WorkSession.started_at,
                or_(
                    WorkSession.ended_at.is_(None),
                    ActivityEvent.event_timestamp <= WorkSession.ended_at,
                ),
                ActivityEvent.event_timestamp < day_end,
            )
            .order_by(ActivityEvent.event_timestamp, ActivityEvent.created_at)
        ).all()
        for event in events:
            events_by_session[event.session_id].append(event)
        heartbeat_rows = db.execute(
            select(
                ActivityEvent.session_id,
                ActivityEvent.event_timestamp,
                ActivityEvent.payload,
            )
            .join(WorkSession, WorkSession.id == ActivityEvent.session_id)
            .where(
                ActivityEvent.company_id == company_id,
                ActivityEvent.employee_id == employee_id,
                ActivityEvent.session_id.in_(session_ids),
                ActivityEvent.event_type == "heartbeat",
                ActivityEvent.event_timestamp >= WorkSession.started_at,
                or_(
                    WorkSession.ended_at.is_(None),
                    ActivityEvent.event_timestamp <= WorkSession.ended_at,
                ),
                ActivityEvent.event_timestamp < day_end,
            )
            .order_by(
                ActivityEvent.session_id,
                ActivityEvent.event_timestamp,
                ActivityEvent.created_at,
            )
        ).all()
        for session_id, heartbeat_at, payload in heartbeat_rows:
            heartbeats_by_session[session_id].append((_utc(heartbeat_at), payload))

    offline_threshold_minutes = (
        db.scalar(
            select(TrackingSettings.offline_threshold_minutes).where(
                TrackingSettings.company_id == company_id
            )
        )
        or 3
    )
    freshness_limit = timedelta(minutes=max(1, int(offline_threshold_minutes)))
    observations = session_observation_bounds(
        db,
        company_id=company_id,
        sessions=sessions,
        now=now_utc,
    )

    intervals: list[dict] = []
    offline_gaps_by_session: dict[UUID, list[tuple[datetime, datetime]]] = {}
    has_open_session = False
    continued_session_starts: list[datetime] = []
    for session in sessions:
        session_start = _utc(session.started_at)
        session_events = events_by_session[session.id]
        continued_session_start = _continued_session_started_at(session_events)
        session_heartbeats = heartbeats_by_session[session.id]
        offline_gaps_by_session[session.id] = _offline_gaps(
            session_heartbeats,
            freshness_limit=freshness_limit,
        )
        observation = observations[session.id]
        is_fresh = observation["is_fresh"]
        session_end = observation["effective_end_at"]
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
                    "manual_pause" if event.event_type == "manual_pause_started" else "activity"
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
                "manual_pause" if event.event_type == "manual_pause_started" else "activity"
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

        if len(intervals) > interval_count_before_session:
            if session_start < day_start:
                continued_session_starts.append(session_start)
            elif continued_session_start is not None and continued_session_start < day_start:
                continued_session_starts.append(continued_session_start)

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
    connected_intervals = [
        segment
        for item in intervals
        for segment in _exclude_gaps(
            item,
            offline_gaps_by_session.get(item["session_id"], []),
        )
    ]
    valid_intervals = [
        item for item in connected_intervals if item["ended_at"] > item["started_at"]
    ]
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

    merged = _insert_untracked_gaps(merged)

    totals = {
        "worked": 0,
        "idle": 0,
        "locked": 0,
        "sleeping": 0,
        "untracked": 0,
    }
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
                "session_id": (str(interval["session_id"]) if interval.get("session_id") else None),
                "project_id": (str(interval["project_id"]) if interval.get("project_id") else None),
                "task_id": str(interval["task_id"]) if interval.get("task_id") else None,
                "project_name": interval["project_name"],
                "task_name": interval["task_name"],
                "is_current": is_current,
                "work_category": (
                    "extra" if approved_leave and interval["type"] == "worked" else None
                ),
            }
        )

    leave_seconds = totals["idle"] + totals["locked"] + totals["sleeping"] if approved_leave else 0
    first_signal_at = min(
        (interval["started_at"] for interval in merged),
        default=None,
    )
    # The day starts where sustained work starts. Touching a machine for a few
    # minutes and then leaving it for hours used to set the workday start hours
    # before the employee actually sat down.
    first_started_at = (
        sustained_work_start(
            [
                (interval["type"], interval["started_at"], interval["ended_at"])
                for interval in merged
            ],
            company_idle_threshold_seconds(db, company_id),
        )
        or first_signal_at
    )
    last_visible_end = max((interval["ended_at"] for interval in merged), default=None)
    return {
        "date": selected_date.isoformat(),
        "timezone": zone.key,
        "first_started_at": max(first_started_at, day_start).isoformat()
        if first_started_at
        else None,
        "first_signal_at": max(first_signal_at, day_start).isoformat() if first_signal_at else None,
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
        "untracked_seconds": totals["untracked"],
        "approved_leave": approved_leave,
        "leave_seconds": leave_seconds,
        "intervals": serialized_intervals,
    }
