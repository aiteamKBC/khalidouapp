"""add time adjustment requests

Revision ID: 20260710_000005
Revises: 20260710_000004
Create Date: 2026-07-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260710_000005"
down_revision: str | None = "20260710_000004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def uuid_pk() -> sa.Column:
    return sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False)


def timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "time_adjustment_requests",
        uuid_pk(),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("employee_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("work_session_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("requested_date", sa.Date(), nullable=False),
        sa.Column("requested_seconds", sa.Integer(), nullable=False),
        sa.Column("approved_seconds", sa.Integer(), nullable=True),
        sa.Column("reason", sa.String(length=1000), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("reviewed_by_admin_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("admin_note", sa.String(length=1000), nullable=True),
        *timestamps(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["reviewed_by_admin_user_id"], ["admin_users.id"]),
        sa.ForeignKeyConstraint(["work_session_id"], ["work_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_time_adjustment_requests_company_id"), "time_adjustment_requests", ["company_id"], unique=False)
    op.create_index(op.f("ix_time_adjustment_requests_device_id"), "time_adjustment_requests", ["device_id"], unique=False)
    op.create_index(op.f("ix_time_adjustment_requests_employee_id"), "time_adjustment_requests", ["employee_id"], unique=False)
    op.create_index(op.f("ix_time_adjustment_requests_requested_date"), "time_adjustment_requests", ["requested_date"], unique=False)
    op.create_index(
        op.f("ix_time_adjustment_requests_reviewed_by_admin_user_id"),
        "time_adjustment_requests",
        ["reviewed_by_admin_user_id"],
        unique=False,
    )
    op.create_index(op.f("ix_time_adjustment_requests_status"), "time_adjustment_requests", ["status"], unique=False)
    op.create_index(op.f("ix_time_adjustment_requests_work_session_id"), "time_adjustment_requests", ["work_session_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_time_adjustment_requests_work_session_id"), table_name="time_adjustment_requests")
    op.drop_index(op.f("ix_time_adjustment_requests_status"), table_name="time_adjustment_requests")
    op.drop_index(op.f("ix_time_adjustment_requests_reviewed_by_admin_user_id"), table_name="time_adjustment_requests")
    op.drop_index(op.f("ix_time_adjustment_requests_requested_date"), table_name="time_adjustment_requests")
    op.drop_index(op.f("ix_time_adjustment_requests_employee_id"), table_name="time_adjustment_requests")
    op.drop_index(op.f("ix_time_adjustment_requests_device_id"), table_name="time_adjustment_requests")
    op.drop_index(op.f("ix_time_adjustment_requests_company_id"), table_name="time_adjustment_requests")
    op.drop_table("time_adjustment_requests")
