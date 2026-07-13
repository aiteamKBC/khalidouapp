"""add person archiving and per-admin access control

Revision ID: 20260713_000024
Revises: 20260713_000023
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "20260713_000024"
down_revision: str | None = "20260713_000023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "admin_users",
        sa.Column("permission_mode", sa.String(length=20), nullable=False, server_default="role"),
    )
    op.add_column(
        "admin_users",
        sa.Column("data_scope", sa.String(length=30), nullable=True),
    )
    op.execute(
        "UPDATE admin_users SET data_scope = CASE "
        "WHEN role = 'general_admin' THEN 'company' ELSE 'assigned_teams' END"
    )
    op.alter_column(
        "admin_users",
        "data_scope",
        nullable=False,
        server_default="assigned_teams",
    )
    op.add_column(
        "admin_users",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "admin_users",
        sa.Column("status_before_archive", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "employees",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "employees",
        sa.Column("status_before_archive", sa.String(length=50), nullable=True),
    )

    op.create_table(
        "admin_permission_overrides",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("admin_user_id", sa.Uuid(), nullable=False),
        sa.Column("permission_key", sa.String(length=100), nullable=False),
        sa.Column("allowed", sa.Boolean(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["admin_user_id"], ["admin_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "admin_user_id",
            "permission_key",
            name="uq_admin_permission_overrides_admin_key",
        ),
    )
    op.create_index(
        "ix_admin_permission_overrides_company_id",
        "admin_permission_overrides",
        ["company_id"],
    )
    op.create_index(
        "ix_admin_permission_overrides_admin_user_id",
        "admin_permission_overrides",
        ["admin_user_id"],
    )
    op.create_index(
        "ix_admin_permission_overrides_permission_key",
        "admin_permission_overrides",
        ["permission_key"],
    )


def downgrade() -> None:
    op.drop_table("admin_permission_overrides")
    op.drop_column("employees", "status_before_archive")
    op.drop_column("employees", "archived_at")
    op.drop_column("admin_users", "status_before_archive")
    op.drop_column("admin_users", "archived_at")
    op.drop_column("admin_users", "data_scope")
    op.drop_column("admin_users", "permission_mode")
