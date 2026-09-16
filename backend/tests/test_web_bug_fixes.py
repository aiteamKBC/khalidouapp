"""Regression tests for the web audit findings (docs/WEB-BUG-AUDIT-AND-CLAUDE-PROMPT.md).

Each test fails on the pre-fix behavior and passes with the repair.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import settings


# --- W2: unexpected 500 responses must carry CORS headers for allowed origins ---


def _app_with_boom_route() -> FastAPI:
    from app.main import app

    if not any(getattr(route, "path", None) == "/api/v1/_boom" for route in app.routes):

        @app.get("/api/v1/_boom")
        def _boom():  # pragma: no cover - body is trivial
            raise RuntimeError("intentional test failure")

    return app


def test_unhandled_500_includes_cors_headers_for_allowed_origin() -> None:
    app = _app_with_boom_route()
    client = TestClient(app, raise_server_exceptions=False)
    origin = settings.cors_origins[0]

    response = client.get("/api/v1/_boom", headers={"Origin": origin})

    assert response.status_code == 500
    # The browser can only read the error (rather than seeing a masked CORS
    # failure) when the allowed origin is echoed back on the 500.
    assert response.headers.get("access-control-allow-origin") == origin
    assert response.headers.get("access-control-allow-credentials") == "true"


def test_unhandled_500_denies_disallowed_origin() -> None:
    app = _app_with_boom_route()
    client = TestClient(app, raise_server_exceptions=False)

    response = client.get(
        "/api/v1/_boom", headers={"Origin": "https://evil.example.com"}
    )

    assert response.status_code == 500
    assert "access-control-allow-origin" not in response.headers


def test_handled_api_error_still_has_cors_headers() -> None:
    # A handled error (validation 422) flows through CORSMiddleware normally.
    app = _app_with_boom_route()
    client = TestClient(app, raise_server_exceptions=False)
    origin = settings.cors_origins[0]

    response = client.get(
        "/api/v1/payroll/sheet", headers={"Origin": origin}
    )

    # Unauthenticated -> 401/403, but the CORS header must be present either way.
    assert response.headers.get("access-control-allow-origin") == origin


# --- W10: CSV formula-injection safety (backend payroll export) ---


def test_csv_safe_neutralizes_formula_injection() -> None:
    from app.api.v1.payroll import _csv_safe

    assert _csv_safe("=1+1") == "'=1+1"
    assert _csv_safe("+1+1") == "'+1+1"
    assert _csv_safe("@SUM(A1)") == "'@SUM(A1)"
    assert _csv_safe("-1+1") == "'-1+1"
    assert _csv_safe("	cmd") == "'	cmd"


def test_csv_safe_preserves_numbers_and_text() -> None:
    from app.api.v1.payroll import _csv_safe

    assert _csv_safe("-100.5") == "-100.5"
    assert _csv_safe("2026-09-14") == "2026-09-14"
    assert _csv_safe("Acme, Inc") == "Acme, Inc"
    assert _csv_safe(1234) == 1234
    assert _csv_safe(None) is None
