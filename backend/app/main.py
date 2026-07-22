import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.exceptions import ApiError
from app.core.responses import error_response
from app.database.session import get_sessionmaker
from app.services.screenshot_retention import cleanup_expired_screenshots

logger = logging.getLogger(__name__)


async def retention_worker() -> None:
    while True:
        try:
            with get_sessionmaker()() as db:
                await asyncio.to_thread(cleanup_expired_screenshots, db)
        except Exception:
            # The next scheduled pass retries; API startup and requests remain available.
            logger.exception("Screenshot retention cleanup failed; it will retry later")
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
    production = settings.app_env.lower() == "production"
    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        docs_url=None if production else "/docs",
        redoc_url=None if production else "/redoc",
        openapi_url=None if production else "/openapi.json",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def add_security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=(), payment=()",
        )
        response.headers.setdefault("X-Request-ID", uuid4().hex)
        if request.url.path.startswith(("/api/v1/auth", "/api/v1/employee-auth")):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(_, exc: Exception):
        logger.exception("Unhandled API exception", exc_info=exc)
        return error_response(
            code="INTERNAL_SERVER_ERROR",
            message="An unexpected server error occurred.",
            status_code=500,
            details={} if production else {"type": exc.__class__.__name__},
        )

    @app.exception_handler(ApiError)
    async def api_error_handler(_, exc: ApiError):
        response = error_response(
            code=exc.code,
            message=exc.message,
            status_code=exc.status_code,
            details=exc.details,
        )
        retry_after = exc.details.get("retry_after_seconds")
        if exc.status_code == 429 and retry_after is not None:
            response.headers["Retry-After"] = str(retry_after)
        return response

    app.include_router(api_router, prefix="/api/v1")
    return app


app = create_app()
