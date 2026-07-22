from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class TaskNotification(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "task_notifications"
    __table_args__ = (UniqueConstraint("dedupe_key", name="uq_task_notifications_dedupe_key"),)

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    employee_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("employees.id"), nullable=True, index=True
    )
    admin_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("admin_users.id"), nullable=True, index=True
    )
    task_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True, index=True
    )
    workflow_request_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("task_workflow_requests.id", ondelete="SET NULL"), nullable=True, index=True
    )
    notification_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str] = mapped_column(String(1000), nullable=False)
    dedupe_key: Mapped[str] = mapped_column(String(255), nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    workflow_request = relationship(
        "TaskWorkflowRequest", back_populates="notifications", lazy="joined"
    )
