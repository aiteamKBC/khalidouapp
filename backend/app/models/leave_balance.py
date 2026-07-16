from uuid import UUID

from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class LeaveBalance(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "leave_balances"
    __table_args__ = (
        UniqueConstraint("employee_id", "year", name="uq_leave_balances_employee_year"),
    )

    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    employee_id: Mapped[UUID] = mapped_column(ForeignKey("employees.id"), nullable=False, index=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    credit_days: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=Decimal("21.00"))
    manually_adjusted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    employee = relationship("Employee")
