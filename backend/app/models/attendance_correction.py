from datetime import date, datetime
from uuid import UUID

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class AttendanceCorrection(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Explicit HR correction layered over immutable tracking evidence."""

    __tablename__ = "attendance_corrections"
    __table_args__ = (
        UniqueConstraint(
            "company_id",
            "employee_id",
            "work_date",
            name="uq_attendance_corrections_employee_day",
        ),
    )

    company_id: Mapped[UUID] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_id: Mapped[UUID] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    work_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    corrected_start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    corrected_end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    payable_seconds_delta: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by_admin_user_id: Mapped[UUID] = mapped_column(
        ForeignKey("admin_users.id"), nullable=False
    )
