"""enforce the ten minute idle threshold

Revision ID: 20260727_000049
Revises: 20260727_000048
"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260727_000049"
down_revision: Union[str, None] = "20260727_000048"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE tracking_settings "
        "SET idle_threshold_minutes = 10 "
        "WHERE idle_threshold_minutes <> 10"
    )


def downgrade() -> None:
    # Previous company-specific values cannot be reconstructed safely.
    pass
