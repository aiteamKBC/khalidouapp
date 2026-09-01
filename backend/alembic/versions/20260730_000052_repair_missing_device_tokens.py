"""repair a missing device token registry without reenrolling every desktop

Revision ID: 20260730_000052
Revises: 20260729_000051

Some production databases were stamped with the initial revision after their
tables had been created from an older model snapshot. Alembic therefore
believed ``device_tokens`` existed and never created it. Create the missing
registry idempotently and mark only the already-active devices from that
specific legacy state for one signed-token bootstrap.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260730_000052"
down_revision: str | None = "20260729_000051"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    device_tokens_missing = not inspector.has_table("device_tokens")

    if device_tokens_missing:
        op.create_table(
            "device_tokens",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column(
                "company_id",
                postgresql.UUID(as_uuid=True),
                nullable=False,
            ),
            sa.Column(
                "device_id",
                postgresql.UUID(as_uuid=True),
                nullable=False,
            ),
            sa.Column("token_hash", sa.String(length=128), nullable=False),
            sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
            sa.ForeignKeyConstraint(["device_id"], ["devices.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("token_hash"),
        )
        op.create_index(
            "ix_device_tokens_company_id",
            "device_tokens",
            ["company_id"],
            unique=False,
        )
        op.create_index(
            "ix_device_tokens_device_id",
            "device_tokens",
            ["device_id"],
            unique=False,
        )
        op.create_index(
            "ix_device_tokens_token_hash",
            "device_tokens",
            ["token_hash"],
            unique=False,
        )

    device_columns = {column["name"] for column in inspector.get_columns("devices")}
    if "legacy_token_bootstrap_allowed" not in device_columns:
        op.add_column(
            "devices",
            sa.Column(
                "legacy_token_bootstrap_allowed",
                sa.Boolean(),
                server_default=sa.false(),
                nullable=False,
            ),
        )

    if device_tokens_missing:
        op.execute(
            sa.text(
                """
                UPDATE devices
                SET legacy_token_bootstrap_allowed = TRUE
                WHERE status = 'active' AND revoked_at IS NULL
                """
            )
        )


def downgrade() -> None:
    # Dropping a repaired token registry would invalidate enrolled desktops
    # and destroy revocation data, so this repair is intentionally retained.
    pass
