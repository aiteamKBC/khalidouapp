from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ApiError
from app.models import Employee, EmployeeWorkProfile, WorkScheduleOverride, WorkSession

REQUIRED_PROFILE_FIELDS = (
    "shift_start",
    "shift_end",
    "working_days",
    "weekly_off_days",
    "required_daily_minutes",
    "break_rules",
    "late_grace_minutes",
    "no_show_threshold_minutes",
    "schedule_type",
    "weekly_early_leave_minutes",
    "deduction_policy",
    "salary_amount",
    "salary_currency",
    "salary_type",
)

DEFAULT_BREAK_RULES = [
    {
        "name": "Lunch",
        "minutes": 30,
        "paid": False,
        "start_time": "12:30",
        "end_time": "13:00",
    },
    {
        "name": "Short break",
        "minutes": 15,
        "paid": False,
        "start_time": "15:30",
        "end_time": "15:45",
    },
]
DEFAULT_DEDUCTION_POLICY = {
    "mode": "review",
    "require_admin_review": True,
    "brackets": [{"after_minutes": 15, "deduct_minutes": 1, "note": "Admin/HR review by minute"}],
}


def get_or_create_work_profile(db: Session, employee: Employee) -> EmployeeWorkProfile:
    # Query by the database key instead of trusting a possibly stale loaded
    # relationship. The profile may have been created by another request after
    # this Employee instance was loaded.
    profile = db.scalar(
        select(EmployeeWorkProfile).where(
            EmployeeWorkProfile.company_id == employee.company_id,
            EmployeeWorkProfile.employee_id == employee.id,
        )
    )
    if profile is None:
        company_shift_default = db.scalar(
            select(WorkScheduleOverride)
            .where(
                WorkScheduleOverride.company_id == employee.company_id,
                WorkScheduleOverride.scope == "company",
                WorkScheduleOverride.permanent.is_(True),
                WorkScheduleOverride.override_type.in_(["shift", "both"]),
            )
            .order_by(WorkScheduleOverride.created_at.desc())
        )
        company_break_default = db.scalar(
            select(WorkScheduleOverride)
            .where(
                WorkScheduleOverride.company_id == employee.company_id,
                WorkScheduleOverride.scope == "company",
                WorkScheduleOverride.permanent.is_(True),
                WorkScheduleOverride.override_type.in_(["breaks", "both"]),
            )
            .order_by(WorkScheduleOverride.created_at.desc())
        )
        profile = EmployeeWorkProfile(
            company_id=employee.company_id,
            employee_id=employee.id,
            shift_start=(
                company_shift_default.shift_start
                if company_shift_default and company_shift_default.shift_start
                else datetime.strptime("09:00", "%H:%M").time()
            ),
            shift_end=(
                company_shift_default.shift_end
                if company_shift_default and company_shift_default.shift_end
                else datetime.strptime("17:00", "%H:%M").time()
            ),
            working_days=[0, 1, 2, 3, 4],
            weekly_off_days=[5, 6],
            required_daily_minutes=(
                company_shift_default.shift_end.hour * 60
                + company_shift_default.shift_end.minute
                - company_shift_default.shift_start.hour * 60
                - company_shift_default.shift_start.minute
                if company_shift_default
                and company_shift_default.shift_start
                and company_shift_default.shift_end
                else 480
            ),
            break_rules=(
                company_break_default.break_rules
                if company_break_default and company_break_default.break_rules is not None
                else DEFAULT_BREAK_RULES
            ),
            late_grace_minutes=15,
            no_show_threshold_minutes=30,
            schedule_type="fixed",
            weekly_early_leave_minutes=120,
            deduction_policy=DEFAULT_DEDUCTION_POLICY,
            salary_amount=0,
            salary_currency="EGP",
            salary_type="monthly",
            overtime_enabled=False,
        )
        db.add(profile)
        db.flush()
    return profile


def _missing_fields(profile: EmployeeWorkProfile) -> list[str]:
    missing = []
    for field in REQUIRED_PROFILE_FIELDS:
        value = getattr(profile, field)
        if value is None or value == [] or value == {}:
            missing.append(field)
    if profile.overtime_enabled and not profile.overtime_basis:
        missing.append("overtime_basis")
    if profile.overtime_enabled and profile.overtime_rate_multiplier is None:
        missing.append("overtime_rate_multiplier")
    return missing


