"""add profile avatars

Revision ID: 20260712_000020
Revises: 20260712_000019
"""

from alembic import op
import sqlalchemy as sa

revision = "20260712_000020"
down_revision = "20260712_000019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("admin_users", sa.Column("avatar_url", sa.Text(), nullable=True))
    op.add_column("employees", sa.Column("avatar_url", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("employees", "avatar_url")
    op.drop_column("admin_users", "avatar_url")
