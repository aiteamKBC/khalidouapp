"""add device windows username

Revision ID: 20260710_000002
Revises: 20260710_000001
Create Date: 2026-07-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260710_000002"
down_revision: str | None = "20260710_000001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("devices", sa.Column("windows_username", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("devices", "windows_username")
