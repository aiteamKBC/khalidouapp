"""add work profiles and hr role

Revision ID: 20260715_000025
Revises: 20260713_000024
Create Date: 2026-07-15 18:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "20260715_000025"
down_revision: str | None = "20260713_000024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.create_table(
        "employee_work_profiles",
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("employee_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("shift_start", sa.Time(), nullable=True),
        sa.Column("shift_end", sa.Time(), nullable=True),
        sa.Column("working_days", sa.JSON(), nullable=True),
        sa.Column("weekly_off_days", sa.JSON(), nullable=True),
        sa.Column("required_daily_minutes", sa.Integer(), nullable=True),
        sa.Column("break_rules", sa.JSON(), nullable=True),
        sa.Column("late_grace_minutes", sa.Integer(), nullable=True),
        sa.Column("deduction_policy", sa.JSON(), nullable=True),
        sa.Column("overtime_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("overtime_basis", sa.String(length=40), nullable=True),
        sa.Column("overtime_rate_multiplier", sa.Numeric(8, 2), nullable=True),
        sa.Column("salary_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("salary_currency", sa.String(length=3), nullable=True),
        sa.Column("profile_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("employee_id", name="uq_employee_work_profiles_employee"),
    )
    op.create_index(op.f("ix_employee_work_profiles_company_id"), "employee_work_profiles", ["company_id"], unique=False)
    op.create_index(op.f("ix_employee_work_profiles_employee_id"), "employee_work_profiles", ["employee_id"], unique=False)
    op.get_bind().exec_driver_sql(
        """
        INSERT INTO employee_work_profiles (
            id, company_id, employee_id, required_daily_minutes, late_grace_minutes,
            shift_start, shift_end, working_days, weekly_off_days, break_rules,
            deduction_policy, salary_amount, salary_currency, overtime_enabled,
            profile_completed_at, created_at, updated_at
        )
        SELECT gen_random_uuid(), company_id, id, 480, 15,
            '09:00'::time, '17:00'::time, '[0,1,2,3,4]'::json, '[5,6]'::json,
            '[{"name":"Lunch","minutes":30,"paid":false},{"name":"Short break","minutes":15,"paid":false}]'::json,
            '{"mode":"review","require_admin_review":true,"brackets":[{"after_minutes":15,"deduct_minutes":1,"note":"Admin/HR review by minute"}]}'::json,
            0, 'EGP', false, now(), now(), now()
        FROM employees
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_employee_work_profiles_employee_id"), table_name="employee_work_profiles")
    op.drop_index(op.f("ix_employee_work_profiles_company_id"), table_name="employee_work_profiles")
    op.drop_table("employee_work_profiles")
