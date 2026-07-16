"""add leave balances and requests

Revision ID: 20260716_000026
Revises: 20260715_000025
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260716_000026"
down_revision: Union[str, None] = "20260715_000025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "leave_balances",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("credit_days", sa.Integer(), nullable=False, server_default="21"),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("employee_id", "year", name="uq_leave_balances_employee_year"),
    )
    op.create_index("ix_leave_balances_company_id", "leave_balances", ["company_id"])
    op.create_index("ix_leave_balances_employee_id", "leave_balances", ["employee_id"])
    op.create_index("ix_leave_balances_year", "leave_balances", ["year"])

    op.create_table(
        "leave_requests",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("requested_days", sa.Integer(), nullable=False),
        sa.Column("leave_type", sa.String(length=50), nullable=False, server_default="annual"),
        sa.Column("reason", sa.String(length=1000), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="pending"),
        sa.Column("reviewed_by_admin_user_id", sa.Uuid(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.String(length=1000), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["reviewed_by_admin_user_id"], ["admin_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("company_id", "employee_id", "start_date", "status", "reviewed_by_admin_user_id"):
        op.create_index(f"ix_leave_requests_{column}", "leave_requests", [column])


def downgrade() -> None:
    op.drop_table("leave_requests")
    op.drop_table("leave_balances")
