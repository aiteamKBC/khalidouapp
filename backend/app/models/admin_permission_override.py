from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class AdminPermissionOverride(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "admin_permission_overrides"
    __table_args__ = (
        UniqueConstraint(
            "admin_user_id",
            "permission_key",
            name="uq_admin_permission_overrides_admin_key",
        ),
    )

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    admin_user_id: Mapped[UUID] = mapped_column(
        ForeignKey("admin_users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    permission_key: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    allowed: Mapped[bool] = mapped_column(Boolean, nullable=False)

    admin_user = relationship("AdminUser", back_populates="permission_overrides")
