from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class TrackingSettings(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "tracking_settings"
    __table_args__ = (
        UniqueConstraint("company_id", name="uq_tracking_settings_company"),
    )

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    screenshot_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    screenshot_interval_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    screenshots_per_interval: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    idle_threshold_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    capture_during_idle: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    offline_threshold_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    screenshot_retention_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
