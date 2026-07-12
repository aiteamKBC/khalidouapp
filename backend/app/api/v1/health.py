from datetime import UTC, datetime

from fastapi import APIRouter
from sqlalchemy import text

from app.core.responses import success_response
from app.database.session import get_engine

router = APIRouter()


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

    return success_response(
        data={
            "status": "ok",
            "database": "reachable",
            "timestamp": datetime.now(UTC).isoformat(),
        }
    )
