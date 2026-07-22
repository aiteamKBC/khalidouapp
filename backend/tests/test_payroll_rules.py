from datetime import date
from decimal import Decimal

from app.models import PayrollAdjustment, PayrollEntry
from app.services.payroll import month_bounds, payroll_period_bounds, recalculate_entry


def test_month_bounds_accepts_payroll_month():
    assert month_bounds("2026-02") == (date(2026, 2, 1), date(2026, 2, 28))
    assert month_bounds("2028-02") == (date(2028, 2, 1), date(2028, 2, 29))


def test_default_payroll_cycle_runs_from_26_to_25():
    assert payroll_period_bounds("2026-07", 26, 25) == (
        date(2026, 6, 26),
        date(2026, 7, 25),
    )


def test_payroll_cycle_clamps_short_month_days_safely():
    assert payroll_period_bounds("2026-02", 31, 28) == (
        date(2026, 1, 31),
        date(2026, 2, 28),
    )
    assert payroll_period_bounds("2028-02", 31, 31) == (
        date(2028, 2, 29),
        date(2028, 2, 29),
    )


def test_payroll_decisions_are_manual_and_recalculate_final_salary():
    entry = PayrollEntry(
        base_salary=Decimal("10000"),
        hourly_rate=Decimal("50"),
        recorded_overtime_seconds=3600,
        approved_overtime_seconds=0,
        pay_overtime=True,
        overtime_decision="paid",
        overtime_multiplier=Decimal("1.5"),
        deduct_lateness=True,
        lateness_deduction_amount=Decimal("100"),
        deduct_idle=False,
        idle_deduction_amount=Decimal("500"),
        deduct_unpaid_breaks=False,
        unpaid_break_deduction_amount=Decimal("0"),
        bonus_amount=Decimal("100"),
        additional_deduction_amount=Decimal("50"),
        calculation_snapshot={},
    )
    entry.adjustments = [
        PayrollAdjustment(
            adjustment_type="bonus",
            amount=Decimal("200"),
            reason="Performance",
        ),
        PayrollAdjustment(
            adjustment_type="deduction",
            amount=Decimal("30"),
            reason="Correction",
        ),
    ]

    recalculate_entry(entry)

    assert entry.overtime_amount == Decimal("75.00")
    assert entry.total_bonuses == Decimal("300.00")
    assert entry.total_deductions == Decimal("180.00")
    assert entry.final_salary == Decimal("10195.00")


def test_recorded_overtime_is_not_paid_without_hr_decision():
    entry = PayrollEntry(
        base_salary=Decimal("10000"),
        hourly_rate=Decimal("50"),
        recorded_overtime_seconds=7200,
        approved_overtime_seconds=0,
        pay_overtime=False,
        overtime_decision="pending",
        overtime_multiplier=Decimal("2"),
        deduct_lateness=False,
        lateness_deduction_amount=Decimal("0"),
        deduct_idle=False,
        idle_deduction_amount=Decimal("0"),
        deduct_unpaid_breaks=False,
        unpaid_break_deduction_amount=Decimal("0"),
        bonus_amount=Decimal("0"),
        additional_deduction_amount=Decimal("0"),
    )
    entry.adjustments = []

    recalculate_entry(entry)

    assert entry.overtime_amount == Decimal("0.00")
    assert entry.final_salary == Decimal("10000.00")
