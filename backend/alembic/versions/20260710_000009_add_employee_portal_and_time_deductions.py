"""add employee portal and screenshot time deductions

Revision ID: 20260710_000009
Revises: 20260710_000008
Create Date: 2026-07-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "20260710_000009"
down_revision: str | None = "20260710_000008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("employees", sa.Column("portal_access_key_hash", sa.String(length=255), nullable=True))
    op.add_column("employees", sa.Column("portal_access_key_hint", sa.String(length=40), nullable=True))
    op.add_column("employees", sa.Column("portal_last_login_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("employees", sa.Column("portal_last_login_ip", sa.String(length=64), nullable=True))
    op.add_column("employees", sa.Column("portal_last_user_agent", sa.String(length=512), nullable=True))
    op.add_column("devices", sa.Column("last_ip_address", sa.String(length=64), nullable=True))
    op.add_column(
        "work_sessions",
        sa.Column("deducted_seconds", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "screenshots",
        sa.Column("tracked_seconds", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "screenshots",
        sa.Column("deleted_time_seconds", sa.Integer(), nullable=False, server_default="0"),
    )
    op.execute(
        """
        UPDATE screenshots AS screenshot
        SET tracked_seconds = GREATEST(
            1,
            (
                settings.screenshot_interval_minutes * 60.0
                / GREATEST(settings.screenshots_per_interval, 1)
            )::integer
        )
        FROM tracking_settings AS settings
        WHERE screenshot.company_id = settings.company_id
          AND screenshot.tracked_seconds = 0
        """
    )


def downgrade() -> None:
    op.drop_column("screenshots", "deleted_time_seconds")
    op.drop_column("screenshots", "tracked_seconds")
    op.drop_column("work_sessions", "deducted_seconds")
    op.drop_column("devices", "last_ip_address")
    op.drop_column("employees", "portal_last_user_agent")
    op.drop_column("employees", "portal_last_login_ip")
    op.drop_column("employees", "portal_last_login_at")
    op.drop_column("employees", "portal_access_key_hint")
    op.drop_column("employees", "portal_access_key_hash")
