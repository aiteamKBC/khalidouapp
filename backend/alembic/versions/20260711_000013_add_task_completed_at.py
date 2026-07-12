"""record the real completion time for weekly task archives

Revision ID: 20260711_000013
Revises: 20260711_000012
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "20260711_000013"
down_revision: str | None = "20260711_000012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_tasks_completed_at", "tasks", ["completed_at"])
    op.execute("UPDATE tasks SET completed_at = updated_at WHERE stage = 'completed'")


def downgrade() -> None:
    op.drop_index("ix_tasks_completed_at", table_name="tasks")
    op.drop_column("tasks", "completed_at")
