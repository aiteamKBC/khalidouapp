import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError, ProgrammingError

from app.api.v1 import health as health_api
from app.core.exceptions import ApiError
from app.main import app


def test_health_check() -> None:
    client = TestClient(app)

    response = client.get("/api/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["status"] == "ok"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["x-request-id"]


def test_database_health_rejects_an_incomplete_critical_schema(monkeypatch) -> None:
    class FakeConnection:
        class Dialect:
            name = "sqlite"

        dialect = Dialect()

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, statement):
            if "device_tokens" in str(statement):
                raise ProgrammingError(
                    str(statement),
                    {},
                    RuntimeError("device_tokens does not exist"),
                )
            return None

    class FakeEngine:
        def connect(self):
            return FakeConnection()

    monkeypatch.setattr(health_api, "get_health_engine", lambda: FakeEngine())

    with pytest.raises(ApiError) as exc_info:
        health_api._database_health_check()

    assert exc_info.value.status_code == 503
    assert exc_info.value.code == "DATABASE_SCHEMA_UNHEALTHY"


def test_database_health_converts_driver_failures_to_a_bounded_service_error(
    monkeypatch,
) -> None:
    class BrokenEngine:
        def connect(self):
            raise OperationalError("select 1", {}, RuntimeError("database timeout"))

    monkeypatch.setattr(health_api, "get_health_engine", lambda: BrokenEngine())

    with pytest.raises(ApiError) as exc_info:
        health_api._database_health_check()

    assert exc_info.value.status_code == 503
    assert exc_info.value.code == "DATABASE_UNREACHABLE"
