"""harden identity reset and task workflow

Revision ID: 20260712_000022
Revises: 20260712_000021
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "20260712_000022"
down_revision: str | None = "20260712_000021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("UPDATE admin_users SET role = 'general_admin' WHERE role = 'company_admin'")

    op.add_column("tasks", sa.Column("blocked_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tasks", sa.Column("blocked_by_employee_id", sa.Uuid(), nullable=True))
    op.add_column("tasks", sa.Column("blocked_by_admin_user_id", sa.Uuid(), nullable=True))
    op.add_column("tasks", sa.Column("block_resolution_note", sa.String(length=1000), nullable=True))
    op.create_foreign_key(
        "fk_tasks_blocked_by_employee",
        "tasks",
        "employees",
        ["blocked_by_employee_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_tasks_blocked_by_admin",
        "tasks",
        "admin_users",
        ["blocked_by_admin_user_id"],
        ["id"],
    )
    op.create_index("ix_tasks_blocked_by_employee_id", "tasks", ["blocked_by_employee_id"])
    op.create_index("ix_tasks_blocked_by_admin_user_id", "tasks", ["blocked_by_admin_user_id"])
    op.drop_column("tasks", "requires_review")

    op.create_index(
        "uq_task_workflow_requests_pending_task",
        "task_workflow_requests",
        ["task_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
        sqlite_where=sa.text("status = 'pending'"),
    )

    op.create_table(
        "admin_password_reset_tokens",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("admin_user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["admin_user_id"], ["admin_users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        "ix_admin_password_reset_tokens_company_id",
        "admin_password_reset_tokens",
        ["company_id"],
    )
    op.create_index(
        "ix_admin_password_reset_tokens_admin_user_id",
        "admin_password_reset_tokens",
        ["admin_user_id"],
    )
    op.create_index(
        "ix_admin_password_reset_tokens_token_hash",
        "admin_password_reset_tokens",
        ["token_hash"],
        unique=True,
    )
    op.create_index(
        "ix_admin_password_reset_tokens_expires_at",
        "admin_password_reset_tokens",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_table("admin_password_reset_tokens")
    op.drop_index(
        "uq_task_workflow_requests_pending_task",
        table_name="task_workflow_requests",
    )

    op.add_column(
        "tasks",
        sa.Column("requires_review", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.drop_index("ix_tasks_blocked_by_admin_user_id", table_name="tasks")
    op.drop_index("ix_tasks_blocked_by_employee_id", table_name="tasks")
    op.drop_constraint("fk_tasks_blocked_by_admin", "tasks", type_="foreignkey")
    op.drop_constraint("fk_tasks_blocked_by_employee", "tasks", type_="foreignkey")
    op.drop_column("tasks", "block_resolution_note")
    op.drop_column("tasks", "blocked_by_admin_user_id")
    op.drop_column("tasks", "blocked_by_employee_id")
    op.drop_column("tasks", "blocked_at")
