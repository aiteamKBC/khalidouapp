"""set default annual leave to 21 days

Revision ID: 20260716_000029
Revises: 20260716_000028
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "20260716_000029"
down_revision: Union[str, None] = "20260716_000028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("employees", "annual_leave_days", server_default="21")
    # Version 000027 introduced 16 as the temporary default. Preserve any
    # other custom values while moving those untouched defaults to 21.
    op.execute("UPDATE employees SET annual_leave_days = 21 WHERE annual_leave_days = 16")


def downgrade() -> None:
    op.execute("UPDATE employees SET annual_leave_days = 16 WHERE annual_leave_days = 21")
    op.alter_column("employees", "annual_leave_days", server_default="16")
