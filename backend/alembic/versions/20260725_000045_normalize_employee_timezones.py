"""use the workspace timezone for legacy employees

Revision ID: 20260725_000045
Revises: 20260725_000044
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260725_000045"
down_revision: Union[str, None] = "20260725_000044"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Older employee records were created with the old UTC default.  The
    # workspace operates in Cairo, so their shift boundaries were being read
    # two hours early and the app showed overtime during the paid shift.
    # Keep explicitly configured non-UTC timezones untouched.
    op.execute(
        sa.text(
            "UPDATE employees SET timezone = 'Africa/Cairo' "
            "WHERE timezone IS NULL OR timezone = 'UTC'"
        )
    )


def downgrade() -> None:
    # Do not rewrite employee choices on downgrade; timezone data is user data.
    pass
