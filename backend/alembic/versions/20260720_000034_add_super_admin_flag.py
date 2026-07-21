"""add super admin flag

Revision ID: 20260720_000034
Revises: 20260720_000033
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260720_000034"
down_revision: Union[str, None] = "20260720_000033"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "admin_users",
        sa.Column("is_super_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute(
        """
        WITH ranked AS (
            SELECT
                id,
                row_number() OVER (
                    PARTITION BY company_id
                    ORDER BY
                        CASE
                            WHEN status = 'active' AND role = 'general_admin' THEN 0
                            WHEN status = 'active' THEN 1
                            WHEN role = 'general_admin' THEN 2
                            ELSE 3
                        END,
                        created_at ASC,
                        id ASC
                ) AS rn
            FROM admin_users
            WHERE status != 'deleted'
        )
        UPDATE admin_users
        SET is_super_admin = true
        WHERE id IN (SELECT id FROM ranked WHERE rn = 1)
        """
    )
    op.create_index(
        "uq_admin_users_one_super_admin_per_company",
        "admin_users",
        ["company_id"],
        unique=True,
        postgresql_where=sa.text("is_super_admin = true"),
    )


def downgrade() -> None:
    op.drop_index("uq_admin_users_one_super_admin_per_company", table_name="admin_users")
    op.drop_column("admin_users", "is_super_admin")
