"""replace employee department with job title

Revision ID: 20260716_000028
Revises: 20260716_000027
"""
from typing import Sequence, Union
from alembic import op

revision: str = "20260716_000028"
down_revision: Union[str, None] = "20260716_000027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Renaming preserves every existing value; it only changes its meaning in
    # the product from an organization grouping to the employee's job title.
    op.alter_column("employees", "department", new_column_name="job_title")


def downgrade() -> None:
    op.alter_column("employees", "job_title", new_column_name="department")
