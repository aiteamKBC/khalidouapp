import pytest
from pydantic import ValidationError

from app.core.config import Settings


def production_settings(**overrides):
    values = {
        "APP_ENV": "production",
        "DATABASE_URL": "postgresql://user:password@database.example/khaliduo",
        "JWT_SECRET_KEY": "j" * 32,
        "DEVICE_TOKEN_SECRET": "d" * 32,
        "SALARY_ENCRYPTION_KEY": "s" * 32,
        "CORS_ORIGINS": "https://app.example.com",
        "APP_PUBLIC_URL": "https://app.example.com",
    }
    values.update(overrides)
    return Settings(**values)


def test_production_settings_accept_explicit_https_origins_and_strong_secrets():
    settings = production_settings()

    assert settings.cors_origins == ["https://app.example.com"]


@pytest.mark.parametrize(
    "override",
    [
        {"JWT_SECRET_KEY": "short"},
        {"DEVICE_TOKEN_SECRET": "short"},
        {"SALARY_ENCRYPTION_KEY": "short"},
        {"DATABASE_URL": ""},
        {"CORS_ORIGINS": "*"},
        {"CORS_ORIGINS": "http://app.example.com"},
        {"CORS_ORIGINS": "https://app.example.com/unexpected-path"},
        {"APP_PUBLIC_URL": "http://app.example.com"},
    ],
)
def test_production_settings_reject_unsafe_security_configuration(override):
    with pytest.raises(ValidationError):
        production_settings(**override)
