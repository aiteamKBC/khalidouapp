"""add auditable attendance corrections

Revision ID: 20260723_000041
Revises: 20260723_000040
Create Date: 2026-07-23 00:00:41.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260723_000041"
down_revision: str | None = "20260723_000040"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "attendance_corrections",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("corrected_start_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("corrected_end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payable_seconds_delta", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("updated_by_admin_user_id", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"], ["employees.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_admin_user_id"], ["admin_users.id"]
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "company_id",
            "employee_id",
            "work_date",
            name="uq_attendance_corrections_employee_day",
        ),
    )
    op.create_index(
        "ix_attendance_corrections_company_id",
        "attendance_corrections",
        ["company_id"],
    )
    op.create_index(
        "ix_attendance_corrections_employee_id",
        "attendance_corrections",
        ["employee_id"],
    )
    op.create_index(
        "ix_attendance_corrections_work_date",
        "attendance_corrections",
        ["work_date"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_attendance_corrections_work_date",
        table_name="attendance_corrections",
    )
    op.drop_index(
        "ix_attendance_corrections_employee_id",
        table_name="attendance_corrections",
    )
    op.drop_index(
        "ix_attendance_corrections_company_id",
        table_name="attendance_corrections",
    )
    op.drop_table("attendance_corrections")
