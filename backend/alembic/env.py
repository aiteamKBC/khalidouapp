from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings
from app.database.base import Base
from app.database.session import normalize_database_url
from app import models  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    is_postgresql = settings.database_url.startswith("postgresql")
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table_schema="public" if is_postgresql else None,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = normalize_database_url(settings.database_url)
    connectable = engine_from_config(configuration, prefix="sqlalchemy.", poolclass=pool.NullPool)

    with connectable.connect() as connection:
        is_postgresql = connection.dialect.name == "postgresql"
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table_schema="public" if is_postgresql else None,
        )

        with context.begin_transaction():
            if is_postgresql:
                # Production uses a transaction pooler whose server connection
                # can have an empty or foreign search_path. Pin every Alembic
                # transaction before it looks up alembic_version or executes
                # unqualified migration DDL.
                connection.exec_driver_sql(
                    "select set_config('search_path', 'public', true)"
                )
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
