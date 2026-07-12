from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class TaskWorkflowRequest(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "task_workflow_requests"
    __table_args__ = (
        CheckConstraint(
            "request_type IN ('task_creation', 'completion')",
            name="ck_task_workflow_requests_type",
        ),
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_task_workflow_requests_status",
        ),
        Index(
            "uq_task_workflow_requests_pending_task",
            "task_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
            sqlite_where=text("status = 'pending'"),
        ),
    )

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    task_id: Mapped[UUID] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    requested_by_employee_id: Mapped[UUID] = mapped_column(
        ForeignKey("employees.id"), nullable=False, index=True
    )
    request_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    from_stage: Mapped[str] = mapped_column(String(80), nullable=False)
    requested_stage: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    request_note: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    decision_note: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    return_stage: Mapped[str | None] = mapped_column(String(80), nullable=True)
    reviewed_by_admin_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("admin_users.id"), nullable=True, index=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    task = relationship("Task", back_populates="workflow_requests")
    requested_by_employee = relationship("Employee", foreign_keys=[requested_by_employee_id])
    reviewed_by_admin = relationship(
        "AdminUser",
        back_populates="workflow_requests_reviewed",
        foreign_keys=[reviewed_by_admin_user_id],
    )
    notifications = relationship("TaskNotification", back_populates="workflow_request")