def profile_completeness(profile: EmployeeWorkProfile) -> dict:
    missing = _missing_fields(profile)
    return {
        "complete": len(missing) == 0,
        "missing_fields": missing,
        "completed_at": profile.profile_completed_at.isoformat()
        if profile.profile_completed_at
        else None,
    }


def validate_work_profile(profile: EmployeeWorkProfile) -> None:
    for values_name in ("working_days", "weekly_off_days"):
        values = getattr(profile, values_name)
        if values is not None:
            invalid = [item for item in values if not isinstance(item, int) or item < 0 or item > 6]
            if invalid:
                raise ApiError(
                    "INVALID_WORK_DAYS", f"{values_name} must contain weekday numbers 0-6.", 400
                )
    if profile.working_days and profile.weekly_off_days:
        overlap = set(profile.working_days) & set(profile.weekly_off_days)
        if overlap:
            raise ApiError("INVALID_WORK_DAYS", "Working days and off days cannot overlap.", 400)
    if profile.shift_start and profile.shift_end and profile.shift_end <= profile.shift_start:
        raise ApiError(
            "INVALID_SHIFT", "Shift end must be later than shift start on the same day.", 400
        )
    parsed_breaks = []
    for rule in profile.break_rules or []:
        start = rule.get("start_time")
        end = rule.get("end_time")
        if not start or not end:
            raise ApiError("INVALID_BREAK", "Every break needs a start and end time.", 400)
        start_time = datetime.strptime(str(start)[:5], "%H:%M").time()
        end_time = datetime.strptime(str(end)[:5], "%H:%M").time()
        if end_time <= start_time:
            raise ApiError("INVALID_BREAK", "Break end must be later than break start.", 400)
        actual_minutes = (
            end_time.hour * 60 + end_time.minute - start_time.hour * 60 - start_time.minute
        )
        if int(rule.get("minutes", 0)) != actual_minutes:
            raise ApiError(
                "INVALID_BREAK_DURATION", "Break duration must match its start and end time.", 400
            )
        if (
            profile.shift_start
            and profile.shift_end
            and not (profile.shift_start <= start_time < end_time <= profile.shift_end)
        ):
            raise ApiError(
                "BREAK_OUTSIDE_SHIFT", "Every break must be fully inside the employee shift.", 400
            )
        parsed_breaks.append((start_time, end_time))
    parsed_breaks.sort(key=lambda item: item[0])
    if any(previous[1] > current[0] for previous, current in zip(parsed_breaks, parsed_breaks[1:])):
        raise ApiError("OVERLAPPING_BREAKS", "Break periods cannot overlap.", 400)


def schedule_minutes(profile: EmployeeWorkProfile) -> dict[str, int]:
    """Return shift salary minutes; scheduled breaks are inside the shift."""
    if not profile.shift_start or not profile.shift_end or profile.shift_end <= profile.shift_start:
        return {"shift": 0, "paid_break": 0, "unpaid_break": 0, "payable": 0}
    shift = (
        profile.shift_end.hour * 60
        + profile.shift_end.minute
        - profile.shift_start.hour * 60
        - profile.shift_start.minute
    )
    paid_break = sum(
        int(rule.get("minutes", 0)) for rule in profile.break_rules or [] if rule.get("paid")
    )
    unpaid_break = sum(
        int(rule.get("minutes", 0)) for rule in profile.break_rules or [] if not rule.get("paid")
    )
    return {
        "shift": shift,
        "paid_break": paid_break,
        "unpaid_break": unpaid_break,
        "payable": shift,
    }


def refresh_profile_completed_at(profile: EmployeeWorkProfile) -> None:
    validate_work_profile(profile)
    minutes = schedule_minutes(profile)
    if minutes["payable"]:
        profile.required_daily_minutes = minutes["payable"]
    if profile_completeness(profile)["complete"]:
        profile.profile_completed_at = profile.profile_completed_at or datetime.now(UTC)
    else:
        profile.profile_completed_at = None


