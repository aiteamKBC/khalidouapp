"""add employee onboarding fields

Revision ID: 20260716_000027
Revises: 20260716_000026
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "20260716_000027"
down_revision: Union[str, None] = "20260716_000026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("employees", sa.Column("start_date", sa.Date(), nullable=True))
    op.add_column("employees", sa.Column("annual_leave_days", sa.Integer(), nullable=False, server_default="16"))
    op.create_index("ix_employees_start_date", "employees", ["start_date"])
    op.add_column("employee_work_profiles", sa.Column("salary_type", sa.String(length=20), nullable=False, server_default="monthly"))


def downgrade() -> None:
    op.drop_column("employee_work_profiles", "salary_type")
    op.drop_index("ix_employees_start_date", table_name="employees")
    op.drop_column("employees", "annual_leave_days")
    op.drop_column("employees", "start_date")
