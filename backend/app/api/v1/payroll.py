import csv
import html
import io
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_admin
from app.core.exceptions import ApiError
from app.core.responses import success_response
from app.api.v1.team_auth import accessible_employee_ids_statement, ensure_employee_access
from app.database.session import get_db
from app.models import (
    AdminUser,
    Employee,
    EmployeeWorkProfile,
    LeaveRequest,
    PayrollAdjustment,
    PayrollEntry,
    PayrollRun,
    WorkScheduleOverride,
    TimeAdjustmentRequest,
)
from app.schemas.admin import BreakRule
from app.services.audit import record_audit_log
from app.services.payroll import (
    get_or_create_run,
    month_bounds,
    recalculate_entry,
    refresh_run_entries,
    serialize_entry,
    serialize_run,
)
from app.services.permissions import require_capability
from app.services.permissions import has_company_data_scope
from app.services.work_profiles import get_or_create_work_profile, refresh_profile_completed_at


router = APIRouter(prefix="/payroll", tags=["payroll"])


class PayrollEntryUpdate(BaseModel):
    deduct_lateness: bool | None = None
    lateness_deduction_amount: Decimal | None = Field(default=None, ge=0)
    lateness_note: str | None = Field(default=None, max_length=2000)
    deduct_idle: bool | None = None
    idle_deduction_amount: Decimal | None = Field(default=None, ge=0)
    idle_note: str | None = Field(default=None, max_length=2000)
    deduct_unpaid_breaks: bool | None = None
    unpaid_break_deduction_amount: Decimal | None = Field(default=None, ge=0)
    unpaid_break_note: str | None = Field(default=None, max_length=2000)
    overtime_decision: Literal["pending", "paid", "rejected"] | None = None
    overtime_multiplier: Decimal | None = Field(default=None, ge=0, le=10)
    custom_overtime_amount: Decimal | None = Field(default=None, ge=0)
    overtime_note: str | None = Field(default=None, max_length=2000)
    bonus_amount: Decimal | None = Field(default=None, ge=0)
    additional_deduction_amount: Decimal | None = Field(default=None, ge=0)
    adjustment_note: str | None = Field(default=None, max_length=2000)
    status: Literal["draft", "needs_review", "approved"] | None = None


class PayrollAdjustmentCreate(BaseModel):
    adjustment_type: Literal[
        "bonus",
        "deduction",
        "late_deduction",
        "idle_deduction",
        "overtime_exception",
        "salary_correction",
        "unpaid_leave",
        "other",
    ]
    amount: Decimal = Field(gt=0)
    reason: str = Field(min_length=3, max_length=2000)


class PayrollRunStatusUpdate(BaseModel):
    status: Literal["draft", "approved", "locked", "paid"]
    reason: str | None = Field(default=None, max_length=2000)


class ScheduleOverrideCreate(BaseModel):
    scope: Literal["employee", "company"]
    override_type: Literal["shift", "breaks", "both"]
    employee_id: UUID | None = None
    effective_date: date | None = None
    permanent: bool = False
    shift_start: str | None = None
    shift_end: str | None = None
    break_rules: list[BreakRule] | None = None
    reason: str = Field(min_length=3, max_length=2000)

    @model_validator(mode="after")
    def validate_scope_and_timing(self):
        if self.scope == "employee" and self.employee_id is None:
            raise ValueError("Choose an employee for an employee override.")
        if not self.permanent and self.effective_date is None:
            raise ValueError("A one-day override requires an effective date.")
        if self.override_type in {"shift", "both"} and not (self.shift_start and self.shift_end):
            raise ValueError("Shift overrides require start and end times.")
        if self.override_type in {"breaks", "both"} and self.break_rules is None:
            raise ValueError("Break overrides require break rules.")
        return self


