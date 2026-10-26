from uuid import UUID

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class EmployeeAppearance(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "employee_appearance"
    __table_args__ = (UniqueConstraint("company_id", "employee_id"),)

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    employee_id: Mapped[UUID] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"))
    skin: Mapped[str] = mapped_column(String(16), nullable=False, default="orbit")
    mode: Mapped[str] = mapped_column(String(8), nullable=False, default="dark")
