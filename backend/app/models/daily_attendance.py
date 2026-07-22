from datetime import date, datetime
from uuid import UUID

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class DailyAttendance(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Stored, auditable attendance result for one employee calendar day."""

    __tablename__ = "daily_attendance"
    __table_args__ = (
        UniqueConstraint(
            "company_id", "employee_id", "work_date", name="uq_daily_attendance_employee_day"
        ),
        Index("ix_daily_attendance_company_day_status", "company_id", "work_date", "status"),
        Index("ix_daily_attendance_employee_day", "employee_id", "work_date"),
    )

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), nullable=False)
    employee_id: Mapped[UUID] = mapped_column(ForeignKey("employees.id"), nullable=False)
    work_date: Mapped[date] = mapped_column(Date, nullable=False)
    timezone: Mapped[str] = mapped_column(String(80), nullable=False, default="UTC")
    scheduled_start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    scheduled_end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    actual_first_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    actual_last_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    actual_sign_out_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    normal_worked_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    paid_break_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unpaid_break_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    idle_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    approved_manual_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pending_manual_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rejected_manual_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    raw_late_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deductible_late_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    early_leave_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pre_shift_extra_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    post_shift_extra_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    recorded_overtime_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    approved_overtime_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unapproved_overtime_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_payable_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="not_started")
    leave_status: Mapped[str | None] = mapped_column(String(40))
    issues: Mapped[list[dict] | None] = mapped_column(JSON)
    calculation_sources: Mapped[dict | None] = mapped_column(JSON)
    calculated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
