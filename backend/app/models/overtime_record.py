from datetime import date
from uuid import UUID

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class OvertimeRecord(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "overtime_records"
    __table_args__ = (
        UniqueConstraint("work_session_id", name="uq_overtime_records_work_session"),
    )

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    employee_id: Mapped[UUID] = mapped_column(ForeignKey("employees.id"), nullable=False, index=True)
    work_session_id: Mapped[UUID] = mapped_column(ForeignKey("work_sessions.id"), nullable=False, index=True)
    work_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    overtime_enabled_snapshot: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    recorded_extra_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    approved_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="recorded", index=True)
