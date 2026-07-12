"""add employee uploader to task attachments

Revision ID: 20260712_000019
Revises: 20260712_000018
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260712_000019"
down_revision: str | None = "20260712_000018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("task_attachments", sa.Column("uploader_employee_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_task_attachments_uploader_employee",
        "task_attachments",
        "employees",
        ["uploader_employee_id"],
        ["id"],
    )
    op.create_index("ix_task_attachments_uploader_employee_id", "task_attachments", ["uploader_employee_id"])


def downgrade() -> None:
    op.drop_index("ix_task_attachments_uploader_employee_id", table_name="task_attachments")
    op.drop_constraint("fk_task_attachments_uploader_employee", "task_attachments", type_="foreignkey")
    op.drop_column("task_attachments", "uploader_employee_id")
