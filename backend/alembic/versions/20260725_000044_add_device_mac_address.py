"""add device mac address

Revision ID: 20260725_000044
Revises: 20260724_000043
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260725_000044"
down_revision: Union[str, None] = "20260724_000043"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("devices", sa.Column("mac_address", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("devices", "mac_address")
