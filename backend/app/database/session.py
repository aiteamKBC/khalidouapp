from collections.abc import Generator
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings


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
    if not database_url.startswith("sqlite"):
        pool_options = {
            "pool_size": max(1, settings.database_pool_size),
            "max_overflow": max(0, settings.database_max_overflow),
            "pool_timeout": max(1, settings.database_pool_timeout_seconds),
            "pool_recycle": 1800,
        }
    return create_engine(
        database_url,
        pool_pre_ping=True,
        future=True,
        **pool_options,
    )


@lru_cache
def get_sessionmaker() -> sessionmaker[Session]:
    return sessionmaker(autocommit=False, autoflush=False, bind=get_engine())


def get_db() -> Generator[Session, None, None]:
    db = get_sessionmaker()()
    try:
        yield db
    finally:
        db.close()
