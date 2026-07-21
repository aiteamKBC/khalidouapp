"""add time adjustment sources

Revision ID: 20260722_000036
Revises: 20260721_000035
Create Date: 2026-07-22 00:00:36.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "20260722_000036"
down_revision: str | None = "20260721_000035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "time_adjustment_requests",
        sa.Column(
            "request_type",
            sa.String(length=40),
            nullable=False,
            server_default="manual_time",
        ),
    )
    op.add_column(
        "time_adjustment_requests",
        sa.Column("source_start_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "time_adjustment_requests",
        sa.Column("source_end_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        op.f("ix_time_adjustment_requests_request_type"),
        "time_adjustment_requests",
        ["request_type"],
        unique=False,
    )
    op.alter_column("time_adjustment_requests", "request_type", server_default=None)


def downgrade() -> None:
    op.drop_index(
        op.f("ix_time_adjustment_requests_request_type"),
        table_name="time_adjustment_requests",
    )
    op.drop_column("time_adjustment_requests", "source_end_at")
    op.drop_column("time_adjustment_requests", "source_start_at")
    op.drop_column("time_adjustment_requests", "request_type")
