from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from sqlalchemy import select
from sqlalchemy.orm import Session, load_only

from app.models import (
    AttendanceCorrection,
    DailyAttendance,
    Employee,
    EmployeeWorkProfile,
    LeaveRequest,
    MeetingRecord,
    OvertimeRecord,
    TimeAdjustmentRequest,
    WorkSession,
)
from app.services.activity_timeline import (
    build_workday_timeline,
    build_workday_timelines,
    company_idle_threshold_seconds,
    local_today,
    scope_timeline_to_schedule,
    sustained_work_start,
)
from app.services.employee_archive import cap_to_employment_end
from app.services.financial_policy import (
    LATE_ALLOWANCE_CAP_SECONDS,
    company_financial_policy_effective_date,
    financial_policy_active,
)
from app.services.schedules import (
    effective_schedule,
    effective_schedules_for_employees,
    overlap_seconds,
)
from app.services.work_profiles import get_or_create_work_profile

DAILY_PAID_IDLE_GRACE_SECONDS = 15 * 60
DELAYED_BREAK_REQUEST = "delayed_break"
_ATTENDANCE_NOT_LOADED = object()


@dataclass(frozen=True)
class DailyAttendanceInputs:
    """Pre-fetched per-(employee, day) inputs for ``calculate_daily_attendance``.

    When supplied, ``calculate_daily_attendance`` performs no per-employee reads
    of its own: a batch caller resolves every field in bulk and the daily
    calculation runs purely in memory. Every field must correspond to exactly
    what the single-employee path would have fetched for the same day, so the
    persisted row is identical to the unbatched result.
    """

    timezone: str
    schedule: dict
    timeline: dict
    adjustments: list[TimeAdjustmentRequest]
    correction: AttendanceCorrection | None
    leave: LeaveRequest | None
    overtime_rows: list[OvertimeRecord]
    financial_policy_effective_date: date | None = None
    meetings: list = field(default_factory=list)


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _parsed(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def attendance_timezone(
    db: Session,
    *,
    employee: Employee,
    work_date: date,
    timezone_name: str | None = None,
    device_id: UUID | None = None,
) -> str:
    """Prefer the timezone snapshotted by a session on this work date."""
    if timezone_name:
        return timezone_name
    window_start = datetime.combine(work_date - timedelta(days=1), time.min, tzinfo=UTC)
    window_end = datetime.combine(work_date + timedelta(days=2), time.min, tzinfo=UTC)
    statement = (
        select(WorkSession.timezone, WorkSession.started_at)
        .where(
            WorkSession.company_id == employee.company_id,
            WorkSession.employee_id == employee.id,
            WorkSession.timezone.is_not(None),
            WorkSession.started_at >= window_start,
            WorkSession.started_at < window_end,
        )
        .order_by(WorkSession.started_at.desc())
    )
    if device_id is not None:
        statement = statement.where(WorkSession.device_id == device_id)
    for candidate, started_at in db.execute(statement).all():
        try:
            zone = ZoneInfo(candidate)
        except (ZoneInfoNotFoundError, ValueError):
            continue
        if _utc(started_at).astimezone(zone).date() == work_date:
            return zone.key
    return employee.timezone or "UTC"


def attendance_timezones_bulk(
    db: Session,
    *,
    company_id: UUID,
    requests: list[tuple[Employee, date]],
) -> dict[tuple[UUID, date], str]:
    """Resolve ``attendance_timezone`` for many (employee, date) pairs in one query.

    Mirrors the single-employee resolution exactly: for each pair, the most
    recent work session (no device filter) whose snapshotted timezone renders
    ``work_date`` as its local date wins; otherwise the employee's own timezone.
    """
    if not requests:
        return {}
    employee_ids = {employee.id for employee, _ in requests}
    min_date = min(work_date for _, work_date in requests)
    max_date = max(work_date for _, work_date in requests)
    window_start = datetime.combine(min_date - timedelta(days=1), time.min, tzinfo=UTC)
    window_end = datetime.combine(max_date + timedelta(days=2), time.min, tzinfo=UTC)
    rows = db.execute(
        select(WorkSession.employee_id, WorkSession.timezone, WorkSession.started_at)
        .where(
            WorkSession.company_id == company_id,
            WorkSession.employee_id.in_(employee_ids),
            WorkSession.timezone.is_not(None),
            WorkSession.started_at >= window_start,
            WorkSession.started_at < window_end,
        )
        .order_by(WorkSession.started_at.desc())
    ).all()
    candidates_by_employee: dict[UUID, list[tuple[str, datetime]]] = defaultdict(list)
    for employee_id, tz_name, started_at in rows:
        candidates_by_employee[employee_id].append((tz_name, started_at))

    result: dict[tuple[UUID, date], str] = {}
    for employee, work_date in requests:
        pair_start = datetime.combine(work_date - timedelta(days=1), time.min, tzinfo=UTC)
        pair_end = datetime.combine(work_date + timedelta(days=2), time.min, tzinfo=UTC)
        chosen = employee.timezone or "UTC"
        for tz_name, started_at in candidates_by_employee.get(employee.id, []):
            started = _utc(started_at)
            if not (pair_start <= started < pair_end):
                continue
            try:
                zone = ZoneInfo(tz_name)
            except (ZoneInfoNotFoundError, ValueError):
                continue
            if started.astimezone(zone).date() == work_date:
                chosen = zone.key
                break
        result[(employee.id, work_date)] = chosen
    return result


def calculate_daily_attendance_bulk(
    db: Session,
    *,
    company_id: UUID,
    requests: list[tuple[Employee, date]],
    now: datetime | None = None,
    profiles: dict[UUID, EmployeeWorkProfile] | None = None,
    existing_by_key: dict[tuple[UUID, date], DailyAttendance] | None = None,
    persist: bool = True,
) -> dict[tuple[UUID, date], tuple[DailyAttendance, dict]]:
    """Compute daily attendance for many (employee, date) pairs with bulk reads.

    Every per-employee query the single path issues (timezone, schedule,
    timeline, adjustments, correction, leave, overtime, existing row) is fetched
    here in a fixed number of statements, then ``calculate_daily_attendance``
    runs purely in memory via :class:`DailyAttendanceInputs`. Results are
    identical to calling ``calculate_daily_attendance`` per pair.
    """
    if not requests:
        return {}
    calculation_now = _utc(now or datetime.now(UTC))
    financial_policy_effective_date = company_financial_policy_effective_date(db, company_id)
    profiles = dict(profiles or {})
    employees_by_id: dict[UUID, Employee] = {}
    for employee, _ in requests:
        employees_by_id[employee.id] = employee
        if employee.id not in profiles:
            profiles[employee.id] = get_or_create_work_profile(db, employee)

    # 1) Effective timezone per pair (one query).
    tz_by_key = attendance_timezones_bulk(db, company_id=company_id, requests=requests)

    # 2) Schedules, grouped by work_date (effective_schedules_for_employees runs
    #    two queries per distinct date, honoring each employee's snapshot tz).
    requests_by_date: dict[date, list[Employee]] = defaultdict(list)
    for employee, work_date in requests:
        requests_by_date[work_date].append(employee)
    schedule_by_key: dict[tuple[UUID, date], dict] = {}
    for work_date, day_employees in requests_by_date.items():
        tz_for_date = {
            employee.id: tz_by_key[(employee.id, work_date)] for employee in day_employees
        }
        day_schedules = effective_schedules_for_employees(
            db,
            day_employees,
            work_date,
            profiles=profiles,
            timezone_by_employee=tz_for_date,
        )
        for employee in day_employees:
            schedule_by_key[(employee.id, work_date)] = day_schedules[employee.id]

    # 3) Timelines (bulk); the single path builds each from schedule["timezone"].
    timeline_requests = [
        (employee.id, schedule_by_key[(employee.id, work_date)]["timezone"], work_date)
        for employee, work_date in requests
    ]
    timelines = build_workday_timelines(
        db, company_id=company_id, requests=timeline_requests, now=calculation_now
    )

    # 4) Per-pair source rows, each fetched once in bulk.
    employee_ids = list(employees_by_id)
    work_dates = {work_date for _, work_date in requests}
    min_date, max_date = min(work_dates), max(work_dates)

    adjustments_by_key: dict[tuple[UUID, date], list[TimeAdjustmentRequest]] = defaultdict(list)
    for row in db.scalars(
        select(TimeAdjustmentRequest).where(
            TimeAdjustmentRequest.company_id == company_id,
            TimeAdjustmentRequest.employee_id.in_(employee_ids),
            TimeAdjustmentRequest.requested_date.in_(work_dates),
        )
    ).all():
        adjustments_by_key[(row.employee_id, row.requested_date)].append(row)

    correction_by_key: dict[tuple[UUID, date], AttendanceCorrection] = {}
    for row in db.scalars(
        select(AttendanceCorrection).where(
            AttendanceCorrection.company_id == company_id,
            AttendanceCorrection.employee_id.in_(employee_ids),
            AttendanceCorrection.work_date.in_(work_dates),
        )
    ).all():
        correction_by_key[(row.employee_id, row.work_date)] = row

    overtime_by_key: dict[tuple[UUID, date], list[OvertimeRecord]] = defaultdict(list)
    for row in db.scalars(
        select(OvertimeRecord).where(
            OvertimeRecord.company_id == company_id,
            OvertimeRecord.employee_id.in_(employee_ids),
            OvertimeRecord.work_date.in_(work_dates),
        )
    ).all():
        overtime_by_key[(row.employee_id, row.work_date)].append(row)

    meetings_by_key: dict[tuple[UUID, date], list[MeetingRecord]] = defaultdict(list)
    for row in db.scalars(
        select(MeetingRecord).where(
            MeetingRecord.company_id == company_id,
            MeetingRecord.employee_id.in_(employee_ids),
            MeetingRecord.work_date.in_(work_dates),
        )
    ).all():
        meetings_by_key[(row.employee_id, row.work_date)].append(row)

    leaves_by_employee: dict[UUID, list[LeaveRequest]] = defaultdict(list)
    for row in db.scalars(
        select(LeaveRequest).where(
            LeaveRequest.company_id == company_id,
            LeaveRequest.employee_id.in_(employee_ids),
            LeaveRequest.status == "approved",
            LeaveRequest.start_date <= max_date,
            LeaveRequest.end_date >= min_date,
        )
    ).all():
        leaves_by_employee[row.employee_id].append(row)

    if existing_by_key is None:
        existing_by_key = {}
        for row in db.scalars(
            select(DailyAttendance).where(
                DailyAttendance.company_id == company_id,
                DailyAttendance.employee_id.in_(employee_ids),
                DailyAttendance.work_date.in_(work_dates),
            )
        ).all():
            existing_by_key[(row.employee_id, row.work_date)] = row

    results: dict[tuple[UUID, date], tuple[DailyAttendance, dict]] = {}
    for employee, work_date in requests:
        key = (employee.id, work_date)
        # Match the single path: the first approved leave row covering this day,
        # in the query's default ordering (primary key / insertion order).
        leave = next(
            (
                item
                for item in leaves_by_employee.get(employee.id, [])
                if item.start_date <= work_date <= item.end_date
            ),
            None,
        )
        inputs = DailyAttendanceInputs(
            timezone=tz_by_key[key],
            schedule=schedule_by_key[key],
            timeline=timelines[(employee.id, work_date)],
            adjustments=adjustments_by_key.get(key, []),
            correction=correction_by_key.get(key),
            leave=leave,
            overtime_rows=overtime_by_key.get(key, []),
            financial_policy_effective_date=financial_policy_effective_date,
            meetings=meetings_by_key.get(key, []),
        )
        # Compute in memory here; persist once for the whole batch below so a
        # payroll refresh flushes every current-day row in a single round trip
        # instead of one flush per employee.
        results[key] = calculate_daily_attendance(
            db,
            employee=employee,
            work_date=work_date,
            now=calculation_now,
            persist=False,
            existing_attendance=existing_by_key.get(key),
            profile=profiles[employee.id],
            prefetched=inputs,
        )
    if persist:
        db.add_all(row for row, _ in results.values())
        db.flush()
    return results


def cached_daily_attendance(
    db: Session,
    *,
    employee: Employee,
    work_date: date,
    now: datetime | None = None,
    max_age_seconds: int = 30,
    timezone_name: str | None = None,
    device_id: UUID | None = None,
    existing_attendance: DailyAttendance | None | object = _ATTENDANCE_NOT_LOADED,
    profile: EmployeeWorkProfile | None = None,
) -> tuple[DailyAttendance, dict | None]:
    """Return a recent materialized day, recalculating only when needed.

    Closed days are immutable unless another workflow explicitly recalculates
    them after an approval or schedule change. The current day is refreshed at
    a short, bounded interval so dashboard polling does not rebuild every
    employee timeline on every request.
    """
    at = _utc(now or datetime.now(UTC))
    row = (
        db.scalar(
            select(DailyAttendance).where(
                DailyAttendance.company_id == employee.company_id,
                DailyAttendance.employee_id == employee.id,
                DailyAttendance.work_date == work_date,
            )
        )
        if existing_attendance is _ATTENDANCE_NOT_LOADED
        else existing_attendance
    )
    if row is not None and not isinstance(row, DailyAttendance):
        raise TypeError("existing_attendance must be a DailyAttendance row or None")

    # Fresh snapshots already carry the timezone used to calculate them. Most
    # dashboard polls can return here without another work-session lookup.
    cached_timezone = timezone_name or (row.timezone if row is not None else None)
    cached_employee_today = local_today(
        cached_timezone or employee.timezone or "UTC",
        at,
    )
    if row is not None and work_date < cached_employee_today:
        return row, None
    if row is not None and row.calculated_at is not None:
        age = max(0, int((at - _utc(row.calculated_at)).total_seconds()))
        if age < max_age_seconds:
            return row, None

    effective_timezone = attendance_timezone(
        db,
        employee=employee,
        work_date=work_date,
        timezone_name=timezone_name,
        device_id=device_id,
    )
    return calculate_daily_attendance(
        db,
        employee=employee,
        work_date=work_date,
        now=at,
        timezone_name=effective_timezone,
        device_id=device_id,
        existing_attendance=row,
        profile=profile,
    )


def calculate_daily_attendance(
    db: Session,
    *,
    employee: Employee,
    work_date: date,
    now: datetime | None = None,
    persist: bool = True,
    timezone_name: str | None = None,
    device_id: UUID | None = None,
    existing_attendance: DailyAttendance | None | object = _ATTENDANCE_NOT_LOADED,
    profile: EmployeeWorkProfile | None = None,
    prefetched: "DailyAttendanceInputs | None" = None,
) -> tuple[DailyAttendance, dict]:
    calculation_now = _utc(now or datetime.now(UTC))
    if prefetched is not None:
        effective_timezone = prefetched.timezone
    else:
        effective_timezone = attendance_timezone(
            db,
            employee=employee,
            work_date=work_date,
            timezone_name=timezone_name,
            device_id=device_id,
        )
    profile = profile or get_or_create_work_profile(db, employee)
    if prefetched is not None:
        schedule = prefetched.schedule
    else:
        schedule = effective_schedule(
            db,
            employee,
            profile,
            work_date,
            timezone_name=effective_timezone,
        )
    if prefetched is not None:
        timeline = prefetched.timeline
    else:
        timeline = build_workday_timeline(
            db,
            company_id=employee.company_id,
            employee_id=employee.id,
            timezone_name=schedule["timezone"],
            target_date=work_date,
            now=now,
            device_id=device_id,
        )
    if prefetched is not None:
        adjustments = prefetched.adjustments
    else:
        adjustments = db.scalars(
            select(TimeAdjustmentRequest).where(
                TimeAdjustmentRequest.company_id == employee.company_id,
                TimeAdjustmentRequest.employee_id == employee.id,
                TimeAdjustmentRequest.requested_date == work_date,
            )
        ).all()
    if prefetched is not None:
        policy_effective_date = prefetched.financial_policy_effective_date
    else:
        policy_effective_date = company_financial_policy_effective_date(db, employee.company_id)
    policy_active = financial_policy_active(policy_effective_date, work_date)
    start_at = schedule["start_at"]
    end_at = schedule["end_at"]
    timeline = scope_timeline_to_schedule(
        timeline,
        shift_start=start_at,
        shift_end=end_at,
        scheduled_breaks=schedule["breaks"],
        approved_idle_adjustments=[
            {
                "session_id": row.work_session_id,
                "start_at": row.source_start_at,
                "end_at": row.source_end_at,
                "approved_seconds": int(row.approved_seconds or row.requested_seconds),
            }
            for row in adjustments
            if row.request_type == "idle_time"
            and row.status == "approved"
            and row.work_session_id is not None
            and row.source_start_at is not None
            and row.source_end_at is not None
        ],
        now=now,
    )
    intervals = []
    for item in timeline["intervals"]:
        item_start = _parsed(item["started_at"])
        item_end = _parsed(item["ended_at"]) or _utc(now or datetime.now(UTC))
        if item_start and item_end > item_start:
            intervals.append((item, _utc(item_start), _utc(item_end)))

    activity_intervals = [item for item in intervals if item[0]["type"] in {"worked", "idle"}]
    worked_intervals = [item for item in activity_intervals if item[0]["type"] == "worked"]
    scheduled_activity_intervals = [
        item
        for item in activity_intervals
        if item[0]["type"] != "worked" or item[0].get("work_category") != "extra"
    ]
    scheduled_worked_intervals = [
        item for item in scheduled_activity_intervals if item[0]["type"] == "worked"
    ]
    # Lateness is measured from sustained work, not from a brief touch that was
    # followed by hours away from the machine.
    idle_threshold = company_idle_threshold_seconds(db, employee.company_id)

    def first_activity_at(candidates) -> datetime | None:
        blocks = [(item[0]["type"], item[1], item[2]) for item in candidates]
        return sustained_work_start(blocks, idle_threshold) or min(
            (item[1] for item in candidates if item[0]["type"] == "worked"),
            default=None,
        )

    raw_first_at = first_activity_at(activity_intervals)
    raw_last_at = max((item[2] for item in worked_intervals), default=None)
    scheduled_first_at = first_activity_at(scheduled_activity_intervals)
    scheduled_last_at = max((item[2] for item in scheduled_worked_intervals), default=None)
    if prefetched is not None:
        correction = prefetched.correction
    else:
        correction = db.scalar(
            select(AttendanceCorrection).where(
                AttendanceCorrection.company_id == employee.company_id,
                AttendanceCorrection.employee_id == employee.id,
                AttendanceCorrection.work_date == work_date,
            )
        )
    first_at = (
        _utc(correction.corrected_start_at)
        if correction and correction.corrected_start_at
        else scheduled_first_at
    )
    last_at = (
        _utc(correction.corrected_end_at)
        if correction and correction.corrected_end_at
        else scheduled_last_at
    )
    actual_sign_out_at = None if timeline["is_running"] else _parsed(timeline["last_ended_at"])
    normal_worked = 0
    pre_shift_extra = 0
    post_shift_extra = 0
    eligible_idle = 0
    manual_pause_idle = 0
    # Seconds of real work performed during a scheduled break. Under the new
    # policy this counts as paid work (not a consumed break) and earns an equal
    # same-day break-bank credit. Under the old policy it is subtracted from work
    # and the whole break window is paid as break.
    worked_break_seconds = 0
    for item, interval_start, interval_end in intervals:
        if item["type"] == "worked":
            # Work performed on an approved leave day is extra/overtime work.
            # It must never consume the paid leave entitlement or appear as
            # normal shift time, even when it falls inside the configured shift.
            if item.get("work_category") == "extra":
                extra_seconds = int((interval_end - interval_start).total_seconds())
                if start_at and interval_end <= start_at:
                    pre_shift_extra += extra_seconds
                else:
                    post_shift_extra += extra_seconds
                continue
            if start_at and end_at:
                worked_in_shift = overlap_seconds(interval_start, interval_end, start_at, end_at)
                interval_break_work = 0
                for scheduled_break in schedule["breaks"]:
                    interval_break_work += overlap_seconds(
                        interval_start,
                        interval_end,
                        scheduled_break["start_at"],
                        scheduled_break["end_at"],
                    )
                worked_break_seconds += interval_break_work
                if not policy_active:
                    # Old behavior: breaks are reported separately, so active
                    # input during a scheduled break is removed from work.
                    worked_in_shift -= interval_break_work
                # New behavior: working through a break IS paid work, so the
                # break overlap stays in normal_worked and is credited to the
                # break bank below instead of double-counting as a paid break.
                normal_worked += max(0, worked_in_shift)
                if interval_start < start_at:
                    pre_shift_extra += overlap_seconds(
                        interval_start, interval_end, interval_start, start_at
                    )
                if interval_end > end_at:
                    post_shift_extra += overlap_seconds(
                        interval_start, interval_end, end_at, interval_end
                    )
            else:
                post_shift_extra += int((interval_end - interval_start).total_seconds())
        elif item["type"] == "idle" and start_at and end_at:
            idle_in_shift = overlap_seconds(interval_start, interval_end, start_at, end_at)
            for scheduled_break in schedule["breaks"]:
                idle_in_shift -= overlap_seconds(
                    interval_start,
                    interval_end,
                    scheduled_break["start_at"],
                    scheduled_break["end_at"],
                )
            idle_in_shift = max(0, idle_in_shift)
            eligible_idle += idle_in_shift
            if item.get("source") == "manual_pause":
                manual_pause_idle += idle_in_shift

    # Delayed-break claims are accounted separately below: they reclassify a
    # later eligible idle interval as paid rather than adding brand-new time, and
    # are bounded by the same-day break-bank credit. Keeping them out of the
    # generic manual buckets prevents paying the reclassified interval twice.
    approved_manual_requested = sum(
        int(row.approved_seconds or row.requested_seconds)
        for row in adjustments
        if row.status == "approved"
        and row.request_type not in {"early_leave", DELAYED_BREAK_REQUEST}
    )
    pending_manual = sum(
        int(row.requested_seconds)
        for row in adjustments
        if row.status == "pending" and row.request_type != DELAYED_BREAK_REQUEST
    )
    rejected_manual = sum(
        int(row.requested_seconds)
        for row in adjustments
        if row.status == "rejected" and row.request_type != DELAYED_BREAK_REQUEST
    )
    def _delayed_break_idle_coverage(row: TimeAdjustmentRequest) -> int:
        """Return approved seconds that still overlap the request's source idle."""
        if (
            row.work_session_id is None
            or row.source_start_at is None
            or row.source_end_at is None
        ):
            return 0
        source_start = _utc(row.source_start_at)
        source_end = _utc(row.source_end_at)
        remaining = max(0, int(row.approved_seconds or row.requested_seconds))
        covered = 0
        for item, interval_start, interval_end in intervals:
            if (
                remaining <= 0
                or item["type"] != "idle"
                or item.get("source") == "manual_pause"
                or str(item.get("session_id") or "") != str(row.work_session_id)
            ):
                continue
            overlap = min(
                remaining,
                overlap_seconds(interval_start, interval_end, source_start, source_end),
            )
            covered += overlap
            remaining -= overlap
        return covered

    approved_delayed_break_requested = sum(
        _delayed_break_idle_coverage(row)
        for row in adjustments
        if row.status == "approved" and row.request_type == DELAYED_BREAK_REQUEST
    )
    pending_delayed_break_seconds = sum(
        int(row.requested_seconds)
        for row in adjustments
        if row.status == "pending" and row.request_type == DELAYED_BREAK_REQUEST
    )
    approved_early_leave = next(
        (
            row
            for row in adjustments
            if row.request_type == "early_leave" and row.status == "approved"
        ),
        None,
    )
    approved_early_leave_seconds = (
        int(approved_early_leave.approved_seconds or approved_early_leave.requested_seconds)
        if approved_early_leave
        else 0
    )

    if prefetched is not None:
        leave = prefetched.leave
    else:
        leave = db.scalar(
            select(LeaveRequest).where(
                LeaveRequest.company_id == employee.company_id,
                LeaveRequest.employee_id == employee.id,
                LeaveRequest.status == "approved",
                LeaveRequest.start_date <= work_date,
                LeaveRequest.end_date >= work_date,
            )
        )
    if leave:
        eligible_idle = 0

    # Meeting Mode: an approved meeting pays its in-shift, non-worked time once
    # (worked time inside it is already paid as work); a pending/active meeting's
    # time is shown provisionally and is neither paid nor deducted until review.
    if prefetched is not None:
        meetings = prefetched.meetings
    else:
        meetings = db.scalars(
            select(MeetingRecord).where(
                MeetingRecord.company_id == employee.company_id,
                MeetingRecord.employee_id == employee.id,
                MeetingRecord.work_date == work_date,
            )
        ).all()

    def _meeting_nonworked_in_shift(meeting) -> int:
        if meeting.ended_at is None or not (start_at and end_at):
            return 0
        m_start = max(_utc(meeting.started_at), start_at)
        m_end = min(_utc(meeting.ended_at), end_at)
        covered = overlap_seconds(m_start, m_end, m_start, m_end)
        if covered <= 0:
            return 0
        for scheduled_break in schedule["breaks"]:
            covered -= overlap_seconds(
                m_start, m_end, scheduled_break["start_at"], scheduled_break["end_at"]
            )
        worked_overlap = sum(
            overlap_seconds(item_start, item_end, m_start, m_end)
            for _item, item_start, item_end in worked_intervals
        )
        return max(0, covered - worked_overlap)

    approved_meeting_covered = 0
    pending_meeting_covered = 0
    if not leave:
        for meeting in meetings:
            if meeting.status == "approved":
                bounded = min(
                    _meeting_nonworked_in_shift(meeting),
                    int(meeting.approved_seconds or 0),
                )
                approved_meeting_covered += bounded
            elif meeting.status == "pending":
                pending_meeting_covered += _meeting_nonworked_in_shift(meeting)

    paid_break = 0
    unpaid_break = 0
    earned_break_credit = 0
    if first_at and last_at:
        for scheduled_break in schedule["breaks"]:
            attended_break_seconds = overlap_seconds(
                first_at,
                last_at,
                scheduled_break["start_at"],
                scheduled_break["end_at"],
            )
            if policy_active:
                # Only the part of the break the employee actually rested is a
                # consumed break; time worked through the break is already paid
                # as work above and instead earns an equal break-bank credit.
                worked_through = sum(
                    overlap_seconds(
                        item_start,
                        item_end,
                        scheduled_break["start_at"],
                        scheduled_break["end_at"],
                    )
                    for _item, item_start, item_end in worked_intervals
                )
                worked_through = min(worked_through, attended_break_seconds)
                rested_break_seconds = max(0, attended_break_seconds - worked_through)
                # Earning requires real activity evidence and can never exceed the
                # worked overlap with the scheduled break window.
                earned_break_credit += worked_through
            else:
                rested_break_seconds = attended_break_seconds
            if scheduled_break["paid"]:
                paid_break += rested_break_seconds
            else:
                unpaid_break += rested_break_seconds
    # Device-on/idle is not proof that the employee attended. Attendance starts
    # only from worked evidence (or an explicit approved/manual correction).
    attended = bool(
        scheduled_worked_intervals
        or approved_manual_requested
        or approved_meeting_covered
        or correction
    )
    tracked_work = any(item[0]["type"] == "worked" for item in activity_intervals)

    raw_late = (
        max(0, int((first_at - start_at).total_seconds()))
        if first_at and start_at and not leave
        else 0
    )
    deductible_late = max(0, raw_late - int(profile.late_grace_minutes or 0) * 60)
    # The first minutes of lateness are a paid allowance: credit the missing
    # eligible period between shift start and qualifying arrival, capped at 15
    # minutes. This window precedes any worked/break/manual time, so it never
    # pays the same second twice. Raw arrival and excess lateness stay visible;
    # the allowance is a payable term, not tracked work. Absent/off/leave days
    # already have raw_late == 0, so no allowance is credited there.
    paid_late_allowance = min(raw_late, LATE_ALLOWANCE_CAP_SECONDS) if policy_active else 0
    effective_expected_end = end_at
    if approved_early_leave and approved_early_leave.source_start_at:
        effective_expected_end = (
            min(end_at, _utc(approved_early_leave.source_start_at)) if end_at else None
        )
        # Approved early-leave time is outside the employee's attendance
        # obligation and therefore cannot remain eligible idle time.
        eligible_idle = 0
        manual_pause_idle = 0
        if start_at and effective_expected_end:
            for item, interval_start, interval_end in intervals:
                if item["type"] != "idle":
                    continue
                idle_in_shift = overlap_seconds(
                    interval_start,
                    interval_end,
                    start_at,
                    effective_expected_end,
                )
                for scheduled_break in schedule["breaks"]:
                    idle_in_shift -= overlap_seconds(
                        interval_start,
                        interval_end,
                        scheduled_break["start_at"],
                        min(scheduled_break["end_at"], effective_expected_end),
                    )
                idle_in_shift = max(0, idle_in_shift)
                eligible_idle += idle_in_shift
                if item.get("source") == "manual_pause":
                    manual_pause_idle += idle_in_shift
    early_leave = (
        max(0, int((effective_expected_end - last_at).total_seconds()))
        if last_at
        and effective_expected_end
        and calculation_now >= effective_expected_end
        and not timeline["is_running"]
        and not leave
        else 0
    )
    raw_eligible_idle = eligible_idle
    automatic_idle = max(0, raw_eligible_idle - manual_pause_idle)
    # An approved delayed break reclassifies later automatic (non-pause) idle as
    # paid rest, bounded by the same-day break-bank credit actually earned by
    # working through a scheduled break. It can never reclassify more idle than
    # exists, so the same second is paid once and the idle-grace pool is
    # recomputed on the remaining automatic idle (no duplicate credit).
    approved_delayed_break = min(
        approved_delayed_break_requested, earned_break_credit, automatic_idle
    )
    idle_after = max(0, automatic_idle - approved_delayed_break)
    # Approval is itself bounded attendance evidence, so it can pay a recorded
    # in-shift meeting even when no WorkSession/idle row reached the server. Only
    # the portion that overlaps recorded idle is removed from the idle ledger.
    approved_meeting_seconds = approved_meeting_covered
    approved_meeting_idle_seconds = min(approved_meeting_seconds, idle_after)
    idle_after = max(0, idle_after - approved_meeting_idle_seconds)
    # A pending/active meeting's covered idle is provisional: neither paid nor
    # deducted while it awaits review, and shown separately.
    pending_meeting_seconds = pending_meeting_covered
    pending_meeting_idle_seconds = min(pending_meeting_seconds, idle_after)
    idle_after = max(0, idle_after - pending_meeting_idle_seconds)
    paid_idle_grace = min(idle_after, DAILY_PAID_IDLE_GRACE_SECONDS)
    deductible_idle = manual_pause_idle + max(0, idle_after - paid_idle_grace)
    # Same-day, no carryover: remaining bank an employee may still claim later.
    reserved_break_credit = min(
        max(0, earned_break_credit - approved_delayed_break), pending_delayed_break_seconds
    )
    remaining_break_credit = max(
        0, earned_break_credit - approved_delayed_break - reserved_break_credit
    )

    if prefetched is not None:
        overtime_rows = prefetched.overtime_rows
    else:
        overtime_rows = db.scalars(
            select(OvertimeRecord).where(
                OvertimeRecord.company_id == employee.company_id,
                OvertimeRecord.employee_id == employee.id,
                OvertimeRecord.work_date == work_date,
            )
        ).all()
    recorded_overtime = max(
        pre_shift_extra + post_shift_extra,
        sum(int(row.recorded_extra_seconds) for row in overtime_rows),
    )
    approved_overtime = min(
        recorded_overtime,
        sum(int(row.approved_seconds) for row in overtime_rows if row.status == "approved"),
    )
    unapproved_overtime = max(0, recorded_overtime - approved_overtime)
    pending_overtime = 0
    rejected_overtime = 0
    recorded_only_overtime = 0
    overtime_rows_total = 0
    for overtime_row in overtime_rows:
        row_recorded = max(0, int(overtime_row.recorded_extra_seconds))
        row_approved = (
            min(row_recorded, max(0, int(overtime_row.approved_seconds)))
            if overtime_row.status == "approved"
            else 0
        )
        row_unapproved = max(0, row_recorded - row_approved)
        overtime_rows_total += row_recorded
        if overtime_row.status == "rejected":
            rejected_overtime += row_unapproved
        elif (
            overtime_row.status == "recorded_not_counted"
            or not overtime_row.overtime_enabled_snapshot
        ):
            recorded_only_overtime += row_unapproved
        else:
            pending_overtime += row_unapproved

    # A freshly synchronized timeline can contain extra seconds before its
    # per-session overtime record is materialized. Classify that bounded gap
    # according to the employee's policy instead of losing it or calling a
    # rejected decision "pending".
    unclassified_overtime = max(0, recorded_overtime - overtime_rows_total)
    if profile.overtime_enabled:
        pending_overtime += unclassified_overtime
    else:
        recorded_only_overtime += unclassified_overtime

    # Admin screenshot deletions remove proven work from the session ledger
    # (WorkSession.deducted_seconds, surfaced per day by the timeline). Attendance
    # is a projection of that ledger, so subtract the deduction from PAYABLE time
    # in priority order — normal in-shift work first, then paid (approved)
    # overtime, then any remaining recorded/extra overtime — so the pay actually
    # drops instead of being restored by the overtime record (W3). Reading the
    # accumulated ledger total keeps repeated deletions idempotent.
    remaining_deduction = max(0, int(timeline.get("deducted_seconds", 0)))
    if remaining_deduction:
        take = min(remaining_deduction, normal_worked)
        normal_worked -= take
        remaining_deduction -= take
        # Overtime beyond normal time: reduce the paid amount and keep
        # recorded_overtime >= approved_overtime.
        take = min(remaining_deduction, approved_overtime)
        approved_overtime -= take
        recorded_overtime = max(0, recorded_overtime - take)
        remaining_deduction -= take
        take = min(remaining_deduction, recorded_overtime)
        recorded_overtime -= take
        remaining_deduction -= take
        take = min(remaining_deduction, post_shift_extra)
        post_shift_extra -= take
        remaining_deduction -= take
        take = min(remaining_deduction, pre_shift_extra)
        pre_shift_extra -= take
        remaining_deduction -= take
        unapproved_overtime = max(0, recorded_overtime - approved_overtime)

    expected_seconds = int((end_at - start_at).total_seconds()) if start_at and end_at else 0
    # Manual credits fill only the remaining in-shift deficit after every
    # evidence-backed or policy-backed classification. This keeps a generic
    # untimestamped correction from also paying seconds already covered by work,
    # a break, lateness allowance, delayed rest, or a meeting. Timestamped idle
    # requests are bounded by their source interval before reaching this cap.
    payable_before_manual = (
        normal_worked
        + paid_break
        + paid_idle_grace
        + approved_early_leave_seconds
        + paid_late_allowance
        + approved_delayed_break
        + approved_meeting_seconds
    )
    approved_manual = min(
        approved_manual_requested,
        max(0, expected_seconds - payable_before_manual),
    )
    if leave and leave.leave_type != "unpaid":
        normal_payable = expected_seconds
    elif leave and leave.leave_type == "unpaid":
        normal_payable = 0
    else:
        normal_payable = min(
            expected_seconds,
            normal_worked
            + paid_break
            + paid_idle_grace
            + approved_manual
            + approved_early_leave_seconds
            + paid_late_allowance
            + approved_delayed_break
            + approved_meeting_seconds,
        )
    attendance_adjustment_seconds = int(correction.payable_seconds_delta) if correction else 0
    adjusted_normal_payable = max(
        0,
        min(expected_seconds, normal_payable + attendance_adjustment_seconds),
    )
    total_payable = adjusted_normal_payable + approved_overtime

    issues: list[dict] = []
    if deductible_late:
        issues.append({"code": "late", "seconds": deductible_late})
    if early_leave:
        issues.append({"code": "early_leave", "seconds": early_leave})
    if deductible_idle:
        issues.append({"code": "unexplained_idle", "seconds": deductible_idle})
    if pending_overtime:
        issues.append({"code": "overtime_pending", "seconds": pending_overtime})
    if rejected_overtime:
        issues.append({"code": "overtime_rejected", "seconds": rejected_overtime})
    if recorded_only_overtime:
        issues.append({"code": "overtime_recorded_only", "seconds": recorded_only_overtime})
    if correction:
        issues.append(
            {
                "code": "attendance_corrected",
                "seconds": attendance_adjustment_seconds,
            }
        )
    if schedule["scheduled_day"] and not attended and not leave:
        issues.append({"code": "missing_check_in", "seconds": expected_seconds})

    if leave:
        status = "approved_leave"
    elif not schedule["scheduled_day"]:
        status = "worked_off_day" if tracked_work or approved_manual or correction else "off_day"
    elif not attended:
        employee_today = local_today(schedule["timezone"], now)
        status = "not_started" if work_date >= employee_today else "absent"
    elif deductible_late:
        status = "late"
    elif early_leave:
        status = "left_early"
    else:
        status = "present"

    row = (
        db.scalar(
            select(DailyAttendance).where(
                DailyAttendance.company_id == employee.company_id,
                DailyAttendance.employee_id == employee.id,
                DailyAttendance.work_date == work_date,
            )
        )
        if existing_attendance is _ATTENDANCE_NOT_LOADED
        else existing_attendance
    )
    if row is not None and not isinstance(row, DailyAttendance):
        raise TypeError("existing_attendance must be a DailyAttendance row or None")
    if row is None:
        row = DailyAttendance(
            company_id=employee.company_id,
            employee_id=employee.id,
            work_date=work_date,
            calculated_at=datetime.now(UTC),
        )
    values = {
        "timezone": schedule["timezone"],
        "scheduled_start_at": start_at,
        "scheduled_end_at": end_at,
        "actual_first_activity_at": (
            _utc(correction.corrected_start_at)
            if correction and correction.corrected_start_at
            else raw_first_at
        ),
        "actual_last_activity_at": (
            _utc(correction.corrected_end_at)
            if correction and correction.corrected_end_at
            else raw_last_at
        ),
        "actual_sign_out_at": actual_sign_out_at,
        "normal_worked_seconds": normal_worked,
        "paid_break_seconds": paid_break,
        "unpaid_break_seconds": unpaid_break,
        "idle_seconds": deductible_idle,
        "approved_manual_seconds": approved_manual,
        "pending_manual_seconds": pending_manual,
        "rejected_manual_seconds": rejected_manual,
        "raw_late_seconds": raw_late,
        "deductible_late_seconds": deductible_late,
        "early_leave_seconds": early_leave,
        "pre_shift_extra_seconds": pre_shift_extra,
        "post_shift_extra_seconds": post_shift_extra,
        "recorded_overtime_seconds": recorded_overtime,
        "approved_overtime_seconds": approved_overtime,
        "unapproved_overtime_seconds": unapproved_overtime,
        "total_payable_seconds": total_payable,
        "status": status,
        "leave_status": leave.leave_type if leave else None,
        "issues": issues,
        "calculation_sources": {
            "session_ids": sorted(
                {item[0]["session_id"] for item in intervals if item[0].get("session_id")}
            ),
            "is_running": bool(timeline["is_running"]),
            "continued_from_previous_day": bool(timeline.get("continued_from_previous_day", False)),
            "continued_session_started_at": timeline.get("continued_session_started_at"),
            "adjustment_ids": [str(item.id) for item in adjustments],
            "overtime_ids": [str(item.id) for item in overtime_rows],
            "leave_request_id": str(leave.id) if leave else None,
            "approved_early_leave_seconds": approved_early_leave_seconds,
            "approved_manual_requested_seconds": approved_manual_requested,
            "schedule_override_id": schedule["override_id"],
            "profile_history_applied": bool(schedule.get("profile_history_applied", False)),
            "attendance_correction_id": str(correction.id) if correction else None,
            "attendance_adjustment_seconds": attendance_adjustment_seconds,
            "attendance_correction_reason": correction.reason if correction else None,
            "raw_idle_seconds": raw_eligible_idle,
            # Preserve every idle second observed by the connected agent for
            # operational timesheets. Payroll continues to use the clipped
            # in-shift idle values above.
            "observed_idle_seconds": int(timeline.get("idle_seconds", 0)),
            "approved_idle_seconds_removed": int(timeline.get("manual_seconds", 0)),
            "manual_pause_seconds": manual_pause_idle,
            "paid_idle_grace_seconds": paid_idle_grace,
            # Phase-1 financial policy figures. When the policy is inactive these
            # are all zero and payable is unchanged from the previous behavior.
            "financial_policy_active": bool(policy_active),
            "paid_late_allowance_seconds": paid_late_allowance,
            "worked_break_seconds": worked_break_seconds,
            "earned_break_credit_seconds": earned_break_credit,
            "approved_delayed_break_seconds": approved_delayed_break,
            "reserved_break_credit_seconds": reserved_break_credit,
            "remaining_break_credit_seconds": remaining_break_credit,
            "approved_meeting_seconds": approved_meeting_seconds,
            "pending_meeting_seconds": pending_meeting_seconds,
            "raw_first_activity_at": raw_first_at.isoformat() if raw_first_at else None,
            "raw_last_activity_at": raw_last_at.isoformat() if raw_last_at else None,
            # Interval-reconstructed worked total (includes in-shift, pre/post-shift
            # extra, and break-overlapped worked time). This is the single
            # authoritative worked-evidence figure that desktop summary, the
            # timeline, and timesheets all reconcile session counters against, so
            # every surface reports the same worked/overtime seconds (D7).
            "worked_seconds": int(timeline.get("worked_seconds", 0)),
        },
        "calculated_at": datetime.now(UTC),
    }
    for key, value in values.items():
        setattr(row, key, value)
    if persist:
        db.add(row)
        db.flush()
    return row, timeline


def serialize_daily_attendance(row: DailyAttendance, *, timeline: dict | None = None) -> dict:
    calculation_sources = row.calculation_sources or {}
    result = {
        "id": str(row.id),
        "employee_id": str(row.employee_id),
        "date": row.work_date.isoformat(),
        "timezone": row.timezone,
        "scheduled_start_at": row.scheduled_start_at.isoformat()
        if row.scheduled_start_at
        else None,
        "scheduled_end_at": row.scheduled_end_at.isoformat() if row.scheduled_end_at else None,
        "actual_first_activity_at": row.actual_first_activity_at.isoformat()
        if row.actual_first_activity_at
        else None,
        "actual_last_activity_at": row.actual_last_activity_at.isoformat()
        if row.actual_last_activity_at
        else None,
        "actual_sign_out_at": row.actual_sign_out_at.isoformat()
        if row.actual_sign_out_at
        else None,
        "is_running": bool(
            timeline["is_running"]
            if timeline is not None
            else calculation_sources.get("is_running", False)
        ),
        "continued_from_previous_day": bool(
            timeline.get("continued_from_previous_day", False)
            if timeline is not None
            else calculation_sources.get("continued_from_previous_day", False)
        ),
        "continued_session_started_at": (
            timeline.get("continued_session_started_at")
            if timeline is not None
            else calculation_sources.get("continued_session_started_at")
        ),
        "normal_worked_seconds": row.normal_worked_seconds,
        "paid_break_seconds": row.paid_break_seconds,
        "unpaid_break_seconds": row.unpaid_break_seconds,
        # Phase-1 financial-policy figures, surfaced for the dashboard timeline,
        # timesheets, and payroll review so every surface shows the same numbers.
        "paid_late_allowance_seconds": int(
            calculation_sources.get("paid_late_allowance_seconds", 0)
        ),
        "worked_break_seconds": int(calculation_sources.get("worked_break_seconds", 0)),
        "earned_break_credit_seconds": int(
            calculation_sources.get("earned_break_credit_seconds", 0)
        ),
        "approved_delayed_break_seconds": int(
            calculation_sources.get("approved_delayed_break_seconds", 0)
        ),
        "reserved_break_credit_seconds": int(
            calculation_sources.get("reserved_break_credit_seconds", 0)
        ),
        "remaining_break_credit_seconds": int(
            calculation_sources.get("remaining_break_credit_seconds", 0)
        ),
        "approved_meeting_seconds": int(calculation_sources.get("approved_meeting_seconds", 0)),
        "pending_meeting_seconds": int(calculation_sources.get("pending_meeting_seconds", 0)),
        "financial_policy_active": bool(calculation_sources.get("financial_policy_active", False)),
        "recorded_idle_seconds": max(
            0,
            int(calculation_sources.get("raw_idle_seconds", row.idle_seconds)),
        ),
        "paid_idle_grace_seconds": max(
            0,
            int(calculation_sources.get("paid_idle_grace_seconds", 0)),
        ),
        "idle_seconds": row.idle_seconds,
        "approved_manual_seconds": row.approved_manual_seconds,
        "pending_manual_seconds": row.pending_manual_seconds,
        "rejected_manual_seconds": row.rejected_manual_seconds,
        "raw_late_seconds": row.raw_late_seconds,
        "deductible_late_seconds": row.deductible_late_seconds,
        "early_leave_seconds": row.early_leave_seconds,
        "pre_shift_extra_seconds": row.pre_shift_extra_seconds,
        "post_shift_extra_seconds": row.post_shift_extra_seconds,
        "recorded_overtime_seconds": row.recorded_overtime_seconds,
        "approved_overtime_seconds": row.approved_overtime_seconds,
        "unapproved_overtime_seconds": row.unapproved_overtime_seconds,
        "total_payable_seconds": row.total_payable_seconds,
        "status": row.status,
        "leave_status": row.leave_status,
        "approved_early_leave_seconds": int(
            calculation_sources.get("approved_early_leave_seconds", 0)
        ),
        "attendance_adjustment_seconds": int(
            calculation_sources.get("attendance_adjustment_seconds", 0)
        ),
        "attendance_correction": (
            {
                "id": calculation_sources.get("attendance_correction_id"),
                "reason": calculation_sources.get("attendance_correction_reason"),
                "raw_first_activity_at": calculation_sources.get("raw_first_activity_at"),
                "raw_last_activity_at": calculation_sources.get("raw_last_activity_at"),
            }
            if calculation_sources.get("attendance_correction_id")
            else None
        ),
        "issues": row.issues or [],
        "calculation_sources": row.calculation_sources or {},
        "calculated_at": row.calculated_at.isoformat(),
    }
    if timeline is not None:
        result["timeline"] = timeline
    return result


def accountable_idle_seconds(row: DailyAttendance) -> int:
    """Idle recorded inside an attendance obligation before grace/deductions."""
    sources = row.calculation_sources or {}
    return max(0, int(sources.get("raw_idle_seconds", row.idle_seconds)))


def accountable_idle_totals(
    db: Session,
    *,
    company_id: UUID,
    employee_ids: set[UUID] | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict[UUID, int]:
    statement = select(DailyAttendance).where(DailyAttendance.company_id == company_id)
    if employee_ids is not None:
        if not employee_ids:
            return {}
        statement = statement.where(DailyAttendance.employee_id.in_(employee_ids))
    if start_date is not None:
        statement = statement.where(DailyAttendance.work_date >= start_date)
    if end_date is not None:
        statement = statement.where(DailyAttendance.work_date <= end_date)

    totals: dict[UUID, int] = {}
    for row in db.scalars(statement).all():
        totals[row.employee_id] = totals.get(row.employee_id, 0) + accountable_idle_seconds(row)
    return totals


def current_idle_context(
    db: Session,
    *,
    employee: Employee,
    now: datetime | None = None,
) -> Literal["accountable", "on_break", "off_shift"]:
    """Classify a live non-working device state against the employee schedule."""
    return current_idle_contexts(db, employees=[employee], now=now).get(
        employee.id,
        "off_shift",
    )


def current_idle_contexts(
    db: Session,
    *,
    employees: list[Employee],
    now: datetime | None = None,
    memberships_by_employee: dict[UUID, list[UUID]] | None = None,
) -> dict[UUID, Literal["accountable", "on_break", "off_shift"]]:
    """Classify many live idle employees without rebuilding their timelines."""
    if not employees:
        return {}

    at = _utc(now or datetime.now(UTC))
    employee_ids = [employee.id for employee in employees]
    profiles = {
        profile.employee_id: profile
        for profile in db.scalars(
            select(EmployeeWorkProfile)
            .options(
                load_only(
                    EmployeeWorkProfile.id,
                    EmployeeWorkProfile.company_id,
                    EmployeeWorkProfile.employee_id,
                    EmployeeWorkProfile.shift_start,
                    EmployeeWorkProfile.shift_end,
                    EmployeeWorkProfile.working_days,
                    EmployeeWorkProfile.weekly_off_days,
                    EmployeeWorkProfile.break_rules,
                )
            )
            .where(EmployeeWorkProfile.employee_id.in_(employee_ids))
        ).all()
    }
    for employee in employees:
        if employee.id not in profiles:
            profiles[employee.id] = get_or_create_work_profile(db, employee)

    work_date_by_employee = {
        employee.id: local_today(employee.timezone, at) for employee in employees
    }
    schedules = {}
    for work_date in set(work_date_by_employee.values()):
        day_employees = [
            employee for employee in employees if work_date_by_employee[employee.id] == work_date
        ]
        schedules.update(
            effective_schedules_for_employees(
                db,
                day_employees,
                work_date,
                profiles=profiles,
                memberships_by_employee=memberships_by_employee,
            )
        )

    min_date = min(work_date_by_employee.values())
    max_date = max(work_date_by_employee.values())
    approved_leave_employee_ids = {
        leave.employee_id
        for leave in db.scalars(
            select(LeaveRequest).where(
                LeaveRequest.employee_id.in_(employee_ids),
                LeaveRequest.status == "approved",
                LeaveRequest.start_date <= max_date,
                LeaveRequest.end_date >= min_date,
            )
        ).all()
        if leave.start_date
        <= work_date_by_employee.get(leave.employee_id, min_date)
        <= leave.end_date
    }

    contexts: dict[UUID, Literal["accountable", "on_break", "off_shift"]] = {}
    for employee in employees:
        schedule = schedules[employee.id]
        shift_start = schedule["start_at"]
        shift_end = schedule["end_at"]
        if (
            employee.id in approved_leave_employee_ids
            or shift_start is None
            or shift_end is None
            or not (shift_start <= at < shift_end)
        ):
            contexts[employee.id] = "off_shift"
            continue
        if any(item["start_at"] <= at < item["end_at"] for item in schedule["breaks"]):
            contexts[employee.id] = "on_break"
            continue
        contexts[employee.id] = "accountable"
    return contexts


def is_currently_accountable_idle(
    db: Session,
    *,
    employee: Employee,
    now: datetime | None = None,
) -> bool:
    """Whether the current non-working device state is accountable attendance idle."""
    return current_idle_context(db, employee=employee, now=now) == "accountable"


def refresh_daily_attendance_range(
    db: Session,
    *,
    employee: Employee,
    start_date: date,
    end_date: date,
    now: datetime | None = None,
) -> list[DailyAttendance]:
    """Rebuild derived attendance immediately after an HR source decision."""
    # Never materialize attendance after an archived employee's last working day.
    end_date = cap_to_employment_end(employee, end_date)
    if end_date < start_date:
        return []
    rows: list[DailyAttendance] = []
    cursor = start_date
    while cursor <= end_date:
        row, _ = calculate_daily_attendance(
            db,
            employee=employee,
            work_date=cursor,
            now=now,
        )
        rows.append(row)
        cursor = date.fromordinal(cursor.toordinal() + 1)
    return rows
