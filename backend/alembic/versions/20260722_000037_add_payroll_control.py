"""add payroll and attendance control

Revision ID: 20260722_000037
Revises: 20260722_000036
Create Date: 2026-07-22 00:00:37.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "20260722_000037"
down_revision: str | None = "20260722_000036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "payroll_runs",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="draft"),
        sa.Column("created_by_admin_user_id", sa.Uuid(), nullable=False),
        sa.Column("approved_by_admin_user_id", sa.Uuid(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("locked_by_admin_user_id", sa.Uuid(), nullable=True),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_by_admin_user_id", sa.Uuid(), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["created_by_admin_user_id"], ["admin_users.id"]),
        sa.ForeignKeyConstraint(["approved_by_admin_user_id"], ["admin_users.id"]),
        sa.ForeignKeyConstraint(["locked_by_admin_user_id"], ["admin_users.id"]),
        sa.ForeignKeyConstraint(["paid_by_admin_user_id"], ["admin_users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "month", name="uq_payroll_runs_company_month"),
    )
    for column in ("company_id", "month", "status"):
        op.create_index(op.f(f"ix_payroll_runs_{column}"), "payroll_runs", [column], unique=False)

    op.create_table(
        "payroll_entries",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("payroll_run_id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("team_name", sa.String(length=255), nullable=True),
        sa.Column("job_title", sa.String(length=255), nullable=True),
        sa.Column("salary_type", sa.String(length=20), nullable=False, server_default="monthly"),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column("salary_amount", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("hourly_rate", sa.Numeric(14, 4), nullable=False, server_default="0"),
        sa.Column("expected_work_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("expected_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("worked_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("approved_manual_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("pending_manual_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rejected_manual_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("idle_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("late_minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("paid_break_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unpaid_break_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("absence_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("recorded_overtime_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("approved_overtime_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rejected_overtime_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("overtime_eligible", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("deduct_lateness", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "lateness_deduction_amount", sa.Numeric(14, 2), nullable=False, server_default="0"
        ),
        sa.Column("lateness_note", sa.Text(), nullable=True),
        sa.Column("deduct_idle", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("idle_deduction_amount", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("idle_note", sa.Text(), nullable=True),
        sa.Column("pay_overtime", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "overtime_decision", sa.String(length=20), nullable=False, server_default="pending"
        ),
        sa.Column("overtime_multiplier", sa.Numeric(8, 2), nullable=False, server_default="1"),
        sa.Column("custom_overtime_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("overtime_note", sa.Text(), nullable=True),
        sa.Column("deduct_unpaid_breaks", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "unpaid_break_deduction_amount", sa.Numeric(14, 2), nullable=False, server_default="0"
        ),
        sa.Column("unpaid_break_note", sa.Text(), nullable=True),
        sa.Column("bonus_amount", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column(
            "additional_deduction_amount", sa.Numeric(14, 2), nullable=False, server_default="0"
        ),
        sa.Column("adjustment_note", sa.Text(), nullable=True),
        sa.Column("base_salary", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("overtime_amount", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("total_deductions", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("total_bonuses", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("final_salary", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="draft"),
        sa.Column("calculation_snapshot", sa.JSON(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["payroll_run_id"], ["payroll_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "payroll_run_id", "employee_id", name="uq_payroll_entries_run_employee"
        ),
    )
    for column in ("company_id", "payroll_run_id", "employee_id", "status"):
        op.create_index(
            op.f(f"ix_payroll_entries_{column}"), "payroll_entries", [column], unique=False
        )

    op.create_table(
        "payroll_adjustments",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("payroll_entry_id", sa.Uuid(), nullable=False),
        sa.Column("adjustment_type", sa.String(length=40), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by_admin_user_id", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["payroll_entry_id"], ["payroll_entries.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_admin_user_id"], ["admin_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("company_id", "payroll_entry_id", "adjustment_type"):
        op.create_index(
            op.f(f"ix_payroll_adjustments_{column}"), "payroll_adjustments", [column], unique=False
        )

    op.create_table(
        "work_schedule_overrides",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=True),
        sa.Column("scope", sa.String(length=20), nullable=False),
        sa.Column("override_type", sa.String(length=20), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=True),
        sa.Column("permanent", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("shift_start", sa.Time(), nullable=True),
        sa.Column("shift_end", sa.Time(), nullable=True),
        sa.Column("break_rules", sa.JSON(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by_admin_user_id", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["created_by_admin_user_id"], ["admin_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("company_id", "employee_id", "override_type", "effective_date"):
        op.create_index(
            op.f(f"ix_work_schedule_overrides_{column}"),
            "work_schedule_overrides",
            [column],
            unique=False,
        )


def downgrade() -> None:
    op.drop_table("work_schedule_overrides")
    op.drop_table("payroll_adjustments")
    op.drop_table("payroll_entries")
    op.drop_table("payroll_runs")