def serialize_work_profile(profile: EmployeeWorkProfile) -> dict:
    return {
        "id": str(profile.id),
        "employee_id": str(profile.employee_id),
        "shift_start": profile.shift_start.isoformat(timespec="minutes")
        if profile.shift_start
        else None,
        "shift_end": profile.shift_end.isoformat(timespec="minutes") if profile.shift_end else None,
        "working_days": profile.working_days,
        "weekly_off_days": profile.weekly_off_days,
        "required_daily_minutes": profile.required_daily_minutes,
        "break_rules": profile.break_rules,
        "late_grace_minutes": profile.late_grace_minutes,
        "no_show_threshold_minutes": profile.no_show_threshold_minutes,
        "schedule_type": profile.schedule_type,
        "weekly_early_leave_minutes": profile.weekly_early_leave_minutes,
        "deduction_policy": profile.deduction_policy,
        "overtime_enabled": profile.overtime_enabled,
        "overtime_basis": profile.overtime_basis,
        "overtime_rate_multiplier": float(profile.overtime_rate_multiplier)
        if profile.overtime_rate_multiplier is not None
        else None,
        "salary_amount": float(profile.salary_amount)
        if profile.salary_amount is not None
        else None,
        "salary_currency": profile.salary_currency,
        "salary_type": profile.salary_type,
        "completeness": profile_completeness(profile),
        "created_at": profile.created_at.isoformat(),
        "updated_at": profile.updated_at.isoformat(),
    }


def payroll_preview(
    db: Session,
    *,
    company_id: UUID,
    employee: Employee,
    start_date: date,
    end_date: date,
) -> dict:
    profile = get_or_create_work_profile(db, employee)
    sessions = db.scalars(
        select(WorkSession).where(
            WorkSession.company_id == company_id,
            WorkSession.employee_id == employee.id,
            WorkSession.started_at >= datetime.combine(start_date, datetime.min.time(), tzinfo=UTC),
            WorkSession.started_at <= datetime.combine(end_date, datetime.max.time(), tzinfo=UTC),
        )
    ).all()
    active_seconds = sum(
        max(0, session.active_seconds - session.deducted_seconds) for session in sessions
    )
    idle_seconds = sum(session.idle_seconds for session in sessions)
    required_daily = profile.required_daily_minutes or 480
    break_minutes = schedule_minutes(profile)
    if break_minutes["payable"]:
        required_daily = break_minutes["payable"]
    working_days = profile.working_days or [0, 1, 2, 3, 4]
    days = (end_date - start_date).days + 1
    required_days = sum(
        1
        for offset in range(days)
        if (start_date + timedelta(days=offset)).weekday() in working_days
    )
    required_seconds = required_days * required_daily * 60
    paid_break_seconds = required_days * break_minutes["paid_break"] * 60
    unpaid_break_seconds = required_days * break_minutes["unpaid_break"] * 60
    overtime_seconds = max(0, active_seconds - required_seconds) if profile.overtime_enabled else 0
    configured_salary = Decimal(profile.salary_amount or 0)
    monthly_paid_hours = Decimal(required_daily * 30) / Decimal(60)
    hourly_rate = (
        configured_salary
        if profile.salary_type == "hourly"
        else configured_salary / monthly_paid_hours
        if configured_salary and monthly_paid_hours > 0
        else Decimal(0)
    )
    base_salary = (
        configured_salary if profile.salary_type == "monthly" else hourly_rate * monthly_paid_hours
    )
    overtime_multiplier = Decimal(profile.overtime_rate_multiplier or 1)
    overtime_amount = (
        (Decimal(overtime_seconds) / Decimal(3600)) * hourly_rate * overtime_multiplier
    )
    return {
        "employee_id": str(employee.id),
        "currency": profile.salary_currency or "EGP",
        "base_salary": float(base_salary),
        "hourly_rate": float(hourly_rate.quantize(Decimal("0.01"))),
        "monthly_paid_hours": float(monthly_paid_hours.quantize(Decimal("0.01"))),
        "salary_type": profile.salary_type,
        "required_seconds": required_seconds,
        "paid_break_seconds": paid_break_seconds,
        "unpaid_break_seconds": unpaid_break_seconds,
        "active_seconds": active_seconds,
        "idle_seconds": idle_seconds,
        "overtime_seconds": overtime_seconds,
        "overtime_amount": float(overtime_amount.quantize(Decimal("0.01"))),
        "deduction_amount": 0,
        "estimated_total": float((base_salary + overtime_amount).quantize(Decimal("0.01"))),
        "notes": [
            "Salary rate uses 30 paid calendar days per month; weekly days off and scheduled breaks remain paid.",
            "Idle and late deductions stay pending for Admin/HR review until a deduction decision is recorded.",
            "Preview uses a monthly base of 22 working days x 8 hours until a company payroll calendar is added.",
        ],
    }
