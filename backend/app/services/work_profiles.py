from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ApiError
from app.models import Employee, EmployeeWorkProfile, WorkSession

REQUIRED_PROFILE_FIELDS = (
    "shift_start",
    "shift_end",
    "working_days",
    "weekly_off_days",
    "required_daily_minutes",
    "break_rules",
    "late_grace_minutes",
    "deduction_policy",
    "salary_amount",
    "salary_currency",
)

DEFAULT_BREAK_RULES = [
    {"name": "Lunch", "minutes": 30, "paid": False},
    {"name": "Short break", "minutes": 15, "paid": False},
]
DEFAULT_DEDUCTION_POLICY = {
    "mode": "review",
    "require_admin_review": True,
    "brackets": [{"after_minutes": 15, "deduct_minutes": 1, "note": "Admin/HR review by minute"}],
}


def get_or_create_work_profile(db: Session, employee: Employee) -> EmployeeWorkProfile:
    profile = employee.work_profile
    if profile is None:
        profile = EmployeeWorkProfile(
            company_id=employee.company_id,
            employee_id=employee.id,
            shift_start=datetime.strptime("09:00", "%H:%M").time(),
            shift_end=datetime.strptime("17:00", "%H:%M").time(),
            working_days=[0, 1, 2, 3, 4],
            weekly_off_days=[5, 6],
            required_daily_minutes=480,
            break_rules=DEFAULT_BREAK_RULES,
            late_grace_minutes=15,
            deduction_policy=DEFAULT_DEDUCTION_POLICY,
            salary_amount=0,
            salary_currency="EGP",
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
        "completed_at": profile.profile_completed_at.isoformat() if profile.profile_completed_at else None,
    }


def validate_work_profile(profile: EmployeeWorkProfile) -> None:
    for values_name in ("working_days", "weekly_off_days"):
        values = getattr(profile, values_name)
        if values is not None:
            invalid = [item for item in values if not isinstance(item, int) or item < 0 or item > 6]
            if invalid:
                raise ApiError("INVALID_WORK_DAYS", f"{values_name} must contain weekday numbers 0-6.", 400)
    if profile.working_days and profile.weekly_off_days:
        overlap = set(profile.working_days) & set(profile.weekly_off_days)
        if overlap:
            raise ApiError("INVALID_WORK_DAYS", "Working days and off days cannot overlap.", 400)


def refresh_profile_completed_at(profile: EmployeeWorkProfile) -> None:
    validate_work_profile(profile)
    if profile_completeness(profile)["complete"]:
        profile.profile_completed_at = profile.profile_completed_at or datetime.now(UTC)
    else:
        profile.profile_completed_at = None


def serialize_work_profile(profile: EmployeeWorkProfile) -> dict:
    return {
        "id": str(profile.id),
        "employee_id": str(profile.employee_id),
        "shift_start": profile.shift_start.isoformat(timespec="minutes") if profile.shift_start else None,
        "shift_end": profile.shift_end.isoformat(timespec="minutes") if profile.shift_end else None,
        "working_days": profile.working_days,
        "weekly_off_days": profile.weekly_off_days,
        "required_daily_minutes": profile.required_daily_minutes,
        "break_rules": profile.break_rules,
        "late_grace_minutes": profile.late_grace_minutes,
        "deduction_policy": profile.deduction_policy,
        "overtime_enabled": profile.overtime_enabled,
        "overtime_basis": profile.overtime_basis,
        "overtime_rate_multiplier": float(profile.overtime_rate_multiplier) if profile.overtime_rate_multiplier is not None else None,
        "salary_amount": float(profile.salary_amount) if profile.salary_amount is not None else None,
        "salary_currency": profile.salary_currency,
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
    active_seconds = sum(max(0, session.active_seconds - session.deducted_seconds) for session in sessions)
    idle_seconds = sum(session.idle_seconds for session in sessions)
    required_daily = profile.required_daily_minutes or 480
    working_days = profile.working_days or [0, 1, 2, 3, 4]
    days = (end_date - start_date).days + 1
    required_days = sum(1 for offset in range(days) if (start_date + timedelta(days=offset)).weekday() in working_days)
    required_seconds = required_days * required_daily * 60
    overtime_seconds = max(0, active_seconds - required_seconds) if profile.overtime_enabled else 0
    base_salary = Decimal(profile.salary_amount or 0)
    hourly_rate = base_salary / Decimal(22 * 8) if base_salary else Decimal(0)
    overtime_multiplier = Decimal(profile.overtime_rate_multiplier or 1)
    overtime_amount = (Decimal(overtime_seconds) / Decimal(3600)) * hourly_rate * overtime_multiplier
    return {
        "employee_id": str(employee.id),
        "currency": profile.salary_currency or "EGP",
        "base_salary": float(base_salary),
        "required_seconds": required_seconds,
        "active_seconds": active_seconds,
        "idle_seconds": idle_seconds,
        "overtime_seconds": overtime_seconds,
        "overtime_amount": float(overtime_amount.quantize(Decimal("0.01"))),
        "deduction_amount": 0,
        "estimated_total": float((base_salary + overtime_amount).quantize(Decimal("0.01"))),
        "notes": [
            "Idle and late deductions stay pending for Admin/HR review until a deduction decision is recorded.",
            "Preview uses a monthly base of 22 working days x 8 hours until a company payroll calendar is added.",
        ],
    }
