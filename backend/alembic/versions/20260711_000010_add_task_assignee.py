"""add optional employee assignee to tasks

Revision ID: 20260711_000010
Revises: 20260710_000009
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "20260711_000010"
down_revision: str | None = "20260710_000009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("assignee_employee_id", sa.Uuid(), nullable=True))
    op.create_index("ix_tasks_assignee_employee_id", "tasks", ["assignee_employee_id"])
    op.create_foreign_key(
        "fk_tasks_assignee_employee_id_employees",
        "tasks",
        "employees",
        ["assignee_employee_id"],
        ["id"],
    )
    op.execute("UPDATE tasks SET stage = 'new_requests' WHERE stage IN ('impact_effects', 'need_more_details')")
    op.execute("UPDATE tasks SET stage = 'backlog' WHERE stage = 'approved_backlog'")


def downgrade() -> None:
    op.drop_constraint("fk_tasks_assignee_employee_id_employees", "tasks", type_="foreignkey")
    op.drop_index("ix_tasks_assignee_employee_id", table_name="tasks")
    op.drop_column("tasks", "assignee_employee_id")
