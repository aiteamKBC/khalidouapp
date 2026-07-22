import calendar
from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    Employee,
    EmployeeWorkProfile,
    LeaveRequest,
    OvertimeRecord,
    PayrollAdjustment,
    PayrollEntry,
    PayrollRun,
    Team,
    TeamMember,
    TimeAdjustmentRequest,
    WorkScheduleOverride,
    WorkSession,
)
from app.services.work_profiles import get_or_create_work_profile


MONEY = Decimal("0.01")
DEDUCTION_ADJUSTMENTS = {"deduction", "late_deduction", "idle_deduction", "unpaid_leave"}
BONUS_ADJUSTMENTS = {"bonus", "overtime_exception", "salary_correction"}


def month_bounds(value: str | date) -> tuple[date, date]:
    if isinstance(value, str):
        try:
            year, month = (int(part) for part in value.split("-", 1))
            first = date(year, month, 1)
        except (TypeError, ValueError):
            raise ValueError("Month must use YYYY-MM format.") from None
    else:
        first = value.replace(day=1)
    return first, first.replace(day=calendar.monthrange(first.year, first.month)[1])


def utc_bounds(first: date, last: date) -> tuple[datetime, datetime]:
    return (
        datetime.combine(first, time.min, tzinfo=UTC),
        datetime.combine(last, time.max, tzinfo=UTC),
    )


def decimal(value: object) -> Decimal:
    return Decimal(str(value or 0))


def money(value: Decimal) -> Decimal:
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


def get_or_create_run(
    db: Session,
    *,
    company_id: UUID,
    month: date,
    admin_user_id: UUID,
) -> PayrollRun:
    run = db.scalar(
        select(PayrollRun).where(PayrollRun.company_id == company_id, PayrollRun.month == month)
    )
    if run is None:
        run = PayrollRun(
            company_id=company_id,
            month=month,
            status="draft",
            created_by_admin_user_id=admin_user_id,
        )
        db.add(run)
        db.flush()
    return run


def _timezone(employee: Employee) -> ZoneInfo:
    try:
        return ZoneInfo(employee.timezone or "UTC")
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def _daily_override(
    overrides: list[WorkScheduleOverride], employee_id: UUID, work_date: date
) -> WorkScheduleOverride | None:
    exact = [
        item
        for item in overrides
        if item.effective_date == work_date and item.employee_id == employee_id
    ]
    if exact:
        return max(exact, key=lambda item: item.created_at)
    company = [
        item for item in overrides if item.effective_date == work_date and item.employee_id is None
    ]
    return max(company, key=lambda item: item.created_at) if company else None


def _day_schedule(
    profile: EmployeeWorkProfile,
    override: WorkScheduleOverride | None,
) -> tuple[time | None, time | None, list[dict]]:
    return (
        override.shift_start if override and override.shift_start else profile.shift_start,
        override.shift_end if override and override.shift_end else profile.shift_end,
        override.break_rules
        if override and override.break_rules is not None
        else profile.break_rules or [],
    )


def _break_totals(rules: list[dict]) -> tuple[int, int]:
    paid = sum(int(item.get("minutes", 0)) for item in rules if item.get("paid"))
    unpaid = sum(int(item.get("minutes", 0)) for item in rules if not item.get("paid"))
    return paid * 60, unpaid * 60


def _team_names(db: Session, company_id: UUID) -> dict[UUID, str]:
    rows = db.execute(
        select(TeamMember.employee_id, Team.name)
        .join(Team, Team.id == TeamMember.team_id)
        .where(
            Team.company_id == company_id,
            Team.status == "active",
            TeamMember.status == "active",
        )
        .order_by(Team.name)
    ).all()
    names: dict[UUID, list[str]] = defaultdict(list)
    for employee_id, name in rows:
        names[employee_id].append(name)
    return {employee_id: ", ".join(values) for employee_id, values in names.items()}


