from typing import Any
from uuid import UUID

from sqlalchemy import JSON, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class TaskActivity(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "task_activities"

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    task_id: Mapped[UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    admin_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("admin_users.id"), nullable=True)
    employee_id: Mapped[UUID | None] = mapped_column(ForeignKey("employees.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
