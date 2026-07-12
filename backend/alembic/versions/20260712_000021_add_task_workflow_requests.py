"""add actionable task workflow requests

Revision ID: 20260712_000021
Revises: 20260712_000020
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "20260712_000021"
down_revision: str | None = "20260712_000020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("admin_users", sa.Column("employee_id", sa.Uuid(), nullable=True))
    op.execute(
        """
        UPDATE admin_users
        SET employee_id = (
            SELECT employees.id
            FROM employees
            WHERE employees.company_id = admin_users.company_id
              AND lower(employees.email) = lower(admin_users.email)
            LIMIT 1
        )
        WHERE employee_id IS NULL
        """
    )
    op.create_foreign_key(
        "fk_admin_users_employee_id_employees",
        "admin_users",
        "employees",
        ["employee_id"],
        ["id"],
    )
    op.create_unique_constraint("uq_admin_users_employee_id", "admin_users", ["employee_id"])

    op.create_table(
        "task_workflow_requests",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("requested_by_employee_id", sa.Uuid(), nullable=False),
        sa.Column("request_type", sa.String(length=40), nullable=False),
        sa.Column("from_stage", sa.String(length=80), nullable=False),
        sa.Column("requested_stage", sa.String(length=80), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("request_note", sa.String(length=1000), nullable=True),
        sa.Column("decision_note", sa.String(length=1000), nullable=True),
        sa.Column("return_stage", sa.String(length=80), nullable=True),
        sa.Column("reviewed_by_admin_user_id", sa.Uuid(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "request_type IN ('task_creation', 'completion')",
            name="ck_task_workflow_requests_type",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_task_workflow_requests_status",
        ),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["requested_by_employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["reviewed_by_admin_user_id"], ["admin_users.id"]),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in [
        "company_id",
        "task_id",
        "requested_by_employee_id",
        "request_type",
        "status",
        "reviewed_by_admin_user_id",
    ]:
        op.create_index(
            f"ix_task_workflow_requests_{column}", "task_workflow_requests", [column]
        )

    op.add_column(
        "task_notifications", sa.Column("workflow_request_id", sa.Uuid(), nullable=True)
    )
    op.create_foreign_key(
        "fk_task_notifications_workflow_request_id",
        "task_notifications",
        "task_workflow_requests",
        ["workflow_request_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_task_notifications_workflow_request_id",
        "task_notifications",
        ["workflow_request_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_task_notifications_workflow_request_id", table_name="task_notifications"
    )
    op.drop_constraint(
        "fk_task_notifications_workflow_request_id",
        "task_notifications",
        type_="foreignkey",
    )
    op.drop_column("task_notifications", "workflow_request_id")

    op.drop_table("task_workflow_requests")

    op.drop_constraint("uq_admin_users_employee_id", "admin_users", type_="unique")
    op.drop_constraint(
        "fk_admin_users_employee_id_employees", "admin_users", type_="foreignkey"
    )
    op.drop_column("admin_users", "employee_id")
