"""add team member roles

Revision ID: 20260720_000032
Revises: 20260716_000031
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260720_000032"
down_revision: Union[str, None] = "20260716_000031"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "team_members",
        sa.Column("role", sa.String(length=50), nullable=False, server_default="member"),
    )


def downgrade() -> None:
    op.drop_column("team_members", "role")
