from uuid import UUID

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


def default_admin_data_scope(context) -> str:
    return (
        "company"
        if context.get_current_parameters().get("role") == "general_admin"
        else "assigned_teams"
    )


class AdminUser(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "admin_users"
    __table_args__ = (
        UniqueConstraint("company_id", "email", name="uq_admin_users_company_email"),
    )

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    employee_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("employees.id"), nullable=True, unique=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="general_admin")
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active")
    permission_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="role")
    data_scope: Mapped[str] = mapped_column(
        String(30), nullable=False, default=default_admin_data_scope
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status_before_archive: Mapped[str | None] = mapped_column(String(50), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    company = relationship("Company", back_populates="admins")
    employee = relationship("Employee", foreign_keys=[employee_id])
    permission_overrides = relationship(
        "AdminPermissionOverride",
        back_populates="admin_user",
        cascade="all, delete-orphan",
    )
    workflow_requests_reviewed = relationship(
        "TaskWorkflowRequest",
        back_populates="reviewed_by_admin",
        foreign_keys="TaskWorkflowRequest.reviewed_by_admin_user_id",
    )
