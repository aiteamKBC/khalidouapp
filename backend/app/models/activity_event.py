from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.mixins import UUIDPrimaryKeyMixin, utc_now


class ActivityEvent(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "activity_events"
    __table_args__ = (
        UniqueConstraint("company_id", "idempotency_key", name="uq_activity_events_idempotency"),
    )

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    employee_id: Mapped[UUID] = mapped_column(
        ForeignKey("employees.id"), nullable=False, index=True
    )
    device_id: Mapped[UUID] = mapped_column(ForeignKey("devices.id"), nullable=False, index=True)
    session_id: Mapped[UUID] = mapped_column(
        ForeignKey("work_sessions.id"), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    event_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
