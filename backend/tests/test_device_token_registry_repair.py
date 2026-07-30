"""Regression tests for repairing legacy databases without device token rows."""

import importlib.util
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260730_000052_repair_missing_device_tokens.py"
)


def load_migration():
    spec = importlib.util.spec_from_file_location(
        "repair_missing_device_tokens",
        MIGRATION_PATH,
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_migration(connection) -> None:
    module = load_migration()
    module.op = Operations(MigrationContext.configure(connection))
    module.upgrade()


def legacy_engine(*, include_token_registry: bool = False):
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    metadata = sa.MetaData()
    companies = sa.Table(
        "companies",
        metadata,
        sa.Column("id", sa.Uuid(), primary_key=True),
    )
    devices = sa.Table(
        "devices",
        metadata,
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("company_id", sa.Uuid(), sa.ForeignKey(companies.c.id), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    if include_token_registry:
        sa.Table(
            "device_tokens",
            metadata,
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column(
                "company_id",
                sa.Uuid(),
                sa.ForeignKey(companies.c.id),
                nullable=False,
            ),
            sa.Column(
                "device_id",
                sa.Uuid(),
                sa.ForeignKey(devices.c.id),
                nullable=False,
            ),
            sa.Column("token_hash", sa.String(128), nullable=False, unique=True),
            sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        )
    metadata.create_all(engine)
    return engine, companies, devices


def test_repair_creates_registry_and_enables_only_active_legacy_devices() -> None:
    engine, companies, devices = legacy_engine()
    company_id = uuid4()
    active_device_id = uuid4()
    revoked_device_id = uuid4()

    with engine.begin() as connection:
        connection.execute(companies.insert(), {"id": company_id})
        connection.execute(
            devices.insert(),
            [
                {
                    "id": active_device_id,
                    "company_id": company_id,
                    "status": "active",
                    "revoked_at": None,
                },
                {
                    "id": revoked_device_id,
                    "company_id": company_id,
                    "status": "revoked",
                    "revoked_at": datetime.now(UTC),
                },
            ],
        )

        run_migration(connection)
        inspector = sa.inspect(connection)
        assert inspector.has_table("device_tokens")
        assert "legacy_token_bootstrap_allowed" in {
            column["name"] for column in inspector.get_columns("devices")
        }

        repaired_devices = sa.Table("devices", sa.MetaData(), autoload_with=connection)
        bootstrap_flags = dict(
            connection.execute(
                sa.select(
                    repaired_devices.c.status,
                    repaired_devices.c.legacy_token_bootstrap_allowed,
                )
            ).all()
        )
        assert bootstrap_flags["active"] is True
        assert bootstrap_flags["revoked"] is False

        # The repair is safe if an operator retries it after an interrupted deploy.
        run_migration(connection)

    engine.dispose()


def test_existing_registry_does_not_authorize_legacy_bootstrap() -> None:
    engine, companies, devices = legacy_engine(include_token_registry=True)
    company_id = uuid4()
    device_id = uuid4()

    with engine.begin() as connection:
        connection.execute(companies.insert(), {"id": company_id})
        connection.execute(
            devices.insert(),
            {
                "id": device_id,
                "company_id": company_id,
                "status": "active",
                "revoked_at": None,
            },
        )

        run_migration(connection)
        repaired_devices = sa.Table("devices", sa.MetaData(), autoload_with=connection)
        bootstrap_allowed = connection.scalar(
            sa.select(repaired_devices.c.legacy_token_bootstrap_allowed).where(
                repaired_devices.c.id == device_id
            )
        )
        assert bootstrap_allowed is False

    engine.dispose()
