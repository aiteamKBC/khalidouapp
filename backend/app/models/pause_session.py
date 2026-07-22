from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class PauseSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "pause_sessions"
    __table_args__ = (
        UniqueConstraint(
            "work_session_id", "idempotency_key", name="uq_pause_sessions_idempotency"
        ),
    )

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    employee_id: Mapped[UUID] = mapped_column(
        ForeignKey("employees.id"), nullable=False, index=True
    )
    work_session_id: Mapped[UUID] = mapped_column(
        ForeignKey("work_sessions.id"), nullable=False, index=True
    )
    pause_balance_id: Mapped[UUID] = mapped_column(
        ForeignKey("pause_balances.id"), nullable=False, index=True
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    scheduled_end_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    requested_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    used_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="active", index=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(120), nullable=False)
