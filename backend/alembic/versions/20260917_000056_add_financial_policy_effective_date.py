"""add financial policy effective date to company payroll settings

Revision ID: 20260917_000056
Revises: 20260917_000055

Phase-1 financial policies (paid scheduled breaks, paid late allowance, break
bank / delayed break) activate on and after an employee-local effective date
stored per company. Null means inactive, so this migration is inert for existing
data: it adds a nullable column and changes no attendance or payroll figures.
Activation is a deliberate, reviewed step (see scripts/dry_run_break_policy.py),
never an automatic backfill.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260917_000056"
down_revision: Union[str, None] = "20260917_000055"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "company_payroll_settings",
        sa.Column("financial_policy_effective_date", sa.Date(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("company_payroll_settings", "financial_policy_effective_date")
