from datetime import UTC, datetime

from fastapi import APIRouter
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError, SQLAlchemyError

from app.core.exceptions import ApiError
from app.core.responses import success_response
from app.database.session import get_engine

router = APIRouter()
CRITICAL_DATABASE_TABLES = (
    "devices",
    "device_tokens",
    "work_sessions",
    "activity_events",
    "daily_attendance",
    "screenshots",
)


@router.get("/health")
async def health_check():
    return success_response(
        data={
            "status": "ok",
            "service": "backend-api",
            "timestamp": datetime.now(UTC).isoformat(),
        }
    )


@router.get("/health/db")
def database_health_check():
    try:
        with get_engine().connect() as connection:
            if connection.dialect.name == "postgresql":
                connection.execute(text("set local statement_timeout = '5000ms'"))
            connection.execute(text("select 1"))
            critical_tables = ", ".join(CRITICAL_DATABASE_TABLES)
            connection.execute(text(f"select 1 from {critical_tables} limit 0"))
    except ProgrammingError as error:
        raise ApiError(
            "DATABASE_SCHEMA_UNHEALTHY",
            "The database schema is incomplete.",
            503,
        ) from error
    except SQLAlchemyError as error:
        raise ApiError(
            "DATABASE_UNREACHABLE",
            "The database did not answer the health check in time.",
            503,
        ) from error
    return success_response(
        data={
            "status": "ok",
            "database": "reachable",
            "schema": "ready",
            "timestamp": datetime.now(UTC).isoformat(),
        }
    )
