from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class PayrollRun(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "payroll_runs"
    __table_args__ = (
        UniqueConstraint("company_id", "month", name="uq_payroll_runs_company_month"),
    )

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    month: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="draft", index=True)
    created_by_admin_user_id: Mapped[UUID] = mapped_column(
        ForeignKey("admin_users.id"), nullable=False
    )
    approved_by_admin_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("admin_users.id"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    locked_by_admin_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("admin_users.id"), nullable=True
    )
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_by_admin_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("admin_users.id"), nullable=True
    )
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    entries = relationship("PayrollEntry", back_populates="run", cascade="all, delete-orphan")


class PayrollEntry(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "payroll_entries"
    __table_args__ = (
        UniqueConstraint("payroll_run_id", "employee_id", name="uq_payroll_entries_run_employee"),
    )

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    payroll_run_id: Mapped[UUID] = mapped_column(
        ForeignKey("payroll_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_id: Mapped[UUID] = mapped_column(
        ForeignKey("employees.id"), nullable=False, index=True
    )
    team_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    job_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    salary_type: Mapped[str] = mapped_column(String(20), nullable=False, default="monthly")
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    salary_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    hourly_rate: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False, default=0)
    expected_work_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    expected_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    worked_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    approved_manual_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pending_manual_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rejected_manual_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    idle_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    late_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    paid_break_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unpaid_break_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    absence_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    recorded_overtime_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    approved_overtime_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rejected_overtime_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    overtime_eligible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    deduct_lateness: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    lateness_deduction_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=0
    )
    lateness_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    deduct_idle: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    idle_deduction_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=0
    )
    idle_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    pay_overtime: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    overtime_decision: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    overtime_multiplier: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False, default=1)
    custom_overtime_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    overtime_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    deduct_unpaid_breaks: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    unpaid_break_deduction_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=0
    )
    unpaid_break_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    bonus_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    additional_deduction_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=0
    )
    adjustment_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    base_salary: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    overtime_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    total_deductions: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    total_bonuses: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    final_salary: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="draft", index=True)
    calculation_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    run = relationship("PayrollRun", back_populates="entries")
    employee = relationship("Employee")
    adjustments = relationship(
        "PayrollAdjustment", back_populates="entry", cascade="all, delete-orphan"
    )


class PayrollAdjustment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "payroll_adjustments"

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    payroll_entry_id: Mapped[UUID] = mapped_column(
        ForeignKey("payroll_entries.id", ondelete="CASCADE"), nullable=False, index=True
    )
    adjustment_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_by_admin_user_id: Mapped[UUID] = mapped_column(
        ForeignKey("admin_users.id"), nullable=False
    )

    entry = relationship("PayrollEntry", back_populates="adjustments")


class WorkScheduleOverride(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "work_schedule_overrides"

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    employee_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("employees.id"), nullable=True, index=True
    )
    scope: Mapped[str] = mapped_column(String(20), nullable=False)
    override_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    effective_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    permanent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    shift_start: Mapped[time | None] = mapped_column(Time(), nullable=True)
    shift_end: Mapped[time | None] = mapped_column(Time(), nullable=True)
    break_rules: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_by_admin_user_id: Mapped[UUID] = mapped_column(
        ForeignKey("admin_users.id"), nullable=False
    )
