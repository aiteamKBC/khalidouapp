"""add task workflow, activity, notifications, and capacity

Revision ID: 20260712_000018
Revises: 20260712_000017
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260712_000018"
down_revision: str | None = "20260712_000017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("employees", sa.Column("weekly_capacity_minutes", sa.Integer(), nullable=False, server_default="2400"))
    op.add_column("tasks", sa.Column("created_by_employee_id", sa.Uuid(), nullable=True))
    op.add_column("tasks", sa.Column("priority", sa.String(length=20), nullable=False, server_default="medium"))
    op.add_column("tasks", sa.Column("requires_review", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("tasks", sa.Column("blocked_reason", sa.String(length=1000), nullable=True))
    op.add_column("tasks", sa.Column("review_note", sa.String(length=1000), nullable=True))
    op.add_column("tasks", sa.Column("completion_note", sa.String(length=1000), nullable=True))
    op.add_column("tasks", sa.Column("reviewed_by_admin_user_id", sa.Uuid(), nullable=True))
    op.add_column("tasks", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key("fk_tasks_created_by_employee", "tasks", "employees", ["created_by_employee_id"], ["id"])
    op.create_foreign_key("fk_tasks_reviewed_by_admin", "tasks", "admin_users", ["reviewed_by_admin_user_id"], ["id"])
    op.create_index("ix_tasks_created_by_employee_id", "tasks", ["created_by_employee_id"])
    op.create_index("ix_tasks_priority", "tasks", ["priority"])
    op.create_index("ix_tasks_reviewed_by_admin_user_id", "tasks", ["reviewed_by_admin_user_id"])
    op.create_table(
        "task_activities",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("admin_user_id", sa.Uuid(), nullable=True),
        sa.Column("employee_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["admin_user_id"], ["admin_users.id"]),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_task_activities_company_id", "task_activities", ["company_id"])
    op.create_index("ix_task_activities_task_id", "task_activities", ["task_id"])
    op.create_index("ix_task_activities_action", "task_activities", ["action"])
    op.create_table(
        "task_notifications",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=True),
        sa.Column("admin_user_id", sa.Uuid(), nullable=True),
        sa.Column("task_id", sa.Uuid(), nullable=True),
        sa.Column("notification_type", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("message", sa.String(length=1000), nullable=False),
        sa.Column("dedupe_key", sa.String(length=255), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["admin_user_id"], ["admin_users.id"]),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dedupe_key", name="uq_task_notifications_dedupe_key"),
    )
    for column in ["company_id", "employee_id", "admin_user_id", "task_id", "notification_type", "read_at"]:
        op.create_index(f"ix_task_notifications_{column}", "task_notifications", [column])


def downgrade() -> None:
    op.drop_table("task_notifications")
    op.drop_table("task_activities")
    op.drop_index("ix_tasks_reviewed_by_admin_user_id", table_name="tasks")
    op.drop_index("ix_tasks_priority", table_name="tasks")
    op.drop_index("ix_tasks_created_by_employee_id", table_name="tasks")
    op.drop_constraint("fk_tasks_reviewed_by_admin", "tasks", type_="foreignkey")
    op.drop_constraint("fk_tasks_created_by_employee", "tasks", type_="foreignkey")
    for column in ["reviewed_at", "reviewed_by_admin_user_id", "completion_note", "review_note", "blocked_reason", "requires_review", "priority", "created_by_employee_id"]:
        op.drop_column("tasks", column)
    op.drop_column("employees", "weekly_capacity_minutes")
