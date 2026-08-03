import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from anyio.to_thread import current_default_thread_limiter

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.exceptions import ApiError
from app.core.responses import error_response
from app.database.session import get_sessionmaker
from app.services.screenshot_retention import cleanup_expired_screenshots

logger = logging.getLogger(__name__)


def _is_agent_ingestion_path(path: str) -> bool:
    if path.startswith("/api/v1/agent/screenshots/"):
        return True
    if not path.startswith("/api/v1/agent/sessions/"):
        return False
    return path.endswith(("/heartbeat", "/events"))


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
    # Synchronous SQLAlchemy endpoints run in AnyIO's worker pool. Keep that
    # pool aligned with the bounded database capacity so agent retry bursts do
    # not open dozens of transactions and starve interactive admin requests.
    current_default_thread_limiter().total_tokens = settings.api_thread_pool_size
    task = asyncio.create_task(retention_worker())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


def create_app() -> FastAPI:
    production = settings.app_env.lower() == "production"
    agent_ingestion_slots = asyncio.Semaphore(settings.agent_ingestion_concurrency)
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
        started_at = perf_counter()
        ingestion_slot_acquired = False
        if _is_agent_ingestion_path(request.url.path):
            if agent_ingestion_slots.locked():
                response = error_response(
                    code="AGENT_INGESTION_BUSY",
                    message="The server is catching up. Please retry this tracking update shortly.",
                    status_code=429,
                    details={"retry_after_seconds": 2},
                )
                response.headers["Retry-After"] = "2"
            else:
                await agent_ingestion_slots.acquire()
                ingestion_slot_acquired = True
                response = None
        else:
            response = None
        try:
            if response is None:
                response = await call_next(request)
        finally:
            if ingestion_slot_acquired:
                agent_ingestion_slots.release()
        duration_ms = (perf_counter() - started_at) * 1000
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=(), payment=()",
        )
        if production:
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        response.headers.setdefault("X-Request-ID", uuid4().hex)
        response.headers.setdefault("Server-Timing", f"app;dur={duration_ms:.1f}")
        if request.url.path.startswith(("/api/v1/auth", "/api/v1/employee-auth")):
            response.headers["Cache-Control"] = "no-store"
        if duration_ms >= 750:
            logger.warning(
                "Slow API request method=%s path=%s status=%s duration_ms=%.1f",
                request.method,
                request.url.path,
                response.status_code,
                duration_ms,
            )
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
