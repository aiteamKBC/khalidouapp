"""add employee archive (offboarding) details

Revision ID: 20260923_000058
Revises: 20260917_000057

HR / Super Admin archive fired or resigned employees. The existing
``employees.status = 'archived'`` and ``archived_at`` columns keep marking the
archive itself; these additive, nullable columns record why the employee left,
their last working day (payroll and attendance stop counting after it), and who
archived them. No existing data is touched.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260923_000058"
down_revision: Union[str, None] = "20260917_000057"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("employees", sa.Column("archive_reason", sa.String(length=20), nullable=True))
    op.add_column("employees", sa.Column("last_working_day", sa.Date(), nullable=True))
    # Plain column (no FK): admin_users.employee_id already references
    # employees, and a reverse FK would create a table dependency cycle. The
    # audit log keeps the authoritative actor reference.
    op.add_column("employees", sa.Column("archived_by_admin_user_id", sa.Uuid(), nullable=True))


def downgrade() -> None:
    op.drop_column("employees", "archived_by_admin_user_id")
    op.drop_column("employees", "last_working_day")
    op.drop_column("employees", "archive_reason")
