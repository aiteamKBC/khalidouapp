from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import UUIDPrimaryKeyMixin, utc_now


class Device(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "devices"
    __table_args__ = (
        UniqueConstraint("company_id", "installation_id", name="uq_devices_company_installation"),
    )

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    employee_id: Mapped[UUID] = mapped_column(
        ForeignKey("employees.id"), nullable=False, index=True
    )
    device_name: Mapped[str] = mapped_column(String(255), nullable=False)
    installation_id: Mapped[str] = mapped_column(String(255), nullable=False)
    operating_system: Mapped[str] = mapped_column(String(255), nullable=False)
    agent_version: Mapped[str] = mapped_column(String(50), nullable=False)
    windows_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active")
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    registered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    employee = relationship("Employee", back_populates="devices")
