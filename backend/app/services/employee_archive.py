"""Shared rules for archived (fired/resigned) employees.

An archived employee keeps every historical record (sessions, attendance,
closed payroll) but is hidden from current operational views, and payroll /
attendance never count a day after their inclusive ``last_working_day``.
"""

from datetime import date

from app.models import Employee


ARCHIVE_REASONS = ("fired", "resigned")

# Statuses that never appear in current operational views (rosters, monitoring,
# attendance, timesheets, reports, request queues, draft payroll).
HIDDEN_EMPLOYEE_STATUSES = ("deleted", "archived")


def current_employee_clause():
    """SQL clause selecting employees that belong in current views."""

    return Employee.status.not_in(HIDDEN_EMPLOYEE_STATUSES)


def is_archived(employee: Employee | None) -> bool:
    return employee is not None and employee.status == "archived"


def employment_end_date(employee: Employee | None) -> date | None:
    """Inclusive last day that may count for attendance/payroll, if any."""

    if is_archived(employee):
        return employee.last_working_day
    return None


def cap_to_employment_end(employee: Employee | None, value: date) -> date:
    end = employment_end_date(employee)
    return min(value, end) if end is not None else value
