from calendar import monthrange
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Employee, LeaveBalance, LeaveRequest


DEFAULT_ANNUAL_CREDIT_DAYS = 21


def _add_six_months(value: date) -> date:
    month_index = value.month - 1 + 6
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    return date(year, month, min(value.day, monthrange(year, month)[1]))


def entitled_credit_days(employee: Employee, year: int) -> Decimal:
    annual = Decimal(employee.annual_leave_days or DEFAULT_ANNUAL_CREDIT_DAYS)
    if employee.start_date is None:
        return Decimal("0.00")
    eligible_at = _add_six_months(employee.start_date)
    if year < eligible_at.year:
        return Decimal("0.00")
    if year > eligible_at.year:
        return annual.quantize(Decimal("0.01"))
    if employee.start_date.year < eligible_at.year:
        return annual.quantize(Decimal("0.01"))
    remaining_full_months = 12 - eligible_at.month
    return (Decimal(remaining_full_months) * annual / Decimal(12)).quantize(Decimal("0.01"))


def requested_workdays(
    start_date: date,
    end_date: date,
    working_days: list[int] | None = None,
) -> int:
    if end_date < start_date:
        return 0
    allowed_days = set(working_days or [0, 1, 2, 3, 4])
    return sum(
        1
        for offset in range((end_date - start_date).days + 1)
        if (start_date.fromordinal(start_date.toordinal() + offset)).weekday() in allowed_days
    )


def get_or_create_balance(db: Session, employee: Employee, year: int) -> LeaveBalance:
    balance = db.scalar(
        select(LeaveBalance).where(
            LeaveBalance.employee_id == employee.id,
            LeaveBalance.year == year,
        )
    )
    if balance is None:
        balance = LeaveBalance(
            company_id=employee.company_id,
            employee_id=employee.id,
            year=year,
            credit_days=entitled_credit_days(employee, year),
        )
        db.add(balance)
        db.flush()
    elif not balance.manually_adjusted:
        calculated = entitled_credit_days(employee, year)
        if balance.credit_days != calculated:
            balance.credit_days = calculated
            db.add(balance)
            db.flush()
    return balance


def approved_days(db: Session, employee_id, year: int) -> int:
    return int(
        db.scalar(
            select(func.coalesce(func.sum(LeaveRequest.requested_days), 0)).where(
                LeaveRequest.employee_id == employee_id,
                LeaveRequest.status == "approved",
                func.extract("year", LeaveRequest.start_date) == year,
            )
        )
        or 0
    )


def serialize_balance(db: Session, employee: Employee, year: int) -> dict:
    balance = get_or_create_balance(db, employee, year)
    used = approved_days(db, employee.id, year)
    return {
        "year": year,
        "credit_days": float(balance.credit_days),
        "used_days": used,
        "remaining_days": float(max(Decimal("0.00"), balance.credit_days - Decimal(used))),
    }


def serialize_leave_request(row: LeaveRequest) -> dict:
    return {
        "id": str(row.id),
        "employee_id": str(row.employee_id),
        "employee_name": row.employee.name if row.employee else "Unknown employee",
        "start_date": row.start_date.isoformat(),
        "end_date": row.end_date.isoformat(),
        "requested_days": row.requested_days,
        "leave_type": row.leave_type,
        "reason": row.reason,
        "status": row.status,
        "reviewed_by_name": row.reviewed_by.name if row.reviewed_by else None,
        "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
        "review_note": row.review_note,
        "created_at": row.created_at.isoformat(),
    }
