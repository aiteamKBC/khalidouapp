from uuid import UUID

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


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
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    company = relationship("Company", back_populates="admins")
    employee = relationship("Employee", foreign_keys=[employee_id])
    workflow_requests_reviewed = relationship(
        "TaskWorkflowRequest",
        back_populates="reviewed_by_admin",
        foreign_keys="TaskWorkflowRequest.reviewed_by_admin_user_id",
    )
