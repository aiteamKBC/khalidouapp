from datetime import date, datetime, time
from uuid import UUID

from sqlalchemy import Date, DateTime, ForeignKey, Index, String, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class ShiftRescheduleRequest(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A one-day move of an employee's shift to a same-length time range.

    The row is the request/review workflow and audit record. Once approved, the
    new range is materialized as an employee-scoped, non-permanent
    ``WorkScheduleOverride`` (``schedule_override_id``) so every schedule
    resolver (attendance, session buckets, desktop config, payroll) honors it.
    """

    __tablename__ = "shift_reschedule_requests"
    __table_args__ = (
        Index(
            "ix_shift_reschedules_company_employee_date_status",
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
    # Employee-local calendar day being rescheduled.
    work_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    requested_start: Mapped[time] = mapped_column(Time(), nullable=False)
    requested_end: Mapped[time] = mapped_column(Time(), nullable=False)
    # The normal shift for that day when the request was made (audit snapshot).
    original_start: Mapped[time] = mapped_column(Time(), nullable=False)
    original_end: Mapped[time] = mapped_column(Time(), nullable=False)
    reason: Mapped[str] = mapped_column(String(1000), nullable=False)
    # pending | approved | rejected | cancelled | expired
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    # employee (desktop request) | admin (emergency, auto-approved)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="employee")
    created_by_admin_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("admin_users.id"), nullable=True, index=True
    )
    reviewed_by_admin_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("admin_users.id"), nullable=True, index=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_reason: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    schedule_override_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("work_schedule_overrides.id", ondelete="SET NULL"), nullable=True
    )

    employee = relationship("Employee")
    reviewed_by = relationship("AdminUser", foreign_keys=[reviewed_by_admin_user_id])
    created_by = relationship("AdminUser", foreign_keys=[created_by_admin_user_id])
