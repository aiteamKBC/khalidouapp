from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class WorkSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "work_sessions"

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
