"""add email delivery log

Revision ID: 20260712_000017
Revises: 20260712_000016
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260712_000017"
down_revision: str | None = "20260712_000016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "email_deliveries",
        sa.Column("company_id", sa.Uuid(), nullable=True),
        sa.Column("recipient", sa.String(length=320), nullable=False),
        sa.Column("category", sa.String(length=80), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("subject", sa.String(length=500), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.String(length=1000), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("fingerprint", name="uq_email_deliveries_fingerprint"),
    )
    op.create_index("ix_email_deliveries_company_id", "email_deliveries", ["company_id"])
    op.create_index("ix_email_deliveries_recipient", "email_deliveries", ["recipient"])
    op.create_index("ix_email_deliveries_category", "email_deliveries", ["category"])
    op.create_index("ix_email_deliveries_status", "email_deliveries", ["status"])


def downgrade() -> None:
    op.drop_table("email_deliveries")
