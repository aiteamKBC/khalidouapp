from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.exceptions import ApiError
from app.models import Device, Employee, TimeAdjustmentRequest
from app.services.activity_timeline import build_workday_timeline
from app.services.session_tracking import get_current_session
from app.services.work_profiles import get_or_create_work_profile


IDLE_TIME_REQUEST = "idle_time"
EARLY_LEAVE_REQUEST = "early_leave"
MANUAL_TIME_REQUEST = "manual_time"
REVIEWABLE_STATUSES = {"pending", "approved"}


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def serialize_time_adjustment_request(row: TimeAdjustmentRequest) -> dict:
    return {
        "id": str(row.id),
        "company_id": str(row.company_id),
        "employee_id": str(row.employee_id),
        "employee_name": row.employee.name if row.employee else "",
        "device_id": str(row.device_id) if row.device_id else None,
        "work_session_id": str(row.work_session_id) if row.work_session_id else None,
        "request_type": row.request_type,
        "requested_date": row.requested_date.isoformat(),
        "source_start_at": row.source_start_at.isoformat() if row.source_start_at else None,
        "source_end_at": row.source_end_at.isoformat() if row.source_end_at else None,
        "requested_seconds": row.requested_seconds,
        "requested_minutes": round(row.requested_seconds / 60),
        "approved_seconds": row.approved_seconds,
        "approved_minutes": round(row.approved_seconds / 60) if row.approved_seconds else None,
        "reason": row.reason,
        "status": row.status,
        "reviewed_by_admin_user_id": str(row.reviewed_by_admin_user_id)
        if row.reviewed_by_admin_user_id
        else None,
        "reviewed_by_name": row.reviewed_by.name if row.reviewed_by else None,
        "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
        "admin_note": row.admin_note,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }


