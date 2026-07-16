from datetime import date, time
from decimal import Decimal

import pytest

from app.core.exceptions import ApiError
from app.models import Employee, EmployeeWorkProfile
from app.services.leave_management import entitled_credit_days, requested_workdays
from app.services.permissions import capabilities_for_role
from app.services.work_profiles import schedule_minutes, validate_work_profile


def test_first_leave_credit_is_prorated_after_six_months():
    employee = Employee(
        name="New employee",
        email="new@example.com",
        employee_code="EMP-NEW",
        timezone="Africa/Cairo",
        start_date=date(2026, 1, 1),
        annual_leave_days=21,
    )
    assert entitled_credit_days(employee, 2025) == Decimal("0.00")
    assert entitled_credit_days(employee, 2026) == Decimal("8.75")
    assert entitled_credit_days(employee, 2027) == Decimal("21.00")


def test_break_must_be_inside_same_day_shift():
    profile = EmployeeWorkProfile(
        shift_start=time(9, 0),
        shift_end=time(17, 0),
        break_rules=[{"name": "Lunch", "start_time": "08:30", "end_time": "09:00", "minutes": 30, "paid": False}],
    )
    with pytest.raises(ApiError) as error:
        validate_work_profile(profile)
    assert error.value.code == "BREAK_OUTSIDE_SHIFT"


def test_admin_inherits_team_leader_but_not_the_reverse():
    leader = capabilities_for_role("team_owner")
    admin = capabilities_for_role("general_admin")
    assert leader < admin
    assert "payroll.manage" not in leader
    assert "leave_requests.manage" not in leader


def test_all_scheduled_breaks_stay_inside_salary_shift_hours():
    profile = EmployeeWorkProfile(
        shift_start=time(9, 0),
        shift_end=time(17, 0),
        break_rules=[
            {"name": "Paid", "start_time": "11:00", "end_time": "11:15", "minutes": 15, "paid": True},
            {"name": "Lunch", "start_time": "13:00", "end_time": "13:30", "minutes": 30, "paid": False},
        ],
    )
    minutes = schedule_minutes(profile)
    assert minutes == {"shift": 480, "paid_break": 15, "unpaid_break": 30, "payable": 480}


def test_leave_uses_the_employee_actual_working_days():
    # Friday/Saturday are off, so a Thursday-to-Sunday leave costs two days.
    assert requested_workdays(date(2026, 7, 16), date(2026, 7, 19), [0, 1, 2, 3, 6]) == 2
