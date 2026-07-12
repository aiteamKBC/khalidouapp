"""add task scheduling fields

Revision ID: 20260712_000014
Revises: 20260711_000013
"""
from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op

revision: str = "20260712_000014"
down_revision: str | None = "20260711_000013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

def upgrade() -> None:
    op.add_column("tasks", sa.Column("start_date", sa.Date(), nullable=True))
    op.add_column("tasks", sa.Column("deadline", sa.Date(), nullable=True))
    op.add_column("tasks", sa.Column("estimated_minutes", sa.Integer(), nullable=True))
    op.create_index("ix_tasks_start_date", "tasks", ["start_date"])
    op.create_index("ix_tasks_deadline", "tasks", ["deadline"])
    op.create_index("ix_tasks_stage_position", "tasks", ["stage", "position"])

def downgrade() -> None:
    op.drop_index("ix_tasks_stage_position", table_name="tasks")
    op.drop_index("ix_tasks_deadline", table_name="tasks")
    op.drop_index("ix_tasks_start_date", table_name="tasks")
    op.drop_column("tasks", "estimated_minutes")
    op.drop_column("tasks", "deadline")
    op.drop_column("tasks", "start_date")