def _entry_or_404(db: Session, company_id: UUID, entry_id: UUID) -> PayrollEntry:
    entry = db.scalar(
        select(PayrollEntry)
        .options(selectinload(PayrollEntry.employee), selectinload(PayrollEntry.adjustments))
        .where(PayrollEntry.id == entry_id, PayrollEntry.company_id == company_id)
    )
    if entry is None:
        raise ApiError("PAYROLL_ENTRY_NOT_FOUND", "Payroll row was not found.", 404)
    return entry


def _ensure_entry_access(db: Session, admin: AdminUser, entry: PayrollEntry) -> None:
    ensure_employee_access(db, admin, entry.employee_id)


def _scope_entries(
    db: Session, admin: AdminUser, entries: list[PayrollEntry]
) -> list[PayrollEntry]:
    employee_ids = accessible_employee_ids_statement(db, admin)
    if employee_ids is None:
        return entries
    allowed = set(db.scalars(employee_ids).all())
    return [entry for entry in entries if entry.employee_id in allowed]


def _run_editable(db: Session, entry: PayrollEntry) -> PayrollRun:
    run = db.get(PayrollRun, entry.payroll_run_id)
    if run is None or run.status in {"locked", "paid"}:
        raise ApiError("PAYROLL_LOCKED", "Locked or paid payroll cannot be edited.", 409)
    return run


def _filtered_entries(
    entries: list[PayrollEntry],
    *,
    team: str | None,
    employee_id: UUID | None,
    status: str | None,
    overtime_eligible: bool | None,
    has_lateness: bool | None,
    has_idle: bool | None,
    has_deductions: bool | None,
    has_manual_adjustments: bool | None,
) -> list[PayrollEntry]:
    return [
        entry
        for entry in entries
        if (not team or entry.team_name == team)
        and (not employee_id or entry.employee_id == employee_id)
        and (not status or entry.status == status)
        and (overtime_eligible is None or entry.overtime_eligible == overtime_eligible)
        and (has_lateness is None or (entry.late_minutes > 0) == has_lateness)
        and (has_idle is None or (entry.idle_seconds > 0) == has_idle)
        and (has_deductions is None or (entry.total_deductions > 0) == has_deductions)
        and (has_manual_adjustments is None or bool(entry.adjustments) == has_manual_adjustments)
    ]


@router.get("/sheet")
def payroll_sheet(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    month: str = Query(pattern=r"^\d{4}-\d{2}$"),
    team: str | None = None,
    employee_id: UUID | None = None,
    status: str | None = None,
    overtime_eligible: bool | None = None,
    has_lateness: bool | None = None,
    has_idle: bool | None = None,
    has_deductions: bool | None = None,
    has_manual_adjustments: bool | None = None,
):
    require_capability(current_admin, "payroll.view")
    try:
        first, _ = month_bounds(month)
    except ValueError as exc:
        raise ApiError("INVALID_MONTH", str(exc), 400) from exc
    run = get_or_create_run(
        db,
        company_id=current_admin.company_id,
        month=first,
        admin_user_id=current_admin.id,
    )
    entries = refresh_run_entries(db, run)
    db.commit()
    entries = db.scalars(
        select(PayrollEntry)
        .options(selectinload(PayrollEntry.employee), selectinload(PayrollEntry.adjustments))
        .where(PayrollEntry.payroll_run_id == run.id)
        .order_by(PayrollEntry.team_name.nullslast(), PayrollEntry.employee_id)
    ).all()
    entries = _scope_entries(db, current_admin, entries)
    entries = _filtered_entries(
        entries,
        team=team,
        employee_id=employee_id,
        status=status,
        overtime_eligible=overtime_eligible,
        has_lateness=has_lateness,
        has_idle=has_idle,
        has_deductions=has_deductions,
        has_manual_adjustments=has_manual_adjustments,
    )
    currencies: dict[str, dict[str, float]] = {}
    for entry in entries:
        totals = currencies.setdefault(
            entry.currency,
            {"base": 0, "overtime": 0, "bonuses": 0, "deductions": 0, "final": 0},
        )
        totals["base"] += float(entry.base_salary)
        totals["overtime"] += float(entry.overtime_amount)
        totals["bonuses"] += float(entry.total_bonuses)
        totals["deductions"] += float(entry.total_deductions)
        totals["final"] += float(entry.final_salary)
    return success_response(
        data={
            "run": serialize_run(run),
            "summary": {
                "employees": len(entries),
                "needs_review": sum(item.status == "needs_review" for item in entries),
                "late_employees": sum(item.late_minutes > 0 for item in entries),
                "overtime_employees": sum(item.recorded_overtime_seconds > 0 for item in entries),
                "currencies": currencies,
            },
            "teams": sorted({item.team_name for item in entries if item.team_name}),
            "entries": [serialize_entry(item) for item in entries],
        }
    )


