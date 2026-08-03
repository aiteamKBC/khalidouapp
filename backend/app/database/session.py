from collections.abc import Generator
from functools import lru_cache

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from app.core.config import settings

MAX_POOL_CHECKOUT_TIMEOUT_SECONDS = 5
MAX_DATABASE_POOL_SIZE = 10
MAX_DATABASE_CONNECTIONS = 12
POSTGRES_IDLE_TRANSACTION_TIMEOUT_MILLISECONDS = 60_000
POSTGRES_LOCK_TIMEOUT_MILLISECONDS = 5_000
POSTGRES_STATEMENT_TIMEOUT_MILLISECONDS = 30_000


def _bound_pool_timeout(configured_seconds: int) -> int:
    return max(1, min(MAX_POOL_CHECKOUT_TIMEOUT_SECONDS, configured_seconds))


def _effective_pool_limits(configured_size: int, configured_overflow: int) -> tuple[int, int]:
    pool_size = min(MAX_DATABASE_POOL_SIZE, max(1, configured_size))
    max_overflow = min(
        max(0, configured_overflow),
        MAX_DATABASE_CONNECTIONS - pool_size,
    )
    return pool_size, max_overflow


def _set_postgres_transaction_timeout(connection) -> None:
    # One round trip matters on a remote transaction pooler. set_config(...,
    # true) has the same transaction-local scope as three SET LOCAL commands.
    connection.exec_driver_sql(
        "select "
        "set_config('idle_in_transaction_session_timeout', "
        f"'{POSTGRES_IDLE_TRANSACTION_TIMEOUT_MILLISECONDS}ms', true), "
        "set_config('lock_timeout', "
        f"'{POSTGRES_LOCK_TIMEOUT_MILLISECONDS}ms', true), "
        "set_config('statement_timeout', "
        f"'{POSTGRES_STATEMENT_TIMEOUT_MILLISECONDS}ms', true)"
    )


def normalize_database_url(database_url: str) -> str:
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    return database_url


@lru_cache
def get_engine() -> Engine:
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required for database operations.")

    database_url = normalize_database_url(settings.database_url)
    pool_options = {}
    connect_args = {}
    if not database_url.startswith("sqlite"):
        pool_size, max_overflow = _effective_pool_limits(
            settings.database_pool_size,
            settings.database_max_overflow,
        )
        pool_options = {
            "pool_size": pool_size,
            "max_overflow": max_overflow,
            "pool_timeout": _bound_pool_timeout(settings.database_pool_timeout_seconds),
            "pool_recycle": 1800,
            "pool_use_lifo": True,
        }
    if database_url.startswith("postgresql"):
        connect_args = {
            "connect_timeout": _bound_pool_timeout(settings.database_pool_timeout_seconds)
        }
    engine = create_engine(
        database_url,
        pool_pre_ping=True,
        future=True,
        connect_args=connect_args,
        **pool_options,
    )
    if database_url.startswith("postgresql"):
        event.listen(engine, "begin", _set_postgres_transaction_timeout)
    return engine


@lru_cache
def get_health_engine() -> Engine:
    """Return a reserved connection pool that cannot be starved by API traffic."""
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required for database operations.")

    database_url = normalize_database_url(settings.database_url)
    if database_url.startswith("sqlite"):
        return get_engine()

    connect_args = {}
    if database_url.startswith("postgresql"):
        connect_args["connect_timeout"] = _bound_pool_timeout(
            settings.database_pool_timeout_seconds
        )
    engine = create_engine(
        database_url,
        poolclass=QueuePool,
        pool_size=1,
        max_overflow=0,
        pool_timeout=_bound_pool_timeout(settings.database_pool_timeout_seconds),
        pool_recycle=300,
        pool_pre_ping=True,
        pool_use_lifo=True,
        future=True,
        connect_args=connect_args,
    )
    if database_url.startswith("postgresql"):
        event.listen(engine, "begin", _set_postgres_transaction_timeout)
    return engine


@lru_cache
def get_sessionmaker() -> sessionmaker[Session]:
    return sessionmaker(
        autocommit=False,
        autoflush=False,
        expire_on_commit=False,
        bind=get_engine(),
    )


def get_db() -> Generator[Session, None, None]:
    db = get_sessionmaker()()
    try:
        yield db
    finally:
        db.close()
