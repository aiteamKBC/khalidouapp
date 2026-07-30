import pytest
from fastapi.testclient import TestClient

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
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, _statement):
            return None

    class FakeEngine:
        def connect(self):
            return FakeConnection()

    class FakeInspector:
        def get_table_names(self):
            return [
                table_name
                for table_name in health_api.CRITICAL_DATABASE_TABLES
                if table_name != "device_tokens"
            ]

    monkeypatch.setattr(health_api, "get_engine", lambda: FakeEngine())
    monkeypatch.setattr(health_api, "inspect", lambda _connection: FakeInspector())

    with pytest.raises(ApiError) as exc_info:
        health_api.database_health_check()

    assert exc_info.value.status_code == 503
    assert exc_info.value.details == {"missing_tables": ["device_tokens"]}
