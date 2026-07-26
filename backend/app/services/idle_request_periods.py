from datetime import UTC, date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Employee, PauseSession, TimeAdjustmentRequest
from app.services.work_profiles import get_or_create_work_profile, resolve_day_policy


REVIEWABLE_STATUSES = {"pending", "approved"}


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _employee_zone(employee: Employee, timezone_name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(timezone_name or employee.timezone or "UTC")
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def _included_segments(
    start: datetime,
    end: datetime,
    exclusions: list[tuple[datetime, datetime]],
) -> list[tuple[datetime, datetime]]:
    clipped = sorted(
        (max(start, excluded_start), min(end, excluded_end))
        for excluded_start, excluded_end in exclusions
        if excluded_end > start and excluded_start < end
    )
    segments: list[tuple[datetime, datetime]] = []
    cursor = start
    for excluded_start, excluded_end in clipped:
        if excluded_start > cursor:
            segments.append((cursor, excluded_start))
        cursor = max(cursor, excluded_end)
        if cursor >= end:
            break
    if cursor < end:
        segments.append((cursor, end))
    return [
        (segment_start, segment_end)
        for segment_start, segment_end in segments
        if segment_end > segment_start
    ]


def _request_matches_period(
    row: TimeAdjustmentRequest,
    *,
    session_id: str,
    started_at: datetime,
    ended_at: datetime,
) -> bool:
    if (
        row.work_session_id is None
        or str(row.work_session_id) != session_id
        or row.source_start_at is None
        or row.source_end_at is None
    ):
        return False
    return (
        abs((_as_utc(row.source_start_at) - started_at).total_seconds()) <= 2
        and abs((_as_utc(row.source_end_at) - ended_at).total_seconds()) <= 2
    )


def idle_request_period_matches(
    period: dict,
    *,
    work_session_id: UUID,
    source_start_at: datetime,
    source_end_at: datetime,
) -> bool:
    return (
        period["work_session_id"] == str(work_session_id)
        and abs(
            (
                datetime.fromisoformat(period["started_at"]) - _as_utc(source_start_at)
            ).total_seconds()
        )
        <= 2
        and abs(
            (datetime.fromisoformat(period["ended_at"]) - _as_utc(source_end_at)).total_seconds()
        )
        <= 2
    )


def build_idle_request_periods(
    db: Session,
    *,
    employee: Employee,
    company_id: UUID,
    work_date: date,
    timeline: dict,
    timezone_name: str | None,
) -> list[dict]:
    profile = get_or_create_work_profile(db, employee)
    policy = resolve_day_policy(db, employee, profile, work_date)
    working_days = profile.working_days or [0, 1, 2, 3, 4]
    weekly_off_days = profile.weekly_off_days or []
    if (
        work_date.weekday() not in working_days
        or work_date.weekday() in weekly_off_days
        or policy["approved_leave"]
        or not policy["shift_start"]
        or not policy["shift_end"]
    ):
        return []

    zone = _employee_zone(employee, timezone_name)
    shift_start = datetime.combine(work_date, policy["shift_start"], tzinfo=zone).astimezone(UTC)
    shift_end = datetime.combine(work_date, policy["shift_end"], tzinfo=zone).astimezone(UTC)
    if shift_end <= shift_start:
        return []

    exclusions: list[tuple[datetime, datetime]] = []
    for rule in policy["break_rules"]:
        if not rule.get("paid") or not rule.get("start_time") or not rule.get("end_time"):
            continue
        try:
            break_start = datetime.strptime(str(rule["start_time"])[:5], "%H:%M").time()
            break_end = datetime.strptime(str(rule["end_time"])[:5], "%H:%M").time()
        except (TypeError, ValueError):
            continue
        exclusions.append(
            (
                datetime.combine(work_date, break_start, tzinfo=zone).astimezone(UTC),
                datetime.combine(work_date, break_end, tzinfo=zone).astimezone(UTC),
            )
        )
    if policy["approved_early_leave_from"]:
        exclusions.append((_as_utc(policy["approved_early_leave_from"]), shift_end))
    pauses = db.scalars(
        select(PauseSession).where(
            PauseSession.company_id == company_id,
            PauseSession.employee_id == employee.id,
            PauseSession.started_at < shift_end,
            PauseSession.scheduled_end_at > shift_start,
        )
    ).all()
    exclusions.extend(
        (_as_utc(pause.started_at), _as_utc(pause.scheduled_end_at)) for pause in pauses
    )

    existing_requests = db.scalars(
        select(TimeAdjustmentRequest).where(
            TimeAdjustmentRequest.company_id == company_id,
            TimeAdjustmentRequest.employee_id == employee.id,
            TimeAdjustmentRequest.request_type == "idle_time",
            TimeAdjustmentRequest.requested_date == work_date,
            TimeAdjustmentRequest.status.in_(REVIEWABLE_STATUSES),
        )
    ).all()

    periods: list[dict] = []
    for interval in timeline.get("intervals", []):
        if interval.get("type") != "idle" or not interval.get("ended_at"):
            continue
        interval_start = _as_utc(datetime.fromisoformat(interval["started_at"]))
        interval_end = _as_utc(datetime.fromisoformat(interval["ended_at"]))
        eligible_start = max(interval_start, shift_start)
        eligible_end = min(interval_end, shift_end)
        if eligible_end <= eligible_start:
            continue
        session_id = str(interval["session_id"])
        for started_at, ended_at in _included_segments(
            eligible_start,
            eligible_end,
            exclusions,
        ):
            duration_seconds = int((ended_at - started_at).total_seconds())
            already_requested_seconds = sum(
                row.requested_seconds
                for row in existing_requests
                if _request_matches_period(
                    row,
                    session_id=session_id,
                    started_at=started_at,
                    ended_at=ended_at,
                )
            )
            periods.append(
                {
                    "work_session_id": session_id,
                    "started_at": started_at.isoformat(),
                    "ended_at": ended_at.isoformat(),
                    "duration_seconds": duration_seconds,
                    "available_seconds": max(
                        0,
                        duration_seconds - already_requested_seconds,
                    ),
                    "project_name": interval.get("project_name"),
                    "task_name": interval.get("task_name"),
                }
            )
    return sorted(periods, key=lambda period: period["started_at"])
