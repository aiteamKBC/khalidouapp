from uuid import UUID

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Employee(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "employees"
    __table_args__ = (
        UniqueConstraint("company_id", "email", name="uq_employees_company_email"),
        UniqueConstraint("company_id", "employee_code", name="uq_employees_company_code"),
    )

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    employee_code: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    job_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    timezone: Mapped[str] = mapped_column(String(80), nullable=False, default="UTC")
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active")
    weekly_capacity_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=2400)
    portal_password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    portal_last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    portal_last_login_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    portal_last_user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status_before_archive: Mapped[str | None] = mapped_column(String(50), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    annual_leave_days: Mapped[int] = mapped_column(Integer, nullable=False, default=21)

    company = relationship("Company", back_populates="employees")
    devices = relationship("Device", back_populates="employee")
    work_profile = relationship(
        "EmployeeWorkProfile",
        back_populates="employee",
        uselist=False,
        cascade="all, delete-orphan",
    )