def calculate_employee_metrics(
    db: Session,
    *,
    company_id: UUID,
    employee: Employee,
    profile: EmployeeWorkProfile,
    first: date,
    last: date,
    overrides: list[WorkScheduleOverride],
    sessions: list[WorkSession] | None = None,
    adjustments: list[TimeAdjustmentRequest] | None = None,
    overtime_records: list[OvertimeRecord] | None = None,
    approved_leave: list[LeaveRequest] | None = None,
) -> dict:
    zone = _timezone(employee)
    if sessions is None:
        local_start = datetime.combine(first, time.min, tzinfo=zone).astimezone(UTC)
        local_end = datetime.combine(last + timedelta(days=1), time.min, tzinfo=zone).astimezone(
            UTC
        )
        sessions = db.scalars(
            select(WorkSession).where(
                WorkSession.company_id == company_id,
                WorkSession.employee_id == employee.id,
                WorkSession.started_at >= local_start,
                WorkSession.started_at < local_end,
            )
        ).all()
    if adjustments is None:
        adjustments = db.scalars(
            select(TimeAdjustmentRequest).where(
                TimeAdjustmentRequest.company_id == company_id,
                TimeAdjustmentRequest.employee_id == employee.id,
                TimeAdjustmentRequest.requested_date.between(first, last),
            )
        ).all()
    if overtime_records is None:
        overtime_records = db.scalars(
            select(OvertimeRecord).where(
                OvertimeRecord.company_id == company_id,
                OvertimeRecord.employee_id == employee.id,
                OvertimeRecord.work_date.between(first, last),
            )
        ).all()
    if approved_leave is None:
        approved_leave = db.scalars(
            select(LeaveRequest).where(
                LeaveRequest.company_id == company_id,
                LeaveRequest.employee_id == employee.id,
                LeaveRequest.status == "approved",
                LeaveRequest.start_date <= last,
                LeaveRequest.end_date >= first,
            )
        ).all()

    sessions_by_day: dict[date, list[WorkSession]] = defaultdict(list)
    month_sessions: list[WorkSession] = []
    for session in sessions:
        local_day = session.started_at.astimezone(zone).date()
        if first <= local_day <= last:
            sessions_by_day[local_day].append(session)
            month_sessions.append(session)
    sessions = month_sessions

    leave_days: set[date] = set()
    unpaid_leave_days: set[date] = set()
    for leave in approved_leave:
        cursor = max(first, leave.start_date)
        leave_last = min(last, leave.end_date)
        while cursor <= leave_last:
            leave_days.add(cursor)
            if leave.leave_type == "unpaid":
                unpaid_leave_days.add(cursor)
            cursor += timedelta(days=1)

    expected_days = 0
    expected_seconds = 0
    paid_break_seconds = 0
    unpaid_break_seconds = 0
    late_minutes = 0
    absence_days = 0
    elapsed_last = min(last, datetime.now(zone).date())
    working_days = set(profile.working_days or [0, 1, 2, 3, 4])
    cursor = max(first, employee.start_date) if employee.start_date else first
    while cursor <= last:
        if cursor.weekday() in working_days:
            expected_days += 1
            override = _daily_override(overrides, employee.id, cursor)
            shift_start, shift_end, rules = _day_schedule(profile, override)
            if shift_start and shift_end and shift_end > shift_start:
                shift_seconds = (
                    shift_end.hour * 3600
                    + shift_end.minute * 60
                    - shift_start.hour * 3600
                    - shift_start.minute * 60
                )
            else:
                shift_seconds = int(profile.required_daily_minutes or 480) * 60
            expected_seconds += shift_seconds
            day_sessions = sessions_by_day.get(cursor, [])
            if day_sessions:
                paid, unpaid = _break_totals(rules)
                paid_break_seconds += paid
                unpaid_break_seconds += unpaid
            if cursor <= elapsed_last and not day_sessions and cursor not in leave_days:
                absence_days += 1
            if day_sessions and shift_start:
                first_start = min(item.started_at for item in day_sessions).astimezone(zone)
                scheduled = datetime.combine(cursor, shift_start, tzinfo=zone)
                grace = timedelta(minutes=int(profile.late_grace_minutes or 15))
                if first_start > scheduled + grace:
                    late_minutes += int((first_start - scheduled - grace).total_seconds() // 60)
        cursor += timedelta(days=1)

    worked_seconds = sum(max(0, item.active_seconds - item.deducted_seconds) for item in sessions)
    idle_seconds = sum(max(0, item.idle_seconds) for item in sessions)
    manual = {"approved": 0, "pending": 0, "rejected": 0}
    for item in adjustments:
        seconds = item.approved_seconds if item.status == "approved" else item.requested_seconds
        manual[item.status] = manual.get(item.status, 0) + int(seconds or 0)

    recorded_overtime = sum(max(0, item.recorded_extra_seconds) for item in overtime_records)
    recorded_overtime = max(recorded_overtime, sum(max(0, item.extra_seconds) for item in sessions))
    approved_overtime = sum(
        max(0, item.approved_seconds) for item in overtime_records if item.status == "approved"
    )
    rejected_overtime = sum(
        max(0, item.recorded_extra_seconds)
        for item in overtime_records
        if item.status == "rejected"
    )
    configured = decimal(profile.salary_amount)
    monthly_paid_hours = Decimal(int(profile.required_daily_minutes or 480) * 30) / Decimal(60)
    hourly_rate = (
        configured
        if profile.salary_type == "hourly"
        else (configured / monthly_paid_hours if monthly_paid_hours else Decimal(0))
    )
    regular_payable_seconds = min(
        expected_seconds,
        worked_seconds + manual["approved"] + paid_break_seconds,
    )
    base_salary = (
        configured
        if profile.salary_type == "monthly"
        else (Decimal(regular_payable_seconds) / Decimal(3600) * hourly_rate)
    )
    needs_review = any(
        (
            late_minutes,
            idle_seconds,
            absence_days,
            recorded_overtime,
            manual["pending"],
            unpaid_leave_days,
        )
    )
    return {
        "salary_type": profile.salary_type,
        "currency": profile.salary_currency or "EGP",
        "salary_amount": money(configured),
        "hourly_rate": hourly_rate.quantize(Decimal("0.0001")),
        "expected_work_days": expected_days,
        "expected_seconds": expected_seconds,
        "worked_seconds": worked_seconds,
        "approved_manual_seconds": manual["approved"],
        "pending_manual_seconds": manual["pending"],
        "rejected_manual_seconds": manual["rejected"],
        "idle_seconds": idle_seconds,
        "late_minutes": late_minutes,
        "paid_break_seconds": paid_break_seconds,
        "unpaid_break_seconds": unpaid_break_seconds,
        "absence_days": absence_days,
        "recorded_overtime_seconds": recorded_overtime,
        "approved_overtime_seconds": approved_overtime,
        "rejected_overtime_seconds": rejected_overtime,
        "overtime_eligible": bool(profile.overtime_enabled),
        "base_salary": money(base_salary),
        "default_overtime_multiplier": decimal(profile.overtime_rate_multiplier or 1),
        "needs_review": needs_review,
        "unpaid_leave_days": len(unpaid_leave_days),
        "shift_start": profile.shift_start.isoformat(timespec="minutes")
        if profile.shift_start
        else None,
        "shift_end": profile.shift_end.isoformat(timespec="minutes") if profile.shift_end else None,
        "late_grace_minutes": int(profile.late_grace_minutes or 15),
    }


def recalculate_entry(entry: PayrollEntry) -> None:
    adjustments = entry.adjustments or []
    adjustment_bonuses = sum(
        (decimal(item.amount) for item in adjustments if item.adjustment_type in BONUS_ADJUSTMENTS),
        Decimal(0),
    )
    adjustment_deductions = sum(
        (
            decimal(item.amount)
            for item in adjustments
            if item.adjustment_type in DEDUCTION_ADJUSTMENTS
        ),
        Decimal(0),
    )
    overtime_seconds = entry.approved_overtime_seconds or entry.recorded_overtime_seconds
    calculated_overtime = (
        Decimal(overtime_seconds)
        / Decimal(3600)
        * decimal(entry.hourly_rate)
        * decimal(entry.overtime_multiplier)
    )
    entry.overtime_amount = money(
        decimal(entry.custom_overtime_amount)
        if entry.pay_overtime and entry.custom_overtime_amount is not None
        else calculated_overtime
        if entry.pay_overtime
        else Decimal(0)
    )
    entry.total_deductions = money(
        (decimal(entry.lateness_deduction_amount) if entry.deduct_lateness else Decimal(0))
        + (decimal(entry.idle_deduction_amount) if entry.deduct_idle else Decimal(0))
        + (
            decimal(entry.unpaid_break_deduction_amount)
            if entry.deduct_unpaid_breaks
            else Decimal(0)
        )
        + decimal(entry.additional_deduction_amount)
        + adjustment_deductions
    )
    entry.total_bonuses = money(decimal(entry.bonus_amount) + adjustment_bonuses)
    entry.final_salary = money(
        max(
            Decimal(0),
            decimal(entry.base_salary)
            + decimal(entry.overtime_amount)
            + decimal(entry.total_bonuses)
            - decimal(entry.total_deductions),
        )
    )
    if entry.calculation_snapshot is not None:
        entry.calculation_snapshot = {
            **entry.calculation_snapshot,
            "overtime_amount": float(entry.overtime_amount),
            "total_deductions": float(entry.total_deductions),
            "total_bonuses": float(entry.total_bonuses),
            "final_salary": float(entry.final_salary),
        }


def refresh_run_entries(db: Session, run: PayrollRun) -> list[PayrollEntry]:
    existing = {
        item.employee_id: item
        for item in db.scalars(
            select(PayrollEntry)
            .options(selectinload(PayrollEntry.adjustments))
            .where(PayrollEntry.payroll_run_id == run.id)
        ).all()
    }
    if run.status in {"locked", "paid"}:
        return list(existing.values())

    first, last = month_bounds(run.month)
    employees = db.scalars(
        select(Employee)
        .where(
            Employee.company_id == run.company_id,
            Employee.status != "deleted",
            or_(Employee.start_date.is_(None), Employee.start_date <= last),
        )
        .order_by(Employee.name)
    ).all()
    overrides = db.scalars(
        select(WorkScheduleOverride).where(
            WorkScheduleOverride.company_id == run.company_id,
            WorkScheduleOverride.permanent.is_(False),
            WorkScheduleOverride.effective_date.between(first, last),
        )
    ).all()
    employee_ids = [employee.id for employee in employees]
    profiles = {
        profile.employee_id: profile
        for profile in db.scalars(
            select(EmployeeWorkProfile).where(
                EmployeeWorkProfile.company_id == run.company_id,
                EmployeeWorkProfile.employee_id.in_(employee_ids),
            )
        ).all()
    }
    # Fetch month data in batches. The two-day margin covers every practical
    # employee timezone; each employee's local month is filtered below.
    wide_start = datetime.combine(first - timedelta(days=2), time.min, tzinfo=UTC)
    wide_end = datetime.combine(last + timedelta(days=2), time.max, tzinfo=UTC)
    sessions_by_employee: dict[UUID, list[WorkSession]] = defaultdict(list)
    for item in db.scalars(
        select(WorkSession).where(
            WorkSession.company_id == run.company_id,
            WorkSession.employee_id.in_(employee_ids),
            WorkSession.started_at.between(wide_start, wide_end),
        )
    ).all():
        sessions_by_employee[item.employee_id].append(item)
    adjustments_by_employee: dict[UUID, list[TimeAdjustmentRequest]] = defaultdict(list)
    for item in db.scalars(
        select(TimeAdjustmentRequest).where(
            TimeAdjustmentRequest.company_id == run.company_id,
            TimeAdjustmentRequest.employee_id.in_(employee_ids),
            TimeAdjustmentRequest.requested_date.between(first, last),
        )
    ).all():
        adjustments_by_employee[item.employee_id].append(item)
    overtime_by_employee: dict[UUID, list[OvertimeRecord]] = defaultdict(list)
    for item in db.scalars(
        select(OvertimeRecord).where(
            OvertimeRecord.company_id == run.company_id,
            OvertimeRecord.employee_id.in_(employee_ids),
            OvertimeRecord.work_date.between(first, last),
        )
    ).all():
        overtime_by_employee[item.employee_id].append(item)
    leave_by_employee: dict[UUID, list[LeaveRequest]] = defaultdict(list)
    for item in db.scalars(
        select(LeaveRequest).where(
            LeaveRequest.company_id == run.company_id,
            LeaveRequest.employee_id.in_(employee_ids),
            LeaveRequest.status == "approved",
            LeaveRequest.start_date <= last,
            LeaveRequest.end_date >= first,
        )
    ).all():
        leave_by_employee[item.employee_id].append(item)
    teams = _team_names(db, run.company_id)
    result: list[PayrollEntry] = []
    for employee in employees:
        profile = profiles.get(employee.id)
        if profile is None:
            profile = get_or_create_work_profile(db, employee)
            profiles[employee.id] = profile
        metrics = calculate_employee_metrics(
            db,
            company_id=run.company_id,
            employee=employee,
            profile=profile,
            first=first,
            last=last,
            overrides=overrides,
            sessions=sessions_by_employee[employee.id],
            adjustments=adjustments_by_employee[employee.id],
            overtime_records=overtime_by_employee[employee.id],
            approved_leave=leave_by_employee[employee.id],
        )
        entry = existing.get(employee.id)
        if entry is None:
            entry = PayrollEntry(
                company_id=run.company_id,
                payroll_run_id=run.id,
                employee_id=employee.id,
                overtime_multiplier=metrics["default_overtime_multiplier"],
            )
            db.add(entry)
            entry.adjustments = []
        for field in (
            "salary_type",
            "currency",
            "salary_amount",
            "hourly_rate",
            "expected_work_days",
            "expected_seconds",
            "worked_seconds",
            "approved_manual_seconds",
            "pending_manual_seconds",
            "rejected_manual_seconds",
            "idle_seconds",
            "late_minutes",
            "paid_break_seconds",
            "unpaid_break_seconds",
            "absence_days",
            "recorded_overtime_seconds",
            "approved_overtime_seconds",
            "rejected_overtime_seconds",
            "overtime_eligible",
            "base_salary",
        ):
            setattr(entry, field, metrics[field])
        entry.team_name = teams.get(employee.id)
        entry.job_title = employee.job_title
        if entry.status in {"draft", "needs_review"}:
            entry.status = "needs_review" if metrics["needs_review"] else "draft"
        entry.calculation_snapshot = {
            **metrics,
            "base_salary": float(metrics["base_salary"]),
            "hourly_rate": float(metrics["hourly_rate"]),
            "salary_amount": float(metrics["salary_amount"]),
            "default_overtime_multiplier": float(metrics["default_overtime_multiplier"]),
        }
        recalculate_entry(entry)
        result.append(entry)
    db.flush()
    return result


def serialize_adjustment(item: PayrollAdjustment) -> dict:
    return {
        "id": str(item.id),
        "type": item.adjustment_type,
        "amount": float(item.amount),
        "reason": item.reason,
        "created_by": str(item.created_by_admin_user_id),
        "created_at": item.created_at.isoformat(),
    }


def serialize_entry(entry: PayrollEntry, *, include_details: bool = False) -> dict:
    data = {
        "id": str(entry.id),
        "employee_id": str(entry.employee_id),
        "employee_name": entry.employee.name if entry.employee else "Employee",
        "team": entry.team_name,
        "job_title": entry.job_title,
        "salary_type": entry.salary_type,
        "salary": float(entry.salary_amount),
        "currency": entry.currency,
        "hourly_rate": float(entry.hourly_rate),
        "expected_work_days": entry.expected_work_days,
        "expected_seconds": entry.expected_seconds,
        "worked_seconds": entry.worked_seconds,
        "approved_manual_seconds": entry.approved_manual_seconds,
        "pending_manual_seconds": entry.pending_manual_seconds,
        "rejected_manual_seconds": entry.rejected_manual_seconds,
        "idle_seconds": entry.idle_seconds,
        "late_minutes": entry.late_minutes,
        "paid_break_seconds": entry.paid_break_seconds,
        "unpaid_break_seconds": entry.unpaid_break_seconds,
        "absence_days": entry.absence_days,
        "recorded_overtime_seconds": entry.recorded_overtime_seconds,
        "approved_overtime_seconds": entry.approved_overtime_seconds,
        "rejected_overtime_seconds": entry.rejected_overtime_seconds,
        "overtime_eligible": entry.overtime_eligible,
        "deduct_lateness": entry.deduct_lateness,
        "lateness_deduction_amount": float(entry.lateness_deduction_amount),
        "lateness_note": entry.lateness_note,
        "deduct_idle": entry.deduct_idle,
        "idle_deduction_amount": float(entry.idle_deduction_amount),
        "idle_note": entry.idle_note,
        "pay_overtime": entry.pay_overtime,
        "overtime_decision": entry.overtime_decision,
        "overtime_multiplier": float(entry.overtime_multiplier),
        "custom_overtime_amount": float(entry.custom_overtime_amount)
        if entry.custom_overtime_amount is not None
        else None,
        "overtime_note": entry.overtime_note,
        "deduct_unpaid_breaks": entry.deduct_unpaid_breaks,
        "unpaid_break_deduction_amount": float(entry.unpaid_break_deduction_amount),
        "unpaid_break_note": entry.unpaid_break_note,
        "bonus_amount": float(entry.bonus_amount),
        "additional_deduction_amount": float(entry.additional_deduction_amount),
        "adjustment_note": entry.adjustment_note,
        "base_salary": float(entry.base_salary),
        "overtime_amount": float(entry.overtime_amount),
        "total_deductions": float(entry.total_deductions),
        "total_bonuses": float(entry.total_bonuses),
        "final_salary": float(entry.final_salary),
        "status": entry.status,
    }
    if include_details:
        data["calculation"] = entry.calculation_snapshot or {}
        data["adjustments"] = [serialize_adjustment(item) for item in entry.adjustments]
    return data


def serialize_run(run: PayrollRun) -> dict:
    return {
        "id": str(run.id),
        "month": run.month.strftime("%Y-%m"),
        "status": run.status,
        "approved_at": run.approved_at.isoformat() if run.approved_at else None,
        "locked_at": run.locked_at.isoformat() if run.locked_at else None,
        "paid_at": run.paid_at.isoformat() if run.paid_at else None,
    }
