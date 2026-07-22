from uuid import UUID

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class TeamOwner(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "team_owners"
    __table_args__ = (
        UniqueConstraint("team_id", "admin_user_id", name="uq_team_owners_team_admin"),
    )

    team_id: Mapped[UUID] = mapped_column(ForeignKey("teams.id"), nullable=False, index=True)
    admin_user_id: Mapped[UUID] = mapped_column(
        ForeignKey("admin_users.id"), nullable=False, index=True
    )

    team = relationship("Team", back_populates="owners")
    admin_user = relationship("AdminUser")
