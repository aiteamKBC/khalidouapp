from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    AttendanceCorrection,
    DailyAttendance,
    Employee,
    LeaveRequest,
    OvertimeRecord,
    TimeAdjustmentRequest,
    WorkSession,
)
from app.services.activity_timeline import build_workday_timeline, local_today
from app.services.schedules import effective_schedule, overlap_seconds
from app.services.work_profiles import get_or_create_work_profile

DAILY_PAID_IDLE_GRACE_SECONDS = 15 * 60


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _parsed(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def cached_daily_attendance(
    db: Session,
    *,
    employee: Employee,
    work_date: date,
    now: datetime | None = None,
    max_age_seconds: int = 30,
) -> tuple[DailyAttendance, dict | None]:
    """Return a recent materialized day, recalculating only when needed.

    Closed days are immutable unless another workflow explicitly recalculates
    them after an approval or schedule change. The current day is refreshed at
    a short, bounded interval so dashboard polling does not rebuild every
    employee timeline on every request.
    """
    at = _utc(now or datetime.now(UTC))
    row = db.scalar(
        select(DailyAttendance).where(
            DailyAttendance.company_id == employee.company_id,
            DailyAttendance.employee_id == employee.id,
            DailyAttendance.work_date == work_date,
        )
    )
    employee_today = local_today(employee.timezone or "UTC", at)
    if row is not None and work_date < employee_today:
        return row, None
    if row is not None and row.calculated_at is not None:
        age = max(0, int((at - _utc(row.calculated_at)).total_seconds()))
        if age < max_age_seconds:
            return row, None
    return calculate_daily_attendance(
        db,
        employee=employee,
        work_date=work_date,
        now=at,
    )


def calculate_daily_attendance(
    db: Session,
    *,
    employee: Employee,
    work_date: date,
    now: datetime | None = None,
    persist: bool = True,
) -> tuple[DailyAttendance, dict]:
    profile = get_or_create_work_profile(db, employee)
    schedule = effective_schedule(db, employee, profile, work_date)
    timeline = build_workday_timeline(
        db,
        company_id=employee.company_id,
        employee_id=employee.id,
        timezone_name=schedule["timezone"],
        target_date=work_date,
        now=now,
    )
    start_at = schedule["start_at"]
    end_at = schedule["end_at"]
    intervals = []
    for item in timeline["intervals"]:
        item_start = _parsed(item["started_at"])
        item_end = _parsed(item["ended_at"]) or _utc(now or datetime.now(UTC))
        if item_start and item_end > item_start:
            intervals.append((item, _utc(item_start), _utc(item_end)))

    activity_intervals = [item for item in intervals if item[0]["type"] in {"worked", "idle"}]
    raw_first_at = min((item[1] for item in activity_intervals), default=None)
    raw_last_at = max((item[2] for item in activity_intervals), default=None)
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
        else raw_first_at
    )
    last_at = (
        _utc(correction.corrected_end_at)
        if correction and correction.corrected_end_at
        else raw_last_at
    )
    session_ids = {UUID(item[0]["session_id"]) for item in intervals if item[0].get("session_id")}
    actual_sign_out_at = None
    if session_ids:
        actual_sign_out_at = db.scalar(
            select(WorkSession.ended_at)
            .where(WorkSession.id.in_(session_ids), WorkSession.ended_at.is_not(None))
            .order_by(WorkSession.ended_at.desc())
            .limit(1)
        )
    normal_worked = 0
    pre_shift_extra = 0
    post_shift_extra = 0
    eligible_idle = 0
    manual_pause_idle = 0
    for item, interval_start, interval_end in intervals:
        if item["type"] == "worked":
            if start_at and end_at:
                worked_in_shift = overlap_seconds(interval_start, interval_end, start_at, end_at)
                # Breaks are reported separately. Active input during a scheduled break
                # must not make the same minute appear in both worked and break totals.
                for scheduled_break in schedule["breaks"]:
                    worked_in_shift -= overlap_seconds(
                        interval_start,
                        interval_end,
                        scheduled_break["start_at"],
                        scheduled_break["end_at"],
                    )
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

    adjustments = db.scalars(
        select(TimeAdjustmentRequest).where(
            TimeAdjustmentRequest.company_id == employee.company_id,
            TimeAdjustmentRequest.employee_id == employee.id,
            TimeAdjustmentRequest.requested_date == work_date,
        )
    ).all()
    approved_manual = sum(
        int(row.approved_seconds or row.requested_seconds)
        for row in adjustments
        if row.status == "approved" and row.request_type != "early_leave"
    )
    pending_manual = sum(
        int(row.requested_seconds) for row in adjustments if row.status == "pending"
    )
    rejected_manual = sum(
        int(row.requested_seconds) for row in adjustments if row.status == "rejected"
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

    paid_break = 0
    unpaid_break = 0
    if first_at and last_at:
        for scheduled_break in schedule["breaks"]:
            attended_break_seconds = overlap_seconds(
                first_at,
                last_at,
                scheduled_break["start_at"],
                scheduled_break["end_at"],
            )
            if scheduled_break["paid"]:
                paid_break += attended_break_seconds
            else:
                unpaid_break += attended_break_seconds
    attended = bool(activity_intervals or approved_manual or correction)

    raw_late = (
        max(0, int((first_at - start_at).total_seconds()))
        if first_at and start_at and not leave
        else 0
    )
    deductible_late = max(0, raw_late - int(profile.late_grace_minutes or 0) * 60)
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
        if last_at and effective_expected_end and not leave
        else 0
    )
    raw_eligible_idle = eligible_idle
    automatic_idle = max(0, raw_eligible_idle - manual_pause_idle)
    paid_idle_grace = min(automatic_idle, DAILY_PAID_IDLE_GRACE_SECONDS)
    deductible_idle = manual_pause_idle + max(0, automatic_idle - paid_idle_grace)

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
    expected_seconds = int((end_at - start_at).total_seconds()) if start_at and end_at else 0
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
            + approved_early_leave_seconds,
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
    if deductible_idle:
        issues.append({"code": "unexplained_idle", "seconds": deductible_idle})
    if unapproved_overtime:
        issues.append({"code": "overtime_pending", "seconds": unapproved_overtime})
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
        status = "off_day" if not attended else "worked_off_day"
    elif not attended:
        employee_today = local_today(schedule["timezone"], now)
        status = "not_started" if work_date >= employee_today else "absent"
    elif deductible_late:
        status = "late"
    elif early_leave:
        status = "left_early"
    else:
        status = "present"

    row = db.scalar(
        select(DailyAttendance).where(
            DailyAttendance.company_id == employee.company_id,
            DailyAttendance.employee_id == employee.id,
            DailyAttendance.work_date == work_date,
        )
    )
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
        "actual_first_activity_at": first_at,
        "actual_last_activity_at": last_at,
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
            "session_ids": sorted({item[0]["session_id"] for item in intervals}),
            "adjustment_ids": [str(item.id) for item in adjustments],
            "overtime_ids": [str(item.id) for item in overtime_rows],
            "leave_request_id": str(leave.id) if leave else None,
            "approved_early_leave_seconds": approved_early_leave_seconds,
            "schedule_override_id": schedule["override_id"],
            "attendance_correction_id": str(correction.id) if correction else None,
            "attendance_adjustment_seconds": attendance_adjustment_seconds,
            "attendance_correction_reason": correction.reason if correction else None,
            "raw_idle_seconds": raw_eligible_idle,
            "manual_pause_seconds": manual_pause_idle,
            "paid_idle_grace_seconds": paid_idle_grace,
            "raw_first_activity_at": raw_first_at.isoformat() if raw_first_at else None,
            "raw_last_activity_at": raw_last_at.isoformat() if raw_last_at else None,
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
        "actual_sign_out_at": row.actual_sign_out_at.isoformat() if row.actual_sign_out_at else None,
        "normal_worked_seconds": row.normal_worked_seconds,
        "paid_break_seconds": row.paid_break_seconds,
        "unpaid_break_seconds": row.unpaid_break_seconds,
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
            (row.calculation_sources or {}).get("approved_early_leave_seconds", 0)
        ),
        "attendance_adjustment_seconds": int(
            (row.calculation_sources or {}).get("attendance_adjustment_seconds", 0)
        ),
        "attendance_correction": (
            {
                "id": (row.calculation_sources or {}).get("attendance_correction_id"),
                "reason": (row.calculation_sources or {}).get(
                    "attendance_correction_reason"
                ),
                "raw_first_activity_at": (row.calculation_sources or {}).get(
                    "raw_first_activity_at"
                ),
                "raw_last_activity_at": (row.calculation_sources or {}).get(
                    "raw_last_activity_at"
                ),
            }
            if (row.calculation_sources or {}).get("attendance_correction_id")
            else None
        ),
        "issues": row.issues or [],
        "calculation_sources": row.calculation_sources or {},
        "calculated_at": row.calculated_at.isoformat(),
    }
    if timeline is not None:
        result["timeline"] = timeline
    return result


def refresh_daily_attendance_range(
    db: Session,
    *,
    employee: Employee,
    start_date: date,
    end_date: date,
    now: datetime | None = None,
) -> list[DailyAttendance]:
    """Rebuild derived attendance immediately after an HR source decision."""
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
