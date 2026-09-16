"""Check local API configuration without opening a database or printing secrets.

Run from backend: python -m scripts.check_environment (or npm run check:env).
This checks configuration, not connectivity or whether a key matches ciphertext.
"""

import os
from urllib.parse import urlsplit

from pydantic import ValidationError
from pydantic_settings import SettingsError


def configuration_problems(settings) -> list[str]:
    problems = []
    if not settings.database_url:
        problems.append("DATABASE_URL is missing. Configure the intended database in backend/.env.")
        return problems
    try:
        target = urlsplit(settings.database_url)
        remote = not target.scheme.startswith("sqlite") and target.hostname not in {
            "localhost", "127.0.0.1", "::1",
        }
    except ValueError:
        return ["DATABASE_URL is not a valid database URL. Check backend/.env."]
    if remote and not settings.salary_encryption_key:
        problems.append(
            "SALARY_ENCRYPTION_KEY is missing for a remote database. Existing encrypted "
            "salary data requires the SAME key used by the backend that wrote it. "
            "Restore that key securely into backend/.env; do not generate a replacement. "
            "Alternatively use a separate development database with its own stable key."
        )
    return problems


def main() -> int:
    try:
        # Importing settings parses configuration only; do not import app.main,
        # an engine, migrations, or workers here.
        from app.core.config import settings
    except (ValidationError, SettingsError):
        # Pydantic's full exception can include secret values from the input.
        print("ERROR: Backend settings could not be loaded. Check backend/.env and shell overrides.")
        print("CORS_ORIGINS and TRUSTED_PROXY_IPS must be JSON arrays (see .env.example).")
        print("Production also requires strong JWT/device/salary secrets and HTTPS origins.")
        return 1

    print("Backend configuration check (no database connection, migration, or server startup).")
    for name in ("DATABASE_URL", "JWT_SECRET_KEY", "DEVICE_TOKEN_SECRET", "SALARY_ENCRYPTION_KEY"):
        value = getattr(settings, name.lower())
        if name in os.environ:
            source = "shell override"
        else:
            source = "backend/.env or application default"
        print(f"{name}: {'configured' if value else 'missing'} ({source})")
    problems = configuration_problems(settings)
    for problem in problems:
        print(f"ERROR: {problem}")
    if problems:
        return 1
    print("Configuration check passed. Database connectivity and decryption are not verified.")
    print("npm run dev runs migrations on DATABASE_URL; confirm it is the intended database.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
