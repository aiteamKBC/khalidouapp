from collections.abc import Generator
from functools import lru_cache

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

MAX_POOL_CHECKOUT_TIMEOUT_SECONDS = 5
POSTGRES_IDLE_TRANSACTION_TIMEOUT_MILLISECONDS = 60_000
POSTGRES_LOCK_TIMEOUT_MILLISECONDS = 5_000
POSTGRES_STATEMENT_TIMEOUT_MILLISECONDS = 30_000


def _bound_pool_timeout(configured_seconds: int) -> int:
    return max(1, min(MAX_POOL_CHECKOUT_TIMEOUT_SECONDS, configured_seconds))


def _set_postgres_transaction_timeout(connection) -> None:
    connection.exec_driver_sql(
        "set local idle_in_transaction_session_timeout = "
        f"'{POSTGRES_IDLE_TRANSACTION_TIMEOUT_MILLISECONDS}ms'"
    )
    # A single abandoned attendance refresh must not leave every heartbeat
    # waiting on the same row lock until the API's worker pool is exhausted.
    connection.exec_driver_sql(
        f"set local lock_timeout = '{POSTGRES_LOCK_TIMEOUT_MILLISECONDS}ms'"
    )
    connection.exec_driver_sql(
        f"set local statement_timeout = '{POSTGRES_STATEMENT_TIMEOUT_MILLISECONDS}ms'"
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
        pool_options = {
            "pool_size": max(1, settings.database_pool_size),
            "max_overflow": max(0, settings.database_max_overflow),
            "pool_timeout": _bound_pool_timeout(settings.database_pool_timeout_seconds),
            "pool_recycle": 1800,
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
