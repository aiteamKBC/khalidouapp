from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class WorkSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "work_sessions"
    __table_args__ = (
        Index(
            "ix_work_sessions_company_employee_started",
            "company_id",
            "employee_id",
            "started_at",
        ),
        Index(
            "ix_work_sessions_company_employee_open",
            "company_id",
            "employee_id",
            "ended_at",
        ),
        Index(
            "uq_work_sessions_device_single_open",
            "device_id",
            unique=True,
            postgresql_where=text("ended_at IS NULL"),
            sqlite_where=text("ended_at IS NULL"),
        ),
        CheckConstraint(
            "ended_at IS NULL OR ended_at >= started_at",
            name="ck_work_sessions_end_not_before_start",
        ),
        CheckConstraint(
            "ended_at IS NULL OR status = 'ended'",
            name="ck_work_sessions_closed_status",
        ),
    )

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    employee_id: Mapped[UUID] = mapped_column(
        ForeignKey("employees.id"), nullable=False, index=True
    )
    device_id: Mapped[UUID] = mapped_column(ForeignKey("devices.id"), nullable=False, index=True)
    team_id: Mapped[UUID | None] = mapped_column(ForeignKey("teams.id"), nullable=True, index=True)
    project_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("projects.id"), nullable=True, index=True
    )
    task_id: Mapped[UUID | None] = mapped_column(ForeignKey("tasks.id"), nullable=True, index=True)
    timezone: Mapped[str | None] = mapped_column(String(80), nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active", index=True)
    active_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    idle_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deducted_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    normal_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    extra_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    paid_pause_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
