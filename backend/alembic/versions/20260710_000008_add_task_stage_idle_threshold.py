"""add task stage and ten minute idle threshold

Revision ID: 20260710_000008
Revises: 20260710_000007
Create Date: 2026-07-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "20260710_000008"
down_revision: str | None = "20260710_000007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column("stage", sa.String(length=80), nullable=False, server_default="new_requests"),
    )
    op.create_index(op.f("ix_tasks_stage"), "tasks", ["stage"], unique=False)
    op.alter_column("tasks", "stage", server_default=None)
    op.execute(
        "UPDATE tracking_settings SET idle_threshold_minutes = 10 WHERE idle_threshold_minutes < 10"
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_tasks_stage"), table_name="tasks")
    op.drop_column("tasks", "stage")
    op.execute(
        "UPDATE tracking_settings SET idle_threshold_minutes = 5 WHERE idle_threshold_minutes = 10"
    )