@router.get("/entries/{entry_id}")
def payroll_entry_detail(
    entry_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_capability(current_admin, "payroll.view")
    entry = _entry_or_404(db, current_admin.company_id, entry_id)
    _ensure_entry_access(db, current_admin, entry)
    return success_response(data=serialize_entry(entry, include_details=True))


@router.patch("/entries/{entry_id}")
def update_payroll_entry(
    entry_id: UUID,
    payload: PayrollEntryUpdate,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_capability(current_admin, "payroll.manage")
    entry = _entry_or_404(db, current_admin.company_id, entry_id)
    _ensure_entry_access(db, current_admin, entry)
    _run_editable(db, entry)
    changes = payload.model_dump(exclude_unset=True)
    before = {
        key: str(getattr(entry, key)) if getattr(entry, key) is not None else None
        for key in changes
    }
    for key, value in changes.items():
        setattr(entry, key, value)
    entry.pay_overtime = entry.overtime_decision == "paid"
    if (
        entry.deduct_lateness
        and entry.lateness_deduction_amount > 0
        and not (entry.lateness_note or "").strip()
    ):
        raise ApiError("DEDUCTION_REASON_REQUIRED", "Add a reason for the lateness deduction.", 400)
    if (
        entry.deduct_idle
        and entry.idle_deduction_amount > 0
        and not (entry.idle_note or "").strip()
    ):
        raise ApiError("DEDUCTION_REASON_REQUIRED", "Add a reason for the idle deduction.", 400)
    if (
        entry.deduct_unpaid_breaks
        and entry.unpaid_break_deduction_amount > 0
        and not (entry.unpaid_break_note or "").strip()
    ):
        raise ApiError(
            "DEDUCTION_REASON_REQUIRED", "Add a reason for the unpaid break deduction.", 400
        )
    if entry.additional_deduction_amount > 0 and not (entry.adjustment_note or "").strip():
        raise ApiError("DEDUCTION_REASON_REQUIRED", "Add a reason for the manual deduction.", 400)
    if entry.overtime_decision in {"paid", "rejected"} and not (entry.overtime_note or "").strip():
        raise ApiError("OVERTIME_NOTE_REQUIRED", "Add a note for the overtime decision.", 400)
    recalculate_entry(entry)
    db.add(entry)
    record_audit_log(
        db,
        current_admin,
        "updated",
        "payroll_entry",
        entity_id=entry.id,
        entity_name=entry.employee.name,
        details={"old": before, "new": {key: str(getattr(entry, key)) for key in changes}},
        request=request,
    )
    db.commit()
    db.refresh(entry)
    return success_response(
        data=serialize_entry(
            _entry_or_404(db, current_admin.company_id, entry.id), include_details=True
        )
    )


@router.post("/entries/{entry_id}/adjustments")
def add_payroll_adjustment(
    entry_id: UUID,
    payload: PayrollAdjustmentCreate,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_capability(current_admin, "payroll.manage")
    entry = _entry_or_404(db, current_admin.company_id, entry_id)
    _ensure_entry_access(db, current_admin, entry)
    _run_editable(db, entry)
    item = PayrollAdjustment(
        company_id=current_admin.company_id,
        payroll_entry_id=entry.id,
        adjustment_type=payload.adjustment_type,
        amount=payload.amount,
        reason=payload.reason,
        created_by_admin_user_id=current_admin.id,
    )
    db.add(item)
    db.flush()
    entry.adjustments.append(item)
    recalculate_entry(entry)
    record_audit_log(
        db,
        current_admin,
        "created",
        "payroll_adjustment",
        entity_id=item.id,
        entity_name=entry.employee.name,
        details=payload.model_dump(mode="json"),
        request=request,
    )
    db.commit()
    return success_response(
        data=serialize_entry(
            _entry_or_404(db, current_admin.company_id, entry.id), include_details=True
        )
    )


@router.delete("/adjustments/{adjustment_id}")
def delete_payroll_adjustment(
    adjustment_id: UUID,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_capability(current_admin, "payroll.manage")
    item = db.scalar(
        select(PayrollAdjustment).where(
            PayrollAdjustment.id == adjustment_id,
            PayrollAdjustment.company_id == current_admin.company_id,
        )
    )
    if item is None:
        raise ApiError("PAYROLL_ADJUSTMENT_NOT_FOUND", "Payroll adjustment was not found.", 404)
    entry = _entry_or_404(db, current_admin.company_id, item.payroll_entry_id)
    _ensure_entry_access(db, current_admin, entry)
    _run_editable(db, entry)
    details = {"type": item.adjustment_type, "amount": str(item.amount), "reason": item.reason}
    entry.adjustments.remove(item)
    db.delete(item)
    recalculate_entry(entry)
    record_audit_log(
        db,
        current_admin,
        "deleted",
        "payroll_adjustment",
        entity_id=item.id,
        details=details,
        request=request,
    )
    db.commit()
    return success_response(data={"deleted": True})


@router.patch("/runs/{run_id}/status")
def update_payroll_run_status(
    run_id: UUID,
    payload: PayrollRunStatusUpdate,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_capability(current_admin, "payroll.manage")
    if not has_company_data_scope(current_admin):
        raise ApiError(
            "COMPANY_SCOPE_REQUIRED", "Company payroll status requires company-wide access.", 403
        )
    run = db.scalar(
        select(PayrollRun).where(
            PayrollRun.id == run_id, PayrollRun.company_id == current_admin.company_id
        )
    )
    if run is None:
        raise ApiError("PAYROLL_RUN_NOT_FOUND", "Payroll run was not found.", 404)
    old = run.status
    allowed_transitions = {
        "draft": {"draft", "approved"},
        "approved": {"approved", "draft", "locked"},
        "locked": {"locked", "draft", "paid"},
        "paid": {"paid"},
    }
    if payload.status not in allowed_transitions.get(old, set()):
        raise ApiError(
            "INVALID_PAYROLL_STATUS_TRANSITION",
            f"Payroll cannot move from {old} directly to {payload.status}.",
            409,
        )
    if payload.status in {"approved", "locked"}:
        unresolved = sum(entry.status == "needs_review" for entry in run.entries)
        if unresolved:
            raise ApiError(
                "PAYROLL_REVIEW_REQUIRED",
                f"Review and approve {unresolved} payroll row(s) before continuing.",
                409,
            )
    if old == "locked" and payload.status == "draft" and current_admin.role != "general_admin":
        raise ApiError("GENERAL_ADMIN_REQUIRED", "Only General Admin can unlock payroll.", 403)
    if old == "locked" and payload.status == "draft" and not (payload.reason or "").strip():
        raise ApiError("PAYROLL_REASON_REQUIRED", "Add a reason before unlocking payroll.", 400)
    run.status = payload.status
    now = datetime.now(UTC)
    if payload.status == "approved":
        run.approved_by_admin_user_id, run.approved_at = current_admin.id, now
    elif payload.status == "locked":
        run.locked_by_admin_user_id, run.locked_at = current_admin.id, now
    elif payload.status == "paid":
        if old != "locked":
            raise ApiError("PAYROLL_MUST_BE_LOCKED", "Lock payroll before marking it paid.", 409)
        run.paid_by_admin_user_id, run.paid_at = current_admin.id, now
    elif payload.status == "draft":
        run.approved_by_admin_user_id, run.approved_at = None, None
        run.locked_by_admin_user_id, run.locked_at = None, None
    entry_status = payload.status if payload.status in {"approved", "locked", "paid"} else "draft"
    for entry in run.entries:
        entry.status = entry_status
    record_audit_log(
        db,
        current_admin,
        "status_changed",
        "payroll_run",
        entity_id=run.id,
        entity_name=run.month.strftime("%Y-%m"),
        details={"old": old, "new": payload.status, "reason": payload.reason},
        request=request,
    )
    db.commit()
    return success_response(data=serialize_run(run))


@router.get("/exceptions")
def payroll_exceptions(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    month: str = Query(pattern=r"^\d{4}-\d{2}$"),
):
    require_capability(current_admin, "payroll.view")
    first, _ = month_bounds(month)
    run = db.scalar(
        select(PayrollRun).where(
            PayrollRun.company_id == current_admin.company_id, PayrollRun.month == first
        )
    )
    if run is None:
        run = get_or_create_run(
            db, company_id=current_admin.company_id, month=first, admin_user_id=current_admin.id
        )
        refresh_run_entries(db, run)
        db.commit()
    entries = db.scalars(
        select(PayrollEntry)
        .options(selectinload(PayrollEntry.employee))
        .where(PayrollEntry.payroll_run_id == run.id)
    ).all()
    entries = _scope_entries(db, current_admin, entries)
    by_employee = {item.employee_id: item for item in entries}
    first, last = month_bounds(month)
    pending_holiday_ids = set(
        db.scalars(
            select(LeaveRequest.employee_id).where(
                LeaveRequest.company_id == current_admin.company_id,
                LeaveRequest.status == "pending",
                LeaveRequest.start_date <= last,
                LeaveRequest.end_date >= first,
            )
        ).all()
    )
    pending_permission_ids = set(
        db.scalars(
            select(TimeAdjustmentRequest.employee_id).where(
                TimeAdjustmentRequest.company_id == current_admin.company_id,
                TimeAdjustmentRequest.status == "pending",
                TimeAdjustmentRequest.requested_date.between(first, last),
            )
        ).all()
    )
    categories = {
        "late": [item for item in entries if item.late_minutes > 0],
        "high_idle": [item for item in entries if item.idle_seconds >= 3600],
        "missing_work": [item for item in entries if item.absence_days > 0],
        "overtime": [item for item in entries if item.recorded_overtime_seconds > 0],
        "pending_manual": [item for item in entries if item.pending_manual_seconds > 0],
        "missing_breaks": [
            item for item in entries if item.paid_break_seconds + item.unpaid_break_seconds == 0
        ],
        "pending_holiday": [
            by_employee[item] for item in pending_holiday_ids if item in by_employee
        ],
        "pending_permission": [
            by_employee[item] for item in pending_permission_ids if item in by_employee
        ],
    }
    return success_response(
        data={key: [serialize_entry(item) for item in values] for key, values in categories.items()}
    )


@router.post("/schedule-overrides")
def create_schedule_override(
    payload: ScheduleOverrideCreate,
    request: Request,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    require_capability(current_admin, "payroll.manage")
    if payload.scope == "company" and not has_company_data_scope(current_admin):
        raise ApiError(
            "COMPANY_SCOPE_REQUIRED", "Only company-wide HR/Admin can override all employees.", 403
        )
    employee_ids: list[UUID]
    if payload.scope == "employee":
        employee = db.scalar(
            select(Employee).where(
                Employee.id == payload.employee_id, Employee.company_id == current_admin.company_id
            )
        )
        if employee is None:
            raise ApiError("EMPLOYEE_NOT_FOUND", "Employee was not found.", 404)
        employee_ids = [employee.id]
    else:
        employee_ids = list(
            db.scalars(
                select(Employee.id).where(
                    Employee.company_id == current_admin.company_id, Employee.status != "deleted"
                )
            ).all()
        )
    try:
        parsed_start = (
            datetime.strptime(payload.shift_start, "%H:%M").time() if payload.shift_start else None
        )
        parsed_end = (
            datetime.strptime(payload.shift_end, "%H:%M").time() if payload.shift_end else None
        )
    except ValueError as exc:
        raise ApiError("INVALID_SHIFT", "Shift time must use HH:MM.", 400) from exc
    if parsed_start and parsed_end and parsed_end <= parsed_start:
        raise ApiError("INVALID_SHIFT", "Shift end must be later than shift start.", 400)
    rules = (
        [item.model_dump(mode="json") for item in payload.break_rules]
        if payload.break_rules is not None
        else None
    )
    if payload.break_rules is not None:
        profiles_by_employee = {
            profile.employee_id: profile
            for profile in db.scalars(
                select(EmployeeWorkProfile).where(EmployeeWorkProfile.employee_id.in_(employee_ids))
            ).all()
        }
        for rule in payload.break_rules:
            if rule.start_time is None or rule.end_time is None or rule.end_time <= rule.start_time:
                raise ApiError(
                    "INVALID_BREAK", "Every break needs a valid start and end time.", 400
                )
            actual_minutes = (
                rule.end_time.hour * 60
                + rule.end_time.minute
                - rule.start_time.hour * 60
                - rule.start_time.minute
            )
            if actual_minutes != rule.minutes:
                raise ApiError(
                    "INVALID_BREAK_DURATION", "Break duration must match start and end.", 400
                )
            for employee_id in employee_ids:
                profile = profiles_by_employee.get(employee_id)
                effective_start = parsed_start or (profile.shift_start if profile else None)
                effective_end = parsed_end or (profile.shift_end if profile else None)
                if (
                    effective_start
                    and effective_end
                    and not (effective_start <= rule.start_time < rule.end_time <= effective_end)
                ):
                    raise ApiError(
                        "BREAK_OUTSIDE_SHIFT",
                        "Every break must be fully inside the affected shift.",
                        400,
                    )
    item = WorkScheduleOverride(
        company_id=current_admin.company_id,
        employee_id=payload.employee_id if payload.scope == "employee" else None,
        scope=payload.scope,
        override_type=payload.override_type,
        effective_date=None if payload.permanent else payload.effective_date,
        permanent=payload.permanent,
        shift_start=parsed_start,
        shift_end=parsed_end,
        break_rules=rules,
        reason=payload.reason,
        created_by_admin_user_id=current_admin.id,
    )
    db.add(item)
    if payload.permanent:
        profiles = db.scalars(
            select(EmployeeWorkProfile).where(EmployeeWorkProfile.employee_id.in_(employee_ids))
        ).all()
        existing_ids = {profile.employee_id for profile in profiles}
        for employee_id in employee_ids:
            if employee_id not in existing_ids:
                employee = db.get(Employee, employee_id)
                if employee:
                    profiles.append(get_or_create_work_profile(db, employee))
        for profile in profiles:
            if payload.override_type in {"shift", "both"}:
                profile.shift_start, profile.shift_end = parsed_start, parsed_end
            if payload.override_type in {"breaks", "both"}:
                profile.break_rules = rules
            refresh_profile_completed_at(profile)
            db.add(profile)
    record_audit_log(
        db,
        current_admin,
        "created",
        "work_schedule_override",
        entity_id=item.id,
        details=payload.model_dump(mode="json"),
        request=request,
    )
    db.commit()
    return success_response(data={"id": str(item.id), "affected_employees": len(employee_ids)})


EXPORT_COLUMNS = [
    ("Employee", "employee_name"),
    ("Team", "team"),
    ("Job title", "job_title"),
    ("Salary", "salary"),
    ("Currency", "currency"),
    ("Expected days", "expected_work_days"),
    ("Expected seconds", "expected_seconds"),
    ("Worked seconds", "worked_seconds"),
    ("Manual approved", "approved_manual_seconds"),
    ("Idle seconds", "idle_seconds"),
    ("Late minutes", "late_minutes"),
    ("Paid breaks", "paid_break_seconds"),
    ("Unpaid breaks", "unpaid_break_seconds"),
    ("Absence days", "absence_days"),
    ("Recorded overtime", "recorded_overtime_seconds"),
    ("Payable overtime", "approved_overtime_seconds"),
    ("Base salary", "base_salary"),
    ("Overtime amount", "overtime_amount"),
    ("Deductions", "total_deductions"),
    ("Bonuses", "total_bonuses"),
    ("Final salary", "final_salary"),
    ("Status", "status"),
    ("Notes", "adjustment_note"),
]


def _export_rows(db: Session, admin: AdminUser, month: str) -> list[dict]:
    first, _ = month_bounds(month)
    run = db.scalar(
        select(PayrollRun).where(
            PayrollRun.company_id == admin.company_id, PayrollRun.month == first
        )
    )
    if run is None:
        return []
    entries = db.scalars(
        select(PayrollEntry)
        .options(selectinload(PayrollEntry.employee))
        .where(PayrollEntry.payroll_run_id == run.id)
    ).all()
    entries = _scope_entries(db, admin, entries)
    return [serialize_entry(item) for item in entries]


def _pdf_document(lines: list[str]) -> bytes:
    pages = [lines[index : index + 34] for index in range(0, len(lines), 34)] or [[]]
    objects: list[bytes] = []
    page_ids = [4 + index * 2 for index in range(len(pages))]
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(
        f"<< /Type /Pages /Kids [{' '.join(f'{item} 0 R' for item in page_ids)}] /Count {len(page_ids)} >>".encode()
    )
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>")
    for index, page in enumerate(pages):
        page_id = page_ids[index]
        content_id = page_id + 1
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>".encode()
        )
        commands = ["BT /F1 7 Tf 25 565 Td"]
        for line_index, line in enumerate(page):
            safe = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            commands.append(("0 -15 Td " if line_index else "") + f"({safe[:150]}) Tj")
        commands.append("ET")
        stream = "\n".join(commands).encode("latin-1", "replace")
        objects.append(f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream")
    output = io.BytesIO()
    output.write(b"%PDF-1.4\n")
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(output.tell())
        output.write(f"{number} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = output.tell()
    output.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        output.write(f"{offset:010d} 00000 n \n".encode())
    output.write(
        f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()
    )
    return output.getvalue()


@router.get("/export")
def export_payroll(
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    month: str = Query(pattern=r"^\d{4}-\d{2}$"),
    format: Literal["csv", "excel", "pdf"] = "csv",
):
    require_capability(current_admin, "payroll.view")
    rows = _export_rows(db, current_admin, month)
    if format == "pdf":
        lines = ["Khaliduo Payroll " + month, " | ".join(label for label, _ in EXPORT_COLUMNS)]
        lines.extend(
            " | ".join(str(row.get(key) or "") for _, key in EXPORT_COLUMNS) for row in rows
        )
        return Response(
            content=_pdf_document(lines),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="payroll-{month}.pdf"'},
        )
    if format == "excel":
        header = "".join(f"<th>{html.escape(label)}</th>" for label, _ in EXPORT_COLUMNS)
        body = "".join(
            "<tr>"
            + "".join(
                f"<td>{html.escape(str(row.get(key) or ''))}</td>" for _, key in EXPORT_COLUMNS
            )
            + "</tr>"
            for row in rows
        )
        document = f"<html><meta charset='utf-8'><table><thead><tr>{header}</tr></thead><tbody>{body}</tbody></table></html>"
        return Response(
            content=document.encode("utf-8"),
            media_type="application/vnd.ms-excel",
            headers={"Content-Disposition": f'attachment; filename="payroll-{month}.xls"'},
        )
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([label for label, _ in EXPORT_COLUMNS])
    writer.writerows([[row.get(key) for _, key in EXPORT_COLUMNS] for row in rows])
    return StreamingResponse(
        iter([output.getvalue().encode("utf-8-sig")]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="payroll-{month}.csv"'},
    )
