"""add payroll cycle settings and team schedule overrides

Revision ID: 20260723_000039
Revises: 20260722_000038
Create Date: 2026-07-23 00:00:39.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260723_000039"
down_revision: str | None = "20260722_000038"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "daily_attendance",
        sa.Column("actual_sign_out_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "company_payroll_settings",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("cycle_start_day", sa.Integer(), nullable=False, server_default="26"),
        sa.Column("cycle_end_day", sa.Integer(), nullable=False, server_default="25"),
        sa.Column("timezone", sa.String(80), nullable=False, server_default="Africa/Cairo"),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", name="uq_company_payroll_settings_company"),
    )
    op.create_index(
        "ix_company_payroll_settings_company_id",
        "company_payroll_settings",
        ["company_id"],
    )
    op.add_column("payroll_runs", sa.Column("period_start", sa.Date(), nullable=True))
    op.add_column("payroll_runs", sa.Column("period_end", sa.Date(), nullable=True))
    op.add_column("payroll_runs", sa.Column("cycle_timezone", sa.String(80), nullable=True))
    op.create_index("ix_payroll_runs_period_start", "payroll_runs", ["period_start"])
    op.create_index("ix_payroll_runs_period_end", "payroll_runs", ["period_end"])
    op.add_column("work_schedule_overrides", sa.Column("team_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_work_schedule_overrides_team_id_teams",
        "work_schedule_overrides",
        "teams",
        ["team_id"],
        ["id"],
    )
    op.create_index(
        "ix_work_schedule_overrides_team_id", "work_schedule_overrides", ["team_id"]
    )

    # One-time data correction requested by the company. Break rules are intentionally untouched.
    op.execute(
        """
        UPDATE employees
        SET timezone = 'Africa/Cairo'
        WHERE lower(email) = 'khaled.ashraf@kentbusinesscollege.com'
        """
    )
    op.execute(
        """
        UPDATE employee_work_profiles
        SET shift_start = '10:00:00', shift_end = '18:00:00', required_daily_minutes = 480
        WHERE employee_id IN (
            SELECT id FROM employees
            WHERE lower(email) = 'khaled.ashraf@kentbusinesscollege.com'
        )
        """
    )


def downgrade() -> None:
    op.drop_index("ix_work_schedule_overrides_team_id", table_name="work_schedule_overrides")
    op.drop_constraint(
        "fk_work_schedule_overrides_team_id_teams",
        "work_schedule_overrides",
        type_="foreignkey",
    )
    op.drop_column("work_schedule_overrides", "team_id")
    op.drop_index("ix_payroll_runs_period_end", table_name="payroll_runs")
    op.drop_index("ix_payroll_runs_period_start", table_name="payroll_runs")
    op.drop_column("payroll_runs", "cycle_timezone")
    op.drop_column("payroll_runs", "period_end")
    op.drop_column("payroll_runs", "period_start")
    op.drop_index(
        "ix_company_payroll_settings_company_id", table_name="company_payroll_settings"
    )
    op.drop_table("company_payroll_settings")
    op.drop_column("daily_attendance", "actual_sign_out_at")
