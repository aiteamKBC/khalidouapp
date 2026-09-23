"""add shift reschedule requests

Revision ID: 20260923_000059
Revises: 20260923_000058

A new, additive table for one-day shift reschedule requests (desktop requests
reviewed by Super Admin/HR, plus admin emergency reschedules). Approved rows are
materialized as employee-scoped one-day work schedule overrides. No existing data
is touched.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260923_000059"
down_revision: Union[str, None] = "20260923_000058"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "shift_reschedule_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("requested_start", sa.Time(), nullable=False),
        sa.Column("requested_end", sa.Time(), nullable=False),
        sa.Column("original_start", sa.Time(), nullable=False),
        sa.Column("original_end", sa.Time(), nullable=False),
        sa.Column("reason", sa.String(length=1000), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("source", sa.String(length=20), nullable=False, server_default="employee"),
        sa.Column("created_by_admin_user_id", sa.Uuid(), nullable=True),
        sa.Column("reviewed_by_admin_user_id", sa.Uuid(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_reason", sa.String(length=1000), nullable=True),
        sa.Column("schedule_override_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["created_by_admin_user_id"], ["admin_users.id"]),
        sa.ForeignKeyConstraint(["reviewed_by_admin_user_id"], ["admin_users.id"]),
        sa.ForeignKeyConstraint(
            ["schedule_override_id"], ["work_schedule_overrides.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_shift_reschedule_requests_company_id", "shift_reschedule_requests", ["company_id"]
    )
    op.create_index(
        "ix_shift_reschedule_requests_employee_id", "shift_reschedule_requests", ["employee_id"]
    )
    op.create_index(
        "ix_shift_reschedule_requests_work_date", "shift_reschedule_requests", ["work_date"]
    )
    op.create_index(
        "ix_shift_reschedule_requests_status", "shift_reschedule_requests", ["status"]
    )
    op.create_index(
        "ix_shift_reschedule_requests_created_by_admin_user_id",
        "shift_reschedule_requests",
        ["created_by_admin_user_id"],
    )
    op.create_index(
        "ix_shift_reschedule_requests_reviewed_by_admin_user_id",
        "shift_reschedule_requests",
        ["reviewed_by_admin_user_id"],
    )
    op.create_index(
        "ix_shift_reschedules_company_employee_date_status",
        "shift_reschedule_requests",
        ["company_id", "employee_id", "work_date", "status"],
    )


def downgrade() -> None:
    op.drop_table("shift_reschedule_requests")
