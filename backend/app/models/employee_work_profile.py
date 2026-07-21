from datetime import datetime, time
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, Numeric, String, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class EmployeeWorkProfile(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "employee_work_profiles"
    __table_args__ = (
        UniqueConstraint("employee_id", name="uq_employee_work_profiles_employee"),
    )

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    employee_id: Mapped[UUID] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    shift_start: Mapped[time | None] = mapped_column(Time(), nullable=True)
    shift_end: Mapped[time | None] = mapped_column(Time(), nullable=True)
    working_days: Mapped[list[int] | None] = mapped_column(JSON, nullable=True)
    weekly_off_days: Mapped[list[int] | None] = mapped_column(JSON, nullable=True)
    required_daily_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    break_rules: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    late_grace_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    no_show_threshold_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    schedule_type: Mapped[str] = mapped_column(String(20), nullable=False, default="fixed")
    weekly_early_leave_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=120)
    deduction_policy: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    overtime_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    overtime_basis: Mapped[str | None] = mapped_column(String(40), nullable=True)
    overtime_rate_multiplier: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    salary_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    salary_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    salary_type: Mapped[str] = mapped_column(String(20), nullable=False, default="monthly")
    profile_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    employee = relationship("Employee", back_populates="work_profile")
