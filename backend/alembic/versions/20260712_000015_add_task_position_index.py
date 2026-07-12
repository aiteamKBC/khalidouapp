"""add task position index

Revision ID: 20260712_000015
Revises: 20260712_000014
"""
from collections.abc import Sequence

from alembic import op

revision: str = "20260712_000015"
down_revision: str | None = "20260712_000014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index("ix_tasks_position", "tasks", ["position"])


def downgrade() -> None:
    op.drop_index("ix_tasks_position", table_name="tasks")
