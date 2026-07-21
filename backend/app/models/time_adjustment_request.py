from datetime import date, datetime
from uuid import UUID

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class TimeAdjustmentRequest(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "time_adjustment_requests"

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    employee_id: Mapped[UUID] = mapped_column(ForeignKey("employees.id"), nullable=False, index=True)
    device_id: Mapped[UUID | None] = mapped_column(ForeignKey("devices.id"), nullable=True, index=True)
    work_session_id: Mapped[UUID | None] = mapped_column(ForeignKey("work_sessions.id"), nullable=True, index=True)
    request_type: Mapped[str] = mapped_column(String(40), nullable=False, default="manual_time", index=True)
    requested_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    source_start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source_end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    requested_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    approved_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reason: Mapped[str] = mapped_column(String(1000), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="pending", index=True)
    reviewed_by_admin_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("admin_users.id"),
        nullable=True,
        index=True,
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    admin_note: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    employee = relationship("Employee")
    device = relationship("Device")
    work_session = relationship("WorkSession")
    reviewed_by = relationship("AdminUser")
