"""Reset production to one super-admin account and one company.

This is an intentionally destructive maintenance command. It creates a PostgreSQL
backup and a private archive of uploaded files before removing application data.
The Alembic revision table and desktop release files are not touched.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tarfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.engine import Connection, Engine, make_url

# Running ``python scripts/reset_production_data.py`` puts only ``scripts`` on
# sys.path. Add the backend root so the maintenance command can import ``app``
# exactly like Alembic and Uvicorn do.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import settings  # noqa: E402
from app.database.base import Base  # noqa: E402
from app.database.session import get_engine  # noqa: E402
from app.models import AdminUser, Company  # noqa: E402


CONFIRMATION = "RESET-KHALIDUO-PRODUCTION"


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--keep-admin-email", required=True)
    parser.add_argument(
        "--backup-dir",
        type=Path,
        help="Private backup directory. Required with --execute.",
    )
    parser.add_argument("--execute", action="store_true")
    parser.add_argument(
        "--confirmation",
        help=f"Required with --execute; must equal {CONFIRMATION!r}.",
    )
    return parser.parse_args()


def _require_production(engine: Engine) -> None:
    if settings.app_env.lower() != "production":
        raise RuntimeError("Refusing to reset because APP_ENV is not production.")
    if engine.dialect.name != "postgresql":
        raise RuntimeError("Production reset supports PostgreSQL only.")


def _load_keepers(connection: Connection, email: str) -> tuple[dict[str, Any], dict[str, Any]]:
    normalized_email = email.strip().lower()
    admin_rows = connection.execute(
        select(AdminUser.__table__).where(func.lower(AdminUser.email) == normalized_email)
    ).mappings().all()
    if len(admin_rows) != 1:
        raise RuntimeError(
            f"Expected exactly one admin with email {normalized_email!r}; found {len(admin_rows)}."
        )

    admin = dict(admin_rows[0])
    if not admin["is_super_admin"] or admin["status"] != "active":
        raise RuntimeError("The preserved account must be an active super admin.")

    company_row = connection.execute(
        select(Company.__table__).where(Company.id == admin["company_id"])
    ).mappings().one_or_none()
    if company_row is None:
        raise RuntimeError("The preserved super admin has no matching company.")

    admin["employee_id"] = None
    admin["avatar_url"] = None
    admin["archived_at"] = None
    admin["status_before_archive"] = None
    admin["updated_at"] = datetime.now(UTC)
    return admin, dict(company_row)


def _table_counts(connection: Connection) -> dict[str, int]:
    return {
        table.name: int(connection.scalar(select(func.count()).select_from(table)) or 0)
        for table in Base.metadata.sorted_tables
    }


def _storage_roots() -> tuple[Path, Path]:
    screenshots = settings.screenshot_storage_path.resolve()
    attachments = (settings.screenshot_storage_path.parent / "task-attachments").resolve()
    for root in (screenshots, attachments):
        if root == Path(root.anchor) or len(root.parts) < 3:
            raise RuntimeError(f"Unsafe storage path: {root}")
    return screenshots, attachments


def _count_files(roots: tuple[Path, Path]) -> dict[str, int]:
    return {
        root.name: sum(1 for path in root.rglob("*") if path.is_file()) if root.exists() else 0
        for root in roots
    }


def _pg_dump_database_url():
    database_url = make_url(settings.database_url)
    host = database_url.host
    if host and host.endswith(".neon.tech") and "-pooler." in host:
        database_url = database_url.set(host=host.replace("-pooler.", ".", 1))
    return database_url


def _backup_database(destination: Path) -> None:
    database_url = _pg_dump_database_url()
    command = ["pg_dump", "--format=custom", "--file", str(destination)]
    if database_url.host:
        command.extend(["--host", database_url.host])
    if database_url.port:
        command.extend(["--port", str(database_url.port)])
    if database_url.username:
        command.extend(["--username", database_url.username])
    if database_url.database:
        command.append(database_url.database)

    environment = os.environ.copy()
    if database_url.password:
        environment["PGPASSWORD"] = database_url.password
    for query_key, environment_key in (
        ("sslmode", "PGSSLMODE"),
        ("channel_binding", "PGCHANNELBINDING"),
    ):
        query_value = database_url.query.get(query_key)
        if query_value:
            environment[environment_key] = str(query_value)
    environment.setdefault("PGCONNECT_TIMEOUT", "30")
    result = subprocess.run(
        command,
        check=False,
        capture_output=True,
        env=environment,
        text=True,
    )
    if result.returncode:
        message = result.stderr.strip() or result.stdout.strip() or "unknown pg_dump error"
        raise RuntimeError(f"PostgreSQL backup failed: {message}")
    destination.chmod(0o600)


def _backup_uploads(destination: Path, roots: tuple[Path, Path]) -> None:
    with tarfile.open(destination, "w:gz") as archive:
        for root in roots:
            if root.exists():
                archive.add(root, arcname=root.name, recursive=True)
    destination.chmod(0o600)


def _write_manifest(
    destination: Path,
    *,
    email: str,
    table_counts: dict[str, int],
    file_counts: dict[str, int],
    roots: tuple[Path, Path],
) -> None:
    destination.write_text(
        json.dumps(
            {
                "created_at": datetime.now(UTC).isoformat(),
                "preserved_admin_email": email,
                "table_counts_before_reset": table_counts,
                "file_counts_before_reset": file_counts,
                "storage_roots": [str(root) for root in roots],
            },
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    destination.chmod(0o600)


def _truncate_and_restore(
    engine: Engine,
    *,
    admin: dict[str, Any],
    company: dict[str, Any],
) -> None:
    table_names = ", ".join(
        engine.dialect.identifier_preparer.format_table(table)
        for table in Base.metadata.sorted_tables
    )
    with engine.begin() as connection:
        connection.exec_driver_sql(f"TRUNCATE TABLE {table_names} RESTART IDENTITY CASCADE")
        connection.execute(Company.__table__.insert().values(**company))
        connection.execute(AdminUser.__table__.insert().values(**admin))


def _clear_uploads(roots: tuple[Path, Path]) -> None:
    for root in roots:
        if not root.exists():
            continue
        for child in root.iterdir():
            if child.is_dir() and not child.is_symlink():
                shutil.rmtree(child)
            else:
                child.unlink()


def _verify_reset(engine: Engine, email: str) -> dict[str, Any]:
    with engine.connect() as connection:
        counts = _table_counts(connection)
        admins = connection.execute(
            select(
                AdminUser.email,
                AdminUser.is_super_admin,
                AdminUser.status,
                AdminUser.employee_id,
            )
        ).mappings().all()
        companies = int(connection.scalar(select(func.count()).select_from(Company)) or 0)

    expected_admin = email.strip().lower()
    if (
        companies != 1
        or len(admins) != 1
        or admins[0]["email"].lower() != expected_admin
        or not admins[0]["is_super_admin"]
        or admins[0]["status"] != "active"
        or admins[0]["employee_id"] is not None
    ):
        raise RuntimeError("Post-reset verification failed for the preserved account.")
    unexpected_rows = {
        table: count
        for table, count in counts.items()
        if table not in {"companies", "admin_users"} and count
    }
    if unexpected_rows:
        raise RuntimeError(f"Post-reset verification found unexpected rows: {unexpected_rows}")
    return {
        "companies": companies,
        "admins": [dict(row) for row in admins],
        "remaining_rows": sum(counts.values()),
    }


def main() -> None:
    args = _arguments()
    engine = get_engine()
    _require_production(engine)
    roots = _storage_roots()

    with engine.connect() as connection:
        admin, company = _load_keepers(connection, args.keep_admin_email)
        table_counts = _table_counts(connection)
    file_counts = _count_files(roots)

    preview = {
        "preserved_admin": admin["email"],
        "preserved_company": company["name"],
        "rows_to_remove": sum(table_counts.values()) - 2,
        "files_to_remove": sum(file_counts.values()),
        "table_counts": table_counts,
        "file_counts": file_counts,
    }
    print(json.dumps(preview, indent=2, sort_keys=True, default=str))
    if not args.execute:
        print("Dry run only; no data was changed.")
        return

    if args.confirmation != CONFIRMATION:
        raise RuntimeError(f"--confirmation must equal {CONFIRMATION!r}.")
    if args.backup_dir is None:
        raise RuntimeError("--backup-dir is required with --execute.")

    backup_dir = args.backup_dir.resolve()
    backup_dir.mkdir(mode=0o700, parents=True, exist_ok=False)
    _backup_database(backup_dir / "database.dump")
    _backup_uploads(backup_dir / "uploads.tar.gz", roots)
    _write_manifest(
        backup_dir / "manifest.json",
        email=admin["email"],
        table_counts=table_counts,
        file_counts=file_counts,
        roots=roots,
    )

    _truncate_and_restore(engine, admin=admin, company=company)
    _clear_uploads(roots)
    verification = _verify_reset(engine, admin["email"])
    verification["file_counts_after_reset"] = _count_files(roots)
    verification["backup_dir"] = str(backup_dir)
    print(json.dumps(verification, indent=2, sort_keys=True, default=str))


if __name__ == "__main__":
    main()
