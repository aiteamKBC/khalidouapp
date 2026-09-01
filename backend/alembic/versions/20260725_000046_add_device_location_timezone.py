"""add device location timezone

Revision ID: 20260725_000046
Revises: 20260725_000045
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260725_000046"
down_revision: Union[str, None] = "20260725_000045"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("devices", sa.Column("timezone", sa.String(length=80), nullable=True))
    op.add_column("devices", sa.Column("reported_timezone", sa.String(length=80), nullable=True))
    op.add_column("devices", sa.Column("country_code", sa.String(length=2), nullable=True))
    op.add_column("devices", sa.Column("timezone_source", sa.String(length=40), nullable=True))
    op.add_column(
        "devices",
        sa.Column("timezone_checked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("work_sessions", sa.Column("timezone", sa.String(length=80), nullable=True))

    # Existing devices and sessions keep the employee timezone that was used
    # before this migration.  New agent traffic will replace the device value
    # with the IP-detected location and snapshot it onto new sessions.
    op.execute(
        """
        UPDATE devices AS d
        SET timezone = e.timezone,
            timezone_source = 'employee_profile'
        FROM employees AS e
        WHERE e.id = d.employee_id
        """
    )
    op.execute(
        """
        UPDATE work_sessions AS ws
        SET timezone = COALESCE(d.timezone, e.timezone, 'UTC')
        FROM devices AS d, employees AS e
        WHERE d.id = ws.device_id
          AND e.id = ws.employee_id
        """
    )


def downgrade() -> None:
    op.drop_column("work_sessions", "timezone")
    op.drop_column("devices", "timezone_checked_at")
    op.drop_column("devices", "timezone_source")
    op.drop_column("devices", "country_code")
    op.drop_column("devices", "reported_timezone")
    op.drop_column("devices", "timezone")
