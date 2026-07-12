"""add screenshots per interval setting

Revision ID: 20260710_000006
Revises: 20260710_000005
Create Date: 2026-07-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260710_000006"
down_revision: str | None = "20260710_000005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tracking_settings",
        sa.Column("screenshots_per_interval", sa.Integer(), nullable=False, server_default="2"),
    )
    op.alter_column("tracking_settings", "screenshots_per_interval", server_default=None)


def downgrade() -> None:
    op.drop_column("tracking_settings", "screenshots_per_interval")
