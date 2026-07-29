"""drop the attendance cache so days recompute from sustained work

Revision ID: 20260729_000051
Revises: 20260729_000050

The workday used to begin at the first moment a machine was touched. An
employee who switched a PC on, used it for ten minutes and then left it for two
hours was recorded as starting two hours before they sat down, and lateness was
measured from that moment. The workday now begins at the first sustained block
of work.

daily_attendance is a derived cache and is never recalculated for a past date
while a snapshot exists, so every stored day would keep the old start. Clearing
it makes each day recompute from the retained activity events under the new
rule. Approvals live in time_adjustment_requests, overtime_records and
attendance_corrections and are re-applied during that recalculation.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260729_000051"
down_revision: Union[str, None] = "20260729_000050"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DELETE FROM daily_attendance")


def downgrade() -> None:
    # The cache rebuilds itself on the next read of each day.
    pass
