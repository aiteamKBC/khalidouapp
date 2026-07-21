from datetime import date
from uuid import UUID

from sqlalchemy import Date, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class PauseBalance(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "pause_balances"
    __table_args__ = (
        UniqueConstraint("employee_id", "work_date", name="uq_pause_balances_employee_date"),
    )

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    employee_id: Mapped[UUID] = mapped_column(ForeignKey("employees.id"), nullable=False, index=True)
    work_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    base_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=600)
    extra_approved_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    used_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
