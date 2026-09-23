"""set the default idle detection threshold to fifteen minutes

Revision ID: 20260917_000055
Revises: 20260805_000054

The idle *detection* threshold policy default moves from 10 to 15 minutes. This
is distinct from the daily paid automatic-idle grace (a separate 15-minute paid
allowance in attendance accounting), which is unchanged.

Migration 20260727_000049 previously force-pinned every company to 10 (the old
`enforce_idle_threshold` validator rewrote any submitted value to 10), so every
stored value is currently 10 and none are genuine custom choices. We move those
pinned rows to the new 15-minute default and leave any other value untouched, so
a company that later sets a deliberate custom threshold is preserved.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260917_000055"
down_revision: Union[str, None] = "20260805_000054"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE tracking_settings "
        "SET idle_threshold_minutes = 15 "
        "WHERE idle_threshold_minutes = 10"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE tracking_settings "
        "SET idle_threshold_minutes = 10 "
        "WHERE idle_threshold_minutes = 15"
    )
