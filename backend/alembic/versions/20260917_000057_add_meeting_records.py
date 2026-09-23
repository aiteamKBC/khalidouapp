"""add meeting records for desktop Meeting Mode

Revision ID: 20260917_000057
Revises: 20260917_000056

A new, additive table for desktop-initiated Meeting Mode periods awaiting
Admin/HR review. No existing data is touched.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260917_000057"
down_revision: Union[str, None] = "20260917_000056"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "meeting_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("device_id", sa.Uuid(), nullable=True),
        sa.Column("work_session_id", sa.Uuid(), nullable=True),
        sa.Column("project_id", sa.Uuid(), nullable=True),
        sa.Column("task_id", sa.Uuid(), nullable=True),
        sa.Column("idempotency_key", sa.String(length=120), nullable=False),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("reason", sa.String(length=1000), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expected_end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lifecycle_state", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("approved_seconds", sa.Integer(), nullable=True),
        sa.Column("reviewed_by_admin_user_id", sa.Uuid(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("admin_note", sa.String(length=1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"]),
        sa.ForeignKeyConstraint(["work_session_id"], ["work_sessions.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"]),
        sa.ForeignKeyConstraint(["reviewed_by_admin_user_id"], ["admin_users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "company_id", "idempotency_key", name="uq_meeting_records_company_idempotency"
        ),
    )
    op.create_index("ix_meeting_records_company_id", "meeting_records", ["company_id"])
    op.create_index("ix_meeting_records_employee_id", "meeting_records", ["employee_id"])
    op.create_index("ix_meeting_records_device_id", "meeting_records", ["device_id"])
    op.create_index("ix_meeting_records_work_session_id", "meeting_records", ["work_session_id"])
    op.create_index("ix_meeting_records_project_id", "meeting_records", ["project_id"])
    op.create_index("ix_meeting_records_task_id", "meeting_records", ["task_id"])
    op.create_index("ix_meeting_records_work_date", "meeting_records", ["work_date"])
    op.create_index("ix_meeting_records_lifecycle_state", "meeting_records", ["lifecycle_state"])
    op.create_index("ix_meeting_records_status", "meeting_records", ["status"])
    op.create_index(
        "ix_meeting_records_reviewed_by_admin_user_id",
        "meeting_records",
        ["reviewed_by_admin_user_id"],
    )
    op.create_index(
        "ix_meeting_records_company_employee_date_status",
        "meeting_records",
        ["company_id", "employee_id", "work_date", "status"],
    )


def downgrade() -> None:
    op.drop_table("meeting_records")
