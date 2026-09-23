from datetime import date, datetime
from uuid import UUID

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class MeetingRecord(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A desktop-initiated Meeting Mode period awaiting Admin/HR review.

    Start/end are raw source timestamps saved locally before delivery and
    replayed idempotently via ``idempotency_key``. Genuine activity, lock, and
    sleep evidence during the meeting is preserved on the session ledger; this
    row only overlays a review decision. No meeting overtime in this milestone.
    """

    __tablename__ = "meeting_records"
    __table_args__ = (
        UniqueConstraint(
            "company_id", "idempotency_key", name="uq_meeting_records_company_idempotency"
        ),
        Index(
            "ix_meeting_records_company_employee_date_status",
            "company_id",
            "employee_id",
            "work_date",
            "status",
        ),
    )

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    employee_id: Mapped[UUID] = mapped_column(
        ForeignKey("employees.id"), nullable=False, index=True
    )
    device_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("devices.id"), nullable=True, index=True
    )
    work_session_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("work_sessions.id"), nullable=True, index=True
    )
    project_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("projects.id"), nullable=True, index=True
    )
    task_id: Mapped[UUID | None] = mapped_column(ForeignKey("tasks.id"), nullable=True, index=True)
    idempotency_key: Mapped[str] = mapped_column(String(120), nullable=False)
    # Employee-local calendar day the meeting belongs to (for attendance keying).
    work_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    reason: Mapped[str] = mapped_column(String(1000), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expected_end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # active -> the meeting is still running; ended -> closed but awaiting review.
    lifecycle_state: Mapped[str] = mapped_column(
        String(20), nullable=False, default="active", index=True
    )
    # Review decision on the recorded period.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    approved_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reviewed_by_admin_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("admin_users.id"), nullable=True, index=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    admin_note: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    employee = relationship("Employee")
    device = relationship("Device")
    work_session = relationship("WorkSession")
    project = relationship("Project")
    task = relationship("Task")
    reviewed_by = relationship("AdminUser")
