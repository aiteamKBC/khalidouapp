from uuid import UUID

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class TaskAttachment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "task_attachments"

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    task_id: Mapped[UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    uploader_admin_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("admin_users.id"), nullable=True)
    uploader_employee_id: Mapped[UUID | None] = mapped_column(ForeignKey("employees.id"), nullable=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(150), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1000), nullable=False)
