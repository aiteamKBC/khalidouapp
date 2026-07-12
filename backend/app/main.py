import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.exceptions import ApiError
from app.core.responses import error_response
from app.database.session import get_sessionmaker
from app.services.screenshot_retention import cleanup_expired_screenshots


async def retention_worker() -> None:
    while True:
        try:
            with get_sessionmaker()() as db:
                await asyncio.to_thread(cleanup_expired_screenshots, db)
        except Exception:
            # The next scheduled pass retries; API startup and requests remain available.
            pass
        await asyncio.sleep(max(1, settings.screenshot_cleanup_interval_hours) * 3600)


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(retention_worker())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(_, exc: Exception):
        return error_response(
            code="INTERNAL_SERVER_ERROR",
            message="An unexpected server error occurred.",
            status_code=500,
            details={"type": exc.__class__.__name__},
        )

    @app.exception_handler(ApiError)
    async def api_error_handler(_, exc: ApiError):
        return error_response(
            code=exc.code,
            message=exc.message,
            status_code=exc.status_code,
            details=exc.details,
        )

    app.include_router(api_router, prefix="/api/v1")
    return app


app = create_app()
