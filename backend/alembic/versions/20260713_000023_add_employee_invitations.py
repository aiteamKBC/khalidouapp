"""add employee invitations and portal passwords

Revision ID: 20260713_000023
Revises: 20260712_000022
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "20260713_000023"
down_revision: str | None = "20260712_000022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "employees",
        sa.Column("portal_password_hash", sa.String(length=255), nullable=True),
    )
    op.create_table(
        "employee_invitations",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        "ix_employee_invitations_company_id",
        "employee_invitations",
        ["company_id"],
    )
    op.create_index(
        "ix_employee_invitations_employee_id",
        "employee_invitations",
        ["employee_id"],
    )
    op.create_index(
        "ix_employee_invitations_token_hash",
        "employee_invitations",
        ["token_hash"],
        unique=True,
    )
    op.create_index(
        "ix_employee_invitations_expires_at",
        "employee_invitations",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_table("employee_invitations")
    op.drop_column("employees", "portal_password_hash")
