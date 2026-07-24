"""add encrypted bank payroll export fields to employee work profiles"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260724_000043"
down_revision: str | None = "20260723_000042"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "employee_work_profiles",
        sa.Column("bank_account_number", sa.Text(), nullable=True),
    )
    op.add_column(
        "employee_work_profiles",
        sa.Column("bank_employee_id", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("employee_work_profiles", "bank_employee_id")
    op.drop_column("employee_work_profiles", "bank_account_number")
