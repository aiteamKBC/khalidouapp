from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.mixins import UUIDPrimaryKeyMixin, utc_now


class Screenshot(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "screenshots"

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    employee_id: Mapped[UUID] = mapped_column(
        ForeignKey("employees.id"), nullable=False, index=True
    )
    device_id: Mapped[UUID] = mapped_column(ForeignKey("devices.id"), nullable=False, index=True)
    session_id: Mapped[UUID] = mapped_column(
        ForeignKey("work_sessions.id"), nullable=False, index=True
    )
    team_id: Mapped[UUID | None] = mapped_column(ForeignKey("teams.id"), nullable=True, index=True)
    project_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("projects.id"), nullable=True, index=True
    )
    task_id: Mapped[UUID | None] = mapped_column(ForeignKey("tasks.id"), nullable=True, index=True)
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    thumbnail_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    mime_type: Mapped[str] = mapped_column(String(80), nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    display_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    checksum: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="uploaded")
    tracked_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deleted_time_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
