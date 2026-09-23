"""Desktop Meeting Mode: bounded meeting periods for Admin/HR review.

Meetings are started and ended on the desktop, saved locally first, and
delivered/replayed idempotently by a stable ``idempotency_key``. The recorded
period is provisional (``status="pending"``) until an authorized Admin or HR
reviewer approves or rejects it. Approval pays the covered in-shift time once;
rejection reverts to the underlying activity/idle evidence. No meeting overtime
in this milestone.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.exceptions import ApiError
from app.models import Device, Employee, MeetingRecord, Project, Task, TeamMember, WorkSession
from app.services.activity_timeline import local_today
from app.services.schedules import effective_schedule
from app.services.work_profiles import get_or_create_work_profile

ACTIVE_STATE = "active"
ENDED_STATE = "ended"
MAX_TITLE = 255
MAX_REASON = 1000


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _shift_end_for(db: Session, employee: Employee, work_date: date, timezone_name: str) -> datetime | None:
    profile = get_or_create_work_profile(db, employee)
    schedule = effective_schedule(db, employee, profile, work_date, timezone_name=timezone_name)
    return schedule["end_at"]


def start_meeting(
    db: Session,
    *,
    device: Device,
    title: str,
    reason: str,
    expected_end_at: datetime,
    idempotency_key: str,
    claimed_device_id: UUID | None = None,
    started_at: datetime | None = None,
    work_session_id: UUID | None = None,
    project_id: UUID | None = None,
    task_id: UUID | None = None,
) -> MeetingRecord:
    if claimed_device_id is not None and claimed_device_id != device.id:
        raise ApiError(
            "MEETING_DEVICE_MISMATCH",
            "This queued meeting belongs to a different device enrollment.",
            403,
        )
    employee = db.get(Employee, device.employee_id)
    if employee is None:
        raise ApiError("EMPLOYEE_NOT_FOUND", "Employee profile was not found.", 404)
    title = (title or "").strip()
    reason = (reason or "").strip()
    if not title:
        raise ApiError("MEETING_TITLE_REQUIRED", "A meeting title is required.", 422)
    if len(reason) < 3:
        raise ApiError("MEETING_REASON_REQUIRED", "Describe the meeting reason.", 422)

    # Serialize starts for one employee so two devices cannot both pass the
    # overlap check before either row is committed.
    db.execute(select(Employee.id).where(Employee.id == employee.id).with_for_update())

    # Idempotent replay: the same client id always maps to the same row, so a
    # retry or restart never creates a duplicate meeting.
    existing = db.scalar(
        select(MeetingRecord).where(
            MeetingRecord.company_id == device.company_id,
            MeetingRecord.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        if existing.employee_id != device.employee_id or existing.device_id != device.id:
            raise ApiError(
                "MEETING_IDEMPOTENCY_CONFLICT",
                "This meeting identifier belongs to a different employee or device.",
                409,
            )
        return existing

    started = _as_utc(started_at or datetime.now(UTC))
    expected_end = _as_utc(expected_end_at)
    if expected_end <= started:
        raise ApiError("INVALID_MEETING_END", "Expected end must be after the start.", 422)

    timezone_name = device.timezone or employee.timezone or "UTC"
    work_date = local_today(timezone_name, started)
    shift_end = _shift_end_for(db, employee, work_date, timezone_name)
    # End automatically at the expected end or shift end, whichever comes first;
    # a forgotten meeting can never run past the shift.
    if shift_end is not None:
        expected_end = min(expected_end, shift_end)
    if expected_end <= started:
        raise ApiError(
            "MEETING_OUTSIDE_SHIFT",
            "The meeting would end before it starts within the scheduled shift.",
            422,
        )

    if work_session_id is not None:
        session = db.scalar(
            select(WorkSession).where(
                WorkSession.id == work_session_id,
                WorkSession.company_id == device.company_id,
                WorkSession.employee_id == device.employee_id,
                WorkSession.device_id == device.id,
            )
        )
        if session is None:
            raise ApiError(
                "MEETING_SESSION_FORBIDDEN",
                "The selected work session does not belong to this device.",
                403,
            )
    if project_id is not None:
        project = db.scalar(
            select(Project)
            .join(TeamMember, TeamMember.team_id == Project.team_id)
            .where(
                Project.id == project_id,
                Project.company_id == device.company_id,
                TeamMember.employee_id == device.employee_id,
                TeamMember.status == "active",
            )
        )
        if project is None:
            raise ApiError("MEETING_PROJECT_FORBIDDEN", "Project was not found.", 403)
    if task_id is not None:
        task = db.scalar(
            select(Task)
            .join(Project, Project.id == Task.project_id)
            .join(TeamMember, TeamMember.team_id == Project.team_id)
            .where(
                Task.id == task_id,
                Task.company_id == device.company_id,
                TeamMember.employee_id == device.employee_id,
                TeamMember.status == "active",
                or_(
                    Task.assignee_employee_id == device.employee_id,
                    Task.created_by_employee_id == device.employee_id,
                    Task.collaborators.any(Employee.id == device.employee_id),
                ),
            )
        )
        if task is None or (project_id is not None and task.project_id != project_id):
            raise ApiError("MEETING_TASK_FORBIDDEN", "Task was not found in this project.", 403)
        if project_id is None:
            project_id = task.project_id

    # Close an overdue prior meeting before checking overlap. This also lets a
    # device recover after it was offline past the expected end.
    auto_end_due_meetings(
        db,
        now=started,
        company_id=device.company_id,
        employee_id=device.employee_id,
    )

    # No overlapping recorded periods for the same employee. Check ended rows as
    # well as active rows because offline replay can arrive after a later meeting.
    overlapping_meeting = db.scalar(
        select(MeetingRecord).where(
            MeetingRecord.company_id == device.company_id,
            MeetingRecord.employee_id == device.employee_id,
            MeetingRecord.started_at < expected_end,
            func.coalesce(MeetingRecord.ended_at, MeetingRecord.expected_end_at) > started,
        )
    )
    if overlapping_meeting is not None:
        raise ApiError(
            "MEETING_ALREADY_ACTIVE",
            "End the current meeting before starting another.",
            409,
        )

    row = MeetingRecord(
        company_id=device.company_id,
        employee_id=device.employee_id,
        device_id=device.id,
        work_session_id=work_session_id,
        project_id=project_id,
        task_id=task_id,
        idempotency_key=idempotency_key,
        work_date=work_date,
        title=title[:MAX_TITLE],
        reason=reason[:MAX_REASON],
        started_at=started,
        expected_end_at=expected_end,
        lifecycle_state=ACTIVE_STATE,
        status="pending",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _resolve_meeting(db: Session, *, company_id: UUID, meeting_id: UUID | None, idempotency_key: str | None) -> MeetingRecord:
    statement = select(MeetingRecord).where(MeetingRecord.company_id == company_id)
    if meeting_id is not None:
        statement = statement.where(MeetingRecord.id == meeting_id)
    elif idempotency_key is not None:
        statement = statement.where(MeetingRecord.idempotency_key == idempotency_key)
    else:
        raise ApiError("MEETING_NOT_FOUND", "Meeting was not found.", 404)
    row = db.scalar(statement)
    if row is None:
        raise ApiError("MEETING_NOT_FOUND", "Meeting was not found.", 404)
    return row


def end_meeting(
    db: Session,
    *,
    device: Device,
    meeting_id: UUID | None = None,
    idempotency_key: str | None = None,
    claimed_device_id: UUID | None = None,
    ended_at: datetime | None = None,
) -> MeetingRecord:
    if claimed_device_id is not None and claimed_device_id != device.id:
        raise ApiError(
            "MEETING_DEVICE_MISMATCH",
            "This queued meeting belongs to a different device enrollment.",
            403,
        )
    row = _resolve_meeting(
        db, company_id=device.company_id, meeting_id=meeting_id, idempotency_key=idempotency_key
    )
    if row.employee_id != device.employee_id:
        raise ApiError("MEETING_FORBIDDEN", "This meeting belongs to another employee.", 403)
    # Idempotent: ending an already-ended meeting returns it unchanged, so a
    # replayed End never extends or duplicates the period. The one exception is
    # a meeting the server auto-ended at its expected end while the device's real
    # (earlier) End was still offline: that genuine end may shorten the still
    # unreviewed meeting, never lengthen it.
    if row.lifecycle_state == ENDED_STATE:
        auto_ended = row.ended_at is not None and _as_utc(row.ended_at) == _as_utc(
            row.expected_end_at
        )
        if ended_at is not None and auto_ended and row.status == "pending":
            client_end = max(_as_utc(ended_at), _as_utc(row.started_at))
            if client_end < _as_utc(row.ended_at):
                row.ended_at = client_end
                db.add(row)
                db.commit()
                db.refresh(row)
        return row
    ended = _as_utc(ended_at or datetime.now(UTC))
    # Bound the end: never before the start, never past the expected end (which
    # already respects the shift end). Forgotten meetings after sleep/crash close
    # at the expected end rather than inventing worked time.
    ended = max(ended, _as_utc(row.started_at))
    ended = min(ended, _as_utc(row.expected_end_at))
    row.ended_at = ended
    row.lifecycle_state = ENDED_STATE
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def auto_end_due_meetings(
    db: Session,
    *,
    now: datetime | None = None,
    company_id: UUID | None = None,
    employee_id: UUID | None = None,
) -> int:
    """Close any active meeting whose expected end has passed. Returns the count."""
    at = _as_utc(now or datetime.now(UTC))
    statement = select(MeetingRecord).where(
            MeetingRecord.lifecycle_state == ACTIVE_STATE,
            MeetingRecord.expected_end_at <= at,
        )
    if company_id is not None:
        statement = statement.where(MeetingRecord.company_id == company_id)
    if employee_id is not None:
        statement = statement.where(MeetingRecord.employee_id == employee_id)
    due = db.scalars(statement).all()
    for row in due:
        row.ended_at = row.expected_end_at
        row.lifecycle_state = ENDED_STATE
        db.add(row)
    if due:
        db.commit()
    return len(due)


def review_meeting(
    db: Session,
    *,
    admin,
    meeting: MeetingRecord,
    status: str,
    approved_seconds: int | None,
    note: str | None,
) -> MeetingRecord:
    if status not in {"approved", "rejected"}:
        raise ApiError("INVALID_MEETING_DECISION", "Decision must be approved or rejected.", 422)
    if meeting.lifecycle_state != ENDED_STATE:
        raise ApiError(
            "MEETING_NOT_ENDED",
            "The meeting must end before it can be reviewed.",
            409,
        )
    if meeting.status != "pending":
        raise ApiError("MEETING_ALREADY_REVIEWED", "This meeting was already reviewed.", 409)
    recorded = recorded_meeting_seconds(meeting)
    if status == "approved":
        seconds = recorded if approved_seconds is None else max(0, min(int(approved_seconds), recorded))
        meeting.approved_seconds = seconds
    else:
        meeting.approved_seconds = 0
    meeting.status = status
    meeting.reviewed_by_admin_user_id = admin.id
    meeting.reviewed_at = datetime.now(UTC)
    meeting.admin_note = (note or None)
    db.add(meeting)
    db.flush()
    return meeting


def recorded_meeting_seconds(meeting: MeetingRecord) -> int:
    if meeting.ended_at is None:
        return 0
    return max(0, int((_as_utc(meeting.ended_at) - _as_utc(meeting.started_at)).total_seconds()))


def serialize_meeting(row: MeetingRecord) -> dict:
    return {
        "id": str(row.id),
        "employee_id": str(row.employee_id),
        "employee_name": row.employee.name if row.employee else "",
        # The desktop keeps a durable local record keyed by this idempotency key
        # and merges it with server rows; returning it lets the client dedupe a
        # locally-pending meeting against its confirmed server record.
        "idempotency_key": row.idempotency_key,
        "work_date": row.work_date.isoformat(),
        "title": row.title,
        "reason": row.reason,
        "device_name": row.device.device_name if row.device else None,
        "work_session_id": str(row.work_session_id) if row.work_session_id else None,
        "project_id": str(row.project_id) if row.project_id else None,
        "project_name": row.project.name if row.project else None,
        "task_id": str(row.task_id) if row.task_id else None,
        "task_name": row.task.name if row.task else None,
        "started_at": _as_utc(row.started_at).isoformat(),
        "expected_end_at": _as_utc(row.expected_end_at).isoformat(),
        "ended_at": _as_utc(row.ended_at).isoformat() if row.ended_at else None,
        "lifecycle_state": row.lifecycle_state,
        "status": row.status,
        "recorded_seconds": recorded_meeting_seconds(row),
        "approved_seconds": row.approved_seconds,
        "reviewed_by_name": row.reviewed_by.name if row.reviewed_by else None,
        "reviewed_at": _as_utc(row.reviewed_at).isoformat() if row.reviewed_at else None,
        "admin_note": row.admin_note,
    }
