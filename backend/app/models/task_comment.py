from uuid import UUID

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class TaskComment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "task_comments"

    task_id: Mapped[UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    admin_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("admin_users.id"), nullable=True)
    employee_id: Mapped[UUID | None] = mapped_column(ForeignKey("employees.id"), nullable=True)
    body: Mapped[str] = mapped_column(String(4000), nullable=False)
