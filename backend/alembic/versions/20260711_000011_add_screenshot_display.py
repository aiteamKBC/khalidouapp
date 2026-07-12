"""identify the display captured by each screenshot

Revision ID: 20260711_000011
Revises: 20260711_000010
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "20260711_000011"
down_revision: str | None = "20260711_000010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("screenshots", sa.Column("display_id", sa.String(length=100), nullable=True))
    op.add_column("screenshots", sa.Column("display_name", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("screenshots", "display_name")
    op.drop_column("screenshots", "display_id")
