"""support fractional monthly leave credits

Revision ID: 20260716_000030
Revises: 20260716_000029
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "20260716_000030"
down_revision: Union[str, None] = "20260716_000029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "leave_balances",
        "credit_days",
        existing_type=sa.Integer(),
        type_=sa.Numeric(6, 2),
        existing_nullable=False,
        postgresql_using="credit_days::numeric(6,2)",
        server_default="21.00",
    )


def downgrade() -> None:
    op.alter_column(
        "leave_balances",
        "credit_days",
        existing_type=sa.Numeric(6, 2),
        type_=sa.Integer(),
        existing_nullable=False,
        postgresql_using="round(credit_days)::integer",
        server_default="21",
    )
