from types import SimpleNamespace
from pathlib import Path

from scripts.check_environment import configuration_problems


def test_remote_database_without_salary_key_has_actionable_error_without_secrets():
    problems = configuration_problems(SimpleNamespace(
        database_url="postgresql://user:private-password@database.example/app",
        salary_encryption_key="",
    ))
    assert len(problems) == 1
    assert "SAME key" in problems[0]
    assert "private-password" not in problems[0]


def test_remote_database_with_salary_key_passes_configuration_check():
    assert configuration_problems(SimpleNamespace(
        database_url="postgresql://user:password@database.example/app",
        salary_encryption_key="configured-key-not-a-connectivity-check",
    )) == []


def test_local_legacy_development_database_does_not_require_new_key():
    assert configuration_problems(SimpleNamespace(
        database_url="sqlite+pysqlite:///:memory:", salary_encryption_key="",
    )) == []


def test_missing_database_has_actionable_error():
    assert "DATABASE_URL is missing" in configuration_problems(SimpleNamespace(
        database_url="", salary_encryption_key="",
    ))[0]


def test_example_environment_lists_load_through_real_settings(monkeypatch):
    from app.core.config import Settings

    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    monkeypatch.delenv("TRUSTED_PROXY_IPS", raising=False)
    settings = Settings(
        _env_file=Path(__file__).resolve().parents[1] / ".env.example",
        APP_ENV="development",
    )
    assert "http://localhost:5174" in settings.cors_origins
    assert settings.trusted_proxy_ips == ["127.0.0.1", "::1"]
