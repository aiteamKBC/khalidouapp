from datetime import UTC, datetime

from fastapi import APIRouter
from sqlalchemy import inspect, text

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
def health_check():
    return success_response(
        data={
            "status": "ok",
            "service": "backend-api",
            "timestamp": datetime.now(UTC).isoformat(),
        }
    )


@router.get("/health/db")
def database_health_check():
    with get_engine().connect() as connection:
        connection.execute(text("select 1"))
        inspector = inspect(connection)
        available_tables = set(inspector.get_table_names())
        missing_tables = [
            table_name
            for table_name in CRITICAL_DATABASE_TABLES
            if table_name not in available_tables
        ]
    if missing_tables:
        raise ApiError(
            "DATABASE_SCHEMA_UNHEALTHY",
            "The database schema is incomplete.",
            503,
            details={"missing_tables": missing_tables},
        )

    return success_response(
        data={
            "status": "ok",
            "database": "reachable",
            "schema": "ready",
            "timestamp": datetime.now(UTC).isoformat(),
        }
    )
