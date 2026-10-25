from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.mixins import UUIDPrimaryKeyMixin, utc_now


class DeviceSignInAttempt(UUIDPrimaryKeyMixin, Base):
    """An employee tried to sign in on a computer registered to someone else.

    Sign-in is refused; this row lets HR see the attempt and reassign the
    computer. Repeated attempts by the same employee on the same computer update
    one open row instead of adding more.
    """

    __tablename__ = "device_sign_in_attempts"
    __table_args__ = (
        Index("ix_device_sign_in_attempts_company_open", "company_id", "resolved_at"),
        Index("ix_device_sign_in_attempts_device_employee", "device_id", "employee_id"),
    )

    company_id: Mapped[UUID] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    device_id: Mapped[UUID] = mapped_column(
        ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
    # Who tried to sign in, and who the computer belonged to at that moment.
    employee_id: Mapped[UUID] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False
    )
    owner_employee_id: Mapped[UUID] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False
    )
    first_attempted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    last_attempted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    windows_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # "reassigned" or "dismissed" once HR has dealt with it.
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution: Mapped[str | None] = mapped_column(String(30), nullable=True)
    resolved_by_admin_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("admin_users.id", ondelete="SET NULL"), nullable=True
    )
