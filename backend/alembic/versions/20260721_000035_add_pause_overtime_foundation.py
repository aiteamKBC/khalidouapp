"""add pause and overtime foundation

Revision ID: 20260721_000035
Revises: 20260720_000034
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260721_000035"
down_revision: Union[str, None] = "20260720_000034"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("work_sessions", sa.Column("normal_seconds", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("work_sessions", sa.Column("extra_seconds", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("work_sessions", sa.Column("paid_pause_seconds", sa.Integer(), nullable=False, server_default="0"))
    op.execute(
        """
        UPDATE work_sessions
        SET normal_seconds = LEAST(GREATEST(active_seconds - deducted_seconds, 0), 28800),
            extra_seconds = GREATEST(GREATEST(active_seconds - deducted_seconds, 0) - 28800, 0)
        """
    )

    op.add_column("employee_work_profiles", sa.Column("no_show_threshold_minutes", sa.Integer(), nullable=True))
    op.add_column(
        "employee_work_profiles",
        sa.Column("schedule_type", sa.String(length=20), nullable=False, server_default="fixed"),
    )
    op.add_column(
        "employee_work_profiles",
        sa.Column("weekly_early_leave_minutes", sa.Integer(), nullable=False, server_default="120"),
    )

    op.create_table(
        "pause_balances",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("base_seconds", sa.Integer(), nullable=False, server_default="600"),
        sa.Column("extra_approved_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("used_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("employee_id", "work_date", name="uq_pause_balances_employee_date"),
    )
    op.create_index(op.f("ix_pause_balances_company_id"), "pause_balances", ["company_id"], unique=False)
    op.create_index(op.f("ix_pause_balances_employee_id"), "pause_balances", ["employee_id"], unique=False)
    op.create_index(op.f("ix_pause_balances_work_date"), "pause_balances", ["work_date"], unique=False)

    op.create_table(
        "pause_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("work_session_id", sa.Uuid(), nullable=False),
        sa.Column("pause_balance_id", sa.Uuid(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("scheduled_end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("requested_seconds", sa.Integer(), nullable=False),
        sa.Column("used_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="active"),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("idempotency_key", sa.String(length=120), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["pause_balance_id"], ["pause_balances.id"]),
        sa.ForeignKeyConstraint(["work_session_id"], ["work_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("work_session_id", "idempotency_key", name="uq_pause_sessions_idempotency"),
    )
    op.create_index(op.f("ix_pause_sessions_company_id"), "pause_sessions", ["company_id"], unique=False)
    op.create_index(op.f("ix_pause_sessions_employee_id"), "pause_sessions", ["employee_id"], unique=False)
    op.create_index(op.f("ix_pause_sessions_pause_balance_id"), "pause_sessions", ["pause_balance_id"], unique=False)
    op.create_index(op.f("ix_pause_sessions_scheduled_end_at"), "pause_sessions", ["scheduled_end_at"], unique=False)
    op.create_index(op.f("ix_pause_sessions_started_at"), "pause_sessions", ["started_at"], unique=False)
    op.create_index(op.f("ix_pause_sessions_status"), "pause_sessions", ["status"], unique=False)
    op.create_index(op.f("ix_pause_sessions_work_session_id"), "pause_sessions", ["work_session_id"], unique=False)

    op.create_table(
        "overtime_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("work_session_id", sa.Uuid(), nullable=False),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("overtime_enabled_snapshot", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("recorded_extra_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("approved_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="recorded"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["work_session_id"], ["work_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("work_session_id", name="uq_overtime_records_work_session"),
    )
    op.create_index(op.f("ix_overtime_records_company_id"), "overtime_records", ["company_id"], unique=False)
    op.create_index(op.f("ix_overtime_records_employee_id"), "overtime_records", ["employee_id"], unique=False)
    op.create_index(op.f("ix_overtime_records_status"), "overtime_records", ["status"], unique=False)
    op.create_index(op.f("ix_overtime_records_work_date"), "overtime_records", ["work_date"], unique=False)
    op.create_index(op.f("ix_overtime_records_work_session_id"), "overtime_records", ["work_session_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_overtime_records_work_session_id"), table_name="overtime_records")
    op.drop_index(op.f("ix_overtime_records_work_date"), table_name="overtime_records")
    op.drop_index(op.f("ix_overtime_records_status"), table_name="overtime_records")
    op.drop_index(op.f("ix_overtime_records_employee_id"), table_name="overtime_records")
    op.drop_index(op.f("ix_overtime_records_company_id"), table_name="overtime_records")
    op.drop_table("overtime_records")

    op.drop_index(op.f("ix_pause_sessions_work_session_id"), table_name="pause_sessions")
    op.drop_index(op.f("ix_pause_sessions_status"), table_name="pause_sessions")
    op.drop_index(op.f("ix_pause_sessions_started_at"), table_name="pause_sessions")
    op.drop_index(op.f("ix_pause_sessions_scheduled_end_at"), table_name="pause_sessions")
    op.drop_index(op.f("ix_pause_sessions_pause_balance_id"), table_name="pause_sessions")
    op.drop_index(op.f("ix_pause_sessions_employee_id"), table_name="pause_sessions")
    op.drop_index(op.f("ix_pause_sessions_company_id"), table_name="pause_sessions")
    op.drop_table("pause_sessions")

    op.drop_index(op.f("ix_pause_balances_work_date"), table_name="pause_balances")
    op.drop_index(op.f("ix_pause_balances_employee_id"), table_name="pause_balances")
    op.drop_index(op.f("ix_pause_balances_company_id"), table_name="pause_balances")
    op.drop_table("pause_balances")

    op.drop_column("employee_work_profiles", "weekly_early_leave_minutes")
    op.drop_column("employee_work_profiles", "schedule_type")
    op.drop_column("employee_work_profiles", "no_show_threshold_minutes")
    op.drop_column("work_sessions", "paid_pause_seconds")
    op.drop_column("work_sessions", "extra_seconds")
    op.drop_column("work_sessions", "normal_seconds")