def create_employee_time_adjustment_request(
    db: Session,
    *,
    device: Device,
    requested_date: date,
    requested_minutes: int,
    reason: str,
    request_type: str = MANUAL_TIME_REQUEST,
    work_session_id: UUID | None = None,
    source_start_at: datetime | None = None,
    source_end_at: datetime | None = None,
    requested_leave_time: time | None = None,
) -> TimeAdjustmentRequest:
    requested_seconds = requested_minutes * 60
    employee = db.get(Employee, device.employee_id)
    if employee is None:
        raise ApiError("EMPLOYEE_NOT_FOUND", "Employee profile was not found.", 404)
    reason = reason.strip()
    if request_type == IDLE_TIME_REQUEST and len(reason) < 10:
        raise ApiError(
            "IDLE_DESCRIPTION_REQUIRED",
            "Write a clear description of what you were doing during this idle time.",
            422,
        )

    if request_type == EARLY_LEAVE_REQUEST:
        profile = get_or_create_work_profile(db, employee)
        weekly_allowance_seconds = max(0, int(profile.weekly_early_leave_minutes or 0)) * 60
        week_start = requested_date - timedelta(days=requested_date.weekday())
        week_end = week_start + timedelta(days=6)
        already_requested_seconds = (
            db.scalar(
                select(func.coalesce(func.sum(TimeAdjustmentRequest.requested_seconds), 0)).where(
                    TimeAdjustmentRequest.company_id == device.company_id,
                    TimeAdjustmentRequest.employee_id == device.employee_id,
                    TimeAdjustmentRequest.request_type == EARLY_LEAVE_REQUEST,
                    TimeAdjustmentRequest.requested_date >= week_start,
                    TimeAdjustmentRequest.requested_date <= week_end,
                    TimeAdjustmentRequest.status.in_(REVIEWABLE_STATUSES),
                )
            )
            or 0
        )
        remaining_weekly_seconds = max(0, weekly_allowance_seconds - already_requested_seconds)
        if requested_leave_time is not None:
            working_days = profile.working_days or [0, 1, 2, 3, 4]
            if requested_date.weekday() not in working_days:
                raise ApiError(
                    "EARLY_LEAVE_NON_WORKDAY",
                    "Early leave can only be requested for a scheduled working day.",
                    422,
                )
            if not profile.shift_start or not profile.shift_end:
                raise ApiError(
                    "SHIFT_NOT_CONFIGURED",
                    "Your scheduled shift must be configured before requesting early leave.",
                    422,
                )
            if not (profile.shift_start <= requested_leave_time < profile.shift_end):
                raise ApiError(
                    "INVALID_LEAVING_TIME",
                    "Requested leaving time must be inside your scheduled shift.",
                    422,
                )
            requested_seconds = (
                profile.shift_end.hour * 3600
                + profile.shift_end.minute * 60
                - requested_leave_time.hour * 3600
                - requested_leave_time.minute * 60
            )
            try:
                timezone = ZoneInfo(employee.timezone)
            except ZoneInfoNotFoundError:
                timezone = UTC
            source_start_at = datetime.combine(
                requested_date, requested_leave_time, tzinfo=timezone
            ).astimezone(UTC)
            source_end_at = datetime.combine(
                requested_date, profile.shift_end, tzinfo=timezone
            ).astimezone(UTC)
        if requested_seconds > remaining_weekly_seconds:
            raise ApiError(
                "EARLY_LEAVE_LIMIT_EXCEEDED",
                "The requested time is more than your remaining weekly early-leave balance.",
                422,
            )

    if request_type == IDLE_TIME_REQUEST:
        if not source_start_at or not source_end_at or not work_session_id:
            raise ApiError(
                "IDLE_SOURCE_REQUIRED",
                "Choose an idle period before requesting manual time.",
                422,
            )
        source_start_at = _as_utc(source_start_at)
        source_end_at = _as_utc(source_end_at)
        if source_end_at <= source_start_at:
            raise ApiError(
                "INVALID_IDLE_PERIOD", "Idle end time must be after the start time.", 422
            )

        timeline = build_workday_timeline(
            db,
            company_id=device.company_id,
            employee_id=device.employee_id,
            timezone_name=employee.timezone,
            target_date=requested_date,
        )
        matched_interval = None
        for interval in timeline["intervals"]:
            if interval["type"] != "idle" or interval["ended_at"] is None:
                continue
            if interval["session_id"] != str(work_session_id):
                continue
            interval_start = _as_utc(datetime.fromisoformat(interval["started_at"]))
            interval_end = _as_utc(datetime.fromisoformat(interval["ended_at"]))
            if (
                abs((interval_start - source_start_at).total_seconds()) <= 2
                and abs((interval_end - source_end_at).total_seconds()) <= 2
            ):
                matched_interval = interval
                break

        if matched_interval is None:
            raise ApiError(
                "IDLE_PERIOD_NOT_FOUND",
                "This idle period is no longer available for a request.",
                422,
            )

        profile = get_or_create_work_profile(db, employee)
        working_days = profile.working_days or [0, 1, 2, 3, 4]
        try:
            timezone = ZoneInfo(employee.timezone)
        except ZoneInfoNotFoundError:
            timezone = UTC
        local_start = source_start_at.astimezone(timezone)
        local_end = source_end_at.astimezone(timezone)
        if (
            requested_date.weekday() not in working_days
            or local_start.date() != requested_date
            or local_end.date() != requested_date
            or not profile.shift_start
            or not profile.shift_end
            or local_start.time().replace(tzinfo=None) < profile.shift_start
            or local_end.time().replace(tzinfo=None) > profile.shift_end
        ):
            raise ApiError(
                "IDLE_OUTSIDE_SCHEDULED_SHIFT",
                "Only idle periods fully inside your scheduled shift can be explained.",
                422,
            )

        already_requested_seconds = (
            db.scalar(
                select(func.coalesce(func.sum(TimeAdjustmentRequest.requested_seconds), 0)).where(
                    TimeAdjustmentRequest.company_id == device.company_id,
                    TimeAdjustmentRequest.employee_id == device.employee_id,
                    TimeAdjustmentRequest.request_type == IDLE_TIME_REQUEST,
                    TimeAdjustmentRequest.work_session_id == work_session_id,
                    TimeAdjustmentRequest.source_start_at == source_start_at,
                    TimeAdjustmentRequest.source_end_at == source_end_at,
                    TimeAdjustmentRequest.status.in_(REVIEWABLE_STATUSES),
                )
            )
            or 0
        )
        available_seconds = max(0, matched_interval["duration_seconds"] - already_requested_seconds)
        if requested_seconds > available_seconds:
            raise ApiError(
                "IDLE_REQUEST_TOO_LONG",
                "Requested idle time is more than the remaining available idle period.",
                422,
            )

    current_session = get_current_session(db, device)
    row = TimeAdjustmentRequest(
        company_id=device.company_id,
        employee_id=device.employee_id,
        device_id=device.id,
        work_session_id=work_session_id or (current_session.id if current_session else None),
        request_type=request_type,
        requested_date=requested_date,
        source_start_at=source_start_at,
        source_end_at=source_end_at,
        requested_seconds=requested_seconds,
        reason=reason,
        status="pending",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_time_adjustment_or_404(
    db: Session,
    company_id: UUID,
    request_id: UUID,
) -> TimeAdjustmentRequest:
    row = db.scalar(
        select(TimeAdjustmentRequest).where(
            TimeAdjustmentRequest.id == request_id,
            TimeAdjustmentRequest.company_id == company_id,
        )
    )
    if row is None:
        raise ApiError("TIME_ADJUSTMENT_NOT_FOUND", "Time adjustment request was not found.", 404)
    return row
