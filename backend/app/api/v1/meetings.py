from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import exists, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_admin
from app.api.v1.team_auth import apply_employee_scope, ensure_employee_access
from app.core.exceptions import ApiError
from app.core.responses import success_response
from app.database.session import get_db
from app.models import AdminUser, Employee, MeetingRecord, Screenshot, TeamOwner
from app.services.attendance import refresh_daily_attendance_range
from app.services.employee_archive import current_employee_clause
from app.services.audit import record_audit_log
from app.services.meetings import auto_end_due_meetings, review_meeting, serialize_meeting
from app.services.permissions import has_company_data_scope, is_super_admin

router = APIRouter(prefix="/meetings", tags=["meetings"])

# Screenshot rows that are actually viewable in the review grid.
VIEWABLE_SCREENSHOT_STATUSES = ("uploaded", "completed")


class MeetingReview(BaseModel):
    status: Literal["approved", "rejected"]
    approved_minutes: int | None = Field(default=None, ge=0, le=1440)
    admin_note: str | None = Field(default=None, max_length=1000)


def _require_meeting_reviewer(db: Session, admin: AdminUser) -> None:
    """Meeting review is open to the Super Admin, company-scope admins (General
    Admin / HR), and team leaders.

    A team leader only sees and decides their own team's meetings — the row-level
    scope in ``apply_employee_scope`` and the per-meeting ``ensure_employee_access``
    below enforce that. Here we only gate who may reach the review surface at all.
    """
    if is_super_admin(admin) or has_company_data_scope(admin):
        return
    owns_team = db.scalar(select(exists().where(TeamOwner.admin_user_id == admin.id)))
    if owns_team:
        return
    raise ApiError(
        "MEETING_REVIEW_FORBIDDEN",
        "Only an administrator, HR, or a team leader can review meetings.",
        403,
    )


@router.get("")
def list_meetings(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    status: str | None = None,
    employee_id: UUID | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
):
    _require_meeting_reviewer(db, current_admin)
    auto_end_due_meetings(db, company_id=current_admin.company_id)
    statement = (
        select(MeetingRecord)
        .options(
            selectinload(MeetingRecord.employee),
            selectinload(MeetingRecord.device),
            selectinload(MeetingRecord.project),
            selectinload(MeetingRecord.task),
            selectinload(MeetingRecord.reviewed_by),
        )
        .join(Employee, Employee.id == MeetingRecord.employee_id)
        .where(MeetingRecord.company_id == current_admin.company_id)
        .order_by(MeetingRecord.started_at.desc())
    )
    statement = apply_employee_scope(
        statement,
        db,
        current_admin,
        MeetingRecord.employee_id,
    )
    if status is not None:
        statement = statement.where(MeetingRecord.status == status)
    if employee_id is not None:
        statement = statement.where(MeetingRecord.employee_id == employee_id)
    else:
        statement = statement.where(current_employee_clause())
    rows = db.scalars(
        statement.offset((page - 1) * page_size).limit(page_size)
    ).all()
    return success_response(data=[serialize_meeting(row) for row in rows])


@router.patch("/{meeting_id}")
def review_meeting_endpoint(
    meeting_id: UUID,
    payload: MeetingReview,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    _require_meeting_reviewer(db, current_admin)
    meeting = db.scalar(
        select(MeetingRecord).where(
            MeetingRecord.id == meeting_id,
            MeetingRecord.company_id == current_admin.company_id,
        ).with_for_update()
    )
    if meeting is None:
        raise ApiError("MEETING_NOT_FOUND", "Meeting was not found.", 404)
    # Enforce tenant/team scope and existing self-review rules.
    employee = ensure_employee_access(db, current_admin, meeting.employee_id)
    if current_admin.employee_id == meeting.employee_id and not is_super_admin(current_admin):
        raise ApiError("SELF_REVIEW_FORBIDDEN", "You cannot review your own meeting.", 403)

    review_meeting(
        db,
        admin=current_admin,
        meeting=meeting,
        status=payload.status,
        approved_seconds=payload.approved_minutes * 60 if payload.approved_minutes is not None else None,
        note=payload.admin_note,
    )
    # Refresh the affected day so attendance and draft payroll reflect the
    # decision consistently (approved meeting paid once; rejected reverts).
    refresh_daily_attendance_range(
        db,
        employee=employee,
        start_date=meeting.work_date,
        end_date=meeting.work_date,
        now=datetime.now(UTC),
    )
    record_audit_log(
        db,
        current_admin,
        payload.status,
        "meeting_record",
        entity_id=meeting.id,
        entity_name=meeting.title,
        details={"approved_seconds": meeting.approved_seconds},
    )
    db.commit()
    db.refresh(meeting)
    return success_response(data=serialize_meeting(meeting))


@router.get("/{meeting_id}/screenshots")
def meeting_screenshots(
    meeting_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Existing screenshots captured during a meeting's recorded window.

    Reuses screenshots the desktop agent already captured — it never triggers a
    new capture. Returns every viewable screenshot whose ``captured_at`` falls
    between the meeting's start and its end (or expected end while still active),
    so a reviewer can inspect the period before deciding.
    """
    # Import locally to avoid an api-module import cycle.
    from app.api.v1.screenshots import serialize_with_url

    _require_meeting_reviewer(db, current_admin)
    meeting = db.scalar(
        select(MeetingRecord).where(
            MeetingRecord.id == meeting_id,
            MeetingRecord.company_id == current_admin.company_id,
        )
    )
    if meeting is None:
        raise ApiError("MEETING_NOT_FOUND", "Meeting was not found.", 404)
    ensure_employee_access(db, current_admin, meeting.employee_id)

    window_end = meeting.ended_at or meeting.expected_end_at
    rows = db.scalars(
        select(Screenshot)
        .where(
            Screenshot.company_id == current_admin.company_id,
            Screenshot.employee_id == meeting.employee_id,
            Screenshot.deleted_at.is_(None),
            Screenshot.status.in_(VIEWABLE_SCREENSHOT_STATUSES),
            Screenshot.captured_at >= meeting.started_at,
            Screenshot.captured_at <= window_end,
        )
        .order_by(Screenshot.captured_at.asc())
    ).all()
    return success_response(data=[serialize_with_url(row) for row in rows])
