from uuid import UUID
from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Task(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "tasks"
    __table_args__ = (
        UniqueConstraint("company_id", "project_id", "name", name="uq_tasks_project_name"),
    )

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    assignee_employee_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("employees.id"), nullable=True, index=True
    )
    created_by_employee_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("employees.id"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active", index=True)
    stage: Mapped[str] = mapped_column(
        String(80), nullable=False, default="new_requests", index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    estimated_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    labels: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    recurrence_rule: Mapped[str | None] = mapped_column(String(80), nullable=True)
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default="medium", index=True)
    blocked_reason: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    blocked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    blocked_by_employee_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("employees.id"), nullable=True, index=True
    )
    blocked_by_admin_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("admin_users.id"), nullable=True, index=True
    )
    block_resolution_note: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    review_note: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    completion_note: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    reviewed_by_admin_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("admin_users.id"), nullable=True, index=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    collaborators = relationship("Employee", secondary="task_collaborators", lazy="selectin")
    checklist_items = relationship(
        "TaskChecklistItem",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="TaskChecklistItem.position",
    )
    workflow_requests = relationship(
        "TaskWorkflowRequest",
        back_populates="task",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="TaskWorkflowRequest.created_at",
    )
