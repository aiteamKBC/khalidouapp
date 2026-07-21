"""remove employee portal access keys

Revision ID: 20260720_000033
Revises: 20260720_000032
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260720_000033"
down_revision: Union[str, None] = "20260720_000032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("employees", "portal_access_key_hint")
    op.drop_column("employees", "portal_access_key_hash")


def downgrade() -> None:
    op.add_column(
        "employees",
        sa.Column("portal_access_key_hash", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "employees",
        sa.Column("portal_access_key_hint", sa.String(length=40), nullable=True),
    )
