"""add stored daily attendance and screenshot capture audit

Revision ID: 20260722_000038
Revises: 20260722_000037
Create Date: 2026-07-22 00:00:38.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260722_000038"
down_revision: str | None = "20260722_000037"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "daily_attendance",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("timezone", sa.String(80), nullable=False, server_default="UTC"),
        sa.Column("scheduled_start_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("scheduled_end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actual_first_activity_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actual_last_activity_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("normal_worked_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("paid_break_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unpaid_break_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("idle_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("approved_manual_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("pending_manual_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rejected_manual_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("raw_late_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("deductible_late_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("early_leave_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("pre_shift_extra_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("post_shift_extra_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("recorded_overtime_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("approved_overtime_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unapproved_overtime_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_payable_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(40), nullable=False, server_default="not_started"),
        sa.Column("leave_status", sa.String(40), nullable=True),
        sa.Column("issues", sa.JSON(), nullable=True),
        sa.Column("calculation_sources", sa.JSON(), nullable=True),
        sa.Column("calculated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "company_id", "employee_id", "work_date", name="uq_daily_attendance_employee_day"
        ),
    )
    op.create_index(
        "ix_daily_attendance_company_day_status",
        "daily_attendance",
        ["company_id", "work_date", "status"],
    )
    op.create_index(
        "ix_daily_attendance_employee_day", "daily_attendance", ["employee_id", "work_date"]
    )

    op.add_column(
        "screenshots",
        sa.Column("work_category", sa.String(30), nullable=False, server_default="scheduled_shift"),
    )
    op.add_column(
        "screenshots",
        sa.Column("power_source", sa.String(20), nullable=False, server_default="unknown"),
    )
    op.alter_column(
        "screenshots",
        "session_id",
        existing_type=sa.Uuid(),
        nullable=True,
    )
    op.create_index("ix_screenshots_work_category", "screenshots", ["work_category"])
    op.create_table(
        "screenshot_capture_events",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("device_id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=True),
        sa.Column("screenshot_id", sa.Uuid(), nullable=True),
        sa.Column("event_key", sa.String(120), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("outcome", sa.String(20), nullable=False),
        sa.Column("reason", sa.String(80), nullable=True),
        sa.Column("work_category", sa.String(30), nullable=False, server_default="unknown"),
        sa.Column("power_source", sa.String(20), nullable=False, server_default="unknown"),
        sa.Column("tracking_status", sa.String(40), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"]),
        sa.ForeignKeyConstraint(["session_id"], ["work_sessions.id"]),
        sa.ForeignKeyConstraint(["screenshot_id"], ["screenshots.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "device_id", "event_key", name="uq_screenshot_capture_event_device_key"
        ),
    )
    op.create_index(
        "ix_screenshot_capture_events_company_employee_time",
        "screenshot_capture_events",
        ["company_id", "employee_id", "occurred_at"],
    )
    op.create_index(
        "ix_screenshot_capture_events_outcome", "screenshot_capture_events", ["outcome"]
    )
    op.create_index("ix_screenshot_capture_events_reason", "screenshot_capture_events", ["reason"])

    payroll_columns = (
        ("worked_days", sa.Integer(), "0"),
        ("leave_days", sa.Integer(), "0"),
        ("normal_seconds", sa.Integer(), "0"),
        ("total_payable_seconds", sa.Integer(), "0"),
        ("raw_late_minutes", sa.Integer(), "0"),
        ("early_leave_minutes", sa.Integer(), "0"),
    )
    for name, column_type, default in payroll_columns:
        op.add_column(
            "payroll_entries",
            sa.Column(name, column_type, nullable=False, server_default=default),
        )


def downgrade() -> None:
    for name in (
        "early_leave_minutes",
        "raw_late_minutes",
        "total_payable_seconds",
        "normal_seconds",
        "leave_days",
        "worked_days",
    ):
        op.drop_column("payroll_entries", name)
    op.drop_table("screenshot_capture_events")
    op.drop_index("ix_screenshots_work_category", table_name="screenshots")
    op.drop_column("screenshots", "power_source")
    op.drop_column("screenshots", "work_category")
    op.execute("DELETE FROM screenshots WHERE session_id IS NULL")
    op.alter_column(
        "screenshots",
        "session_id",
        existing_type=sa.Uuid(),
        nullable=False,
    )
    op.drop_table("daily_attendance")
