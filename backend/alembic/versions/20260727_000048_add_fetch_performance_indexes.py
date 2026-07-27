"""add composite indexes for dashboard and agent fetch paths

Revision ID: 20260727_000048
Revises: 20260726_000047
"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260727_000048"
down_revision: Union[str, None] = "20260726_000047"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_work_sessions_company_employee_started",
        "work_sessions",
        ["company_id", "employee_id", "started_at"],
    )
    op.create_index(
        "ix_work_sessions_company_employee_open",
        "work_sessions",
        ["company_id", "employee_id", "ended_at"],
    )
    op.create_index(
        "ix_activity_events_company_employee_time",
        "activity_events",
        ["company_id", "employee_id", "event_timestamp"],
    )
    op.create_index(
        "ix_screenshots_company_employee_captured",
        "screenshots",
        ["company_id", "employee_id", "captured_at"],
    )
    op.create_index(
        "ix_screenshots_company_captured_deleted",
        "screenshots",
        ["company_id", "captured_at", "deleted_at"],
    )
    op.create_index(
        "ix_time_adjustments_company_employee_date_status",
        "time_adjustment_requests",
        ["company_id", "employee_id", "requested_date", "status"],
    )
    op.create_index(
        "ix_leave_requests_company_employee_status_dates",
        "leave_requests",
        ["company_id", "employee_id", "status", "start_date", "end_date"],
    )
    op.create_index(
        "ix_overtime_records_company_employee_date_status",
        "overtime_records",
        ["company_id", "employee_id", "work_date", "status"],
    )
    op.create_index(
        "ix_work_schedule_overrides_company_date_permanent",
        "work_schedule_overrides",
        ["company_id", "effective_date", "permanent"],
    )
    op.create_index(
        "ix_devices_company_employee_last_seen",
        "devices",
        ["company_id", "employee_id", "last_seen_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_devices_company_employee_last_seen", table_name="devices")
    op.drop_index(
        "ix_work_schedule_overrides_company_date_permanent",
        table_name="work_schedule_overrides",
    )
    op.drop_index(
        "ix_overtime_records_company_employee_date_status",
        table_name="overtime_records",
    )
    op.drop_index(
        "ix_leave_requests_company_employee_status_dates",
        table_name="leave_requests",
    )
    op.drop_index(
        "ix_time_adjustments_company_employee_date_status",
        table_name="time_adjustment_requests",
    )
    op.drop_index(
        "ix_screenshots_company_captured_deleted",
        table_name="screenshots",
    )
    op.drop_index(
        "ix_screenshots_company_employee_captured",
        table_name="screenshots",
    )
    op.drop_index(
        "ix_activity_events_company_employee_time",
        table_name="activity_events",
    )
    op.drop_index(
        "ix_work_sessions_company_employee_open",
        table_name="work_sessions",
    )
    op.drop_index(
        "ix_work_sessions_company_employee_started",
        table_name="work_sessions",
    )
