from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_DEFAULT_SECRET = "change-me-in-development"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_env: str = Field(default="development", alias="APP_ENV")
    app_name: str = Field(default="Khaliduo", alias="APP_NAME")
    database_url: str = Field(default="", alias="DATABASE_URL")
    database_pool_size: int = Field(default=10, alias="DATABASE_POOL_SIZE")
    database_max_overflow: int = Field(default=20, alias="DATABASE_MAX_OVERFLOW")
    database_pool_timeout_seconds: int = Field(default=30, alias="DATABASE_POOL_TIMEOUT_SECONDS")
    jwt_secret_key: str = Field(default=INSECURE_DEFAULT_SECRET, alias="JWT_SECRET_KEY")
    jwt_access_token_expire_minutes: int = Field(
        default=30, alias="JWT_ACCESS_TOKEN_EXPIRE_MINUTES"
    )
    jwt_refresh_token_expire_days: int = Field(default=7, alias="JWT_REFRESH_TOKEN_EXPIRE_DAYS")
    device_token_secret: str = Field(default=INSECURE_DEFAULT_SECRET, alias="DEVICE_TOKEN_SECRET")
    salary_encryption_key: str = Field(default="", alias="SALARY_ENCRYPTION_KEY")
    cors_origins: list[str] = Field(
        default=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:5174",
            "http://127.0.0.1:5174",
        ],
        alias="CORS_ORIGINS",
    )
    screenshot_storage_type: str = Field(default="local", alias="SCREENSHOT_STORAGE_TYPE")
    screenshot_storage_path: Path = Field(
        default=Path("./storage/screenshots"), alias="SCREENSHOT_STORAGE_PATH"
    )
    desktop_installer_path: Path = Field(
        default=Path("../frontend/desktop-agent/release-khaliduo/KhaliduoSetup.exe"),
        alias="DESKTOP_INSTALLER_PATH",
    )
    desktop_update_directory: Path = Field(
        default=Path("../frontend/desktop-agent/release-khaliduo"),
        alias="DESKTOP_UPDATE_DIRECTORY",
    )
    screenshot_max_file_size_mb: int = Field(default=10, alias="SCREENSHOT_MAX_FILE_SIZE_MB")
    default_screenshot_interval_minutes: int = Field(
        default=10, alias="DEFAULT_SCREENSHOT_INTERVAL_MINUTES"
    )
    default_screenshots_per_interval: int = Field(
        default=1, alias="DEFAULT_SCREENSHOTS_PER_INTERVAL"
    )
    default_idle_threshold_minutes: int = Field(default=10, alias="DEFAULT_IDLE_THRESHOLD_MINUTES")
    default_offline_threshold_minutes: int = Field(
        default=3, alias="DEFAULT_OFFLINE_THRESHOLD_MINUTES"
    )
    default_screenshot_retention_days: int = Field(
        default=30, alias="DEFAULT_SCREENSHOT_RETENTION_DAYS"
    )
    screenshot_thumbnail_width: int = Field(default=480, alias="SCREENSHOT_THUMBNAIL_WIDTH")
    screenshot_storage_warning_percent: int = Field(
        default=75, alias="SCREENSHOT_STORAGE_WARNING_PERCENT"
    )
    screenshot_cleanup_interval_hours: int = Field(
        default=6, alias="SCREENSHOT_CLEANUP_INTERVAL_HOURS"
    )

    # Outbound email. Preferred transport: Microsoft Graph (client-credentials
    # app; Exchange Online retired basic SMTP AUTH). Falls back to SMTP if only
    # SMTP_* is set, else logs to console (safe dev default; nothing breaks).
    graph_tenant_id: str = Field(default="", alias="GRAPH_TENANT_ID")
    graph_client_id: str = Field(default="", alias="GRAPH_CLIENT_ID")
    graph_client_secret: str = Field(default="", alias="GRAPH_CLIENT_SECRET")
    graph_sender: str = Field(default="", alias="GRAPH_SENDER")
    smtp_host: str = Field(default="", alias="SMTP_HOST")
    smtp_port: int = Field(default=587, alias="SMTP_PORT")
    smtp_user: str = Field(default="", alias="SMTP_USER")
    smtp_password: str = Field(default="", alias="SMTP_PASSWORD")
    smtp_from: str = Field(default="", alias="SMTP_FROM")
    smtp_use_tls: bool = Field(default=True, alias="SMTP_USE_TLS")
    email_cooldown_minutes: int = Field(default=15, alias="EMAIL_COOLDOWN_MINUTES")
    password_reset_expire_minutes: int = Field(default=30, alias="PASSWORD_RESET_EXPIRE_MINUTES")
    employee_invitation_expire_hours: int = Field(
        default=24, alias="EMPLOYEE_INVITATION_EXPIRE_HOURS"
    )
    email_allowed_recipients: str = Field(default="", alias="EMAIL_ALLOWED_RECIPIENTS")
    email_logo_url: str = Field(default="", alias="EMAIL_LOGO_URL")
    email_support_address: str = Field(default="", alias="EMAIL_SUPPORT_ADDRESS")
    app_public_url: str = Field(default="http://localhost:5174", alias="APP_PUBLIC_URL")
    trusted_proxy_ips: list[str] = Field(default=["127.0.0.1", "::1"], alias="TRUSTED_PROXY_IPS")

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, list):
            return value
        if not value:
            return []
        return [origin.strip() for origin in value.split(",") if origin.strip()]

    @field_validator("trusted_proxy_ips", mode="before")
    @classmethod
    def parse_trusted_proxy_ips(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, list):
            return value
        if not value:
            return []
        return [address.strip() for address in value.split(",") if address.strip()]

    @model_validator(mode="after")
    def reject_insecure_production_secrets(self) -> "Settings":
        if self.app_env.lower() == "production":
            if self.jwt_secret_key == INSECURE_DEFAULT_SECRET:
                raise ValueError("JWT_SECRET_KEY must be set to a real secret in production.")
            if self.device_token_secret == INSECURE_DEFAULT_SECRET:
                raise ValueError("DEVICE_TOKEN_SECRET must be set to a real secret in production.")
            if not self.salary_encryption_key:
                raise ValueError("SALARY_ENCRYPTION_KEY must be set in production.")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
