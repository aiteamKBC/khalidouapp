"""track automatic versus manual leave balances

Revision ID: 20260716_000031
Revises: 20260716_000030
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "20260716_000031"
down_revision: Union[str, None] = "20260716_000030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("leave_balances", sa.Column("manually_adjusted", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("leave_balances", "manually_adjusted")
