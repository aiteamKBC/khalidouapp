"""record sign-in attempts on another employee's computer

Revision ID: 20261025_000063
Revises: 20261017_000062

Signing in on a computer registered to another employee is refused. Each
refusal is now stored in ``device_sign_in_attempts`` so HR can see who tried to
use whose computer and reassign it from the Devices page.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261025_000063"
down_revision: Union[str, None] = "20261017_000062"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "device_sign_in_attempts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("device_id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("owner_employee_id", sa.Uuid(), nullable=False),
        sa.Column("first_attempted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_attempted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("windows_username", sa.String(length=255), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution", sa.String(length=30), nullable=True),
        sa.Column("resolved_by_admin_user_id", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["resolved_by_admin_user_id"], ["admin_users.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_device_sign_in_attempts_company_open",
        "device_sign_in_attempts",
        ["company_id", "resolved_at"],
    )
    op.create_index(
        "ix_device_sign_in_attempts_device_employee",
        "device_sign_in_attempts",
        ["device_id", "employee_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_device_sign_in_attempts_device_employee", "device_sign_in_attempts")
    op.drop_index("ix_device_sign_in_attempts_company_open", "device_sign_in_attempts")
    op.drop_table("device_sign_in_attempts")
